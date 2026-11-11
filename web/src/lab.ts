// Dev-only harness: runs the real jobs (same code as the app) and prints what came back.
// ?device=none|ready  ?cases=<json array of [clues, target]>  ?job=find|sentences|cue
import { deviceAvailability, wakeDevice } from './core/ai';
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
