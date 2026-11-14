// Finding a word: route the request, call the hybrid model, and cover for a side that is slow.
// The same behaviour as web/src/core/find.ts. Nothing here touches Android or Firebase, so the
// whole flow is unit-tested on the build machine with a stand-in model (see FinderTest).
package app.roundabout.words.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

enum class Side { DEVICE, CLOUD }

/** What one model call returned: the words, which side answered, and how long it took. */
data class Reply(val words: List<String>, val side: Side, val ms: Long)

/**
 * One call to the hybrid model in one inference mode. `cloudModel` picks the cloud model for
 * this call (null = the main one). The Android implementation is ai/Hybrid.kt.
 */
fun interface Asker {
    suspend fun ask(mode: Mode, prompt: String, cloudModel: String?): Reply
}

/** Values that can be changed without a new release (Remote Config fills them when it loads). */
class Settings(
    @Volatile var cloudModel: String,
    @Volatile var cloudBackupModels: List<String>,
    @Volatile var guessCount: Int,
    /** How long the on-device model gets to answer before the cloud is asked instead. */
    @Volatile var deviceTimeoutMs: Long = 8_000,
    /** When the cloud is asked first although the device is ready: how long before the device answers instead. */
    @Volatile var cloudPatienceMs: Long = 1_500,
    /** How long a cloud request gets before it is asked again. 0 = never ask again. */
    @Volatile var cloudHedgeMs: Long = 1_500,
    /** Cloud "thinking" level for these short jobs: "" leaves the model's default. */
    @Volatile var cloudThinking: String = "MINIMAL",
)

data class Answer(
    val guesses: List<Guess>,
    /** Which side produced the guesses. null if no model ran. */
    val side: Side?,
    val ms: Long,
    val why: String,
    val canAskCloud: Boolean,
    /** Set when nothing could run. The text is ready to show. */
    val blocked: String? = null,
    /**
     * Set when this phone answered because the cloud was slow: the cloud's request is still
     * open. It ends with the tiles plus the cloud's words, or null if the cloud never answered.
     */
    val later: Deferred<List<Guess>?>? = null,
)

class Finder(
    private val asker: Asker,
    private val pack: Pack,
    private val settings: Settings,
    private val picture: (String) -> String = { "" },
    private val now: () -> Long = System::currentTimeMillis,
) {
    /** The on-device model runs one prompt at a time. */
    private val deviceQueue = Mutex()

    /** A cloud model that has just said its quota is used up is left alone for as long as its reply asks. */
    private val resting = HashMap<String, Long>()

    /** The backup model that answered last time when the main model was slow. It is asked first for a few minutes. */
    private var quick: Pair<String, Long>? = null

    @Volatile private var cloudPausedUntil = 0L

    /** False for a while after every cloud model has said that its quota is used up. */
    fun cloudUp(): Boolean = now() >= cloudPausedUntil

    private fun isResting(model: String): Boolean = synchronized(resting) { now() < (resting[model] ?: 0L) }

    private fun noCloudModelAwake(): Boolean = (listOf(settings.cloudModel) + settings.cloudBackupModels).all { it.isBlank() || isResting(it) }

    private class CloudReply(val reply: Reply, val why: String?)

    /**
     * A request that goes to the cloud, asked again if it is slow (see Hedge.kt): the request
     * as routed, then the same request to each backup cloud model, then round again. Whichever
     * answers first is used; the others are cancelled.
     */
    private suspend fun cloud(mode: Mode, prompt: String): CloudReply {
        val quickModel = quick?.takeIf { now() < it.second }?.first ?: ""
        val order = attemptOrder(settings.cloudModel, settings.cloudBackupModels, ::isResting, quickModel)
        // Which model each attempt asked. The models take turns; one that has started resting
        // during this very request (it has just refused) is skipped.
        val asked = HashMap<Int, String>()
        var turn = 0
        fun nextModel(): String? {
            repeat(order.size) {
                val model = order[turn++ % order.size]
                if (asked.isEmpty() || !isResting(model)) return model
            }
            return null
        }
        try {
            val hedged = hedge(settings.cloudHedgeMs, if (settings.cloudHedgeMs > 0) 4 else 1) { i ->
                val model = synchronized(asked) { nextModel()?.also { asked[i] = it } }
                    ?: throw IllegalStateException("Every cloud model is resting.")
                try {
                    asker.ask(if (i == 0) mode else Mode.ONLY_IN_CLOUD, prompt, model)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    if (isQuotaError(e)) synchronized(resting) { resting[model] = now() + restAfterQuota(e.message ?: "") }
                    throw e
                }
            }
            val reply = hedged.value
            if (reply.side != Side.CLOUD) return CloudReply(reply, null)
            val used = synchronized(asked) { asked.getValue(hedged.attempt) }
            val first = synchronized(asked) { asked.getValue(0) }
            if (hedged.attempt > 0) quick = if (used == settings.cloudModel) null else used to (now() + QUICK_MS)
            val why = when {
                hedged.attempt > 0 && used != first -> "The cloud model was slow to answer, so a second cloud model was asked as well, and it answered first."
                hedged.attempt > 0 -> "The cloud was slow to answer, so it was asked again."
                used != settings.cloudModel -> "The main cloud model is busy, so a second cloud model is answering for now."
                else -> null
            }
            return CloudReply(reply, why)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (isQuotaError(e)) {
                // Only when every cloud model is resting is the cloud as a whole paused. If one
                // model is over its quota and the others failed for another reason, that is not
                // "the cloud is resting": the next try may well be answered.
                if (noCloudModelAwake()) cloudPausedUntil = now() + 60_000
                else throw CloudUnavailable("One cloud model has no requests left for now and the others did not answer.")
            }
            throw e
        }
    }

    private suspend fun device(prompt: String): Reply = deviceQueue.withLock { asker.ask(Mode.ONLY_ON_DEVICE, prompt, null) }

    private fun tiles(reply: Reply, exclude: List<String> = emptyList()): List<Guess> =
        toGuesses(reply.words, if (reply.side == Side.DEVICE) Source.DEVICE else Source.CLOUD, settings.guessCount, exclude, picture)

    private fun blocked(why: String) = Answer(emptyList(), null, 0, why, canAskCloud = false, blocked = why)

    /**
     * Clues in, word tiles out. `hard`: the person said it is an action or a feeling, kinds of
     * word the on-device model is weak at. `scope` owns a cloud request that outlives the answer.
     */
    suspend fun find(clues: String, s: Situation, hard: Boolean, scope: CoroutineScope): Answer {
        val r = route(if (hard) Task.HARD else Task.FIND, s)
        val mode = r.mode ?: return blocked(r.why)
        val prompt = pack.findPrompt(clues)
        val started = now()
        fun answer(reply: Reply, why: String) = Answer(
            tiles(reply), reply.side, now() - started, why,
            // After a device answer the cloud can still add a second opinion.
            canAskCloud = reply.side == Side.DEVICE && s.online && cloudUp() && !s.privateOnly,
        )

        return when {
            mode == Mode.ONLY_ON_DEVICE -> answer(device(prompt), r.why)

            // The cloud is asked first although the on-device model is ready (actions and
            // feelings). If the cloud has not answered after a short head start, this phone
            // answers, and the cloud's words are added when they arrive.
            mode == Mode.PREFER_IN_CLOUD && s.device == DeviceState.READY -> {
                val pending = scope.async { runCatching { cloud(mode, prompt) } }
                val early = withTimeoutOrNull(settings.cloudPatienceMs) { pending.await() }?.getOrNull()
                if (early != null) return answer(early.reply, early.why ?: r.why)
                val mine = try {
                    device(prompt)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    // The phone could not answer either: wait for the cloud after all.
                    val late = pending.await().getOrThrow()
                    return answer(late.reply, late.why ?: r.why)
                }
                val shown = tiles(mine)
                val later = scope.async {
                    val late = pending.await().getOrNull()?.reply
                    if (late == null || late.side != Side.CLOUD) null
                    else mergeGuesses(shown, tiles(late, shown.map { it.word }), shown.size + settings.guessCount)
                }
                Answer(shown, Side.DEVICE, now() - started, "The cloud was slow to answer, so this phone answered first.", canAskCloud = false, later = later)
            }

            // The cloud will answer: the phone has no model, or its model is still loading.
            mode == Mode.PREFER_IN_CLOUD || s.device != DeviceState.READY -> {
                val c = cloud(mode, prompt)
                answer(c.reply, c.why ?: r.why)
            }

            // The phone answers first. If it fails, or is too slow, the same request goes to the cloud.
            else -> {
                val canFallBack = s.online && cloudUp() && !s.privateOnly
                val mine = try {
                    withTimeoutOrNull(settings.deviceTimeoutMs) { deviceQueue.withLock { asker.ask(mode, prompt, null) } }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    if (!canFallBack) throw e
                    null
                }
                if (mine != null) return answer(mine, if (mine.side == Side.CLOUD) FELL_BACK else r.why)
                if (!canFallBack) throw IllegalStateException("The on-device model took too long to answer.")
                val c = cloud(Mode.ONLY_IN_CLOUD, prompt)
                answer(c.reply, FELL_BACK)
            }
        }
    }

    /** "None of these", or a second opinion for a very short clue: the cloud looks again, told what was already offered. */
    suspend fun more(clues: String, shown: List<Guess>, s: Situation): Answer {
        val r = route(Task.MORE, s)
        val mode = r.mode ?: return blocked(r.why).copy(guesses = shown)
        val started = now()
        val exclude = shown.map { it.word }
        val c = cloud(mode, pack.findPrompt(clues, exclude))
        val fresh = toGuesses(c.reply.words, Source.CLOUD, settings.guessCount, exclude, picture)
        return Answer(mergeGuesses(shown, fresh, shown.size + settings.guessCount), Side.CLOUD, now() - started, c.why ?: r.why, canAskCloud = false)
    }

    companion object {
        const val FELL_BACK = "The on-device model could not answer, so the cloud did."
        private const val QUICK_MS = 3 * 60_000L
    }
}
