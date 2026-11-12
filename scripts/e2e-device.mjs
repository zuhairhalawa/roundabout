// Live end-to-end test of the on-device path: real Chrome with Gemini Nano uses the real site.
// Checks that words are found on the device with no model request leaving the machine, that the
// cloud adds ideas for a short clue, and that everything still works with the network off.
//   node scripts/e2e-device.mjs [baseUrl]
// Needs about 5 GB of free memory and a free GPU. App Check: debug token from web/.env.local.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { startChrome } from './chrome.mjs';

const base = process.argv[2] || 'https://roundabout-words.web.app';
const out = 'test-results/e2e-device';
mkdirSync(out, { recursive: true });
const env = Object.fromEntries(readFileSync('web/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const { page, ctx, stop } = await startChrome({ size: '1320,960' });
await ctx.addInitScript((t) => { try { localStorage.setItem('roundabout:appcheck-debug', t); } catch { /* ignore */ } }, env.APPCHECK_DEBUG_TOKEN);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 220) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 170) : ''}`); };
const modelRequests = [];
ctx.on('request', (r) => { if (/generateContent/i.test(r.url())) modelRequests.push(new URL(r.url()).pathname.split('/').pop()); });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));

const tiles = async () => (await page.locator('.tiles .sign-word').allTextContents()).map((t) => t.trim().toLowerCase());
// Polls from this side rather than with page.waitForFunction: that one polls on animation
// frames, which a browser window in the background does not get.
const until = async (fn, timeout = 120_000, what = 'condition') => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(fn).catch(() => false)) return;
    if (Date.now() > end) throw new Error(`timed out after ${Math.round(timeout / 1000)} s waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
};
const done = () => until(() => Boolean(document.querySelector('.tiles .sign-word') && document.querySelector('.source') && !/Looking/.test(document.querySelector('.btn-go')?.textContent ?? '')), 120_000, 'an answer with a source line');
const find = async (clues) => {
  await page.fill('#clues', '');
  await page.fill('#clues', clues);
  await page.getByRole('button', { name: 'Find the word' }).click();
  await done();
  return tiles();
};

try {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto(base);
  await page.evaluate(() => { const t = localStorage.getItem('roundabout:appcheck-debug'); localStorage.clear(); if (t) localStorage.setItem('roundabout:appcheck-debug', t); });
  await page.reload();
  // Just after Chrome starts, asking whether a model is on the device can itself take a while.
  const tCheck = Date.now();
  await until(() => !/Checking/.test(document.querySelector('.pill')?.textContent ?? 'Checking'), 5 * 60_000, 'the status pill');
  check('the browser has an on-device model', /this device/.test(await page.textContent('.pill')), `${(await page.textContent('.pill')).trim()} (known after ${Math.round((Date.now() - tCheck) / 1000)} s)`);

  // The first tap wakes the model. Until it is ready the cloud answers, so nobody waits.
  const t0 = Date.now();
  let t = await find('you sit on it, four legs, at the table');
  const early = (await page.textContent('.source')).trim();
  check('while the on-device model is still loading, the cloud answers', /cloud/.test(early) && t.includes('chair'), `${early} [${t.slice(0, 3).join(', ')}]`);
  await until(() => /Works on this device/.test(document.querySelector('.pill')?.textContent ?? ''), 15 * 60_000, 'the on-device model to be ready');
  check('the on-device model becomes ready', true, `${Math.round((Date.now() - t0) / 1000)} s after the first tap`);

  // On the device: green tiles, no model request to the network.
  let before = modelRequests.length;
  t = await find('you open the door with it, small and metal, on a ring');
  let src = (await page.textContent('.source')).trim();
  check('a full clue is answered on the device', /Found on this device/.test(src) && /Nothing was sent/.test(src), src);
  check('"key" is offered', t.includes('key') || t.includes('keys'), t.join(', '));
  check('device tiles are green signs', (await page.locator('.tiles .sign-device').count()) > 0 && (await page.locator('.tiles .sign-cloud').count()) === 0);
  check('no model request left the machine for it', modelRequests.length === before, `${modelRequests.length - before} requests`);
  await page.screenshot({ path: `${out}/1-on-device.png` });

  // Type-ahead: guesses appear while typing, with no button pressed, and nothing is sent.
  before = modelRequests.length;
  await page.fill('#clues', 'you wear them on your feet, with laces');
  await until(() => [...document.querySelectorAll('.tiles .sign-word')].some((e) => /shoe|boot|sneaker|trainer/i.test(e.textContent)) && Boolean(document.querySelector('.source')), 30_000, 'type-ahead guesses').catch(() => {});
  t = await tiles();
  check('guesses appear while typing, with no button pressed, and nothing is sent', t.some((w) => /shoe|boot|sneaker|trainer/.test(w)) && modelRequests.length === before, t.join(', '));

  // A very short clue: the device answers first, then the cloud adds ideas (blue tiles).
  before = modelRequests.length;
  await find('money, cards, pocket');
  await until(() => Boolean(document.querySelector('.tiles .sign-cloud')), 30_000, 'blue tiles from the cloud').catch(() => {});
  src = (await page.textContent('.source')).trim();
  check('for a short clue the cloud adds ideas to the device answer', (await page.locator('.tiles .sign-device').count()) > 0 && (await page.locator('.tiles .sign-cloud').count()) > 0 && modelRequests.length > before, `${src} [${(await tiles()).join(', ')}]`);
  await page.screenshot({ path: `${out}/2-cloud-adds.png` });

  // Private mode: the same short clue, and nothing is sent.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('checkbox', { name: /Private mode/ }).check();
  await page.getByRole('button', { name: 'Close' }).click();
  before = modelRequests.length;
  await find('rain, hold, over head');
  await page.waitForTimeout(2500);
  check('private mode: answered on the device and nothing sent', (await page.locator('.tiles .sign-cloud').count()) === 0 && modelRequests.length === before, (await page.textContent('.source')).trim());
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('checkbox', { name: /Private mode/ }).uncheck();
  await page.getByRole('button', { name: 'Close' }).click();

  // Hints, drawing, sentences and practice hints on the device.
  await page.getByRole('tab', { name: 'Tap hints' }).click();
  await page.getByRole('button', { name: 'a thing' }).click();
  await page.getByRole('button', { name: 'in the kitchen' }).click();
  await page.getByRole('button', { name: 'Another clue' }).click();
  await page.getByRole('button', { name: 'cut', exact: true }).click();
  await page.waitForTimeout(800);
  await done();
  t = await tiles();
  check('hints (thing, kitchen, cut) find "knife" on the device', t.includes('knife') && /this device/.test(await page.textContent('.source')), t.join(', '));

  // Actions and feelings are the small model's weak spot (measured), so those go to the cloud first.
  before = modelRequests.length;
  await page.getByRole('button', { name: /a thing\. Tap to change/ }).click();
  await page.getByRole('button', { name: 'something you do' }).click();
  await page.getByRole('button', { name: 'with your mouth' }).click();
  await page.getByRole('button', { name: 'at night' }).click();
  await until(() => Boolean(document.querySelector('.tiles .sign-cloud')) && /cloud/.test(document.querySelector('.source')?.textContent ?? ''), 30_000, 'a cloud answer for an action').catch(() => {});
  check('an action goes to the cloud first, though the on-device model is ready', (await page.locator('.tiles .sign-cloud').count()) > 0 && (await page.locator('.tiles .sign-device').count()) === 0 && modelRequests.length > before, `${(await page.textContent('.source'))?.trim()} [${(await tiles()).slice(0, 4).join(', ')}]`);

  await page.getByRole('tab', { name: 'Draw it' }).click();
  const box = await page.locator('.pad-canvas').boundingBox();
  const P = (x, y) => [box.x + box.width * x, box.y + box.height * y];
  const stroke = async (pts) => { await page.mouse.move(...P(...pts[0])); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(...P(...p), { steps: 6 }); await page.mouse.up(); };
  await stroke([[0.3, 0.45], [0.3, 0.85], [0.7, 0.85], [0.7, 0.45], [0.3, 0.45]]);
  await stroke([[0.25, 0.45], [0.5, 0.15], [0.75, 0.45]]);
  await stroke([[0.46, 0.85], [0.46, 0.65], [0.54, 0.65], [0.54, 0.85]]);
  await done();
  t = await tiles();
  check('a drawing of a house is named on the device, live, with no button', t.some((w) => /house|home/.test(w)) && /this device/.test(await page.textContent('.source')), t.join(', '));
  await page.screenshot({ path: `${out}/3-draw.png` });

  await page.getByRole('button', { name: 'Say a sentence' }).click();
  await page.fill('#kw', 'doctor, Tuesday, change');
  await page.getByRole('button', { name: 'Make a sentence' }).click();
  await until(() => Boolean(document.querySelector('.sentences .sentence')), 120_000, 'sentences');
  const sentences = await page.locator('.sentences .sentence').allTextContents();
  check('sentences are written on the device', sentences.length >= 2 && (await page.locator('.sentence-device').count()) > 0, sentences[0]);

  // Offline: reload with the network off. The app still opens and still finds words.
  await page.getByRole('button', { name: 'Find a word' }).click();
  await page.waitForTimeout(1500); // let the service worker finish keeping the files
  await ctx.setOffline(true);
  await page.reload();
  await until(() => Boolean(document.querySelector('#clues')), 30_000, 'the app to open offline');
  check('with the network off, the app still opens', true);
  before = modelRequests.length;
  await page.click('h1'); // a tap wakes the model again after the reload
  await until(() => /Still works on this device/.test(document.querySelector('.pill')?.textContent ?? ''), 15 * 60_000, 'the on-device model to be ready again, offline');
  t = await find('thing for the rain, you hold it over your head');
  src = (await page.textContent('.source')).trim();
  check('with the network off, "umbrella" is found on the device', t.includes('umbrella') && /Found on this device/.test(src), `${src} [${t.slice(0, 4).join(', ')}]`);
  await page.screenshot({ path: `${out}/4-offline.png` });
  await ctx.setOffline(false);
} catch (e) {
  check('no crash', false, String(e).slice(0, 300));
  await page.screenshot({ path: `${out}/error.png` }).catch(() => {});
} finally {
  await ctx.setOffline(false).catch(() => {});
  writeFileSync(`${out}/results.json`, JSON.stringify({ at: new Date().toISOString(), base, results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await stop();
  process.exit(failed ? 1 : 0);
}
