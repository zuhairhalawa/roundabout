// Fetches the Firebase settings of the Android app with the CLI and writes android/.env
// (git-ignored). The Gradle build reads that file; in CI the same four names come from
// repository secrets. Prints key names only, never values.
//   node scripts/fetch-android-config.mjs
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const PROJECT = 'roundabout-words';
const PACKAGE = 'app.roundabout.words';
const run = (cmd) => execSync(`npx -y firebase-tools@latest ${cmd} --project ${PROJECT}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const apps = JSON.parse(run('apps:list ANDROID --json')).result;
const app = apps.find((a) => (a.namespace ?? a.packageName) === PACKAGE) ?? apps[0];
if (!app) throw new Error(`No Android app registered. Run: npx -y firebase-tools@latest apps:create ANDROID "Roundabout Android" --package-name ${PACKAGE} --project ${PROJECT}`);

const sdk = JSON.parse(run(`apps:sdkconfig ANDROID ${app.appId} --json`)).result;
// The CLI returns the contents of google-services.json; only four values of it are needed.
const services = JSON.parse(sdk.fileContents ?? sdk.sdkConfig ?? '{}');
const client = (services.client ?? []).find((c) => c.client_info?.android_client_info?.package_name === PACKAGE) ?? services.client?.[0];
const values = {
  FB_API_KEY: client?.api_key?.[0]?.current_key ?? '',
  FB_APP_ID: client?.client_info?.mobilesdk_app_id ?? app.appId,
  FB_PROJECT_ID: services.project_info?.project_id ?? PROJECT,
  FB_SENDER_ID: services.project_info?.project_number ?? '',
};
// Keep the App Check debug token that scripts/setup-appcheck-android.cjs saved in the same file.
const file = 'android/.env';
const keep = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('APPCHECK_DEBUG_TOKEN=')) : [];
writeFileSync(file, [...Object.entries(values).map(([k, v]) => `${k}=${v}`), ...keep].join('\n') + '\n');
console.log('wrote android/.env with keys:', Object.entries(values).map(([k, v]) => k + (v ? '' : ' (empty)')).join(', '));
