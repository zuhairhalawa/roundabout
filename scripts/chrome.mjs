// Starts the real Chrome (stable channel) with a dedicated test profile that holds Gemini Nano,
// and attaches over the DevTools protocol. Playwright's own launcher adds switches that stop
// Chrome's on-device model service, so Chrome is started plainly here.
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from '../../video/node_modules/playwright/index.mjs';

const EXE = process.env.CHROME_EXE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const PROFILE = process.env.RB_PROFILE || 'C:/Users/ZUHAIR/.chrome-hybrid-profile';

export async function startChrome({ port = 9334, size = '1320,940', extra = [] } = {}) {
  // RB_KEEP_CHROME=1: reuse a test Chrome that is already running and leave it running, so the
  // on-device model (slow to load) stays warm between runs.
  const keep = process.env.RB_KEEP_CHROME === '1';
  const running = keep ? await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null) : null;
  if (running) {
    const ctx = running.contexts()[0];
    const page = await ctx.newPage();
    return { browser: running, ctx, page, stop: async () => { await page.close().catch(() => {}); } };
  }
  const proc = spawn(EXE, [
    `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check',
    `--window-size=${size}`, ...extra, 'about:blank',
  ], { stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 500));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
  }
  if (!browser) throw new Error('Chrome did not start');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());
  const stop = async () => {
    if (keep) return;
    await browser.close().catch(() => {});
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 800));
  };
  return { browser, ctx, page, stop };
}

/** Free physical memory in GB (Windows). The on-device model needs about 5 GB free to load. */
export function freeMemoryGb() {
  try {
    const kb = Number(execFileSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory'], { encoding: 'utf8' }).trim());
    return kb / 1024 / 1024;
  } catch {
    return NaN;
  }
}
