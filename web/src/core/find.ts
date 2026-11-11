// The jobs Roundabout does with a model: find a word from clues or a picture, build a
// sentence, write practice hints. Each job asks route() where to run, calls the hybrid model,
// and reports which side answered and how long it took.
import { cloudConfigured, model, serial, settings, StaleError, type Kind } from './ai';
import { fill, PACK } from './pack';
import { applySaved, matchSaved, mergeGuesses, parseGuesses, wordKey, type Guess, type SavedWord } from './guess';
import { route, type Mode, type Situation } from './route';

export type Side = 'device' | 'cloud';

export interface Answer {
  guesses: Guess[];
  /** Which side produced the model's guesses. null if no model ran. */
  side: Side | null;
  ms: number;
  mode: Mode | null;
  why: string;
  canAskCloud: boolean;
  /** Set when nothing could run. The text is ready to show. */
  blocked?: string;
  /** The device was tried first and the cloud had to step in. */
  fellBack?: boolean;
}

// ---- cloud pause after "quota used up" ----

let cloudPausedUntil = 0;
const listeners = new Set<() => void>();
export const cloudUp = () => cloudConfigured && Date.now() >= cloudPausedUntil;
export const onCloudChange = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };
function pauseCloud(ms: number) {
  cloudPausedUntil = Date.now() + ms;
  listeners.forEach((f) => f());
  setTimeout(() => listeners.forEach((f) => f()), ms + 50);
}

export const isQuotaError = (e: unknown) => /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(String((e as Error)?.message ?? e));

// ---- one model call, with the fallbacks the SDK does not do by itself ----

type Request = Parameters<ReturnType<typeof model>['generateContent']>[0];

interface Reply { text: string; side: Side; ms: number; fellBack: boolean }

const sideOf = (r: { response: { inferenceSource?: unknown } }): Side => (r.response.inferenceSource === 'on_device' ? 'device' : 'cloud');

async function cloudOnly(kind: Kind, request: Request, t0: number, fellBack: boolean): Promise<Reply> {
  try {
    const r = await model(kind, 'only_in_cloud').generateContent(request);
    return { text: r.response.text(), side: 'cloud', ms: Math.round(performance.now() - t0), fellBack };
  } catch (e) {
    if (isQuotaError(e)) pauseCloud(60_000);
    throw e;
  }
}

/**
 * Run one request in the given mode.
 * - PREFER_ON_DEVICE: if the on-device call fails or takes too long, ask the cloud (when allowed).
 * - PREFER_IN_CLOUD: the SDK already falls back to the device on network and quota errors.
 */
async function ask(kind: Kind, mode: Mode, request: Request, s: Situation, stale?: () => boolean): Promise<Reply> {
  const t0 = performance.now();
  if (mode === 'only_in_cloud') return cloudOnly(kind, request, t0, false);

  const canFallBack = mode === 'prefer_on_device' && s.online && cloudUp() && !s.privateOnly;
  const call = serial(() => model(kind, mode).generateContent(request), stale);
  try {
    const r = canFallBack && s.device === 'ready'
      ? await Promise.race([call, new Promise<never>((_, no) => setTimeout(() => no(new SlowError()), settings.deviceTimeoutMs))])
      : await call;
    const side = sideOf(r);
    return { text: r.response.text(), side, ms: Math.round(performance.now() - t0), fellBack: false };
  } catch (e) {
    call.catch(() => undefined); // a slow device call may still finish later; ignore it
    if (e instanceof StaleError) throw e;
    if (isQuotaError(e)) pauseCloud(60_000);
    if (canFallBack) return cloudOnly(kind, request, t0, true);
    throw e;
  }
}

class SlowError extends Error {
  constructor() { super('The on-device model took too long.'); this.name = 'SlowError'; }
}

// ---- jobs ----

function findPrompt(clues: string, saved: SavedWord[], exclude: string[]): string {
  let p = fill(PACK.find.user, { clues });
  if (saved.length) p += fill(PACK.find.known, { known: saved.slice(0, 24).map((w) => (w.note ? `${w.word} (${w.note})` : w.word)).join(', ') });
  if (exclude.length) p += fill(PACK.find.exclude, { exclude: exclude.join(', ') });
  return p;
}

function blocked(why: string, guesses: Guess[] = []): Answer {
  return { guesses, side: null, ms: 0, mode: null, why, canAskCloud: false, blocked: why };
}

export interface FindOptions {
  saved: SavedWord[];
  situation: Situation;
  /** 'live' = guesses while typing or tapping; they only ever run on the device. */
  live?: boolean;
  stale?: () => boolean;
}

/** Clues in, word tiles out. Saved words that match come first, with no model involved. */
export async function findWord(clues: string, o: FindOptions): Promise<Answer> {
  const mine = matchSaved(clues, o.saved);
  const r = route(o.live ? 'live' : 'find', o.situation);
  if (!r.mode) return blocked(r.why, mine);
  const reply = await ask('find', r.mode, findPrompt(clues, o.saved, []), o.situation, o.stale);
  const guesses = applySaved(parseGuesses(reply.text, reply.side, { limit: settings.guessCount }), o.saved);
  return {
    guesses: mergeGuesses(mine, guesses, settings.guessCount + mine.length),
    side: reply.side, ms: reply.ms, mode: r.mode, fellBack: reply.fellBack,
    why: reply.fellBack ? 'The on-device model could not answer, so the cloud did.' : r.why,
    // After a device answer the cloud can still add a second opinion.
    canAskCloud: reply.side === 'device' && o.situation.online && cloudUp() && !o.situation.privateOnly,
  };
}

/** "None of these": the cloud model looks again, told what was already offered. */
export async function moreFromCloud(clues: string, shown: Guess[], o: FindOptions): Promise<Answer> {
  const r = route('more', o.situation);
  if (!r.mode) return blocked(r.why, shown);
  const exclude = shown.map((g) => g.word);
  const reply = await ask('find', r.mode, findPrompt(clues, o.saved, exclude), o.situation);
  const fresh = applySaved(parseGuesses(reply.text, 'cloud', { limit: settings.guessCount, exclude }), o.saved);
  return { guesses: mergeGuesses(shown, fresh, shown.length + settings.guessCount), side: 'cloud', ms: reply.ms, mode: r.mode, why: r.why, canAskCloud: false };
}

export interface Picture { data: string; mimeType: 'image/png' | 'image/jpeg'; kind: 'sketch' | 'photo' }

/** A drawing or a photo in, word tiles out. */
export async function nameImage(pic: Picture, o: FindOptions & { exclude?: string[] }): Promise<Answer> {
  const task = o.exclude?.length ? 'more' : o.live ? 'live' : 'image';
  const r = route(task, o.situation);
  if (!r.mode) return blocked(r.why);
  let text: string = pic.kind === 'sketch' ? PACK.image.sketch : PACK.image.photo;
  if (o.exclude?.length) text += fill(PACK.image.exclude, { exclude: o.exclude.join(', ') });
  const request = [text, { type: 'inlineData', inlineData: { data: pic.data, mimeType: pic.mimeType } }] as unknown as Request;
  const reply = await ask('image', r.mode, request, o.situation, o.stale);
  const guesses = applySaved(parseGuesses(reply.text, reply.side, { limit: settings.guessCount, exclude: o.exclude }), o.saved);
  return {
    guesses, side: reply.side, ms: reply.ms, mode: r.mode, fellBack: reply.fellBack,
    why: reply.fellBack ? 'The on-device model could not answer, so the cloud did.' : r.why,
    canAskCloud: reply.side === 'device' && o.situation.online && cloudUp() && !o.situation.privateOnly,
  };
}

export type Tone = keyof typeof PACK.sentences.tones;

export interface Sentences { sentences: string[]; side: Side | null; ms: number; why: string; blocked?: string }

/** A few key words in, full sentences out. */
export async function makeSentences(words: string[], tone: Tone, s: Situation): Promise<Sentences> {
  const r = route('sentences', s);
  if (!r.mode) return { sentences: [], side: null, ms: 0, why: r.why, blocked: r.why };
  const reply = await ask('sentences', r.mode, fill(PACK.sentences.user, { words: words.join(', '), tone: PACK.sentences.tones[tone] }), s);
  let list: string[] = [];
  try { list = (JSON.parse(reply.text).sentences ?? []).map((x: unknown) => String(x).trim()).filter(Boolean); } catch { list = reply.text.split('\n').map((x) => x.trim()).filter(Boolean); }
  return { sentences: [...new Set(list)].slice(0, PACK.sentences.count), side: reply.side, ms: reply.ms, why: r.why };
}

export interface Cues { meaning: string; sentence: string; firstLetter: string; side: Side | null; ms: number; blocked?: string }

/** Hide the target word if a hint gave it away. */
export function hideWord(hint: string, word: string): string {
  const parts = wordKey(word).split(' ').filter((p) => p.length > 2);
  let out = hint;
  for (const p of parts) out = out.replace(new RegExp(`(?<![\\p{L}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\p{L}*`, 'giu'), '___');
  return out;
}

/** Practice hints for a word: what it means, a sentence to finish, and the first letter. */
export async function makeCues(word: string, s: Situation): Promise<Cues> {
  const firstLetter = (word.trim()[0] ?? '').toUpperCase();
  const r = route('cue', s);
  if (!r.mode) return { meaning: '', sentence: '', firstLetter, side: null, ms: 0, blocked: r.why };
  const reply = await ask('cue', r.mode, fill(PACK.cue.user, { word }), s);
  let meaning = '', sentence = '';
  try { const j = JSON.parse(reply.text); meaning = String(j.meaning ?? ''); sentence = String(j.sentence ?? ''); } catch { /* leave empty */ }
  sentence = hideWord(sentence, word);
  if (sentence && !sentence.includes('___')) sentence = `${sentence.replace(/[.!?]+$/, '')} ___`;
  return { meaning: hideWord(meaning, word).trim(), sentence: sentence.trim(), firstLetter, side: reply.side, ms: reply.ms };
}
