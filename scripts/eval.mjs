// Accuracy evaluation. Runs every test item through the same code the app uses and scores
// whether an accepted answer is among the guesses (rank 1, top 3, top 6).
//   node scripts/eval.mjs cloud  eval/pnt.json [style] [limit]     headless Edge, cloud model
//   node scripts/eval.mjs device eval/pnt.json [style] [limit]     real Chrome, Gemini Nano only
// style: plain | broken | sparse | all (default all). Results: eval/results-<side>-<set>.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '../../video/node_modules/playwright/index.mjs';
import { rankOf } from './score.mjs'; // the scoring rule, shared with the report

const [side = 'cloud', file = 'eval/pnt.json', styleArg = 'all', limitArg] = process.argv.slice(2);
const set = JSON.parse(readFileSync(file, 'utf8'));
// 'rotate' = one style per word, taking turns (plain, broken, sparse, plain, ...): a third of the
// requests, still balanced across styles. Used for the cloud, where the free tier limits requests.
const ALL = ['plain', 'broken', 'sparse'];
const styles = styleArg === 'all' || styleArg === 'rotate' ? ALL : [styleArg];
// The practice set must not share words with the test sets.
const testWords = new Set(['eval/pnt.json', 'eval/everyday.json'].filter((f) => existsSync(f) && !file.endsWith(f.split('/').pop())).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).items.flatMap((i) => [i.target, ...(i.accept ?? [])].map((w) => w.toLowerCase()))));
const isDev = /dev\.json$/.test(file);
const items = set.items.filter((i) => !isDev || !testWords.has(i.target.toLowerCase())).slice(0, limitArg ? Number(limitArg) : undefined);
if (isDev) console.log(`practice set: ${items.length} of ${set.items.length} words kept (the rest also appear in a test set)`);
const name = file.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
// RB_LABEL names a variant run (kept apart from the main results); RB_OVERRIDES is a JSON file of
// prompt-pack paths to try, e.g. {"find.system": "..."}.
const label = process.env.RB_LABEL ? `-${process.env.RB_LABEL}` : '';
const outFile = `eval/results-${side}-${name}${label}.json`;
const base = process.env.RB_URL || 'http://localhost:5196';
const env = Object.fromEntries(readFileSync('web/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Resume support: keep rows already done.
const done = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, 'utf8')).rows ?? []).filter((r) => !r.error) : [];
const have = new Set(done.map((r) => `${r.id}:${r.style}`));
const rows = [...done];

let page, stop;
if (side === 'device') {
  const { startChrome, freeMemoryGb } = await import('./chrome.mjs');
  const free = freeMemoryGb();
  if (free < Number(process.env.RB_MIN_FREE_GB || 4)) {
    console.log(`Only ${free.toFixed(1)} GB of memory is free; the on-device model needs about 5 GB. Not starting.`);
    process.exit(3);
  }
  ({ page, stop } = await startChrome());
} else {
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext();
  await ctx.addInitScript((t) => { try { localStorage.setItem('roundabout:appcheck-debug', t); } catch { /* ignore */ } }, env.APPCHECK_DEBUG_TOKEN);
  page = await ctx.newPage();
  stop = () => b.close();
}
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
// RB_MODEL measures another cloud model, e.g. RB_MODEL=gemini-3.1-flash-lite (use RB_LABEL too, to keep
// its results apart). On the lab page a request is never asked twice, so one model is measured at a time.
await page.goto(`${base}/lab.html${process.env.RB_MODEL ? `?model=${process.env.RB_MODEL}` : ''}`);
if (side === 'cloud') console.log('cloud model:', process.env.RB_MODEL || 'the main one, from the prompt pack');
await page.waitForFunction(() => window.rb);
if (process.env.RB_OVERRIDES) console.log('prompt override applied:', await page.evaluate((j) => window.rb.override(j), readFileSync(process.env.RB_OVERRIDES, 'utf8')));
if (side === 'device') {
  const a = await page.evaluate(() => window.rb.availability());
  console.log('on-device model:', a);
  if (a !== 'available') { console.log('No on-device model here.'); await stop(); process.exit(3); }
  await page.click('body');
  const t0 = Date.now();
  // Give up cleanly if the model cannot load (not enough memory, or the GPU is busy).
  const limit = Number(process.env.RB_WAKE_LIMIT_S || 900) * 1000;
  const woke = await Promise.race([page.evaluate(() => window.rb.wake()).then(() => true), sleep(limit).then(() => false)]);
  if (!woke) { console.log(`The on-device model did not load within ${limit / 1000} s. Stopping.`); await stop(); process.exit(4); }
  console.log(`model awake after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

const save = (report) => writeFileSync(outFile, JSON.stringify({ set: file, side, ...(process.env.RB_MODEL ? { model: process.env.RB_MODEL } : {}), at: new Date().toISOString(), ...(report ? { report } : {}), rows }, null, 1));
let n = 0;
for (const item of items) {
  for (const style of styles) {
    if (styleArg === 'rotate' && style !== ALL[items.indexOf(item) % 3]) continue;
    if (have.has(`${item.id}:${style}`)) continue;
    let r = null;
    for (let attempt = 0; attempt < 4 && !r; attempt++) {
      try {
        // device runs use private mode: Gemini Nano only, the cloud can never answer for it
        r = await page.evaluate(([c, dev, priv]) => window.rb.find(c, dev, priv), [item[style], side === 'device' ? 'ready' : 'none', side === 'device']);
      } catch (e) {
        const msg = String(e);
        if (/429|quota|RESOURCE_EXHAUSTED|rate.?limit|too many requests/i.test(msg)) { console.log(`rate limit at ${item.id}/${style}: waiting 65 s (${msg.replace(/\s+/g, ' ').slice(0, 700)})`); await sleep(65_000); }
        else { console.log('error', item.id, style, msg.replace(/\s+/g, ' ').slice(0, 400)); await sleep(3000); }
      }
    }
    if (!r) { rows.push({ id: item.id, style, target: item.target, error: true }); continue; }
    const rank = rankOf(r.words, item.accept ?? [item.target]);
    rows.push({ id: item.id, style, target: item.target, rank, side: r.side, ms: r.ms, firstMs: r.firstMs, words: r.words, blocked: r.blocked });
    if (++n % 10 === 0) {
      save();
      console.log(`${n} done; last: ${item.target}/${style} -> ${rank >= 0 ? 'hit ' + (rank + 1) : 'miss'} [${r.words.slice(0, 3).join(', ')}] ${r.side} first ${r.firstMs} ms, all ${r.ms} ms`);
    }
    if (side === 'cloud') await sleep(Number(process.env.RB_GAP_MS || 3300)); // stay under the free tier's per-minute limit
  }
}

const summary = (sel) => {
  const rs = rows.filter((r) => !r.error && sel(r));
  const pct = (f) => (rs.length ? Math.round((1000 * rs.filter(f).length) / rs.length) / 10 : 0);
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  const first = rs.map((r) => r.firstMs ?? r.ms).sort((a, b) => a - b);
  return { n: rs.length, top1: pct((r) => r.rank === 0), top3: pct((r) => r.rank >= 0 && r.rank < 3), top6: pct((r) => r.rank >= 0), medianFirstMs: first[Math.floor(first.length / 2)] ?? 0, medianMs: ms[Math.floor(ms.length / 2)] ?? 0, p90Ms: ms[Math.floor(ms.length * 0.9)] ?? 0 };
};
const report = { all: summary(() => true) };
for (const s of ['plain', 'broken', 'sparse']) report[s] = summary((r) => r.style === s);
report.errors = rows.filter((r) => r.error).length;
report.sides = [...new Set(rows.filter((r) => !r.error).map((r) => r.side))];
save(report);
console.log(JSON.stringify(report, null, 1));
await stop();
process.exit(0);
