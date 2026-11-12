// Live end-to-end test of sharing saved words: two separate browsers (two devices), one for the
// person and one for their helper. Uses the real UI, real anonymous sign-in and the real database.
//   node scripts/e2e-share.mjs [baseUrl]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '../../video/node_modules/playwright/index.mjs';

const base = process.argv[2] || 'https://roundabout-words.web.app';
const out = 'test-results/e2e-share';
mkdirSync(out, { recursive: true });
const env = Object.fromEntries(readFileSync('web/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const browser = await chromium.launch({ channel: 'msedge' });

async function device(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('roundabout:appcheck-debug', t); } catch { /* ignore */ } }, env.APPCHECK_DEBUG_TOKEN);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await page.goto(base);
  await page.getByRole('button', { name: 'My words' }).click();
  return page;
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 200) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`); };
const words = async (page) => (await page.locator('.tiles .sign-word').allTextContents()).map((t) => t.trim());

try {
  const sam = await device(1100);     // the person with aphasia
  const helper = await device(480);   // a family member, on a phone-sized screen

  // Sam has one word on his own device, then turns sharing on and invites a helper.
  await sam.fill('#w-word', 'Layla');
  await sam.fill('#w-note', 'my granddaughter');
  await sam.getByRole('button', { name: 'Save this word' }).click();
  check('a word saved before sharing stays on the device', (await words(sam)).includes('Layla'));
  await sam.getByRole('button', { name: 'Turn on sharing' }).click();
  await sam.waitForSelector('#share-name', { timeout: 30_000 });
  await sam.fill('#share-name', 'Sam');
  await sam.getByRole('button', { name: 'Invite a helper' }).click();
  await sam.waitForSelector('.invite-code', { timeout: 30_000 });
  const code = (await sam.textContent('.invite-code')).trim();
  check('an 8-character invite code is shown', /^[A-Z2-9]{4} [A-Z2-9]{4}$/.test(code), code.replace(/[A-Z2-9]/g, '•'));
  await sam.screenshot({ path: `${out}/1-invite.png` });

  // The helper types the code on their own device.
  await helper.fill('#join-code', code.toLowerCase());
  await helper.getByRole('button', { name: 'Join' }).click();
  await helper.waitForSelector('.helping-bar', { timeout: 30_000 });
  check('the helper sees whose words these are', /Words for Sam/.test(await helper.textContent('h1')), await helper.textContent('h1'));
  await helper.waitForFunction(() => [...document.querySelectorAll('.tiles .sign-word')].some((e) => e.textContent.trim() === 'Layla'), null, { timeout: 30_000 });
  check('the helper sees the word Sam already had', (await words(helper)).includes('Layla'));

  // The helper adds a name; it appears on Sam's device without a reload.
  await helper.fill('#w-word', 'Omar');
  await helper.fill('#w-note', "my daughter's husband");
  await helper.getByRole('button', { name: 'Save this word' }).click();
  await sam.waitForFunction(() => [...document.querySelectorAll('.tiles .sign-word')].some((e) => e.textContent.trim() === 'Omar'), null, { timeout: 30_000 });
  check("the helper's new word appears on Sam's device by itself", (await words(sam)).includes('Omar'));
  check('the invite is withdrawn once the helper has joined', (await sam.locator('.invite-code').count()) === 0);
  check('Sam sees that he has one helper', /Helper 1/.test(await sam.textContent('.helpers')));
  await helper.screenshot({ path: `${out}/2-helper.png` });

  // Sam can now find that name from a loose clue, first and with no model involved.
  await sam.getByRole('button', { name: 'Find a word' }).click();
  await sam.fill('#clues', 'daughter husband');
  await sam.getByRole('button', { name: 'Find the word' }).click();
  await sam.waitForSelector('.tiles .sign-saved', { timeout: 60_000 });
  const first = (await sam.locator('.tiles .sign-word').first().textContent()).trim();
  check('"daughter husband" finds Omar first, as a saved (brown) word', first === 'Omar', first);
  await sam.screenshot({ path: `${out}/3-found.png` });

  // Sam removes the helper; the helper loses access at once.
  await sam.getByRole('button', { name: 'My words' }).click();
  await sam.getByRole('button', { name: 'Remove', exact: true }).click();
  await helper.waitForSelector('.note', { timeout: 30_000 });
  const gone = await helper.textContent('.note');
  check('a removed helper is told, and no longer sees the words', /no longer a helper/.test(gone) && !/Words for/.test(await helper.textContent('h1')), gone.trim());

  // Clean up: delete the test words and switch sharing off.
  for (const w of ['Omar', 'Layla']) await sam.getByRole('button', { name: `Remove ${w}` }).click();
  await sam.waitForFunction(() => document.querySelectorAll('.tiles .sign-word').length === 0, null, { timeout: 15_000 });
  await sam.getByRole('button', { name: 'Turn off sharing' }).click();
  check('test data cleaned up', (await words(sam)).length === 0);
} catch (e) {
  check('no crash', false, String(e).slice(0, 300));
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ at: new Date().toISOString(), base, results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
