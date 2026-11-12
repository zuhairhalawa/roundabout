// Shows how quickly the cloud answers right now, through the dev build's lab page (headless Edge).
//   node scripts/probe-cloud.mjs                          four plain requests to the cloud model
//   node scripts/probe-cloud.mjs model=gemini-3.6-flash   the same, to another model
//   node scripts/probe-cloud.mjs hedge=1500               six finds through the app's own code,
//                                                         asking again after 1.5 s without an answer
//   node scripts/probe-cloud.mjs hedge=0                  the same six finds, never asking again
import { chromium } from '../../video/node_modules/playwright/index.mjs';
const base = process.env.RB_URL || 'http://localhost:5196';
const extra = process.argv[2] ?? '';
const finds = /(^|&)hedge=/.test(extra);
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage();
const started = new Map();
const modelOf = (url) => /models\/([^:/?]+)/.exec(url)?.[1] ?? '?';
p.on('request', (r) => { if (/generateContent/i.test(r.url())) started.set(r, Date.now()); });
p.on('response', async (r) => {
  if (!/generateContent/i.test(r.url()) || r.request().method() !== 'POST') return;
  const held = Date.now() - (started.get(r.request()) ?? Date.now());
  const body = await r.text().catch(() => '');
  const odd = r.status() !== 200 || !/finishReason/.test(body);
  console.log(`  ${new Date().toTimeString().slice(0, 8)} HTTP ${r.status()} from ${modelOf(r.url())}, held ${held} ms${odd ? `, UNFINISHED BODY (${body.length} chars): ${body.replace(/\s+/g, ' ').slice(r.status() === 200 ? -400 : 0, r.status() === 200 ? undefined : 1700)}` : ''}`);
});
p.on('requestfailed', (r) => { if (/generateContent/i.test(r.url())) console.log(`  dropped after ${Date.now() - (started.get(r) ?? Date.now())} ms (${modelOf(r.url())}): ${r.failure()?.errorText}`); });
p.on('pageerror', (e) => console.log(`  page error: ${String(e).slice(0, 300)}`));
p.on('console', (m) => { const t = m.text(); if (/^LAB (stream|HIT|MISS|ERROR|cloud model)/.test(t)) console.log(t.slice(4, 170)); });
await p.goto(`${base}/lab.html?device=none&${finds ? 'extra=0' : 'timing=1'}${extra ? `&${extra}` : ''}`);
await p.click('#go');
await p.waitForFunction(() => window.labDone, null, { timeout: 280_000, polling: 500 }).catch(() => console.log('gave up after 280 s'));
await b.close();
process.exit(0);
