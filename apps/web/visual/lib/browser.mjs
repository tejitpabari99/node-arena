// Shared Chromium / preview-server helpers for the visual:* scripts (PRD SP01 Architecture: determinism recipe).
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test'; // existing dep; re-exports playwright's chromium API
import { PORT, WEB_DIR } from './scenes.mjs';

export const BASE_URL = `http://127.0.0.1:${PORT}`;
const SWIFTSHADER = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const STABLE = ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars'];
/** Fixed fake-clock origin so Date/performance-based code sees the same time every run. */
export const CLOCK_TIME = new Date('2026-01-01T00:00:00Z');

export function chromiumArgs({ gpu = false } = {}) {
  return [...(gpu ? [] : SWIFTSHADER), ...STABLE];
}

export async function launch({ headed = false, gpu = false } = {}) {
  const args = chromiumArgs({ gpu });
  const browser = await chromium.launch({ headless: !headed, args });
  return { browser, args };
}

/** Context per capture: DSF 1, fixed locale/timezone/colour scheme, reduced motion unless a frame needs motion. */
export function newContext(browser, { width, height }, { reducedMotion = 'reduce' } = {}) {
  return browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', hasTouch: false, isMobile: false });
}

export function buildTest() {
  const r = spawnSync('pnpm', ['build:test'], { cwd: WEB_DIR, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`pnpm build:test failed (${r.status})`);
}

/** Starts `vite preview` (dist-test) or `vite` (--dev) on port 4174 in its own process group. */
export async function startServer({ dev = false } = {}) {
  const args = dev ? ['exec', 'vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort']
    : ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--outDir', 'dist-test', '--port', String(PORT), '--strictPort'];
  if (await reachable()) throw new Error(`port ${PORT} already serves something; stop it first`);
  const child = spawn('pnpm', args, { cwd: WEB_DIR, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } };
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode}):\n${log}`);
    if (await reachable()) return { stop, url: BASE_URL };
    await new Promise(r => setTimeout(r, 100));
  }
  stop();
  throw new Error(`server did not start on ${BASE_URL}:\n${log}`);
}

async function reachable() {
  try { const r = await fetch(BASE_URL); return r.ok; } catch { return false; }
}

/** Advance the page's fake clock in 16 ms frames until `predicate(arg)` holds in the page. */
export async function until(page, predicate, arg, { frames = 600, what = 'condition' } = {}) {
  for (let i = 0; i < frames; i++) {
    if (await page.evaluate(predicate, arg)) return i;
    await page.clock.runFor(16);
    await new Promise(r => setTimeout(r, 5)); // node-side yield only: lets network/decoding settle; page time stays frozen
  }
  throw new Error(`timed out waiting for ${what}`);
}

export function gitCommit() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: WEB_DIR, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: WEB_DIR, encoding: 'utf8' }).trim().length > 0;
    return { sha, dirty };
  } catch { return { sha: null, dirty: null }; }
}

/** fontconfig resolution of the generic/system families the CSS asks for (same-machine fingerprint). */
export function resolveFonts(families) {
  const out = {};
  for (const family of families) {
    try { out[family] = execFileSync('fc-match', [family], { encoding: 'utf8' }).trim(); } catch { out[family] = null; }
  }
  return out;
}
