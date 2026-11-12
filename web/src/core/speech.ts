// Saying words and sentences aloud.
// - A single word uses the device's own voice: it starts at once and works offline.
// - A whole sentence, when the cloud is reachable, uses a natural Gemini voice through
//   Firebase AI Logic, and falls back to the device's voice if that fails.
import { fill, PACK } from './pack';
import { voiceModel } from './ai';
import { isQuotaError } from './find';
import { route, type Situation } from './route';

// ---- the device's own voice ----

let chosen: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (chosen) return chosen;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  if (!voices.length) return null;
  // Prefer a voice that works offline, then a natural-sounding one.
  const score = (v: SpeechSynthesisVoice) => (v.localService ? 2 : 0) + (/natural|online/i.test(v.name) ? 1 : 0) + (v.default ? 0.5 : 0);
  chosen = voices.sort((a, b) => score(b) - score(a))[0];
  return chosen;
}

export const canSpeak = () => typeof speechSynthesis !== 'undefined';

/** Speak with the device's own voice, a little slower than normal. */
export function speak(text: string, opts: { slow?: boolean } = {}): void {
  stopNatural();
  if (!canSpeak() || !text.trim()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
  u.rate = opts.slow ? 0.7 : 0.9;
  speechSynthesis.speak(u);
}

if (canSpeak()) speechSynthesis.addEventListener?.('voiceschanged', () => { chosen = null; });

// ---- the natural cloud voice ----

const RATE = 24_000; // Gemini speech comes back as 24 kHz, mono, 16-bit PCM
const cache = new Map<string, Float32Array[]>();
let ctx: AudioContext | null = null;
let playing: AudioBufferSourceNode[] = [];
let ticket = 0;
let voicePausedUntil = 0;

function stopNatural() {
  ticket++;
  for (const n of playing) { try { n.stop(); } catch { /* already stopped */ } }
  playing = [];
}

function pcmToFloat(base64: string): Float32Array {
  const bin = atob(base64);
  const out = new Float32Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32768;
  }
  return out;
}

/** Fetch speech for a text as PCM chunks. Exported for tests. */
export async function fetchSpeech(text: string, onChunk?: (pcm: Float32Array) => void): Promise<Float32Array[]> {
  const hit = cache.get(text);
  if (hit) { hit.forEach((c) => onChunk?.(c)); return hit; }
  const chunks: Float32Array[] = [];
  const res = await voiceModel().generateContentStream(fill(PACK.voice.style, { text }));
  for await (const chunk of res.stream) {
    for (const cand of chunk.candidates ?? []) {
      for (const part of cand.content?.parts ?? []) {
        const data = (part as { inlineData?: { data?: string } }).inlineData?.data;
        if (!data) continue;
        const pcm = pcmToFloat(data);
        chunks.push(pcm);
        onChunk?.(pcm);
      }
    }
  }
  if (chunks.length) { cache.set(text, chunks); if (cache.size > 40) cache.delete(cache.keys().next().value!); }
  return chunks;
}

export type Voice = 'device' | 'natural';

/**
 * Say a sentence. Uses the natural cloud voice when the route allows it, otherwise (or if the
 * cloud fails) the device's voice. Resolves with the voice that was used.
 */
export async function saySentence(text: string, s: Situation, wantNatural: boolean): Promise<Voice> {
  const r = route('voice', s);
  if (!wantNatural || !r.mode || Date.now() < voicePausedUntil) { speak(text); return 'device'; }
  stopNatural();
  speechSynthesis?.cancel();
  const mine = ++ticket;
  try {
    ctx ??= new AudioContext({ sampleRate: RATE });
    if (ctx.state === 'suspended') await ctx.resume();
    let at = ctx.currentTime + 0.05;
    let heard = false;
    await fetchSpeech(text, (pcm) => {
      if (mine !== ticket || !ctx) return;
      const buf = ctx.createBuffer(1, pcm.length, RATE);
      buf.getChannelData(0).set(pcm);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(ctx.destination);
      at = Math.max(at, ctx.currentTime);
      node.start(at);
      at += buf.duration;
      playing.push(node);
      heard = true;
    });
    if (!heard && mine === ticket) { speak(text); return 'device'; }
    return 'natural';
  } catch (e) {
    if (isQuotaError(e)) voicePausedUntil = Date.now() + 5 * 60_000;
    if (mine === ticket) speak(text);
    return 'device';
  }
}
