// Turning what a model returns into the word tiles on the screen. The same rules as
// web/src/core/guess.ts and web/src/core/pictures.ts.
package app.roundabout.words.core

/** Where a tile came from. It decides the tile's colour: green, blue or brown. */
enum class Source { DEVICE, CLOUD, SAVED }

data class Guess(val word: String, val emoji: String, val source: Source)

private fun isPicture(codePoint: Int): Boolean =
    codePoint >= 0x1F000 || codePoint in 0x2190..0x21FF || codePoint in 0x2300..0x23FF ||
        codePoint in 0x2600..0x27BF || codePoint in 0x2B00..0x2BFF || codePoint == 0xFE0F || codePoint == 0x200D

private val LEADING = Regex("""^[\s"'“”‘’\-–—•*.,;:()\[\]\d]+(?=\p{L})""")
private val TRAILING = Regex("""[\s"'“”‘’\-–—•*.,;:()\[\]!?]+$""")
private val ARTICLE = Regex("""^(?:a|an|the)\s+""", RegexOption.IGNORE_CASE)
private val NOT_WORD = Regex("""[^\p{L}\p{N}]+""")
private val HAS_LETTER = Regex("""\p{L}""")
private val SHOUTED = Regex("""^[\p{Lu}\d\s-]+$""")
private val STARTS_UPPER = Regex("""^\p{Lu}""")

/** Strip quotes, bullets, emoji and leading articles; collapse spaces. */
fun normaliseWord(raw: String): String {
    val plain = StringBuilder()
    var i = 0
    while (i < raw.length) {
        val cp = raw.codePointAt(i)
        if (isPicture(cp)) plain.append(' ') else plain.appendCodePoint(cp)
        i += Character.charCount(cp)
    }
    var w = plain.toString().replace(Regex("""\s+"""), " ").trim()
    w = LEADING.replace(w, "")
    w = TRAILING.replace(w, "")
    w = ARTICLE.replace(w, "")
    return w
}

/** Comparison key: lower case, letters and digits only. "Flip-flops" and "flip flops" match. */
fun wordKey(word: String): String = NOT_WORD.replace(word.lowercase(), " ").trim()

private fun usable(word: String): Boolean =
    HAS_LETTER.containsMatchIn(word) && word.length <= 40 && word.split(' ').size <= 4

/** If every single-word guess is capitalised, that is the model's style, not names: lower-case them. SHOUTED words too. */
fun settleCase(guesses: List<Guess>): List<Guess> {
    val singles = guesses.filter { !it.word.contains(' ') }
    val allCapped = singles.size > 1 && singles.all { STARTS_UPPER.containsMatchIn(it.word) }
    return guesses.map { g ->
        when {
            SHOUTED.matches(g.word) && g.word.length > 3 -> g.copy(word = g.word.lowercase())
            allCapped && !g.word.contains(' ') -> g.copy(word = g.word.lowercase())
            else -> g
        }
    }
}

/**
 * A model's list of words as tiles: cleaned, without repeats, without the words in `exclude`,
 * at most `limit`. `picture` supplies the tile picture for a word ("" when there is none).
 */
fun toGuesses(words: List<String>, source: Source, limit: Int, exclude: List<String> = emptyList(), picture: (String) -> String = { "" }): List<Guess> {
    val seen = exclude.map { wordKey(it) }.toMutableSet()
    val out = ArrayList<Guess>()
    for (raw in words) {
        val word = normaliseWord(raw)
        if (!usable(word)) continue
        val key = wordKey(word)
        if (key.isEmpty() || !seen.add(key)) continue
        out += Guess(word, "", source)
        if (out.size >= limit) break
    }
    return settleCase(out).map { it.copy(emoji = picture(it.word)) }
}

/** Keep what is already on screen in place and add new, different guesses after it. */
fun mergeGuesses(shown: List<Guess>, more: List<Guess>, limit: Int): List<Guess> {
    val seen = shown.map { wordKey(it.word) }.toMutableSet()
    val out = shown.toMutableList()
    for (g in more) {
        if (out.size >= limit) break
        if (seen.add(wordKey(g.word))) out += g
    }
    return out
}

private fun singular(w: String): String = if (w.endsWith("ies")) w.dropLast(3) + "y" else w.replace(Regex("""(?:es|s)$"""), "")

/**
 * Pictures for tiles, from the shared look-up table (shared/emoji.json). Only the whole word or
 * phrase counts. Its last word alone is not safe: "rain gear" is not a gear and a "sea lion" is
 * not a lion, and a wrong picture is worse than none.
 */
class Pictures(private val table: Map<String, String>) {
    fun pictureFor(word: String): String {
        val w = word.lowercase().replace(Regex("""[^a-z0-9' ]+"""), " ").replace(Regex("""\s+"""), " ").trim()
        if (w.isEmpty()) return ""
        return table[w] ?: table[singular(w)] ?: ""
    }
}
