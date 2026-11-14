// Asking again when an answer is slow. The same idea as web/src/core/hedge.ts.
//
// A free cloud model usually answers in about a second, but now and then one request is held
// for 10, 20 or 40 seconds while the next one is answered at once. A person in the middle of a
// sentence cannot wait for that, so a request that has not been answered after a short time is
// asked again, and whichever attempt answers first is the one that is used.
package app.roundabout.words.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.onTimeout
import kotlinx.coroutines.selects.select

data class Hedged<T>(
    val value: T,
    /** Which attempt answered: 0 is the first one. */
    val attempt: Int,
    /** How many attempts were begun in all. */
    val attempts: Int,
)

private class Outcome<T>(val attempt: Int, val value: T?, val error: Throwable?)

/**
 * Run `ask(0)`. While no attempt has answered, begin one more attempt every `everyMs`, up to
 * `max` attempts. An attempt that fails is replaced at once. The first attempt to answer wins
 * and the others are cancelled.
 *
 * A failed attempt does not count towards `max`, but no more than twice `max` attempts are
 * ever begun. Fails only when all attempts have failed, with the first attempt's error. `everyMs` of 0
 * means a slow attempt is never asked again (a failed one is still replaced); `max` of 1 means
 * one plain attempt.
 */
@OptIn(ExperimentalCoroutinesApi::class)
suspend fun <T> hedge(everyMs: Long, max: Int, ask: suspend (attempt: Int) -> T): Hedged<T> = coroutineScope {
    val outcomes = Channel<Outcome<T>>(Channel.UNLIMITED)
    val jobs = ArrayList<Job>()
    var begun = 0
    var open = 0
    var fails = 0
    var firstError: Throwable? = null

    // An attempt that failed does not use up one of the `max` tries: a model that refuses at
    // once (its quota is used up) must not crowd out a second try of a model that is only slow.
    // The total is still limited, so that a service that is down is not asked for ever.
    val limit = if (max > 1) max * 2 else 1
    fun room() = begun - fails < max && begun < limit

    fun begin() {
        val i = begun++
        open++
        jobs += launch {
            val outcome = try {
                Outcome(i, ask(i), null)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Outcome<T>(i, null, e)
            }
            outcomes.send(outcome)
        }
    }

    try {
        begin()
        var answer: Hedged<T>? = null
        while (answer == null) {
            val canAskAgain = everyMs > 0 && room()
            val outcome: Outcome<T>? = select {
                outcomes.onReceive { it }
                if (canAskAgain) onTimeout(everyMs) { null }
            }
            if (outcome == null) {
                begin() // slow: ask again
                continue
            }
            open--
            val error = outcome.error
            if (error == null) {
                @Suppress("UNCHECKED_CAST")
                answer = Hedged(outcome.value as T, outcome.attempt, begun)
            } else {
                if (firstError == null || outcome.attempt == 0) firstError = error
                fails++
                if (room()) begin() else if (open == 0) throw checkNotNull(firstError)
            }
        }
        checkNotNull(answer)
    } finally {
        jobs.forEach { it.cancel() }
    }
}

/**
 * Which cloud model each attempt asks, in turn: the main model, then each backup model; after
 * the last one the list starts again. A model that is resting (it has just said that its quota
 * is used up) is left out. `quick`, when given, goes first: the model that answered last time
 * when the main model was slow, because a busy model stays busy for a while.
 */
fun attemptOrder(main: String, backups: List<String>, resting: (String) -> Boolean = { false }, quick: String = ""): List<String> {
    val list = (listOf(main) + backups).map { it.trim() }.filter { it.isNotEmpty() }.distinct().filter { !resting(it) }.toMutableList()
    if (list.isEmpty()) return listOf(main)
    val at = list.indexOf(quick)
    if (at > 0) list.add(0, list.removeAt(at))
    return list
}

private val RETRY_IN = Regex("""retry in\s+(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?""", RegexOption.IGNORE_CASE)

/**
 * How long to leave a cloud model alone after it has said that its quota is used up. The reply
 * says when to try again ("Please retry in 50.8s", or "in 12h35m27s" when the day's quota is
 * gone). That is used, but never less than 10 seconds and never more than half an hour, so a
 * model whose quota has been raised or reset is found again without a restart.
 */
fun restAfterQuota(message: String): Long {
    val m = RETRY_IN.find(message)
    val asked = if (m == null) 0L else {
        val hours = m.groupValues[1].toDoubleOrNull() ?: 0.0
        val minutes = m.groupValues[2].toDoubleOrNull() ?: 0.0
        val seconds = m.groupValues[3].toDoubleOrNull() ?: 0.0
        Math.round((hours * 3600 + minutes * 60 + seconds) * 1000)
    }
    return (if (asked > 0) asked else 60_000L).coerceIn(10_000L, 30 * 60_000L)
}

/** True when an error says that a quota or a rate limit was reached. */
fun isQuotaError(e: Throwable?): Boolean {
    var cause = e
    while (cause != null) {
        if (cause is CloudUnavailable) return false
        if (cause is QuotaError) return true
        val text = "${cause::class.simpleName} ${cause.message}"
        if (Regex("""\b429\b|RESOURCE_EXHAUSTED|quota""", RegexOption.IGNORE_CASE).containsMatchIn(text)) return true
        cause = cause.cause
    }
    return false
}

/** A cloud model said that its quota is used up. The message carries the service's own words. */
class QuotaError(message: String, cause: Throwable? = null) : Exception(message, cause)

/** No cloud model answered, and not because all of them are over their quota. Trying again may work. */
class CloudUnavailable(message: String) : Exception(message)
