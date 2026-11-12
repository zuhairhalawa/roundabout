// Firebase Remote Config: model names, routing numbers and prompt text can be changed from
// the console without shipping a new build. Values fetched last time are applied at start-up
// (no waiting), and a fresh copy is fetched in the background for the next start.
import { activate, fetchConfig, getAll, getRemoteConfig } from 'firebase/remote-config';
import { cloudConfigured, firebaseApp, resetModels, settings } from './ai';
import { PACK } from './pack';

/** Parameter names in the Remote Config template, with the built-in defaults. */
export const REMOTE_DEFAULTS = {
  cloud_model: PACK.cloudModel,
  voice_model: PACK.voiceModel,
  guess_count: PACK.guessCount,
  device_timeout_ms: 8_000,
  cloud_thinking: 'MINIMAL',
  limited_use_tokens: false,
  natural_voice: true,
  /** JSON object of prompt-pack paths to new text, e.g. {"find.system": "..."}. Empty = use the built-in pack. */
  prompt_overrides: '{}',
} as const;

type Values = Record<string, string>;

const THINKING = ['', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
const num = (v: string | undefined, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const bool = (v: string | undefined, fallback: boolean) => (v === 'true' ? true : v === 'false' ? false : fallback);

/**
 * Apply remote values to the app's settings. Every value is checked: a typo in the console
 * must never break the app, so anything out of range falls back to the built-in default.
 * Returns the names of the parameters that changed something.
 */
export function applyRemote(v: Values): string[] {
  const changed: string[] = [];
  const set = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K], name: string) => {
    if (settings[key] !== value) { settings[key] = value; changed.push(name); }
  };
  if (/^gemini-[\w.-]+$/.test(v.cloud_model ?? '')) set('cloudModel', v.cloud_model, 'cloud_model');
  if (/^gemini-[\w.-]+$/.test(v.voice_model ?? '')) set('voiceModel', v.voice_model, 'voice_model');
  set('guessCount', num(v.guess_count, 3, 8, settings.guessCount), 'guess_count');
  set('deviceTimeoutMs', num(v.device_timeout_ms, 2000, 60_000, settings.deviceTimeoutMs), 'device_timeout_ms');
  const thinking = (v.cloud_thinking ?? '').toUpperCase();
  if (v.cloud_thinking !== undefined && THINKING.includes(thinking)) set('cloudThinking', thinking as typeof settings.cloudThinking, 'cloud_thinking');
  set('limitedUseTokens', bool(v.limited_use_tokens, settings.limitedUseTokens), 'limited_use_tokens');
  set('naturalVoice', bool(v.natural_voice, settings.naturalVoice), 'natural_voice');
  if (applyPromptOverrides(v.prompt_overrides)) changed.push('prompt_overrides');
  if (changed.length) resetModels();
  return changed;
}

/** Replace prompt texts by path. Only existing string fields of the pack can be replaced. */
export function applyPromptOverrides(json: string | undefined): boolean {
  if (!json || json === '{}') return false;
  let o: Record<string, unknown>;
  try { o = JSON.parse(json); } catch { return false; }
  let any = false;
  for (const [path, text] of Object.entries(o)) {
    if (typeof text !== 'string' || !text.trim() || path.startsWith('schemas')) continue;
    const keys = path.split('.');
    let node: Record<string, unknown> = PACK as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) node = (node?.[k] ?? null) as Record<string, unknown>;
    const last = keys[keys.length - 1];
    if (node && typeof node[last] === 'string' && node[last] !== text) { node[last] = text; any = true; }
  }
  return any;
}

/** Start-up: use what was fetched last time, then fetch for next time. Never throws. */
export async function loadRemote(): Promise<string[]> {
  if (!cloudConfigured) return [];
  try {
    const rc = getRemoteConfig(firebaseApp());
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 0 : 60 * 60 * 1000;
    rc.defaultConfig = Object.fromEntries(Object.entries(REMOTE_DEFAULTS).map(([k, val]) => [k, String(val)]));
    await activate(rc);
    const values = Object.fromEntries(Object.entries(getAll(rc)).filter(([, val]) => val.getSource() === 'remote').map(([k, val]) => [k, val.asString()]));
    const changed = applyRemote(values);
    fetchConfig(rc).catch(() => undefined); // offline or blocked: keep what we have
    return changed;
  } catch {
    return [];
  }
}
