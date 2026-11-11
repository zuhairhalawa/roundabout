// Accuracy evaluation. Runs every test item through the same code the app uses and scores
// whether an accepted answer is among the guesses (rank 1, top 3, top 6).
//   node scripts/eval.mjs cloud  eval/pnt.json [style] [limit]     headless Edge, cloud model
//   node scripts/eval.mjs device eval/pnt.json [style] [limit]     real Chrome, Gemini Nano only
// style: plain | broken | sparse | all (default all). Results: eval/results-<side>-<set>.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '../../video/node_modules/playwright/index.mjs';

const [side = 'cloud', file = 'eval/pnt.json', styleArg = 'all', limitArg] = process.argv.slice(2);
const set = JSON.parse(readFileSync(file, 'utf8'));
const styles = styleArg === 'all' ? ['plain', 'broken', 'sparse'] : [styleArg];
const items = set.items.slice(0, limitArg ? Number(limitArg) : undefined);
const name = file.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
const outFile = `eval/results-${side}-${name}.json`;
const base = process.env.RB_URL || 'http://localhost:5196';
const env = Object.fromEntries(readFileSync('web/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const key = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** A guess counts if it equals an accepted answer, or contains it as a whole word ("wall clock" for "clock"). */
const rankOf = (words, accept) => {
  const acc = accept.map(key);
  return words.findIndex((w) => { const k = ` ${key(w)} `; return acc.some((a) => k.includes(` ${a} `)); });
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Resume support: keep rows already done.
const done = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, 'utf8')).rows ?? []).filter((r) => !r.error) : [];
const have = new Set(done.map((r) => `${r.id}:${r.style}`));
const rows = [...done];

let page, stop;
if (side === 'device') {
  const { startChrome, freeMemoryGb } = await import('./chrome.mjs');
  const free = freeMemoryGb();
  if (free < 4) {
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
await page.goto(`${base}/lab.html`);
await page.waitForFunction(() => window.rb);
if (side === 'device') {
  const a = await page.evaluate(() => window.rb.availability());
  console.log('on-device model:', a);
  if (a !== 'available') { console.log('No on-device model here.'); await stop(); process.exit(3); }
  await page.click('body');
  const t0 = Date.now();
  await page.evaluate(() => window.rb.wake());
  console.log(`model awake after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

const save = (report) => writeFileSync(outFile, JSON.stringify({ set: file, side, at: new Date().toISOString(), ...(report ? { report } : {}), rows }, null, 1));
let n = 0;
for (const item of items) {
  for (const style of styles) {
    if (have.has(`${item.id}:${style}`)) continue;
    let r = null;
    for (let attempt = 0; attempt < 4 && !r; attempt++) {
      try {
        // device runs use private mode: Gemini Nano only, the cloud can never answer for it
        r = await page.evaluate(([c, dev, priv]) => window.rb.find(c, dev, priv), [item[style], side === 'device' ? 'ready' : 'none', side === 'device']);
      } catch (e) {
        const msg = String(e).slice(0, 160);
        if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) { console.log('quota reached, waiting 65 s'); await sleep(65_000); }
        else { console.log('error', item.id, style, msg); await sleep(3000); }
      }
    }
    if (!r) { rows.push({ id: item.id, style, target: item.target, error: true }); continue; }
    const rank = rankOf(r.words, item.accept ?? [item.target]);
    rows.push({ id: item.id, style, target: item.target, rank, side: r.side, ms: r.ms, words: r.words, blocked: r.blocked });
    if (++n % 10 === 0) {
      save();
      console.log(`${n} done; last: ${item.target}/${style} -> ${rank >= 0 ? 'hit ' + (rank + 1) : 'miss'} [${r.words.slice(0, 3).join(', ')}] ${r.side} ${r.ms} ms`);
    }
    if (side === 'cloud') await sleep(900); // stay well under the per-minute limit
  }
}

const summary = (sel) => {
  const rs = rows.filter((r) => !r.error && sel(r));
  const pct = (f) => (rs.length ? Math.round((1000 * rs.filter(f).length) / rs.length) / 10 : 0);
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  return { n: rs.length, top1: pct((r) => r.rank === 0), top3: pct((r) => r.rank >= 0 && r.rank < 3), top6: pct((r) => r.rank >= 0), medianMs: ms[Math.floor(ms.length / 2)] ?? 0, p90Ms: ms[Math.floor(ms.length * 0.9)] ?? 0 };
};
const report = { all: summary(() => true) };
for (const s of ['plain', 'broken', 'sparse']) report[s] = summary((r) => r.style === s);
report.errors = rows.filter((r) => r.error).length;
report.sides = [...new Set(rows.filter((r) => !r.error).map((r) => r.side))];
save(report);
console.log(JSON.stringify(report, null, 1));
await stop();
process.exit(0);
