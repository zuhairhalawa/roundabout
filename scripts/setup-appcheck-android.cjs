// App Check for the Android app's automated run (GitHub Actions emulator): makes one debug
// token, registers it for the Android app through Google's REST API with the CLI login, and
// saves it to android/.env (git-ignored) as APPCHECK_DEBUG_TOKEN. The workflow hands it to the
// app on the emulator at run time; it is never part of the source or of a build.
// Safe to run again: an existing token is reused. Never prints the token.
//   node scripts/fetch-android-config.mjs && node scripts/setup-appcheck-android.cjs
const fs = require('node:fs');
const crypto = require('node:crypto');
const { call } = require('./fb-api.cjs');

const PROJECT = 'roundabout-words';
const ENV = 'android/.env';
const NAME = 'roundabout-android-ci';

const readEnv = () => Object.fromEntries(fs.readFileSync(ENV, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const writeEnv = (env) => fs.writeFileSync(ENV, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
const ok = (r, what) => { if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };

(async () => {
  const env = readEnv();
  const appId = env.FB_APP_ID;
  if (!appId) throw new Error('android/.env has no FB_APP_ID; run scripts/fetch-android-config.mjs first');
  const tokens = `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT}/apps/${appId}/debugTokens`;
  const existing = ok(await call('GET', tokens), 'list debug tokens').debugTokens || [];
  if (env.APPCHECK_DEBUG_TOKEN && existing.some((t) => t.displayName === NAME)) {
    console.log('debug token already set');
  } else {
    for (const t of existing.filter((t) => t.displayName === NAME)) await call('DELETE', `https://firebaseappcheck.googleapis.com/v1/${t.name}`);
    const token = crypto.randomUUID();
    ok(await call('POST', tokens, { displayName: NAME, token }), 'create debug token');
    env.APPCHECK_DEBUG_TOKEN = token;
    console.log(`debug token "${NAME}" created and saved to ${ENV} (not printed)`);
  }
  writeEnv(env);
  console.log(`${ENV} now has:`, Object.keys(env).join(', '));
})().catch((e) => { console.error('FAILED:', String((e && e.message) || e).replace(/AIza[0-9A-Za-z_-]{20,}/g, '<api-key>').slice(0, 900)); process.exit(1); });
