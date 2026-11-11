// Saying a word aloud. The built-in voice of the browser works offline and starts at once,
// so it is always the first choice for single words.

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
  if (!canSpeak() || !text.trim()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
  u.rate = opts.slow ? 0.7 : 0.9;
  speechSynthesis.speak(u);
}

if (canSpeak()) speechSynthesis.addEventListener?.('voiceschanged', () => { chosen = null; });
