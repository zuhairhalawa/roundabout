// Live end-to-end test of the cloud path: a browser with no on-device model (headless Edge)
// uses the real site. Every way of finding a word is exercised, plus sentences, saved words,
// private mode and offline. Also checks that model requests only ever go to Firebase AI Logic.
//   node scripts/e2e-cloud.mjs [baseUrl]
// App Check: the test hands the page a debug token from web/.env.local (never printed).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '../../video/node_modules/playwright/index.mjs';

const base = process.argv[2] || 'https://roundabout-words.web.app';
const out = 'test-results/e2e-cloud';
mkdirSync(out, { recursive: true });
const env = Object.fromEntries(readFileSync('web/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((t) => { try { localStorage.setItem('roundabout:appcheck-debug', t); } catch { /* ignore */ } }, env.APPCHECK_DEBUG_TOKEN);
const page = await ctx.newPage();

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 200) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`); };
const aiHosts = new Map();
page.on('request', (r) => {
  const u = new URL(r.url());
  if (/generateContent|streamGenerateContent/.test(u.pathname)) aiHosts.set(u.host, (aiHosts.get(u.host) ?? 0) + 1);
});
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));

const tiles = async () => (await page.locator('.tiles .sign-word').allTextContents()).map((t) => t.trim().toLowerCase());
const waitTiles = async () => { await page.waitForFunction(() => document.querySelector('.tiles .sign-word') && !/Looking/.test(document.querySelector('.btn-go')?.textContent ?? ''), null, { timeout: 60_000 }); return tiles(); };

try {
  await page.goto(base);
  await page.evaluate(() => { const t = localStorage.getItem('roundabout:appcheck-debug'); localStorage.clear(); if (t) localStorage.setItem('roundabout:appcheck-debug', t); });
  await page.reload();
  await page.waitForFunction(() => !/Checking/.test(document.querySelector('.pill')?.textContent ?? 'Checking'));
  const pill = await page.textContent('.pill');
  check('browser has no on-device model, app says it uses the cloud', /Using the cloud/.test(pill), pill.trim());

  // 1. describe
  await page.fill('#clues', 'you open the door with it, small, metal');
  await page.getByRole('button', { name: 'Find the word' }).click();
  let t = await waitTiles();
  check('describe: "key" is offered first', t[0] === 'key', t.join(', '));
  const src = await page.textContent('.source');
  check('answer is labelled as coming from the cloud', /Found in the cloud/.test(src), src.trim());
  check('cloud tiles are blue signs', (await page.locator('.tiles .sign-cloud').count()) === t.length);
  await page.locator('.tiles .sign').first().click();
  check('tapping a tile selects it', (await page.locator('.sign-chosen').count()) === 1);
  await page.getByRole('button', { name: 'Use in a sentence' }).click();
  check('the word is added to the sentence strip', /key/.test(await page.textContent('.stripbar')));
  await page.screenshot({ path: `${out}/1-describe.png` });

  // 2. "None of these" asks for different words
  await page.fill('#clues', 'the round thing on the wall that shows the hours');
  await page.getByRole('button', { name: 'Find the word' }).click();
  t = await waitTiles();
  const before = t.length;
  check('describe: "clock" is offered', t.includes('clock'), t.join(', '));
  await page.getByRole('button', { name: 'None of these' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.tiles .sign-word').length > n || document.querySelector('.note'), before, { timeout: 60_000 });
  const after = await tiles();
  check('"None of these" adds new, different words', after.length > before && new Set(after).size === after.length, `${before} -> ${after.length}`);

  // 3. hints, one question at a time
  await page.getByRole('tab', { name: 'Tap hints' }).click();
  await page.getByRole('button', { name: 'a thing' }).click();
  await page.getByRole('button', { name: 'in the kitchen' }).click();
  await page.getByRole('button', { name: 'Another clue' }).click();
  await page.getByRole('button', { name: 'cut', exact: true }).click();
  await page.waitForTimeout(700);
  t = await waitTiles();
  check('hints (thing + kitchen + cut): "knife" is offered', t.includes('knife'), t.join(', '));
  await page.screenshot({ path: `${out}/2-hints.png` });

  // 4. draw: a house (square, roof, door)
  await page.getByRole('tab', { name: 'Draw it' }).click();
  const box = await page.locator('.pad-canvas').boundingBox();
  const P = (x, y) => [box.x + box.width * x, box.y + box.height * y];
  const stroke = async (pts) => { await page.mouse.move(...P(...pts[0])); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(...P(...p), { steps: 6 }); await page.mouse.up(); };
  await stroke([[0.3, 0.45], [0.3, 0.85], [0.7, 0.85], [0.7, 0.45], [0.3, 0.45]]);
  await stroke([[0.25, 0.45], [0.5, 0.15], [0.75, 0.45]]);
  await stroke([[0.46, 0.85], [0.46, 0.65], [0.54, 0.65], [0.54, 0.85]]);
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Find the word' }).click();
  t = await waitTiles();
  check('draw (a house): "house" or "home" is offered', t.some((w) => /house|home/.test(w)), t.join(', '));
  await page.screenshot({ path: `${out}/3-draw.png` });

  // 5. photo: a generated picture of a clock face
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 500; c.height = 500;
    const g = c.getContext('2d'); g.fillStyle = '#e9eef2'; g.fillRect(0, 0, 500, 500);
    g.fillStyle = '#fff'; g.strokeStyle = '#222'; g.lineWidth = 14; g.beginPath(); g.arc(250, 250, 190, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#222'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let h = 1; h <= 12; h++) { const a = (h / 12) * 2 * Math.PI - Math.PI / 2; g.fillText(String(h), 250 + Math.cos(a) * 150, 250 + Math.sin(a) * 150); }
    g.lineCap = 'round'; g.lineWidth = 12; g.beginPath(); g.moveTo(250, 250); g.lineTo(250, 130); g.stroke();
    g.lineWidth = 16; g.beginPath(); g.moveTo(250, 250); g.lineTo(330, 290); g.stroke();
    return c.toDataURL('image/png').split(',')[1];
  });
  writeFileSync(`${out}/clock.png`, Buffer.from(png, 'base64'));
  await page.getByRole('tab', { name: 'Show a photo' }).click();
  await page.setInputFiles('input[type=file]', `${out}/clock.png`);
  t = await waitTiles();
  check('photo (a clock face): "clock" is offered', t.some((w) => /clock|watch/.test(w)), t.join(', '));

  // 6. sentence builder
  await page.getByRole('button', { name: 'Say a sentence' }).click();
  await page.fill('#kw', 'door, lost');
  await page.getByRole('button', { name: 'Make a sentence' }).click();
  await page.waitForSelector('.sentences .sentence', { timeout: 60_000 });
  const sentences = await page.locator('.sentences .sentence').allTextContents();
  check('sentence builder returns three sentences that use the key words', sentences.length === 3 && sentences.every((s) => /key/i.test(s)), sentences[0]);
  await page.screenshot({ path: `${out}/4-say.png` });

  // 7. saved words come first, with no model
  await page.getByRole('button', { name: 'My words' }).click();
  await page.fill('#w-word', 'Layla');
  await page.fill('#w-note', 'my granddaughter');
  await page.getByRole('button', { name: 'Save this word' }).click();
  await page.getByRole('button', { name: 'Find a word' }).click();
  await page.getByRole('tab', { name: 'Describe it' }).click();
  await page.fill('#clues', 'my granddaughter');
  await page.getByRole('button', { name: 'Find the word' }).click();
  t = await waitTiles();
  check('a saved word that matches the clue is offered first, as a brown sign', t[0] === 'layla' && (await page.locator('.tiles li').first().locator('.sign-saved').count()) === 1, t.join(', '));

  // 8. private mode never uses the cloud
  const reqBefore = [...aiHosts.values()].reduce((a, b) => a + b, 0);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.switch input').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.fill('#clues', 'you sit on it');
  await page.getByRole('button', { name: 'Find the word' }).click();
  await page.waitForSelector('.note', { timeout: 15_000 });
  const privateNote = await page.textContent('.note');
  const reqAfter = [...aiHosts.values()].reduce((a, b) => a + b, 0);
  check('private mode: nothing is sent, and the app says why', reqAfter === reqBefore && /Private mode/.test(privateNote), privateNote.trim());
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.switch input').uncheck();
  await page.getByRole('button', { name: 'Close' }).click();

  // 9. offline with no on-device model: a clear message, no crash
  await ctx.setOffline(true);
  await page.fill('#clues', 'you sleep on it');
  await page.getByRole('button', { name: 'Find the word' }).click();
  await page.waitForSelector('.note', { timeout: 15_000 });
  const offNote = await page.textContent('.note');
  check('offline without an on-device model: the app explains', /offline/i.test(offNote), offNote.trim());
  await ctx.setOffline(false);

  // 10. every model request went through Firebase AI Logic
  const hosts = [...aiHosts.keys()];
  check('all model requests go to Firebase AI Logic only', hosts.length === 1 && hosts[0] === 'firebasevertexai.googleapis.com', JSON.stringify(Object.fromEntries(aiHosts)));
} catch (e) {
  check('no crash', false, String(e).slice(0, 300));
  await page.screenshot({ path: `${out}/error.png` }).catch(() => {});
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ at: new Date().toISOString(), base, results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
