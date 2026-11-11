// Turning raw model output into clean word tiles. Everything here is plain code with no model
// calls, so it behaves the same whichever model answered.

export type Source = 'device' | 'cloud' | 'saved';

export interface Guess {
  word: string;
  emoji: string;
  source: Source;
}

/** A word the person saved, e.g. a grandchild's name, with a note such as "my daughter's son". */
export interface SavedWord {
  id: string;
  word: string;
  emoji: string;
  note: string;
}

const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** The first emoji in a string, as one whole grapheme (so flags and families stay intact). */
export function firstEmoji(s: string): string {
  if (!s) return '';
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const { segment } of seg.segment(s.trim())) if (PICTO.test(segment)) return segment;
  return '';
}

/** Strip quotes, bullets, emoji and leading articles; collapse spaces. */
export function normaliseWord(raw: string): string {
  let w = String(raw ?? '').normalize('NFKC');
  w = w.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}️‍]/gu, ' ');
  w = w.replace(/\s+/g, ' ').trim();
  w = w.replace(/^[\s"'“”‘’\-–—•*.,;:()[\]\d]+(?=\p{L})/u, '').replace(/[\s"'“”‘’\-–—•*.,;:()[\]!?]+$/u, '');
  w = w.replace(/^(?:a|an|the)\s+/i, '');
  return w;
}

/** Comparison key: lower case, letters and digits only. "Flip-flops" and "flip flops" match. */
export const wordKey = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function usable(w: string): boolean {
  if (!/\p{L}/u.test(w)) return false;
  if (w.length > 40) return false;
  return w.split(' ').length <= 4;
}

/**
 * Parse a model reply into guesses. Accepts the schema shape {guesses:[{word,emoji}]}, a bare
 * array, or (if the model ignored the schema) a comma- or line-separated list.
 */
export function parseGuesses(text: string, source: Source, opts: { limit: number; exclude?: string[] }): Guess[] {
  const banned = new Set((opts.exclude ?? []).map(wordKey));
  let items: Array<{ word?: unknown; emoji?: unknown } | string> = [];
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const j = JSON.parse(trimmed);
    items = Array.isArray(j) ? j : Array.isArray(j?.guesses) ? j.guesses : [];
  } catch {
    items = trimmed.split(/[\n,;]+/);
  }
  const out: Guess[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const rawWord = typeof it === 'string' ? it : String(it?.word ?? '');
    const word = normaliseWord(rawWord);
    const k = wordKey(word);
    if (!usable(word) || !k || seen.has(k) || banned.has(k)) continue;
    seen.add(k);
    const emoji = firstEmoji(typeof it === 'string' ? it : String(it?.emoji ?? '')) || firstEmoji(rawWord);
    out.push({ word, emoji, source });
    if (out.length >= opts.limit) break;
  }
  return settleCase(out);
}

/**
 * Models often capitalise every guess. If every single-word guess is capitalised, treat that
 * as style and lower-case them; multi-word capitalised guesses are kept as names.
 */
export function settleCase(guesses: Guess[]): Guess[] {
  const singles = guesses.filter((g) => !g.word.includes(' '));
  const allCapped = singles.length > 1 && singles.every((g) => /^\p{Lu}/u.test(g.word));
  return guesses.map((g) => {
    if (/^[\p{Lu}\d\s-]+$/u.test(g.word) && g.word.length > 3) return { ...g, word: g.word.toLowerCase() }; // SHOUTED
    if (allCapped && !g.word.includes(' ')) return { ...g, word: g.word.toLowerCase() };
    return g;
  });
}

/** Keep what is already on screen in place and add new, different guesses after it. */
export function mergeGuesses(shown: Guess[], more: Guess[], limit: number): Guess[] {
  const seen = new Set(shown.map((g) => wordKey(g.word)));
  const out = [...shown];
  for (const g of more) {
    const k = wordKey(g.word);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
    if (out.length >= limit) break;
  }
  return out;
}

const STOP = new Set(['a', 'an', 'the', 'my', 'your', 'his', 'her', 'it', 'is', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'you', 'i', 'with', 'that', 'this', 'thing', 'person', 'who', 'they', 'are', 'use', 'find', 'something', 'one', 'me']);
const tokens = (s: string) => wordKey(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t));

/**
 * Saved words whose note matches the clues, e.g. clues "daughter husband" and a saved word
 * "Omar" with the note "my daughter's husband". Plain matching: private, instant, no model.
 * A note must share at least half of its words with the clues to count.
 */
export function matchSaved(clues: string, saved: SavedWord[]): Guess[] {
  const clue = new Set(tokens(clues).map(stem));
  if (!clue.size) return [];
  const scored: Array<{ g: Guess; score: number }> = [];
  for (const s of saved) {
    const note = [...new Set(tokens(s.note).map(stem))];
    if (!note.length) continue;
    const hit = note.filter((t) => clue.has(t)).length;
    if (hit === 0 || hit / note.length < 0.5) continue;
    scored.push({ g: { word: s.word, emoji: s.emoji, source: 'saved' }, score: hit / note.length + hit * 0.01 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 2).map((x) => x.g);
}

/** Tiny stemmer so "daughters" matches "daughter". */
function stem(t: string): string {
  return t.length > 4 ? t.replace(/(?:'s|s)$/, '') : t;
}

/** If the model guessed a saved word, show it the way the person saved it (their emoji, their spelling). */
export function applySaved(guesses: Guess[], saved: SavedWord[]): Guess[] {
  const byKey = new Map(saved.map((s) => [wordKey(s.word), s]));
  return guesses.map((g) => {
    const s = byKey.get(wordKey(g.word));
    return s ? { ...g, word: s.word, emoji: s.emoji || g.emoji } : g;
  });
}
