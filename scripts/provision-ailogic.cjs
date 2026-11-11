// Same action as `firebase init ailogic`, without the interactive app picker:
// enables Firebase AI Logic (Gemini Developer API) for this project's web app.
// Uses the Firebase CLI's own code and the CLI's saved login.
const path = require('node:path');
const fs = require('node:fs');

const cache = path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx');
const dir = fs.readdirSync(cache)
  .map((d) => path.join(cache, d, 'node_modules', 'firebase-tools'))
  .find((d) => fs.existsSync(path.join(d, 'lib', 'init', 'features', 'ailogic')));
if (!dir) throw new Error('firebase-tools not found in the npx cache; run any `npx -y firebase-tools@latest` command first');
const ft = (p) => require(path.join(dir, 'lib', p));

(async () => {
  const projectId = process.argv[2] || 'roundabout-words';
  const platformArg = (process.argv[3] || 'WEB').toUpperCase();
  const { requireAuth } = ft('requireAuth');
  // The CLI normally fills these in from its saved login before a command runs.
  const account = ft('auth').getGlobalDefaultAccount();
  if (!account) throw new Error('Not signed in: run `npx -y firebase-tools@latest login` first');
  await requireAuth({ project: projectId, projectId, user: account.user, tokens: account.tokens });
  const { listFirebaseApps, AppPlatform } = ft('management/apps');
  const { provisionFirebaseApp } = ft('management/provisioning/provision');
  const apps = await listFirebaseApps(projectId, AppPlatform[platformArg]);
  if (!apps.length) throw new Error(`no ${platformArg} app registered`);
  const app = apps[0];
  const res = await provisionFirebaseApp({
    project: { parent: { type: 'existing_project', projectId } },
    app: { platform: AppPlatform[platformArg], appId: app.appId, displayName: app.displayName },
    features: { firebaseAiLogicInput: {} },
  });
  console.log('AI Logic provisioned for', app.displayName, '- response fields:', Object.keys(res).join(', '));
})().catch((e) => {
  console.error('FAILED:', String((e && e.message) || e).slice(0, 800));
  process.exit(1);
});
