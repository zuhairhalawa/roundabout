// Firebase AI Logic set-up. Every model call in Roundabout goes through this file:
// hybrid models (on-device Gemini Nano with a cloud Gemini fallback) built from the shared
// prompt pack, protected by App Check.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type AI, type GenerativeModel } from 'firebase/ai';
import { fill, PACK } from './pack';
import type { Mode } from './route';

const env = import.meta.env;

export const cloudConfigured = Boolean(env.VITE_FB_API_KEY && env.VITE_FB_PROJECT_ID && env.VITE_FB_APP_ID);

/** Values that can be changed without a new release (filled from Remote Config when it loads). */
export const settings = {
  cloudModel: PACK.cloudModel,
  voiceModel: PACK.voiceModel,
  guessCount: PACK.guessCount,
  /** How long to wait for the on-device model before asking the cloud instead. */
  deviceTimeoutMs: 12_000,
};

let app: FirebaseApp | null = null;
let ai: AI | null = null;

export function firebaseApp(): FirebaseApp {
  if (app) return app;
  app = initializeApp({
    apiKey: env.VITE_FB_API_KEY || 'not-configured',
    authDomain: env.VITE_FB_AUTH_DOMAIN || undefined,
    projectId: env.VITE_FB_PROJECT_ID || 'not-configured',
    appId: env.VITE_FB_APP_ID || '1:0:web:0',
    storageBucket: env.VITE_FB_STORAGE_BUCKET || undefined,
    messagingSenderId: env.VITE_FB_SENDER_ID || undefined,
  });
  if (cloudConfigured) {
    // Local development and automated tests use an App Check debug token. It is injected by the
    // dev server, or handed in by a test through localStorage; it is never part of a build.
    const debug = __APPCHECK_DEBUG__ || readLocal('roundabout:appcheck-debug');
    if (debug) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debug;
    if (env.VITE_RECAPTCHA_KEY || debug) {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_KEY || 'debug-only'),
        isTokenAutoRefreshEnabled: true,
      });
    }
  }
  return app;
}

function readLocal(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

export function firebaseAI(): AI {
  if (ai) return ai;
  // Limited-use App Check tokens give replay protection, which preview models require.
  ai = getAI(firebaseApp(), { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
  return ai;
}

export type Kind = 'find' | 'image' | 'sentences' | 'cue';

const MODES: Record<Mode, InferenceMode> = {
  only_on_device: InferenceMode.ONLY_ON_DEVICE,
  prefer_on_device: InferenceMode.PREFER_ON_DEVICE,
  prefer_in_cloud: InferenceMode.PREFER_IN_CLOUD,
  only_in_cloud: InferenceMode.ONLY_IN_CLOUD,
};

const TEXT_EN = { type: 'text' as const, languages: ['en'] };

function spec(kind: Kind): { system: string; schema: object; maxTokens: number } {
  switch (kind) {
    case 'find': return { system: fill(PACK.find.system, { count: settings.guessCount }), schema: PACK.schemas.guesses, maxTokens: 300 };
    case 'image': return { system: fill(PACK.image.system, { count: settings.guessCount }), schema: PACK.schemas.guesses, maxTokens: 300 };
    case 'sentences': return { system: fill(PACK.sentences.system, { count: PACK.sentences.count }), schema: PACK.schemas.sentences, maxTokens: 400 };
    case 'cue': return { system: PACK.cue.system, schema: PACK.schemas.cue, maxTokens: 200 };
  }
}

const cache = new Map<string, GenerativeModel>();

/**
 * A hybrid model for one job in one inference mode. The same system prompt and the same JSON
 * schema go to both sides: `responseConstraint` for Gemini Nano, `responseSchema` for the cloud.
 */
export function model(kind: Kind, mode: Mode): GenerativeModel {
  const key = `${kind}:${mode}:${settings.cloudModel}:${settings.guessCount}`;
  let m = cache.get(key);
  if (m) return m;
  const { system, schema, maxTokens } = spec(kind);
  m = getGenerativeModel(firebaseAI(), {
    mode: MODES[mode],
    onDeviceParams: {
      createOptions: {
        expectedInputs: kind === 'image' ? [TEXT_EN, { type: 'image' }] : [TEXT_EN],
        expectedOutputs: [TEXT_EN],
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: system }] }],
      } as never,
      promptOptions: { responseConstraint: schema },
    },
    inCloudParams: {
      model: settings.cloudModel,
      systemInstruction: system,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema as never,
        temperature: 0.2,
        maxOutputTokens: maxTokens,
      },
    },
  });
  cache.set(key, m);
  return m;
}

/** Drop cached models, e.g. after Remote Config changes the cloud model name. */
export function resetModels() { cache.clear(); }

// ---- on-device model state ----

export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';

declare global {
  // Chrome's Prompt API. The Firebase SDK calls it for us; we only ask whether a model is there.
  // eslint-disable-next-line no-var
  var LanguageModel: { availability(o?: object): Promise<string> } | undefined;
}

export async function deviceAvailability(): Promise<Availability> {
  if (typeof globalThis.LanguageModel === 'undefined') return 'no-api';
  try {
    const a = await globalThis.LanguageModel.availability({ expectedInputs: [TEXT_EN], expectedOutputs: [TEXT_EN] });
    return (['available', 'downloadable', 'downloading', 'unavailable'].includes(a) ? a : 'unavailable') as Availability;
  } catch {
    return 'unavailable';
  }
}

/**
 * Get the on-device model ready: start or join the download, then run one tiny prompt so the
 * model is loaded before the person needs it. Must be called from a tap or a key press.
 * Resolves with the time it took.
 */
export async function wakeDevice(onDownload: (fraction: number) => void): Promise<number> {
  const t0 = performance.now();
  const m = model('find', 'only_on_device');
  await m.initializeDeviceModel(onDownload);
  await serial(() => m.generateContent(fill(PACK.find.user, { clues: 'you sit on it' })));
  return Math.round(performance.now() - t0);
}

// ---- one on-device call at a time ----

let chain: Promise<unknown> = Promise.resolve();

/**
 * The SDK keeps one on-device session per model and ends the old one when a new call starts.
 * Running calls one after another keeps a new request from cutting off the one before it.
 * `stale` lets a queued live guess be skipped when a newer one is already waiting.
 */
export function serial<T>(task: () => Promise<T>, stale?: () => boolean): Promise<T> {
  const run = () => (stale?.() ? Promise.reject(new StaleError()) : task());
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

export class StaleError extends Error {
  constructor() { super('A newer request replaced this one.'); this.name = 'StaleError'; }
}
