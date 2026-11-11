// Fetches the Firebase web config with the CLI and writes web/.env.local (git-ignored).
// Prints key names only, never values.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const run = (cmd) => execSync(`npx -y firebase-tools@latest ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const apps = JSON.parse(run('apps:list WEB --json')).result;
if (!apps.length) throw new Error('No web app registered');
const appId = apps[0].appId;
const cfg = JSON.parse(run(`apps:sdkconfig WEB ${appId} --json`)).result.sdkConfig;
const file = 'web/.env.local';
const keep = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(l => /^(VITE_RECAPTCHA_KEY|APPCHECK_DEBUG_TOKEN)=/.test(l)) : [];
const has = (k) => keep.some(l => l.startsWith(k + '='));
const lines = [
  `VITE_FB_API_KEY=${cfg.apiKey}`,
  `VITE_FB_AUTH_DOMAIN=${cfg.authDomain}`,
  `VITE_FB_PROJECT_ID=${cfg.projectId}`,
  `VITE_FB_APP_ID=${cfg.appId}`,
  `VITE_FB_STORAGE_BUCKET=${cfg.storageBucket ?? ''}`,
  `VITE_FB_SENDER_ID=${cfg.messagingSenderId ?? ''}`,
  ...keep,
  ...(has('VITE_RECAPTCHA_KEY') ? [] : ['VITE_RECAPTCHA_KEY=']),
  ...(has('APPCHECK_DEBUG_TOKEN') ? [] : ['APPCHECK_DEBUG_TOKEN=']),
];
writeFileSync(file, lines.join('\n') + '\n');
console.log('wrote', file, 'with keys:', lines.map(l => l.split('=')[0] + (l.split('=')[1] ? '' : ' (empty)')).join(', '));
