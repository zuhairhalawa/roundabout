// Looks at the test Chrome that is already running (port 9334): pill text, source line, tiles, and a screenshot.
import { chromium } from '../../video/node_modules/playwright/index.mjs';
const b = await chromium.connectOverCDP('http://127.0.0.1:9334');
for (const p of b.contexts()[0].pages()) {
  const info = await Promise.race([
    p.evaluate(() => ({ url: location.href, pill: document.querySelector('.pill')?.textContent?.trim(), go: document.querySelector('.btn-go')?.textContent?.trim(), source: document.querySelector('.source')?.textContent?.trim(), tiles: [...document.querySelectorAll('.tiles .sign-word')].map((e) => e.textContent), note: document.querySelector('.note')?.textContent?.trim() })),
    new Promise((r) => setTimeout(() => r('page did not answer in 8 s'), 8000)),
  ]);
  console.log(JSON.stringify(info));
  await Promise.race([p.screenshot({ path: process.argv[2] || 'test-results/peek.png' }), new Promise((r) => setTimeout(r, 8000))]).catch(() => {});
}
process.exit(0);
