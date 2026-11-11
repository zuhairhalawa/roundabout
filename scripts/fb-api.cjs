// Calls a Google/Firebase REST API with the Firebase CLI's saved login.
// Usage: node scripts/fb-api.cjs GET|POST|PATCH <full-url> [json-body]
// Used for project set-up steps the CLI has no command for (App Check registration).
// Output is masked: API keys and debug tokens are never printed.
const path = require('node:path');
const fs = require('node:fs');

const cache = path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx');
const dir = fs.readdirSync(cache)
  .map((d) => path.join(cache, d, 'node_modules', 'firebase-tools'))
  .find((d) => fs.existsSync(path.join(d, 'lib', 'requireAuth.js')));
if (!dir) throw new Error('firebase-tools not found in the npx cache');
const ft = (p) => require(path.join(dir, 'lib', p));

const mask = (s) => s
  .replace(/AIza[0-9A-Za-z_-]{20,}/g, '<api-key>')
  .replace(/("token"\s*:\s*")[^"]+/g, '$1<hidden>')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g, '<account>');

async function call(method, url, body, projectId = 'roundabout-words') {
  const account = ft('auth').getGlobalDefaultAccount();
  if (!account) throw new Error('Not signed in: run `npx -y firebase-tools@latest login` first');
  const options = { project: projectId, projectId, user: account.user, tokens: account.tokens };
  await ft('requireAuth').requireAuth(options);
  const { Client } = ft('apiv2');
  const u = new URL(url);
  const client = new Client({ urlPrefix: u.origin, auth: true });
  const res = await client.request({
    method, path: u.pathname + u.search, body,
    headers: { 'x-goog-user-project': projectId },
    resolveOnHTTPError: true,
  });
  return { status: res.status, body: res.body };
}

module.exports = { call, mask };

if (require.main === module) {
  const [method, url, body] = process.argv.slice(2);
  call(method, url, body ? JSON.parse(body) : undefined)
    .then((r) => console.log(r.status, mask(JSON.stringify(r.body, null, 1)).slice(0, 4000)))
    .catch((e) => { console.error('FAILED:', mask(String((e && e.message) || e)).slice(0, 800)); process.exit(1); });
}
