package app.roundabout.words.core

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The whole find flow with a stand-in for the hybrid model: which side is asked, in which mode,
 * with which cloud model, and what happens when a side is slow or out of quota. Time is the
 * test's own clock, so nothing really waits.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FinderTest {
    private data class Call(val mode: Mode, val model: String?, val at: Long)

    private val main = Shared.pack.cloudModel
    private val backup = Shared.pack.cloudBackupModels.first()
    private val ready = Situation(DeviceState.READY, online = true, cloud = true, privateOnly = false)
    private val noModel = ready.copy(device = DeviceState.NONE)

    private fun device(vararg words: String, ms: Long = 400) = Reply(words.toList(), Side.DEVICE, ms)
    private fun cloud(vararg words: String, ms: Long = 900) = Reply(words.toList(), Side.CLOUD, ms)

    private class Rig(val finder: Finder, val calls: MutableList<Call>)

    private fun TestScope.rig(answer: suspend (mode: Mode, model: String?) -> Reply): Rig {
        val calls = ArrayList<Call>()
        val settings = Settings(Shared.pack.cloudModel, Shared.pack.cloudBackupModels, Shared.pack.guessCount)
        val asker = Asker { mode, _, model ->
            calls += Call(mode, model, currentTime)
            answer(mode, model)
        }
        return Rig(Finder(asker, Shared.pack, settings, Shared.pictures::pictureFor) { currentTime }, calls)
    }

    @Test
    fun aReadyPhoneAnswersAndNothingIsSent() = runTest {
        val rig = rig { _, _ -> delay(400); device("key", "lock") }
        val a = rig.finder.find("you open the door with it", ready, hard = false, scope = this)
        assertEquals(Side.DEVICE, a.side)
        assertEquals(listOf("key", "lock"), a.guesses.map { it.word })
        assertTrue(a.guesses.all { it.source == Source.DEVICE })
        assertTrue(a.guesses.first().emoji.isNotEmpty())
        assertTrue(a.canAskCloud)
        assertEquals(listOf(Mode.PREFER_ON_DEVICE), rig.calls.map { it.mode })
    }

    @Test
    fun aPhoneWithNoModelIsAnsweredByTheCloud() = runTest {
        val rig = rig { _, _ -> delay(900); cloud("umbrella", "parasol") }
        val a = rig.finder.find("thing for the rain", noModel, hard = false, scope = this)
        assertEquals(Side.CLOUD, a.side)
        assertTrue(a.guesses.all { it.source == Source.CLOUD })
        assertEquals(1, rig.calls.size)
        assertEquals(main, rig.calls[0].model)
        assertTrue(a.why.contains("no on-device model"))
    }

    @Test
    fun aSlowCloudModelIsCoveredByASecondOneWhichIsThenAskedFirst() = runTest {
        val rig = rig { _, model -> delay(if (model == main) 40_000 else 800); cloud("dentist") }
        val a = rig.finder.find("the man who fixes teeth", noModel, hard = false, scope = this)
        assertEquals(listOf("dentist"), a.guesses.map { it.word })
        assertEquals(listOf(main, backup), rig.calls.map { it.model })
        assertEquals(listOf(Mode.PREFER_ON_DEVICE, Mode.ONLY_IN_CLOUD), rig.calls.map { it.mode })
        assertEquals(1_500L, rig.calls[1].at)
        assertEquals(2_300L, a.ms)
        assertTrue(a.why.contains("second cloud model"))

        rig.calls.clear()
        val next = rig.finder.find("the man who fixes teeth", noModel, hard = false, scope = this)
        assertEquals(listOf(backup), rig.calls.map { it.model })
        assertTrue(next.why.contains("busy"))
    }

    @Test
    fun aModelOverItsQuotaRestsWhileTheOthersCarryOn() = runTest {
        val rig = rig { _, model ->
            delay(200)
            if (model == main) throw QuotaError("limit: 500, requests per day limit exceeded. Please retry in 12h35m27s.")
            cloud("clock")
        }
        val a = rig.finder.find("tells the time on the wall", noModel, hard = false, scope = this)
        assertEquals(listOf("clock"), a.guesses.map { it.word })
        assertEquals(listOf(main, backup), rig.calls.map { it.model })
        assertEquals(200L, rig.calls[1].at) // replaced at once, not after the usual wait
        assertTrue(rig.finder.cloudUp())

        rig.calls.clear()
        rig.finder.find("tells the time on the wall", noModel, hard = false, scope = this)
        assertEquals("the resting model is not asked", listOf(backup), rig.calls.map { it.model })
    }

    @Test
    fun whenEveryCloudModelIsOverItsQuotaTheCloudIsPaused() = runTest {
        val rig = rig { _, _ -> delay(100); throw QuotaError("Please retry in 50s.") }
        val error = runCatching { rig.finder.find("anything", noModel, hard = false, scope = this) }.exceptionOrNull()
        assertTrue(isQuotaError(error))
        assertFalse(rig.finder.cloudUp())
    }

    @Test
    fun anActionGoesToTheCloudFirst() = runTest {
        val rig = rig { mode, _ -> if (mode == Mode.ONLY_ON_DEVICE) { delay(500); device("talk") } else { delay(900); cloud("whisper", "sing") } }
        val a = rig.finder.find("it is something you do; with your mouth", ready, hard = true, scope = this)
        assertEquals(Side.CLOUD, a.side)
        assertEquals(listOf(Mode.PREFER_IN_CLOUD), rig.calls.map { it.mode })
        assertNull(a.later)
    }

    @Test
    fun whenTheCloudIsSlowThePhoneAnswersAndTheCloudsWordsAreAddedLater() = runTest {
        val rig = rig { mode, _ -> if (mode == Mode.ONLY_ON_DEVICE) { delay(500); device("talk", "speak") } else { delay(6_000); cloud("whisper", "talk", "sing") } }
        val a = rig.finder.find("it is something you do; with your mouth", ready, hard = true, scope = this)
        assertEquals(Side.DEVICE, a.side)
        assertEquals(listOf("talk", "speak"), a.guesses.map { it.word })
        assertEquals(2_000L, a.ms) // 1.5 s of patience, then half a second on the phone
        assertFalse(a.canAskCloud)
        val later = a.later
        assertNotNull(later)
        val all = later!!.await()!!
        assertEquals(listOf("talk", "speak", "whisper", "sing"), all.map { it.word })
        assertEquals(listOf(Source.DEVICE, Source.DEVICE, Source.CLOUD, Source.CLOUD), all.map { it.source })
    }

    @Test
    fun aPhoneThatIsTooSlowIsCoveredByTheCloud() = runTest {
        val rig = rig { mode, _ -> if (mode == Mode.PREFER_ON_DEVICE) { delay(60_000); device("key") } else { delay(900); cloud("key") } }
        val a = rig.finder.find("you open the door with it", ready, hard = false, scope = this)
        assertEquals(Side.CLOUD, a.side)
        assertEquals(Finder.FELL_BACK, a.why)
        assertEquals(listOf(Mode.PREFER_ON_DEVICE, Mode.ONLY_IN_CLOUD), rig.calls.map { it.mode })
        assertEquals(8_000L, rig.calls[1].at)
    }

    @Test
    fun privateModeNeverAsksTheCloud() = runTest {
        val rig = rig { _, _ -> delay(400); device("key") }
        val a = rig.finder.find("you open the door with it", ready.copy(privateOnly = true), hard = true, scope = this)
        assertEquals(Side.DEVICE, a.side)
        assertFalse(a.canAskCloud)
        assertEquals(listOf(Mode.ONLY_ON_DEVICE), rig.calls.map { it.mode })
        val more = rig.finder.more("you open the door with it", a.guesses, ready.copy(privateOnly = true))
        assertNotNull(more.blocked)
        assertEquals(1, rig.calls.size)
    }

    @Test
    fun noneOfTheseAsksTheCloudForDifferentWords() = runTest {
        val rig = rig { _, _ -> delay(900); cloud("key", "latch", "bolt") }
        val shown = toGuesses(listOf("key", "lock"), Source.DEVICE, 6)
        val more = rig.finder.more("you open the door with it", shown, ready)
        assertEquals(listOf("key", "lock", "latch", "bolt"), more.guesses.map { it.word })
        assertEquals(listOf(Mode.ONLY_IN_CLOUD), rig.calls.map { it.mode })
    }

    @Test
    fun withNoModelAndNoConnectionTheReasonIsSaid() = runTest {
        val rig = rig { _, _ -> cloud("never") }
        val a = rig.finder.find("anything", noModel.copy(online = false), hard = false, scope = this)
        assertNotNull(a.blocked)
        assertTrue(rig.calls.isEmpty())
    }
}
