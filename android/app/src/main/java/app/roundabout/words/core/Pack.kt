// The shared prompt pack and hint chips. The web app reads the same three JSON files
// (shared/prompts.json, shared/hints.json, shared/emoji.json), so every platform sends the same
// words to the on-device model and to the cloud model.
package app.roundabout.words.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

data class Chip(val id: String, val label: String, val emoji: String, val clue: String)

data class Row(val id: String, val ask: String, val chips: List<Chip>)

private val PLACEHOLDER = Regex("""\{(\w+)\}""")

/** Fill {placeholders} in a prompt template. Unknown placeholders are left as they are. */
fun fill(template: String, vars: Map<String, Any>): String =
    PLACEHOLDER.replace(template) { m -> vars[m.groupValues[1]]?.toString() ?: m.value }

private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content

private fun chips(o: JsonObject): List<Chip> =
    o.getValue("chips").jsonArray.map { it.jsonObject }.map { Chip(it.text("id"), it.text("label"), it.text("emoji"), it.text("clue")) }

class Pack(promptsJson: String, hintsJson: String) {
    private val prompts = Json.parseToJsonElement(promptsJson).jsonObject
    private val hints = Json.parseToJsonElement(hintsJson).jsonObject
    private val find = prompts.getValue("find").jsonObject

    val cloudModel: String = prompts.text("cloudModel")
    val cloudBackupModels: List<String> = prompts.getValue("cloudBackupModels").jsonArray.map { it.jsonPrimitive.content }
    val guessCount: Int = prompts.text("guessCount").toInt()

    val findSystem: String = find.text("system")
    val findUser: String = find.text("user")
    val findExclude: String = find.text("exclude")

    /** The first question: "It is…" a thing, a person, a place… */
    val groupAsk: String = hints.getValue("group").jsonObject.text("ask")
    val groups: List<Chip> = chips(hints.getValue("group").jsonObject)

    private val rows: Map<String, List<Row>> = hints.getValue("rows").jsonObject.mapValues { (_, list) ->
        list.jsonArray.map { it.jsonObject }.map { Row(it.text("id"), it.text("ask"), chips(it)) }
    }
    private val cloudFirst: Set<String> = hints.getValue("cloudFirst").jsonArray.map { it.jsonPrimitive.content }.toSet()

    /** The rows of chips to show once a group is picked. */
    fun rowsFor(groupId: String?): List<Row> = if (groupId == null) emptyList() else rows[groupId].orEmpty()

    /** Groups where the small on-device model is measurably weak, so the cloud is asked first. */
    fun isCloudFirstGroup(groupId: String?): Boolean = groupId != null && groupId in cloudFirst

    /** Turn tapped chips ("row.chip" ids) into the plain-English clue line the model reads. */
    fun cluesFromChips(groupId: String?, picked: Set<String>): String {
        val group = groups.firstOrNull { it.id == groupId } ?: return ""
        val parts = mutableListOf(group.clue)
        for (row in rowsFor(groupId)) for (chip in row.chips) if ("${row.id}.${chip.id}" in picked) parts += chip.clue
        return parts.joinToString("; ")
    }

    /** The request text for one find: the clues, and what was already offered (if anything). */
    fun findPrompt(clues: String, exclude: List<String> = emptyList()): String {
        var p = fill(findUser, mapOf("clues" to clues))
        if (exclude.isNotEmpty()) p += fill(findExclude, mapOf("exclude" to exclude.joinToString(", ")))
        return p
    }

    companion object {
        /** The word-to-picture table from shared/emoji.json. */
        fun pictures(emojiJson: String): Pictures =
            Pictures(Json.parseToJsonElement(emojiJson).jsonObject.getValue("map").jsonObject.mapValues { it.value.jsonPrimitive.content })
    }
}
