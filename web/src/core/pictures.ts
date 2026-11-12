// Pictures for word tiles come from a look-up table (shared/emoji.json), not from the model.
// That keeps the model's answer short, which is what makes the on-device model quick, and it
// gives the same picture for the same word on every platform, online or offline.
// The table is loaded in the background, so the first screen does not wait for it.

let table: Record<string, string> | null = null;
let loading: Promise<void> | null = null;

export function loadPictures(): Promise<void> {
  loading ??= import('../../../shared/emoji.json').then((m) => { table = (m.default as { map: Record<string, string> }).map; }).catch(() => { table = {}; });
  return loading;
}

const singular = (w: string) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.replace(/(?:es|s)$/, ''));

/** The picture for a word, or '' when the table has none (or is not loaded yet). */
export function pictureFor(word: string): string {
  if (!table) return '';
  const w = word.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!w) return '';
  const last = w.split(' ').pop()!;
  // The whole phrase first ("alarm clock"), then its head word ("wall clock" -> clock).
  return table[w] ?? table[singular(w)] ?? (last !== w ? table[last] ?? table[singular(last)] : undefined) ?? '';
}

/** For tests. */
export function setPictures(map: Record<string, string>) { table = map; }
