// Clean viewport screenshots of the live site for the README (cloud path, headless Edge).
import { readFileSync } from 'node:fs';
import { chromium } from '../../video/node_modules/playwright/index.mjs';
const base = process.argv[2] || 'https://roundabout-words.web.app';
const env = Object.fromEntries(readFileSync('web/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const b = await chromium.launch({ channel: 'msedge' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
await ctx.addInitScript((t) => { try { localStorage.setItem('roundabout:appcheck-debug', t); } catch { /* ignore */ } }, env.APPCHECK_DEBUG_TOKEN);
const p = await ctx.newPage();
// Pictures the look-up table does not know arrive a moment after the words.
const picturesReady = () => p.waitForFunction(() => ![...document.querySelectorAll('.tiles .sign-pic')].some((e) => e.textContent.trim() === ''), null, { timeout: 8000 }).catch(() => {});
const tilesReady = () => p.waitForFunction(() => document.querySelector('.tiles .sign-word') && !/Looking/.test(document.querySelector('.btn-go')?.textContent ?? ''), null, { timeout: 60000 });
await p.goto(base);
await p.fill('#clues', 'thing for the rain, you hold it over your head');
await p.getByRole('button', { name: 'Find the word' }).click();
await tilesReady(); await picturesReady(); await p.waitForTimeout(400);
await p.locator('.tiles .sign').first().click(); await p.waitForTimeout(300);
await p.screenshot({ path: 'docs/screenshots/find.png' });
await p.getByRole('tab', { name: 'Tap hints' }).click();
await p.getByRole('button', { name: 'a person' }).click();
await p.getByRole('button', { name: 'a health worker' }).click();
await p.getByRole('button', { name: 'Another clue' }).click();
await p.getByRole('button', { name: 'teeth' }).click();
await p.waitForTimeout(800); await tilesReady(); await picturesReady(); await p.waitForTimeout(400);
await p.screenshot({ path: 'docs/screenshots/hints.png' });
await b.close(); process.exit(0);
