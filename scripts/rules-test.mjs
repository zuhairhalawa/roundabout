// Live test of the deployed Firestore security rules with three real anonymous users:
// an owner, a helper and a stranger. Each line tries one operation and checks that the rules
// allow or deny it as designed.
//   node scripts/rules-test.mjs            (needs the dev server on :5196 for web/lab.html)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '../../video/node_modules/playwright/index.mjs';

const base = process.env.RB_URL || 'http://localhost:5196';
const env = Object.fromEntries(readFileSync('web/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const browser = await chromium.launch({ channel: 'msedge' });

async function user() {
  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => { try { localStorage.setItem('roundabout:appcheck-debug', t); } catch { /* ignore */ } }, env.APPCHECK_DEBUG_TOKEN);
  const page = await ctx.newPage();
  await page.goto(`${base}/lab.html`);
  await page.waitForFunction(() => window.fs);
  const uid = await page.evaluate(() => window.fs.uid());
  const attempt = (op, path, data) => page.evaluate(([o, p, d]) => window.fs.attempt(o, p, d), [op, path, data ?? null]);
  return { uid, attempt };
}

const owner = await user();
const helper = await user();
const stranger = await user();
const results = [];
let failed = 0;
async function expect(name, who, op, path, want, data) {
  const got = await who.attempt(op, path, data);
  const ok = want === 'ok' ? got.startsWith('ok') : got === want;
  if (!ok) failed++;
  results.push({ name, op, want, got, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${op} expected ${want}, got ${got}`);
}

const O = owner.uid, H = helper.uid;
const code = 'TEST' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[01IO]/g, 'X');
const word = (by) => ({ word: 'Layla', emoji: '👧', note: 'my granddaughter', by, updatedAt: '__now__' });
console.log(`three different users: ${new Set([O, H, stranger.uid]).size === 3}`);

// --- owner sets up ---
await expect('owner creates their profile', owner, 'set', `people/${O}`, 'ok', { name: 'Sam', updatedAt: '__now__' });
await expect('owner adds a word', owner, 'set', `people/${O}/words/w1`, 'ok', word(O));
await expect('owner reads their words', owner, 'list', `people/${O}/words`, 'ok');

// --- strangers and not-yet helpers get nothing ---
await expect('stranger cannot read the profile', stranger, 'get', `people/${O}`, 'denied');
await expect('stranger cannot list the words', stranger, 'list', `people/${O}/words`, 'denied');
await expect('stranger cannot read one word', stranger, 'get', `people/${O}/words/w1`, 'denied');
await expect('stranger cannot add a word', stranger, 'set', `people/${O}/words/evil`, 'denied', word(stranger.uid));
await expect('stranger cannot delete a word', stranger, 'delete', `people/${O}/words/w1`, 'denied');
await expect('stranger cannot write the owner profile', stranger, 'set', `people/${O}`, 'denied', { name: 'Hacked', updatedAt: '__now__' });
await expect('helper-to-be cannot read words before joining', helper, 'list', `people/${O}/words`, 'denied');
await expect('nobody can list invite codes', stranger, 'list', 'invites', 'denied');
await expect('stranger cannot list helpers', stranger, 'list', `people/${O}/helpers`, 'denied');

// --- joining needs a real, open invite from this owner ---
await expect('cannot become a helper with a made-up code', stranger, 'set', `people/${O}/helpers/${stranger.uid}`, 'denied', { code: 'ZZZZZZZZ', joinedAt: '__now__' });
await expect('cannot make an invite in someone else\'s name', stranger, 'set', `invites/${code}X`, 'denied', { owner: O, name: 'Sam', expires: '__in:10m__' });
await expect('cannot make an invite that lasts a day', owner, 'set', `invites/${code}L`, 'denied', { owner: O, name: 'Sam', expires: '__in:1440m__' });
await expect('cannot make an invite with a badly formed code', owner, 'set', 'invites/short', 'denied', { owner: O, name: 'Sam', expires: '__in:10m__' });
await expect('owner makes an invite', owner, 'set', `invites/${code}`, 'ok', { owner: O, name: 'Sam', expires: '__in:10m__' });
await expect('an invite cannot be changed afterwards', owner, 'set', `invites/${code}`, 'denied', { owner: O, name: 'Sam', expires: '__in:50m__' });
await expect('someone who knows the code can read the invite', helper, 'get', `invites/${code}`, 'ok');
await expect('a stranger\'s own invite does not open this owner\'s words', stranger, 'set', `invites/${code}S`, 'ok', { owner: stranger.uid, name: 'X', expires: '__in:10m__' });
await expect('…joining this owner with that other invite is refused', stranger, 'set', `people/${O}/helpers/${stranger.uid}`, 'denied', { code: `${code}S`, joinedAt: '__now__' });
await expect('cannot add someone else as a helper', stranger, 'set', `people/${O}/helpers/${H}`, 'denied', { code, joinedAt: '__now__' });
await expect('helper joins with the code', helper, 'set', `people/${O}/helpers/${H}`, 'ok', { code, joinedAt: '__now__' });
await expect('owner cannot be their own helper', owner, 'set', `people/${O}/helpers/${O}`, 'denied', { code, joinedAt: '__now__' });

// --- a helper can read and edit words, in the valid shape only ---
await expect('helper reads the words', helper, 'list', `people/${O}/words`, 'ok');
await expect('helper reads the profile', helper, 'get', `people/${O}`, 'ok');
await expect('helper adds a word', helper, 'set', `people/${O}/words/w2`, 'ok', { word: 'Omar', emoji: '👨', note: 'son-in-law', by: H, updatedAt: '__now__' });
await expect('helper edits a word', helper, 'set', `people/${O}/words/w1`, 'ok', { ...word(H), note: 'granddaughter, age 6' });
await expect('helper cannot write as the owner', helper, 'set', `people/${O}/words/w3`, 'denied', word(O));
await expect('no extra fields', helper, 'set', `people/${O}/words/w3`, 'denied', { ...word(H), admin: true });
await expect('no missing fields', helper, 'set', `people/${O}/words/w3`, 'denied', { word: 'x', by: H, updatedAt: '__now__' });
await expect('no oversized word', helper, 'set', `people/${O}/words/w3`, 'denied', { ...word(H), word: '__repeat:5000__' });
await expect('no oversized note', helper, 'set', `people/${O}/words/w3`, 'denied', { ...word(H), note: '__repeat:5000__' });
await expect('no wrong types', helper, 'set', `people/${O}/words/w3`, 'denied', { ...word(H), word: 42 });
await expect('no made-up timestamps', helper, 'set', `people/${O}/words/w3`, 'denied', { ...word(H), updatedAt: '__in:60m__' });
await expect('an edit cannot break the shape either', helper, 'set', `people/${O}/words/w1`, 'denied', { ...word(H), emoji: '__repeat:200__' });
await expect('helper cannot change the owner profile', helper, 'set', `people/${O}`, 'denied', { name: 'Not Sam', updatedAt: '__now__' });
await expect('helper cannot list other helpers', helper, 'list', `people/${O}/helpers`, 'denied');
await expect('helper cannot delete the invite', helper, 'delete', `invites/${code}`, 'denied');
await expect('profile rejects a huge name', owner, 'set', `people/${O}`, 'denied', { name: '__repeat:5000__', updatedAt: '__now__' });
await expect('nothing outside the model can be written', owner, 'set', `secrets/${O}`, 'denied', { a: 1 });

// --- the owner stays in control ---
await expect('owner sees their helpers', owner, 'list', `people/${O}/helpers`, 'ok');
await expect('owner removes the helper', owner, 'delete', `people/${O}/helpers/${H}`, 'ok');
await expect('removed helper can no longer read', helper, 'list', `people/${O}/words`, 'denied');
await expect('removed helper can no longer write', helper, 'set', `people/${O}/words/w4`, 'denied', word(H));

// --- clean up the test data ---
await owner.attempt('delete', `invites/${code}`);
await stranger.attempt('delete', `invites/${code}S`);
for (const w of ['w1', 'w2']) await owner.attempt('delete', `people/${O}/words/${w}`);
await owner.attempt('delete', `people/${O}`);

mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/rules-test.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
