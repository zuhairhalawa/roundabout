// Where should this request run? One pure function decides, so the rule can be read, tested and
// shown to the person. The answer is a Firebase AI Logic inference mode: the SDK then does the
// switching and reports which side answered. This is the same rule as web/src/core/route.ts.
package app.roundabout.words.core

enum class Mode { ONLY_ON_DEVICE, PREFER_ON_DEVICE, PREFER_IN_CLOUD, ONLY_IN_CLOUD }

enum class Task {
    /** Clues to a word. */
    FIND,

    /** Clues to a word, for a kind of word the on-device model is weak at (actions, feelings). */
    HARD,

    /** "None of these": a second opinion. */
    MORE,
}

/** READY: on-device model loaded. LOADING: present or downloading, not usable yet. NONE: this phone has no on-device model. */
enum class DeviceState { READY, LOADING, NONE }

data class Situation(
    val device: DeviceState,
    val online: Boolean,
    /** Cloud set up, and not paused after a "quota used up" reply. */
    val cloud: Boolean,
    /** The person chose "never use the cloud". */
    val privateOnly: Boolean,
)

data class Route(
    /** null = cannot be done right now; `why` says what to tell the person. */
    val mode: Mode?,
    val why: String,
    /** A cloud second opinion is possible after this answer. */
    val canAskCloud: Boolean,
)

fun route(task: Task, s: Situation): Route {
    val cloudUp = s.online && s.cloud && !s.privateOnly
    fun no(why: String) = Route(null, why, false)

    if (task == Task.MORE) {
        if (s.privateOnly) return no("Private mode is on, so nothing is sent to the cloud.")
        if (!s.online) return no("This needs the internet, and you are offline.")
        if (!s.cloud) return no("The cloud is resting for now. Try again in a minute.")
        return Route(Mode.ONLY_IN_CLOUD, "This job needs the bigger cloud model.", false)
    }

    if (s.privateOnly) {
        if (s.device == DeviceState.NONE) return no("Private mode needs the on-device model, and this phone does not have one.")
        return Route(Mode.ONLY_ON_DEVICE, "Private mode: this stays on your phone.", false)
    }

    if (s.device == DeviceState.READY) {
        // Measured: the small model finds objects and places well, actions and feelings poorly.
        if (task == Task.HARD && cloudUp) {
            return Route(Mode.PREFER_IN_CLOUD, "Actions and feelings are hard for the small on-device model, so the cloud answers first.", false)
        }
        return Route(Mode.PREFER_ON_DEVICE, "Answered on this phone first.", cloudUp)
    }
    if (s.device == DeviceState.LOADING) {
        if (cloudUp) return Route(Mode.PREFER_IN_CLOUD, "The on-device model is still getting ready, so the cloud answers for now.", false)
        return Route(Mode.ONLY_ON_DEVICE, "Waiting for the on-device model to get ready.", false)
    }
    if (cloudUp) return Route(Mode.PREFER_ON_DEVICE, "This phone has no on-device model, so the cloud answers.", false)
    if (!s.online) return no("You are offline and this phone has no on-device model.")
    return no("The cloud is resting for now. Try again in a minute.")
}
