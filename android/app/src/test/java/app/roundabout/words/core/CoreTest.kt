package app.roundabout.words.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The shared files, read straight from the repository: the same ones the web app uses. */
internal object Shared {
    private fun read(name: String) = File("../../shared/$name").readText()
    val pack: Pack by lazy { Pack(read("prompts.json"), read("hints.json")) }
    val pictures: Pictures by lazy { Pack.pictures(read("emoji.json")) }
}

class RouteTest {
    private val ready = Situation(DeviceState.READY, online = true, cloud = true, privateOnly = false)

    @Test
    fun aReadyPhoneAnswersFirst() {
        val r = route(Task.FIND, ready)
        assertEquals(Mode.PREFER_ON_DEVICE, r.mode)
        assertTrue(r.canAskCloud)
    }

    @Test
    fun actionsAndFeelingsGoToTheCloudFirstWhenItCanBeReached() {
        assertEquals(Mode.PREFER_IN_CLOUD, route(Task.HARD, ready).mode)
        assertEquals(Mode.PREFER_ON_DEVICE, route(Task.HARD, ready.copy(online = false)).mode)
        assertEquals(Mode.ONLY_ON_DEVICE, route(Task.HARD, ready.copy(privateOnly = true)).mode)
    }

    @Test
    fun theCloudAnswersWhileTheModelLoadsAndWhereThereIsNone() {
        assertEquals(Mode.PREFER_IN_CLOUD, route(Task.FIND, ready.copy(device = DeviceState.LOADING)).mode)
        assertEquals(Mode.ONLY_ON_DEVICE, route(Task.FIND, ready.copy(device = DeviceState.LOADING, online = false)).mode)
        assertEquals(Mode.PREFER_ON_DEVICE, route(Task.FIND, ready.copy(device = DeviceState.NONE)).mode)
    }

    @Test
    fun privateModeNeverUsesTheCloud() {
        assertEquals(Mode.ONLY_ON_DEVICE, route(Task.FIND, ready.copy(privateOnly = true)).mode)
        assertNull(route(Task.MORE, ready.copy(privateOnly = true)).mode)
        assertNull(route(Task.FIND, ready.copy(device = DeviceState.NONE, privateOnly = true)).mode)
    }

    @Test
    fun whenNothingCanRunTheReasonIsSaid() {
        val offline = route(Task.FIND, ready.copy(device = DeviceState.NONE, online = false))
        assertNull(offline.mode)
        assertTrue(offline.why.contains("offline"))
        val resting = route(Task.FIND, ready.copy(device = DeviceState.NONE, cloud = false))
        assertNull(resting.mode)
        assertTrue(resting.why.contains("resting"))
        assertEquals(Mode.ONLY_IN_CLOUD, route(Task.MORE, ready).mode)
    }
}

class GuessTest {
    @Test
    fun wordsAreCleaned() {
        assertEquals("umbrella", normaliseWord("  1. \"the umbrella\" ☂️ "))
        assertEquals("flip-flops", normaliseWord("- flip-flops."))
        assertEquals("flip flops", wordKey("Flip-Flops"))
    }

    @Test
    fun tilesHaveNoRepeatsAndRespectTheLimit() {
        val tiles = toGuesses(listOf("key", "Key", "a lock", "", "12", "door key", "ring", "chain", "bolt", "latch"), Source.DEVICE, limit = 6)
        assertEquals(listOf("key", "lock", "door key", "ring", "chain", "bolt"), tiles.map { it.word })
        assertTrue(tiles.all { it.source == Source.DEVICE })
    }

    @Test
    fun wordsAlreadyOfferedAreLeftOut() {
        val tiles = toGuesses(listOf("key", "lock", "latch"), Source.CLOUD, limit = 6, exclude = listOf("Key", "lock"))
        assertEquals(listOf("latch"), tiles.map { it.word })
    }

    @Test
    fun aModelThatCapitalisesEverythingIsLowerCased() {
        assertEquals(listOf("key", "lock"), toGuesses(listOf("Key", "Lock"), Source.CLOUD, 6).map { it.word })
        assertEquals(listOf("key", "New York"), toGuesses(listOf("key", "New York"), Source.CLOUD, 6).map { it.word })
        assertEquals(listOf("remote"), toGuesses(listOf("REMOTE"), Source.CLOUD, 6).map { it.word })
    }

    @Test
    fun newWordsAreAddedAfterTheOnesOnScreen() {
        val shown = toGuesses(listOf("key", "lock"), Source.DEVICE, 6)
        val more = toGuesses(listOf("lock", "latch", "bolt"), Source.CLOUD, 6)
        val all = mergeGuesses(shown, more, 3)
        assertEquals(listOf("key", "lock", "latch"), all.map { it.word })
        assertEquals(listOf(Source.DEVICE, Source.DEVICE, Source.CLOUD), all.map { it.source })
    }

    @Test
    fun aPhraseNeverBorrowsThePictureOfItsLastWord() {
        assertTrue(Shared.pictures.pictureFor("umbrella").isNotEmpty())
        assertEquals(Shared.pictures.pictureFor("key"), Shared.pictures.pictureFor("Keys"))
        assertEquals("", Shared.pictures.pictureFor("rain gear"))
    }
}

class PackTest {
    @Test
    fun theSharedPackIsRead() {
        val p = Shared.pack
        assertTrue(p.cloudModel.startsWith("gemini-"))
        assertTrue(p.cloudBackupModels.isNotEmpty())
        assertTrue(p.guessCount in 3..8)
        assertTrue(p.findSystem.contains("{count}"))
        assertEquals("Clues: red fruit", p.findPrompt("red fruit"))
        assertTrue(p.findPrompt("red fruit", listOf("apple", "cherry")).endsWith("apple, cherry"))
    }

    @Test
    fun tappedHintsBecomeACluesLine() {
        val p = Shared.pack
        assertTrue(p.groups.any { it.id == "thing" })
        assertTrue(p.rowsFor("thing").isNotEmpty())
        assertTrue(p.rowsFor(null).isEmpty())
        assertEquals("it is an object; you find it in the kitchen", p.cluesFromChips("thing", setOf("where.kitchen")))
        assertEquals("", p.cluesFromChips(null, setOf("where.kitchen")))
    }

    @Test
    fun actionsAndFeelingsAreMarkedForTheCloud() {
        assertTrue(Shared.pack.isCloudFirstGroup("action"))
        assertTrue(Shared.pack.isCloudFirstGroup("feeling"))
        assertFalse(Shared.pack.isCloudFirstGroup("thing"))
        assertFalse(Shared.pack.isCloudFirstGroup(null))
    }

    @Test
    fun placeholdersAreFilled() {
        assertEquals("Give 6 words for {other}", fill("Give {count} words for {other}", mapOf("count" to 6)))
    }
}
