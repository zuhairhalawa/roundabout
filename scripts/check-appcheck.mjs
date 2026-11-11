// Proves App Check is enforced: the same request without an App Check token must be refused.
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('web/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const url = `https://firebasevertexai.googleapis.com/v1beta/projects/${env.VITE_FB_PROJECT_ID}/models/gemini-3.5-flash-lite:generateContent`;
const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say hi.' }] }] });
const headers = { 'content-type': 'application/json', 'x-goog-api-key': env.VITE_FB_API_KEY, 'x-goog-api-client': 'gl-js/ fire/13.3.0', 'x-firebase-appid': env.VITE_FB_APP_ID };
const res = await fetch(url, { method: 'POST', headers, body });
const text = (await res.text()).replace(/AIza[0-9A-Za-z_-]{20,}/g, '<api-key>');
console.log('without App Check token ->', res.status, text.replace(/\s+/g, ' ').slice(0, 260));
