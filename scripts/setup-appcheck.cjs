// One-time App Check set-up for the web app, through Google's REST APIs with the CLI login:
//  1. a reCAPTCHA Enterprise score key for the hosted domains,
//  2. the web app registered with App Check using that key,
//  3. a debug token for local development and automated tests (saved to web/.env.local only),
//  4. App Check enforced for Firebase AI Logic and for Cloud Firestore.
// Safe to run again: existing keys and tokens are reused. Never prints the debug token.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { call } = require('./fb-api.cjs');

const PROJECT = 'roundabout-words';
const DOMAINS = [`${PROJECT}.web.app`, `${PROJECT}.firebaseapp.com`];
const ENV = 'web/.env.local';

const readEnv = () => Object.fromEntries(fs.readFileSync(ENV, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const writeEnv = (env) => fs.writeFileSync(ENV, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
const ok = (r, what) => { if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };

(async () => {
  const env = readEnv();
  const appId = env.VITE_FB_APP_ID;
  if (!appId) throw new Error('web/.env.local has no VITE_FB_APP_ID; run scripts/fetch-web-config.mjs first');

  // 1. reCAPTCHA Enterprise key
  const rc = `https://recaptchaenterprise.googleapis.com/v1/projects/${PROJECT}/keys`;
  const keys = ok(await call('GET', rc), 'list keys').keys || [];
  let key = keys.find((k) => k.displayName === 'roundabout-web');
  if (!key) {
    key = ok(await call('POST', rc, {
      displayName: 'roundabout-web',
      webSettings: { integrationType: 'SCORE', allowedDomains: DOMAINS, allowAmpTraffic: false },
    }), 'create key');
    console.log('created reCAPTCHA Enterprise key for', DOMAINS.join(', '));
  } else console.log('reCAPTCHA Enterprise key already exists');
  const siteKey = key.name.split('/').pop();
  env.VITE_RECAPTCHA_KEY = siteKey;

  // 2. register the app with App Check
  const ac = `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT}`;
  ok(await call('PATCH', `${ac}/apps/${appId}/recaptchaEnterpriseConfig?updateMask=siteKey,tokenTtl`, { siteKey, tokenTtl: '3600s' }), 'register app');
  console.log('web app registered with App Check (reCAPTCHA Enterprise)');

  // 3. debug token for localhost and tests
  const existing = ok(await call('GET', `${ac}/apps/${appId}/debugTokens`), 'list debug tokens').debugTokens || [];
  if (env.APPCHECK_DEBUG_TOKEN && existing.some((t) => t.displayName === 'roundabout-dev')) {
    console.log('debug token already set');
  } else {
    for (const t of existing.filter((t) => t.displayName === 'roundabout-dev')) await call('DELETE', `https://firebaseappcheck.googleapis.com/v1/${t.name}`);
    const token = crypto.randomUUID();
    ok(await call('POST', `${ac}/apps/${appId}/debugTokens`, { displayName: 'roundabout-dev', token }), 'create debug token');
    env.APPCHECK_DEBUG_TOKEN = token;
    console.log('debug token created and saved to web/.env.local (not printed)');
  }
  writeEnv(env);

  // 4. enforcement for AI Logic
  const services = ok(await call('GET', `${ac}/services`), 'list services').services || [];
  console.log('App Check services:', services.map((s) => `${s.name.split('/').pop()}=${s.enforcementMode || 'UNENFORCED'}`).join(', ') || '(none listed)');
  // firebaseml = Firebase AI Logic; firestore = the saved-words database.
  for (const id of ['firebaseml.googleapis.com', 'firestore.googleapis.com']) {
    const r = await call('PATCH', `${ac}/services/${id}?updateMask=enforcementMode`, { enforcementMode: 'ENFORCED' });
    console.log(`enforce ${id}:`, r.status, r.status < 300 ? r.body.enforcementMode : JSON.stringify(r.body).slice(0, 300));
  }
})().catch((e) => { console.error('FAILED:', String((e && e.message) || e).replace(/AIza[0-9A-Za-z_-]{20,}/g, '<api-key>').slice(0, 900)); process.exit(1); });
