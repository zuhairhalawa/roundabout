// Runs one clue on the live site in headless Edge (cloud path) and prints each tile with its
// picture as time passes, to see how long the picture follow-up takes.
//   node scripts/probe-pictures.mjs "clue text" [baseUrl]
import { readFileSync } from 'node:fs';
import { chromium } from '../../video/node_modules/playwright/index.mjs';
const clue = process.argv[2] || 'thing for the rain, you hold it over your head';
const base = process.argv[3] || 'https://roundabout-words.web.app';
const env = Object.fromEntries(readFileSync('web/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const b = await chromium.launch({ channel: 'msedge' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript((t) => { try { localStorage.setItem('roundabout:appcheck-debug', t); } catch { /* ignore */ } }, env.APPCHECK_DEBUG_TOKEN);
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
const calls = [];
p.on('response', (r) => { if (/generateContent/i.test(r.url())) calls.push(`${r.status()} at ${Date.now() - t0} ms`); });
await p.goto(base);
await p.fill('#clues', clue);
const t0 = Date.now();
await p.getByRole('button', { name: 'Find the word' }).click();
let last = '';
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(500);
  const now = await p.evaluate(() => [...document.querySelectorAll('.tiles .sign')].map((s) => `${s.querySelector('.sign-word')?.textContent}=${s.querySelector('.sign-pic')?.textContent}`).join(' | ') + ' || ' + (document.querySelector('.source')?.textContent ?? '') + (document.querySelector('.note')?.textContent ?? ''));
  if (now !== last) { console.log(`${Date.now() - t0} ms: ${now}`); last = now; }
}
console.log('model responses:', calls.join(', '));
await b.close();
process.exit(0);
