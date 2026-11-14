// The jobs Roundabout does with a model: find a word from clues or a picture, build a
// sentence, write practice hints. Each job asks route() where to run, calls the hybrid model,
// and reports which side answered and how long it took.
import { cloudConfigured, model, serial, settings, StaleError, type Kind } from './ai';
import { attemptOrder, hedge, restAfterQuota } from './hedge';
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
  /**
   * Set when this device answered because the cloud was slow: the cloud's request is still
   * open. Resolves with the tiles plus the cloud's words, or null if the cloud never answered.
   */
  later?: Promise<Guess[] | null>;
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

/** No cloud model answered, and not because all of them are over their quota. Trying again may work. */
export class CloudUnavailable extends Error {
  constructor() { super('One cloud model has no requests left for now and the others did not answer.'); this.name = 'CloudUnavailable'; }
}

export const isQuotaError = (e: unknown) => !(e instanceof CloudUnavailable) && /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(String((e as Error)?.message ?? e));

// ---- one model call, with the fallbacks the SDK does not do by itself ----

type Request = Parameters<ReturnType<typeof model>['generateContent']>[0];

/**
 * How a cloud request was answered when a cloud model was slow or busy: by a second model asked
 * as well, by the same model asked again, or by a backup model that is asked first for now.
 */
type Repeat = 'backup' | 'again' | 'quick';

interface Reply { text: string; side: Side; ms: number; firstMs: number; fellBack: boolean; repeat?: Repeat }

/** Called with the text received so far and the side it is coming from. */
type OnText = (textSoFar: string, side: Side) => void;

/** One streamed call in one mode. Resolves when the whole answer is in. */
async function stream(kind: Kind, mode: Mode, request: Request, t0: number, onText?: OnText, opts: { cloudModel?: string; signal?: AbortSignal } = {}): Promise<Omit<Reply, 'fellBack'>> {
  const result = await model(kind, mode, opts.cloudModel).generateContentStream(request, opts.signal ? { signal: opts.signal } : undefined);
  // The stream is read below; a failure is reported there. Without this, the SDK's second
  // promise for the same response would fail with nobody listening.
  result.response.catch(() => undefined);
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

/** A cloud model that has just said its quota is used up is left alone for as long as its reply asks (see restAfterQuota). */
const resting = new Map<string, number>();
/** True when every cloud model is resting: only then is the cloud as a whole paused. */
const noCloudModelAwake = () => [settings.cloudModel, ...settings.cloudBackupModels.split(',')].every((m) => !m || Date.now() < (resting.get(m) ?? 0));
/**
 * The backup model that answered last time when the main model was slow. It is asked first for
 * a few minutes: a busy model stays busy for a while.
 */
let quick: { model: string; until: number } | null = null;
const QUICK_MS = 3 * 60_000;

/**
 * A request that goes to the cloud, asked again if it is slow to start answering (see
 * hedge.ts): the request as routed, then the same request to each backup cloud model, then
 * round again. Whichever starts answering first is used; the others are dropped.
 * `stopFirst`: the first attempt can be cancelled when it loses. That is not so for a
 * cloud-first request on a device with a model: cancelling it would make the SDK fall back to
 * the device for an answer nobody reads.
 */
async function cloudStream(kind: Kind, mode: Mode, request: Request, t0: number, onText: OnText | undefined, stopFirst: boolean): Promise<Omit<Reply, 'fellBack'>> {
  const now = Date.now();
  const order = attemptOrder(settings.cloudModel, settings.cloudBackupModels.split(','), (m) => now < (resting.get(m) ?? 0), quick && now < quick.until ? quick.model : '');
  // Pictures for the tiles are a help, not a need: they ask a backup model first, which keeps
  // the main model's daily quota for finding words.
  if (kind === 'picture' && order.length > 1 && order[0] === settings.cloudModel) order.push(order.shift()!);
  const stops: Array<AbortController | null> = [];
  // Which model each attempt asked. The models take turns; one that has started resting during
  // this very request (it has just refused) is skipped.
  const asked: string[] = [];
  let turn = 0;
  const nextModel = (): string => {
    for (let n = 0; n < order.length; n++) {
      const m = order[turn++ % order.length];
      if (asked.length === 0 || Date.now() >= (resting.get(m) ?? 0)) return m;
    }
    return '';
  };
  const { value, attempt } = await hedge((i, started) => {
    const cloudModel = nextModel();
    if (!cloudModel) return Promise.reject(new Error('Every cloud model is resting.'));
    asked[i] = cloudModel;
    const stop = i > 0 || stopFirst ? new AbortController() : null;
    stops[i] = stop;
    return stream(kind, i ? 'only_in_cloud' : mode, request, t0, (text, side) => { if (started()) onText?.(text, side); }, { cloudModel, signal: stop?.signal })
      .catch((e) => { if (isQuotaError(e)) resting.set(cloudModel, Date.now() + restAfterQuota(String((e as Error)?.message ?? e))); throw e; });
    // Pictures for the tiles are a help, not a need: a slow request for them is not asked
    // again. If it fails (a model over its quota), another model is tried.
  }, kind === 'picture' ? 0 : settings.cloudHedgeMs, settings.cloudHedgeMs > 0 ? (kind === 'picture' ? 2 : 4) : 1);
  stops.forEach((stop, i) => { if (i !== attempt) stop?.abort(); });
  if (value.side !== 'cloud') return value;
  const used = asked[attempt];
  if (attempt && kind !== 'picture') quick = used === settings.cloudModel ? null : { model: used, until: Date.now() + QUICK_MS };
  // What to tell the person: a different model from the one asked first answered ('backup'),
  // the same model answered when asked again ('again'), or a backup model was asked first
  // because the main one is busy or resting ('quick').
  const repeat: Repeat | undefined = attempt ? (used !== asked[0] ? 'backup' : 'again') : used !== settings.cloudModel ? 'quick' : undefined;
  return repeat ? { ...value, repeat } : value;
}

async function cloudOnly(kind: Kind, request: Request, t0: number, fellBack: boolean, onText?: OnText): Promise<Reply> {
  try {
    return { ...(await cloudStream(kind, 'only_in_cloud', request, t0, onText, true)), fellBack };
  } catch (e) {
    throw cloudFailure(e);
  }
}

/**
 * What a failed cloud request means. Only when every cloud model is resting is the cloud as a
 * whole paused. If one model is over its quota and the others failed for another reason, that
 * is not "the cloud is resting": the next try may well be answered.
 */
function cloudFailure(e: unknown): unknown {
  if (!isQuotaError(e)) return e;
  if (!noCloudModelAwake()) return new CloudUnavailable();
  pauseCloud(60_000);
  return e;
}

class SlowError extends Error {
  constructor() { super('The on-device model took too long to start answering.'); this.name = 'SlowError'; }
}

/**
 * Run one request in the given mode.
 * - PREFER_ON_DEVICE: if the on-device call fails, or has produced nothing within the time
 *   limit, the same request goes to the cloud (when that is allowed).
 * - PREFER_IN_CLOUD: the SDK already falls back to the device on network and quota errors.
 * - Any request that the cloud will answer is asked again if the cloud is slow to start.
 */
async function ask(kind: Kind, mode: Mode, request: Request, s: Situation, opts: { stale?: () => boolean; onText?: OnText } = {}): Promise<Reply> {
  const t0 = performance.now();
  if (mode === 'only_in_cloud') return cloudOnly(kind, request, t0, false, opts.onText);

  // PREFER_ON_DEVICE on a device with no model: the SDK sends it to the cloud by itself.
  const cloudBound = mode === 'prefer_in_cloud' || (mode === 'prefer_on_device' && s.device === 'none');
  const canFallBack = mode === 'prefer_on_device' && s.device !== 'none' && s.online && cloudUp() && !s.privateOnly;
  let abandoned = false;
  let started = false;
  const onText: OnText = (text, side) => { started = true; if (!abandoned) opts.onText?.(text, side); };
  // Calls for the cloud do not wait in the on-device queue. They are used while the device model
  // is still loading, and its first prompt can hold that queue for minutes: the whole point of
  // asking the cloud first is that nobody waits for it.
  const run = () => (cloudBound ? cloudStream(kind, mode, request, t0, onText, s.device === 'none') : stream(kind, mode, request, t0, onText));
  const call = cloudBound ? (opts.stale?.() ? Promise.reject<never>(new StaleError()) : run()) : serial(run, opts.stale);
  try {
    const reply = canFallBack && s.device === 'ready'
      ? await Promise.race([call, new Promise<never>((_, no) => setTimeout(() => { if (!started) no(new SlowError()); }, settings.deviceTimeoutMs))])
      : await call;
    return { ...reply, fellBack: false };
  } catch (e) {
    abandoned = true;
    call.catch(() => undefined); // a slow device call may still finish later; ignore it
    if (e instanceof StaleError) throw e;
    if (cloudBound) throw cloudFailure(e);
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
  /** The person said it is an action or a feeling: kinds of word the on-device model is weak at. */
  hard?: boolean;
  stale?: () => boolean;
  /** Called as words arrive, so tiles can appear one by one. */
  onPartial?: (guesses: Guess[], side: Side | null) => void;
}

const FELL_BACK = 'The on-device model could not answer, so the cloud did.';
const REPEAT_WHY: Record<Repeat, string> = {
  backup: 'The cloud model was slow to answer, so a second cloud model was asked as well, and it answered first.',
  again: 'The cloud was slow to answer, so it was asked again.',
  quick: 'The main cloud model is busy, so a second cloud model is answering for now.',
};
const whyFor = (reply: Reply, routed: string) => (reply.fellBack ? FELL_BACK : reply.repeat ? REPEAT_WHY[reply.repeat] : routed);

/** Clues in, word tiles out. Saved words that match come first, with no model involved. */
export async function findWord(clues: string, o: FindOptions): Promise<Answer> {
  const mine = matchSaved(clues, o.saved);
  const r = route(o.live ? 'live' : o.hard ? 'hard' : 'find', o.situation);
  if (!r.mode) return blocked(r.why, mine);
  const mode = r.mode;
  const limit = settings.guessCount;
  const prompt = findPrompt(clues, o.saved, []);
  const finish = (gs: Guess[]) => mergeGuesses(mine, applySaved(gs, o.saved), limit + mine.length);
  const partial = (text: string, side: Side) => o.onPartial?.(finish(parsePartialGuesses(text, side, { limit, picture: pictureFor })), side);
  const answer = (reply: Reply, why: string): Answer => ({
    guesses: finish(parseGuesses(reply.text, reply.side, { limit, picture: pictureFor })),
    side: reply.side, ms: reply.ms, firstMs: reply.firstMs, mode, fellBack: reply.fellBack, why,
    // After a device answer the cloud can still add a second opinion.
    canAskCloud: reply.side === 'device' && o.situation.online && cloudUp() && !o.situation.privateOnly,
  });

  /**
   * The cloud is asked first although the on-device model is ready (actions and feelings).
   * The cloud gets a short head start. If it has not begun to answer by then, this device
   * answers, and the cloud's words are added when they arrive.
   */
  const cloudFirstCovered = async (): Promise<Answer> => {
    const t0 = performance.now();
    let covering = false;
    let cloudStarted = false;
    const cloud = ask('find', 'prefer_in_cloud', prompt, o.situation, { stale: o.stale, onText: (text, side) => { cloudStarted = true; if (!covering) partial(text, side); } });
    const slow = await Promise.race([
      cloud.then(() => false, () => true),
      new Promise<boolean>((yes) => setTimeout(() => yes(!cloudStarted), settings.cloudPatienceMs)),
    ]);
    if (!slow) { const reply = await cloud; return answer(reply, whyFor(reply, r.why)); }
    covering = true;
    let first: Answer;
    try {
      const reply = await serial(() => stream('find', 'only_on_device', prompt, t0, partial), o.stale);
      first = { ...answer({ ...reply, fellBack: false }, 'The cloud was slow to answer, so this device answered first.'), canAskCloud: false };
    } catch (e) {
      if (e instanceof StaleError) throw e;
      covering = false;
      const reply = await cloud; // the device could not answer either: wait for the cloud after all
      return answer(reply, whyFor(reply, r.why));
    }
    const shown = first.guesses;
    first.later = cloud.then(
      // If the cloud call failed and the SDK fell back to this device, there is no cloud answer.
      (reply) => (reply.side === 'cloud' ? mergeGuesses(shown, applySaved(parseGuesses(reply.text, 'cloud', { limit, exclude: shown.map((g) => g.word), picture: pictureFor }), o.saved), shown.length + limit) : null),
      () => null,
    );
    return first;
  };

  // A saved word that matches needs no model, so it is shown at once and does not wait for one.
  if (mine.length) o.onPartial?.(mine, null);
  try {
    if (mode === 'prefer_in_cloud' && o.situation.device === 'ready') return await cloudFirstCovered();
    const reply = await ask('find', mode, prompt, o.situation, { stale: o.stale, onText: partial });
    return answer(reply, whyFor(reply, r.why));
  } catch (e) {
    // No model could answer. A saved word that matched is still an answer.
    if (e instanceof StaleError || !mine.length) throw e;
    return { guesses: mine, side: null, ms: 0, firstMs: 0, mode, why: 'This is one of your saved words. No model was needed.', canAskCloud: false };
  }
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
    why: whyFor(reply, r.why),
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
