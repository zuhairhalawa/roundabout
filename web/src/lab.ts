// Dev-only harness: runs the real jobs (same code as the app) and prints what came back.
// ?device=none|ready  ?cases=<json array of [clues, target]>  ?job=find|sentences|cue
import { deviceAvailability, settings, wakeDevice } from './core/ai';
import { findWord, makeCues, makeSentences, moreFromCloud } from './core/find';
import type { Situation } from './core/route';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; console.log('LAB ' + s); };
const q = new URLSearchParams(location.search);

const DEFAULT: Array<[string, string]> = [
  ['you open the door with it, small, metal', 'key'],
  ['thing for the rain, you hold it over your head', 'umbrella'],
  ['the man who fixes teeth', 'dentist'],
  ['um the the thing you know for the tv to change', 'remote'],
  ['it is an object; you find it in the kitchen; you use it to cut; it is sharp', 'knife'],
  ['the paper from the doctor for the pharmacy', 'prescription'],
];

async function main() {
  if (q.get('lut') === '0') settings.limitedUseTokens = false;
  if (q.has('think')) settings.cloudThinking = q.get('think')!.toUpperCase() as typeof settings.cloudThinking;
  if (q.has('model')) settings.cloudModel = q.get('model')!;
  log(`cloud model=${settings.cloudModel} thinking=${settings.cloudThinking || 'default'}`);
  if (q.get('timing') === '1') {
    const { model } = await import('./core/ai');
    const m = model('find', 'only_in_cloud');
    for (const clues of ['you open the door with it', 'thing for the rain over your head', 'the man who fixes teeth', 'cold box in the kitchen keeps food']) {
      const t0 = performance.now();
      const st = await m.generateContentStream(`Clues: ${clues}`);
      let first = 0, text = '';
      for await (const c of st.stream) { if (!first) first = performance.now() - t0; text += c.text(); }
      log(`stream first=${Math.round(first)}ms total=${Math.round(performance.now() - t0)}ms len=${text.length} lut=${settings.limitedUseTokens}`);
    }
    (window as unknown as { labDone: unknown }).labDone = [];
    return log('DONE');
  }
  if (q.get('voice') === '1') {
    const { fetchSpeech } = await import('./core/speech');
    for (const text of ['Could I please change my doctor appointment to Tuesday?', 'I lost the key to the door.']) {
      const t0 = performance.now();
      let first = 0;
      try {
        const chunks = await fetchSpeech(text, () => { if (!first) first = performance.now() - t0; });
        const samples = chunks.reduce((a, c) => a + c.length, 0);
        const peak = chunks.reduce((m, c) => Math.max(m, c.reduce((x, v) => Math.max(x, Math.abs(v)), 0)), 0);
        log(`voice first=${Math.round(first)}ms total=${Math.round(performance.now() - t0)}ms seconds=${(samples / 24000).toFixed(2)} peak=${peak.toFixed(2)} lut=${settings.limitedUseTokens}`);
      } catch (e) { log('ERROR voice ' + String(e).slice(0, 300)); }
    }
    (window as unknown as { labDone: unknown }).labDone = [];
    return log('DONE');
  }
  const avail = await deviceAvailability();
  const wantDevice = q.get('device') ?? (avail === 'available' ? 'ready' : 'none');
  log(`availability=${avail} device=${wantDevice}`);
  if (wantDevice === 'ready') log(`wake ${await wakeDevice((p) => log('download ' + p))} ms`);
  const s: Situation = { device: wantDevice as Situation['device'], online: true, cloud: true, privateOnly: q.get('private') === '1' };
  const cases: Array<[string, string]> = q.get('cases') ? JSON.parse(q.get('cases')!) : DEFAULT;
  const rows: unknown[] = [];
  for (const [clues, target] of cases) {
    try {
      const a = await findWord(clues, { saved: [], situation: s });
      const words = a.guesses.map((g) => g.word.toLowerCase());
      const idx = words.findIndex((w) => target.split('|').some((t) => w.includes(t)));
      log(`${idx >= 0 ? 'HIT' + (idx + 1) : 'MISS'} ${a.side} ${a.ms}ms [${target}] <- ${clues} => ${a.guesses.map((g) => g.word + ' ' + g.emoji).join(', ')}${a.blocked ? ' BLOCKED ' + a.blocked : ''}`);
      rows.push({ clues, target, idx, side: a.side, ms: a.ms, guesses: a.guesses, fellBack: a.fellBack });
      if (idx < 0 && q.get('more') === '1') {
        const m = await moreFromCloud(clues, a.guesses, { saved: [], situation: s });
        log(`   more: ${m.guesses.slice(a.guesses.length).map((g) => g.word).join(', ')}${m.blocked ? ' BLOCKED ' + m.blocked : ''}`);
      }
    } catch (e) {
      log(`ERROR [${target}] ${String(e).slice(0, 300)}`);
      rows.push({ clues, target, error: String(e) });
    }
  }
  if (q.get('extra') !== '0') {
    try {
      const st = await makeSentences(['doctor', 'tuesday', 'change'], 'polite', s);
      log(`sentences ${st.side} ${st.ms}ms: ${st.sentences.join(' | ')}`);
      const c = await makeCues('umbrella', s);
      log(`cues ${c.side} ${c.ms}ms: meaning="${c.meaning}" sentence="${c.sentence}" letter=${c.firstLetter}`);
    } catch (e) { log('ERROR extra ' + String(e).slice(0, 300)); }
  }
  (window as unknown as { labDone: unknown }).labDone = rows;
  log('DONE');
}
let started = false;
document.getElementById('go')!.addEventListener('click', () => { if (!started) { started = true; main(); } });

// Used by scripts/eval.mjs: one call per test item, same code path as the app.
(window as unknown as { rb: unknown }).rb = {
  availability: deviceAvailability,
  wake: () => wakeDevice(() => undefined),
  async find(clues: string, device: Situation['device'], privateOnly = false) {
    const s: Situation = { device, online: true, cloud: true, privateOnly };
    const a = await findWord(clues, { saved: [], situation: s });
    return { words: a.guesses.map((g) => g.word), side: a.side, ms: a.ms, fellBack: a.fellBack ?? false, blocked: a.blocked ?? null };
  },
};
