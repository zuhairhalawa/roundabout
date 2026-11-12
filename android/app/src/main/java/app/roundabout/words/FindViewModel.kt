package app.roundabout.words

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.speech.tts.TextToSpeech
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.roundabout.words.ai.Hybrid
import app.roundabout.words.core.Answer
import app.roundabout.words.core.Chip
import app.roundabout.words.core.DeviceState
import app.roundabout.words.core.Finder
import app.roundabout.words.core.Guess
import app.roundabout.words.core.Pack
import app.roundabout.words.core.Row
import app.roundabout.words.core.Settings
import app.roundabout.words.core.Side
import app.roundabout.words.core.Situation
import app.roundabout.words.core.isQuotaError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

enum class Way { DESCRIBE, HINTS }

/** What the cloud did beside an answer from this phone. It is said in the line under the tiles. */
enum class CloudPart(val text: String) {
    ASKING("The cloud was asked too. Its words will be added in blue."),
    SHORT("The clue was short, so the cloud added the blue ones."),
    SLOW("The cloud was slow, and added the blue ones when it answered."),
    NONE("The cloud was asked too, and had nothing to add."),
    FAILED("The cloud was asked too, but did not answer."),
}

data class UiState(
    /** The prompt pack is loaded and the screen can be used. */
    val ready: Boolean = false,
    val configured: Boolean = true,
    val device: DeviceState = DeviceState.NONE,
    val deviceChecked: Boolean = false,
    val online: Boolean = true,
    val privateOnly: Boolean = false,
    val way: Way = Way.DESCRIBE,
    val clues: String = "",
    val group: String? = null,
    val picked: Set<String> = emptySet(),
    val busy: Boolean = false,
    val guesses: List<Guess> = emptyList(),
    val side: Side? = null,
    val ms: Long = 0,
    val why: String = "",
    val cloudPart: CloudPart? = null,
    val note: String = "",
    val chosen: String? = null,
    val canAskMore: Boolean = false,
    /** Debug builds only: this phone's App Check debug token, shown after a request was refused. */
    val debugToken: String? = null,
)

class FindViewModel(app: Application) : AndroidViewModel(app) {
    var ui by mutableStateOf(UiState(configured = RoundaboutApp.configured))
        private set

    private var pack: Pack? = null
    private var hybrid: Hybrid? = null
    private var finder: Finder? = null
    private var job: Job? = null
    private var lastClues = ""

    private var tts: TextToSpeech? = null
    private var ttsReady = false

    private val connectivity = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val networkWatcher = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = setOnline(true)
        override fun onLost(network: Network) = setOnline(isOnlineNow())
    }

    /** The first question of the hints: "It is…" a thing, a person, a place… */
    val groupAsk: String get() = pack?.groupAsk.orEmpty()
    val groups: List<Chip> get() = pack?.groups.orEmpty()
    fun rows(): List<Row> = pack?.rowsFor(ui.group).orEmpty()

    init {
        ui = ui.copy(online = isOnlineNow())
        runCatching { connectivity.registerDefaultNetworkCallback(networkWatcher) }
        tts = TextToSpeech(app) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) tts?.setLanguage(Locale.US)
        }
        viewModelScope.launch {
            // One prompt pack for every platform: the same files the web app reads.
            val loaded = withContext(Dispatchers.IO) {
                fun asset(name: String) = app.assets.open(name).bufferedReader().use { it.readText() }
                Pack(asset("prompts.json"), asset("hints.json")) to Pack.pictures(asset("emoji.json"))
            }
            val p = loaded.first
            val settings = Settings(p.cloudModel, p.cloudBackupModels, p.guessCount)
            pack = p
            if (RoundaboutApp.configured) {
                val h = Hybrid(p, settings)
                hybrid = h
                finder = Finder(h, p, settings, loaded.second::pictureFor)
            }
            ui = ui.copy(ready = true)
            wakeDevice()
        }
    }

    /** Find out whether this phone has an on-device model, and get it ready if it has. */
    private suspend fun wakeDevice() {
        val h = hybrid ?: return
        val state = runCatching { h.deviceState() }.getOrDefault(DeviceState.NONE)
        ui = ui.copy(device = if (state == DeviceState.READY) DeviceState.LOADING else state, deviceChecked = true)
        if (state == DeviceState.NONE) return
        val woke = runCatching { h.wakeDevice() }.getOrDefault(DeviceState.NONE)
        ui = ui.copy(device = woke)
    }

    private fun isOnlineNow(): Boolean {
        val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun setOnline(online: Boolean) {
        viewModelScope.launch { ui = ui.copy(online = online) }
    }

    private fun situation() = Situation(ui.device, ui.online, cloud = finder?.cloudUp() ?: false, privateOnly = ui.privateOnly)

    // ---- what the person does ----

    fun setClues(text: String) { ui = ui.copy(clues = text) }

    fun setWay(way: Way) { ui = ui.copy(way = way) }

    fun setPrivate(on: Boolean) { ui = ui.copy(privateOnly = on) }

    fun pickGroup(id: String?) { ui = ui.copy(group = id, picked = emptySet()) }

    fun toggleChip(id: String) { ui = ui.copy(picked = if (id in ui.picked) ui.picked - id else ui.picked + id) }

    private fun currentClues(): String =
        if (ui.way == Way.DESCRIBE) ui.clues.trim() else pack?.cluesFromChips(ui.group, ui.picked).orEmpty()

    fun canFind(): Boolean = ui.ready && ui.configured && !ui.busy && currentClues().isNotEmpty()

    fun find() {
        val f = finder ?: return
        val clues = currentClues()
        if (clues.isEmpty()) return
        job?.cancel()
        job = viewModelScope.launch {
            lastClues = clues
            ui = ui.copy(busy = true, guesses = emptyList(), side = null, why = "", cloudPart = null, note = "", chosen = null, canAskMore = false)
            val stillLooking = launch {
                delay(4_000)
                ui = ui.copy(note = "This is taking longer than usual. Still looking…")
            }
            try {
                val hard = ui.way == Way.HINTS && pack?.isCloudFirstGroup(ui.group) == true
                val s = situation()
                val a = f.find(clues, s, hard, viewModelScope)
                stillLooking.cancel()
                if (a.blocked != null) {
                    ui = ui.copy(busy = false, note = a.blocked)
                    return@launch
                }
                show(a, null)
                val later = a.later
                if (later != null) {
                    // This phone answered because the cloud was slow: add the cloud's words when they come.
                    ui = ui.copy(cloudPart = CloudPart.ASKING)
                    val all = later.await()
                    ui = when {
                        all == null -> ui.copy(cloudPart = CloudPart.FAILED)
                        all.size > a.guesses.size -> ui.copy(guesses = all, cloudPart = CloudPart.SLOW)
                        else -> ui.copy(cloudPart = CloudPart.NONE)
                    }
                } else if (a.side == Side.DEVICE && a.canAskCloud && clues.split(Regex("""\s+""")).size <= 3) {
                    // Very short clues are hard for a small model, so the cloud adds its ideas.
                    ui = ui.copy(cloudPart = CloudPart.ASKING)
                    val m = runCatching { f.more(clues, a.guesses, situation()) }.getOrNull()
                    ui = when {
                        m == null -> ui.copy(cloudPart = CloudPart.FAILED)
                        m.blocked != null -> ui.copy(cloudPart = null)
                        m.guesses.size > a.guesses.size -> ui.copy(guesses = m.guesses, cloudPart = CloudPart.SHORT, canAskMore = false)
                        else -> ui.copy(cloudPart = CloudPart.NONE)
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                stillLooking.cancel()
                ui = ui.copy(busy = false, note = problemText(e))
            }
        }
    }

    private fun show(a: Answer, part: CloudPart?) {
        ui = ui.copy(
            busy = false, guesses = a.guesses, side = a.side, ms = a.ms, why = a.why, cloudPart = part, debugToken = null,
            note = if (a.guesses.isEmpty()) "No word came back. Try another clue." else "",
            canAskMore = a.guesses.isNotEmpty() && ui.online && !ui.privateOnly,
        )
    }

    /** "None of these": the cloud looks again, told what was already offered. */
    fun noneOfThese() {
        val f = finder ?: return
        if (ui.busy || ui.guesses.isEmpty()) return
        val shown = ui.guesses
        job?.cancel()
        job = viewModelScope.launch {
            ui = ui.copy(busy = true, note = "")
            try {
                val m = f.more(lastClues, shown, situation())
                ui = if (m.blocked != null) ui.copy(busy = false, note = m.blocked)
                else ui.copy(busy = false, guesses = m.guesses, canAskMore = false, note = if (m.guesses.size == shown.size) "The cloud had no other ideas. Try another clue." else "")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                ui = ui.copy(busy = false, note = problemText(e))
            }
        }
    }

    private fun problemText(e: Throwable): String {
        android.util.Log.w("Roundabout", "A request was not answered", e)
        if (isQuotaError(e)) return "The cloud is resting for a minute. Try again soon."
        // In a debug build the usual reason is a phone that App Check does not know yet.
        ui = ui.copy(debugToken = appCheckDebugToken(getApplication()))
        return "That did not work. Please try again."
    }

    /** Tapping a tile picks the word and says it aloud. */
    fun choose(word: String) {
        ui = ui.copy(chosen = word)
        speak(word, 1.0f)
    }

    fun saySlowly() {
        ui.chosen?.let { speak(it, 0.55f) }
    }

    private fun speak(text: String, rate: Float) {
        val engine = tts ?: return
        if (!ttsReady) return
        engine.setSpeechRate(rate)
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "word")
    }

    override fun onCleared() {
        runCatching { connectivity.unregisterNetworkCallback(networkWatcher) }
        tts?.shutdown()
        super.onCleared()
    }
}
