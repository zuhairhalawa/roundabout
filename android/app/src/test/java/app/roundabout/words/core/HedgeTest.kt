package app.roundabout.words.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Asking again when an answer is slow. Time here is the test's own clock, so nothing really waits. */
@OptIn(ExperimentalCoroutinesApi::class)
class HedgeTest {
    @Test
    fun aQuickAnswerIsAskedForOnce() = runTest {
        var begun = 0
        val r = hedge(1_500, 4) { i -> begun++; delay(100); "a$i" }
        assertEquals(Hedged("a0", 0, 1), r)
        assertEquals(1, begun)
    }

    @Test
    fun aSlowAnswerIsAskedForAgainAndTheFirstToAnswerWins() = runTest {
        var cancelled = false
        val r = hedge(1_500, 4) { i ->
            if (i == 0) {
                try { delay(60_000) } catch (e: CancellationException) { cancelled = true; throw e }
                "late"
            } else {
                delay(300)
                "a$i"
            }
        }
        assertEquals(Hedged("a1", 1, 2), r)
        assertEquals(1_800L, currentTime)
        assertTrue("the slow attempt is cancelled once another has answered", cancelled)
    }

    @Test
    fun itAsksAThirdTimeIfTheSecondIsSlowTooAndNeverMoreThanTheLimit() = runTest {
        var begun = 0
        val r = hedge(1_000, 3) { i -> begun++; delay(if (i < 2) 60_000 else 100); "a$i" }
        assertEquals(Hedged("a2", 2, 3), r)
        val slow = hedge(1_000, 3) { i -> delay(10_000); "b$i" }
        assertEquals(Hedged("b0", 0, 3), slow)
        assertEquals(3, begun)
    }

    @Test
    fun anAttemptThatFailsIsReplacedAtOnce() = runTest {
        val r = hedge(60_000, 3) { i -> delay(50); if (i == 0) throw IllegalStateException("a0 failed"); "a$i" }
        assertEquals(Hedged("a1", 1, 2), r)
        assertEquals(100L, currentTime)
    }

    @Test
    fun itFailsWithTheFirstErrorOnlyWhenEveryAttemptHasFailed() = runTest {
        val error = runCatching { hedge<String>(1_000, 3) { i -> delay(10); throw IllegalStateException("a$i failed") } }.exceptionOrNull()
        assertEquals("a0 failed", error?.message)
    }

    @Test
    fun anAttemptThatFailsDoesNotUseUpATry() = runTest {
        // Attempts 0, 2 and 3 are refused at once (models over their quota) and attempt 1 is slow:
        // with a limit of 4 there is still room to ask a fifth time.
        val begun = ArrayList<Int>()
        val r = hedge(1_000, 4) { i ->
            begun += i
            if (i == 0 || i == 2 || i == 3) throw IllegalStateException("a$i refused")
            delay(if (i == 1) 60_000 else 200)
            "a$i"
        }
        assertEquals("a4", r.value)
        assertEquals(listOf(0, 1, 2, 3, 4), begun)
        assertEquals(1_200L, currentTime)
    }

    @Test
    fun itNeverBeginsMoreThanTwiceTheLimit() = runTest {
        var begun = 0
        val error = runCatching { hedge<String>(1_000, 4) { begun++; throw IllegalStateException("down") } }.exceptionOrNull()
        assertEquals("down", error?.message)
        assertEquals(8, begun)
    }

    @Test
    fun withTimedRepeatsOffASlowAttemptIsNotAskedAgain() = runTest {
        var begun = 0
        val r = hedge(0, 4) { i -> begun++; delay(30_000); "a$i" }
        assertEquals(Hedged("a0", 0, 1), r)
        assertEquals(1, begun)
        val replaced = hedge(0, 2) { i -> if (i == 0) throw IllegalStateException("failed"); "b$i" }
        assertEquals("b1", replaced.value)
    }

    @Test
    fun cloudModelsTakeTurns() {
        assertEquals(listOf("main", "b1", "b2"), attemptOrder("main", listOf("b1", "b2")))
        assertEquals(listOf("main"), attemptOrder("main", listOf("")))
        assertEquals(listOf("main", "b1"), attemptOrder("main", listOf("b1", "main", "b1")))
        assertEquals(listOf("main", "b2"), attemptOrder("main", listOf("b1", "b2"), { it == "b1" }))
        assertEquals(listOf("b1", "b2"), attemptOrder("main", listOf("b1", "b2"), { it == "main" }))
        assertEquals(listOf("main"), attemptOrder("main", listOf("b1"), { true }))
        assertEquals(listOf("b2", "main", "b1"), attemptOrder("main", listOf("b1", "b2"), { false }, "b2"))
        assertEquals(listOf("main", "b1"), attemptOrder("main", listOf("b1", "b2"), { it == "b2" }, "b2"))
    }

    @Test
    fun aModelRestsForAsLongAsItsQuotaReplyAsks() {
        assertEquals(50_855L, restAfterQuota("requests per minute limit exceeded on Free Tier.\nPlease retry in 50.854541844s."))
        assertEquals(30 * 60_000L, restAfterQuota("requests per day limit exceeded.\nPlease retry in 12h35m27.048490716s."))
        assertEquals(250_000L, restAfterQuota("Please retry in 4m10s."))
        assertEquals(10_000L, restAfterQuota("Please retry in 2.5s."))
        assertEquals(60_000L, restAfterQuota("Please retry in 250ms."))
        assertEquals(60_000L, restAfterQuota("[429] RESOURCE_EXHAUSTED"))
        assertTrue(isQuotaError(IllegalStateException("[429 ] You exceeded your current quota")))
        assertTrue(isQuotaError(RuntimeException("wrapped", QuotaError("limit: 500"))))
        assertTrue(!isQuotaError(IllegalStateException("network unreachable")))
    }
}
