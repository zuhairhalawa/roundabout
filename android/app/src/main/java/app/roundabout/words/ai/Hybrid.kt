// Firebase AI Logic on Android. Every model call in the app goes through this file: hybrid
// models (Gemini Nano on the phone through the Prompt API from ML Kit, with a cloud Gemini
// model behind it) built from the shared prompt pack, protected by App Check.
@file:OptIn(PublicPreviewAPI::class)

package app.roundabout.words.ai

import android.os.SystemClock
import app.roundabout.words.core.Asker
import app.roundabout.words.core.DeviceState
import app.roundabout.words.core.Mode
import app.roundabout.words.core.Pack
import app.roundabout.words.core.QuotaError
import app.roundabout.words.core.Reply
import app.roundabout.words.core.Settings
import app.roundabout.words.core.Side
import app.roundabout.words.core.fill
import com.google.firebase.Firebase
import com.google.firebase.ai.DownloadStatus
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.QuotaExceededException
import com.google.firebase.ai.type.ThinkingLevel
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.google.firebase.ai.type.thinkingConfig

class Hybrid(private val pack: Pack, private val settings: Settings) : Asker {
    private val models = HashMap<String, GenerativeModel>()

    private fun sdkMode(mode: Mode): InferenceMode = when (mode) {
        Mode.ONLY_ON_DEVICE -> InferenceMode.ONLY_ON_DEVICE
        Mode.PREFER_ON_DEVICE -> InferenceMode.PREFER_ON_DEVICE
        Mode.PREFER_IN_CLOUD -> InferenceMode.PREFER_IN_CLOUD
        Mode.ONLY_IN_CLOUD -> InferenceMode.ONLY_IN_CLOUD
    }

    private fun thinking(level: String): ThinkingLevel? = when (level.uppercase()) {
        "MINIMAL" -> ThinkingLevel.MINIMAL
        "LOW" -> ThinkingLevel.LOW
        "MEDIUM" -> ThinkingLevel.MEDIUM
        "HIGH" -> ThinkingLevel.HIGH
        else -> null
    }

    /**
     * A hybrid model for word-finding in one inference mode. The same instructions go to both
     * sides; the answer schema is passed with each request (see ask).
     */
    private fun model(mode: Mode, cloudModel: String): GenerativeModel {
        val count = settings.guessCount
        val level = settings.cloudThinking
        return synchronized(models) {
            models.getOrPut("$mode:$cloudModel:$count:$level") {
                Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
                    modelName = cloudModel,
                    generationConfig = generationConfig {
                        temperature = 0.2f
                        maxOutputTokens = 200
                        // These are quick look-ups, not reasoning problems: keep the cloud model's thinking short.
                        thinking(level)?.let { thinkingConfig = thinkingConfig { thinkingLevel = it } }
                    },
                    systemInstruction = content { text(fill(pack.findSystem, mapOf("count" to count))) },
                    onDeviceConfig = OnDeviceConfig(mode = sdkMode(mode), maxOutputTokens = 200, temperature = 0.2f),
                )
            }
        }
    }

    /** One request in one mode. The SDK does the switching and reports which side answered. */
    override suspend fun ask(mode: Mode, prompt: String, cloudModel: String?): Reply {
        val started = SystemClock.elapsedRealtime()
        try {
            val result = model(mode, cloudModel ?: settings.cloudModel).generateObject(WordList.firebaseAISchema(), prompt)
            val side = if (result.response.inferenceSource == InferenceSource.ON_DEVICE) Side.DEVICE else Side.CLOUD
            return Reply(result.getObject()?.words.orEmpty(), side, SystemClock.elapsedRealtime() - started)
        } catch (e: QuotaExceededException) {
            throw QuotaError(e.message ?: "quota used up", e)
        }
    }

    /** Is there an on-device model on this phone, and is it ready? */
    suspend fun deviceState(): DeviceState {
        val onDevice = model(Mode.ONLY_ON_DEVICE, settings.cloudModel).onDeviceExtension ?: return DeviceState.NONE
        return when (onDevice.checkStatus()) {
            OnDeviceModelStatus.AVAILABLE -> DeviceState.READY
            OnDeviceModelStatus.DOWNLOADABLE, OnDeviceModelStatus.DOWNLOADING -> DeviceState.LOADING
            else -> DeviceState.NONE
        }
    }

    /**
     * Get the on-device model ready: download it if the phone can run it but does not have it
     * yet, then load it into memory so that the first answer is quick. Returns the new state.
     */
    suspend fun wakeDevice(onProgress: (Long) -> Unit = {}): DeviceState {
        val onDevice = model(Mode.ONLY_ON_DEVICE, settings.cloudModel).onDeviceExtension ?: return DeviceState.NONE
        val status = onDevice.checkStatus()
        if (status == OnDeviceModelStatus.UNAVAILABLE) return DeviceState.NONE
        if (status != OnDeviceModelStatus.AVAILABLE) {
            onDevice.download().collect { step ->
                if (step is DownloadStatus.DownloadInProgress) onProgress(step.totalBytesDownloaded)
            }
            if (onDevice.checkStatus() != OnDeviceModelStatus.AVAILABLE) return DeviceState.LOADING
        }
        onDevice.warmUp()
        return DeviceState.READY
    }

    /** Drop cached models, e.g. after Remote Config changes a model name. */
    fun reset() = synchronized(models) { models.clear() }
}
