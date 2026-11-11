// Runs web/lab.html in headless Edge (no on-device model there), so everything goes to the cloud.
// node scripts/lab-cloud.mjs "device=none&more=1"
import { chromium } from '../../video/node_modules/playwright/index.mjs';
const qs = process.argv[2] || 'device=none';
const base = process.env.RB_URL || 'http://localhost:5196';
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage();
p.on('console', (m) => { const t = m.text(); if (t.startsWith('LAB ')) console.log(t.slice(4).slice(0, 420)); else if (m.type() === 'error') console.log('console.error:', t.slice(0, 300)); });
p.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
p.on('response', (r) => { if (/googleapis\.com/.test(r.url()) && r.status() >= 400) console.log('HTTP', r.status(), r.url().replace(/\?.*/, '').slice(0, 140)); });
await p.goto(`${base}/lab.html?${qs}`);
await p.click('#go');
await p.waitForFunction(() => window.labDone, null, { timeout: 180_000, polling: 500 }).catch((e) => console.log('TIMEOUT', String(e).slice(0, 100)));
await b.close();
process.exit(0);
