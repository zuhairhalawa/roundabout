// The jobs Roundabout does with a model: find a word from clues or a picture, build a
// sentence, write practice hints. Each job asks route() where to run, calls the hybrid model,
// and reports which side answered and how long it took.
import { cloudConfigured, model, serial, settings, StaleError, type Kind } from './ai';
import { fill, PACK } from './pack';
import { applySaved, matchSaved, mergeGuesses, parseGuesses, parsePartialGuesses, wordKey, type Guess, type SavedWord } from './guess';
import { pictureFor } from './pictures';
import { route, type Mode, type Situation } from './route';

export type Side = 'device' | 'cloud';

export interface Answer {
  guesses: Guess[];
  /** Which side produced the model's guesses. null if no model ran. */
  side: Side | null;
  /** Time until the whole answer was in. */
  ms: number;
  /** Time until the first word could be shown (answers are streamed). */
  firstMs: number;
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

interface Reply { text: string; side: Side; ms: number; firstMs: number; fellBack: boolean }

/** Called with the text received so far and the side it is coming from. */
type OnText = (textSoFar: string, side: Side) => void;

/** One streamed call in one mode. Resolves when the whole answer is in. */
async function stream(kind: Kind, mode: Mode, request: Request, t0: number, onText?: OnText): Promise<Omit<Reply, 'fellBack'>> {
  const result = await model(kind, mode).generateContentStream(request);
  let text = '';
  let firstMs = 0;
  let side: Side = mode === 'only_in_cloud' ? 'cloud' : 'device';
  for await (const chunk of result.stream) {
    side = chunk.inferenceSource === 'on_device' ? 'device' : 'cloud';
    const piece = chunk.text();
    if (!piece) continue;
    if (!firstMs) firstMs = Math.round(performance.now() - t0);
    text += piece;
    onText?.(text, side);
  }
  const ms = Math.round(performance.now() - t0);
  return { text, side, ms, firstMs: firstMs || ms };
}

async function cloudOnly(kind: Kind, request: Request, t0: number, fellBack: boolean, onText?: OnText): Promise<Reply> {
  try {
    return { ...(await stream(kind, 'only_in_cloud', request, t0, onText)), fellBack };
  } catch (e) {
    if (isQuotaError(e)) pauseCloud(60_000);
    throw e;
  }
}

class SlowError extends Error {
  constructor() { super('The on-device model took too long to start answering.'); this.name = 'SlowError'; }
}

/**
 * Run one request in the given mode.
 * - PREFER_ON_DEVICE: if the on-device call fails, or has produced nothing within the time
 *   limit, the same request goes to the cloud (when that is allowed).
 * - PREFER_IN_CLOUD: the SDK already falls back to the device on network and quota errors.
 */
async function ask(kind: Kind, mode: Mode, request: Request, s: Situation, opts: { stale?: () => boolean; onText?: OnText } = {}): Promise<Reply> {
  const t0 = performance.now();
  if (mode === 'only_in_cloud') return cloudOnly(kind, request, t0, false, opts.onText);

  const canFallBack = mode === 'prefer_on_device' && s.online && cloudUp() && !s.privateOnly;
  let abandoned = false;
  let started = false;
  const onText: OnText = (text, side) => { started = true; if (!abandoned) opts.onText?.(text, side); };
  const call = serial(() => stream(kind, mode, request, t0, onText), opts.stale);
  try {
    const reply = canFallBack && s.device === 'ready'
      ? await Promise.race([call, new Promise<never>((_, no) => setTimeout(() => { if (!started) no(new SlowError()); }, settings.deviceTimeoutMs))])
      : await call;
    return { ...reply, fellBack: false };
  } catch (e) {
    abandoned = true;
    call.catch(() => undefined); // a slow device call may still finish later; ignore it
    if (e instanceof StaleError) throw e;
    if (isQuotaError(e)) pauseCloud(60_000);
    if (canFallBack) return cloudOnly(kind, request, t0, true, opts.onText);
    throw e;
  }
}

// ---- jobs ----

function findPrompt(clues: string, saved: SavedWord[], exclude: string[]): string {
  let p = fill(PACK.find.user, { clues });
  if (saved.length) p += fill(PACK.find.known, { known: saved.slice(0, 24).map((w) => (w.note ? `${w.word} (${w.note})` : w.word)).join(', ') });
  if (exclude.length) p += fill(PACK.find.exclude, { exclude: exclude.join(', ') });
  return p;
}

function blocked(why: string, guesses: Guess[] = []): Answer {
  return { guesses, side: null, ms: 0, firstMs: 0, mode: null, why, canAskCloud: false, blocked: why };
}

export interface FindOptions {
  saved: SavedWord[];
  situation: Situation;
  /** 'live' = guesses while typing or tapping; they only ever run on the device. */
  live?: boolean;
  stale?: () => boolean;
  /** Called as words arrive, so tiles can appear one by one. */
  onPartial?: (guesses: Guess[], side: Side) => void;
}

const FELL_BACK = 'The on-device model could not answer, so the cloud did.';

/** Clues in, word tiles out. Saved words that match come first, with no model involved. */
export async function findWord(clues: string, o: FindOptions): Promise<Answer> {
  const mine = matchSaved(clues, o.saved);
  const r = route(o.live ? 'live' : 'find', o.situation);
  if (!r.mode) return blocked(r.why, mine);
  const limit = settings.guessCount;
  const finish = (gs: Guess[]) => mergeGuesses(mine, applySaved(gs, o.saved), limit + mine.length);
  const reply = await ask('find', r.mode, findPrompt(clues, o.saved, []), o.situation, {
    stale: o.stale,
    onText: o.onPartial && ((text, side) => o.onPartial!(finish(parsePartialGuesses(text, side, { limit, picture: pictureFor })), side)),
  });
  return {
    guesses: finish(parseGuesses(reply.text, reply.side, { limit, picture: pictureFor })),
    side: reply.side, ms: reply.ms, firstMs: reply.firstMs, mode: r.mode, fellBack: reply.fellBack,
    why: reply.fellBack ? FELL_BACK : r.why,
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
  const fresh = applySaved(parseGuesses(reply.text, 'cloud', { limit: settings.guessCount, exclude, picture: pictureFor }), o.saved);
  return { guesses: mergeGuesses(shown, fresh, shown.length + settings.guessCount), side: 'cloud', ms: reply.ms, firstMs: reply.firstMs, mode: r.mode, why: r.why, canAskCloud: false };
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
  const limit = settings.guessCount;
  const parseOpts = { limit, exclude: o.exclude, picture: pictureFor };
  const reply = await ask('image', r.mode, request, o.situation, {
    stale: o.stale,
    onText: o.onPartial && ((t, side) => o.onPartial!(applySaved(parsePartialGuesses(t, side, parseOpts), o.saved), side)),
  });
  return {
    guesses: applySaved(parseGuesses(reply.text, reply.side, parseOpts), o.saved),
    side: reply.side, ms: reply.ms, firstMs: reply.firstMs, mode: r.mode, fellBack: reply.fellBack,
    why: reply.fellBack ? FELL_BACK : r.why,
    canAskCloud: reply.side === 'device' && o.situation.online && cloudUp() && !o.situation.privateOnly,
  };
}

/**
 * Pictures for the few words the look-up table does not cover: one short model request for
 * all of them. Pictures are a help, not a need, so any failure just leaves the tiles as they are.
 */
export async function fillPictures(guesses: Guess[], s: Situation): Promise<Guess[]> {
  const missing = guesses.filter((g) => !g.emoji && g.source !== 'saved');
  if (!missing.length) return guesses;
  const r = route('cue', s);
  if (!r.mode) return guesses;
  try {
    const reply = await ask('picture', r.mode, fill(PACK.picture.user, { words: missing.map((g) => g.word).join(', ') }), s);
    const list: unknown[] = JSON.parse(reply.text).emoji ?? [];
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const first = (v: unknown) => { for (const { segment } of seg.segment(String(v ?? '').trim())) if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment)) return segment; return ''; };
    const byWord = new Map(missing.map((g, i) => [wordKey(g.word), first(list[i])]));
    return guesses.map((g) => (g.emoji ? g : { ...g, emoji: byWord.get(wordKey(g.word)) ?? '' }));
  } catch {
    return guesses;
  }
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
