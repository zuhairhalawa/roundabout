// Shows what the cloud model endpoint actually returns right now: status, time and the start of
// the body for a few plain requests made by the dev build's lab page (headless Edge).
//   node scripts/probe-cloud.mjs [count]
import { chromium } from '../../video/node_modules/playwright/index.mjs';
const base = process.env.RB_URL || 'http://localhost:5196';
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage();
const started = new Map();
p.on('request', (r) => { if (/generateContent/i.test(r.url())) started.set(r, Date.now()); });
p.on('response', async (r) => {
  if (!/generateContent/i.test(r.url())) return;
  const ms = Date.now() - (started.get(r.request()) ?? Date.now());
  const body = await r.text().catch((e) => `(body not readable: ${String(e).slice(0, 80)})`);
  console.log(`${new Date().toISOString().slice(11, 19)} HTTP ${r.status()} headers after ${ms} ms, body ${body.length} chars: ${body.replace(/\s+/g, ' ').slice(0, 500)}`);
});
p.on('requestfailed', (r) => { if (/generateContent/i.test(r.url())) console.log('request failed:', r.failure()?.errorText); });
p.on('console', (m) => { const t = m.text(); if (t.startsWith('LAB stream')) console.log(t.slice(4)); });
await p.goto(`${base}/lab.html?device=none&timing=1`);
await p.click('#go');
await p.waitForFunction(() => window.labDone, null, { timeout: 150_000, polling: 500 }).catch(() => console.log('gave up after 150 s'));
await b.close();
process.exit(0);
