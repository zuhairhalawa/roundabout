// The shape of an answer. The same schema goes to the on-device model (as an output constraint)
// and to the cloud model (as a JSON schema): {"words": ["key", "lock"]}, as in
// shared/prompts.json. Hybrid structured output on Android is declared with @Generable.
package app.roundabout.words.ai

import com.google.firebase.ai.annotations.Generable
import com.google.firebase.ai.annotations.Guide
import kotlinx.serialization.Serializable

@Serializable
@Generable(description = "Words a person may be looking for")
data class WordList(
    @Guide(description = "The words or short names the person most likely means, most likely first", minItems = 1, maxItems = 8)
    val words: List<String> = emptyList(),
) {
    // The schema generator adds firebaseAISchema() to this companion.
    companion object
}
