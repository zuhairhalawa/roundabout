// Headless Edge screenshots with simple steps.
// node scripts/shot.mjs <url> <out.png> <width> <height> [step...]
// steps: "text=Label" click by text | "role=tab:Draw it" click by role+name | "fill=#sel::text" | "wait=ms" | "js=code" | css selector to click
import { chromium } from '../../video/node_modules/playwright/index.mjs';
const [url, out, w = '1280', h = '900', ...steps] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + String(e).slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 300)); });
await p.goto(url);
await p.waitForTimeout(700);
for (const s of steps) {
  if (s.startsWith('text=')) await p.getByText(s.slice(5), { exact: false }).first().click();
  else if (s.startsWith('role=')) { const [role, name] = s.slice(5).split(':'); await p.getByRole(role, { name }).first().click(); }
  else if (s.startsWith('fill=')) { const [sel, text] = s.slice(5).split('::'); await p.fill(sel, text); }
  else if (s.startsWith('wait=')) await p.waitForTimeout(+s.slice(5));
  else if (s.startsWith('waitfor=')) await p.waitForSelector(s.slice(8), { timeout: 30000 });
  else if (s.startsWith('js=')) await p.evaluate(s.slice(3));
  else await p.click(s);
  await p.waitForTimeout(350);
}
await p.screenshot({ path: out, fullPage: true });
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await b.close(); process.exit(0);
