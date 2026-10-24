import { spawn } from 'node:child_process';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { constants, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { connectCdp } from './cdp.mjs';

function failure(message, exitCode = 22, cause) { return Object.assign(new Error(message, { cause }), { exitCode }); }

/** Explicit overrides fail loudly; discovery never imports Playwright. */
export async function resolveChromeBinary({ chrome, env = process.env, preferPlaywright = false } = {}) {
  const override = chrome || env.KANE_CLI_CHROME_PATH;
  const executable = async path => { try { await access(path, constants.X_OK); return path; } catch { return null; } };
  const locate = async name => {
    if (name.includes('/')) return executable(name);
    for (const directory of (env.PATH ?? process.env.PATH ?? '').split(delimiter)) {
      const found = await executable(join(directory, name)); if (found) return found;
    }
    return null;
  };
  if (override) {
    const found = await locate(override);
    if (!found) throw failure(`Chrome binary is unavailable or not executable: ${override}`);
    return found;
  }
  const systemBinary = async () => {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      const found = await locate(name); if (found) return found;
    }
    return null;
  };
  const playwrightBinary = async () => {
    const cache = env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0' ? env.PLAYWRIGHT_BROWSERS_PATH : join(homedir(), '.cache', 'ms-playwright');
    let entries = [];
    try { entries = (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])); } catch { /* Missing cache is handled by the other discovery paths. */ }
    for (const entry of entries) for (const suffix of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']) {
      const found = await executable(join(cache, entry, suffix)); if (found) return found;
    }
    return null;
  };
  const found = preferPlaywright ? await playwrightBinary() ?? await systemBinary() : await systemBinary() ?? await playwrightBinary();
  if (found) return found;
  throw failure('Chrome binary not found; pass --chrome or set KANE_CLI_CHROME_PATH');
}

export function chromeArgs({ port = 9222, userDataDir, headless = false, softwareGl = false, root = process.getuid?.() === 0 } = {}) {
  return [
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--no-proxy-server', '--no-default-browser-check', '--disable-dev-shm-usage', '--window-size=1600,900',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    ...(headless ? ['--headless=new'] : []),
    ...(softwareGl || headless ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
    ...(root ? ['--no-sandbox'] : []), 'about:blank',
  ];
}

async function assertPortFree(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw failure(`Invalid Chrome port: ${port}`);
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => reject(failure(`Chrome port ${port} unavailable: ${error.message}`, 22, error)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function endpoint(port, { timeoutMs, child, signal, userDataDir } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    if (signal?.aborted) throw failure('Chrome startup aborted', 22, signal.reason);
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw failure(`Chrome exited before CDP was ready (${child.exitCode ?? child.signalCode})`);
    try {
      if (port === 0) port = Number((await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(Math.max(1, Math.min(500, deadline - Date.now()))) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const version = await response.json();
      if (!version.webSocketDebuggerUrl) throw new Error('Missing browser WebSocket endpoint');
      return { port, webSocketUrl: version.webSocketDebuggerUrl };
    } catch (error) { lastError = error; }
    await delay(Math.min(100, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw failure(`Chrome/CDP did not become available on port ${port} within ${timeoutMs}ms`, 22, lastError);
}

async function singlePage(cdp, onWarn, keepTargetId) {
  const pages = (await cdp.getTargets()).filter(target => target.type === 'page');
  if (keepTargetId) pages.sort((a, b) => Number(b.targetId === keepTargetId) - Number(a.targetId === keepTargetId));
  if (!pages.length) throw failure('Chrome has no page target');
  for (const target of pages.slice(1)) {
    onWarn?.({ code: 'extra_tab', msg: `Closing extra page target ${target.targetId}` });
    const closed = await cdp.send('Target.closeTarget', { targetId: target.targetId });
    if (!closed.success) throw failure(`Could not close extra page target ${target.targetId}`);
  }
  const deadline = Date.now() + 3000;
  do {
    const remaining = (await cdp.getTargets()).filter(target => target.type === 'page');
    if (remaining.length === 1 && remaining[0].targetId === pages[0].targetId) return pages[0];
    await delay(50);
  } while (Date.now() < deadline);
  throw failure('Chrome must have exactly one page target');
}

const readyExpression = `(() => {const n=window.__na; return !!(n && n.screen==='playing' && n.kane && typeof n.kane.summary==='function' && n.state().levelId==='na-kane');})()`;
async function waitForPage(page, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    if (signal?.aborted) throw failure('Page readiness aborted', 23, signal.reason);
    try { if (await page.cdp.evaluate(readyExpression, page.sessionId)) return; }
    catch (error) { if (page.cdp.closed) throw failure('CDP disconnected while waiting for game', 22, error); lastError = error; }
    await delay(Math.min(100, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw failure(`Game not ready: expected playing Kane level na-kane within ${timeoutMs}ms`, 23, lastError);
}

/** Called before every Kane run; only visibility/resume operations, never game actions. */
export async function preparePage(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.cdp.send('Page.bringToFront', {}, page.sessionId);
    await page.cdp.evaluate('window.__na.resume()', page.sessionId);
    await page.cdp.setFocusEmulation(true, page.sessionId);
    const visibility = await page.cdp.evaluate('({hidden:document.hidden,paused:!!window.__na.state().restartPopup})', page.sessionId);
    if (!visibility.hidden && !visibility.paused) return page.summary();
    if (attempt === 0) page.onWarn?.({ code: 'paused_hidden', msg: 'Game paused after visibility mitigation; retrying bringToFront/resume' });
  }
  throw failure('Game remains paused after visibility mitigation', 23);
}

/** Attach preserves the existing URL, targets and caller-owned Chrome process. */
export async function attachChrome({ port = 9222, url, timeoutMs = 30000, onWarn, signal, waitForReady = true } = {}) {
  let cdp;
  try {
    const found = await endpoint(port, { timeoutMs, signal });
    cdp = await connectCdp(found.webSocketUrl, { timeoutMs });
    const pages = (await cdp.getTargets()).filter(target => target.type === 'page');
    const target = pages.find(page => url && page.url === url) ?? pages.find(page => /[?&]kane=1(?:&|$)/.test(page.url)) ?? pages[0];
    if (!target) throw failure('Chrome has no page target');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const page = { cdp, sessionId, port: found.port, onWarn,
      summary: () => cdp.evaluate('window.__na.kane.summary()', sessionId),
      close: async () => { cdp.close(); },
    };
    page.prepare = () => preparePage(page);
    if (waitForReady) { await waitForPage(page, timeoutMs, signal); await page.prepare(); }
    return page;
  } catch (error) { cdp?.close(); if (error.exitCode) throw error; throw failure(`Chrome/CDP attach failed: ${error.message}`, 22, error); }
}

/** Owns a private profile and process group; cleanup is idempotent on every exit path. */
export async function launchChrome({ url, port = 9222, chrome, headless = false, softwareGl = false, timeoutMs = 30000, onWarn, signal, handleSignals = true } = {}) {
  if (!url) throw failure('Game URL is required', 23);
  await assertPortFree(port);
  const binary = await resolveChromeBinary({ chrome });
  const userDataDir = await mkdtemp(join(tmpdir(), 'node-arena-chrome-'));
  let child, cdp, closing, stderr = '', spawnError;
  const handlers = new Map();
  const kill = name => { if (child?.pid && child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, name); } catch { /* Already exited. */ } } };
  const exitHandler = () => {
    kill('SIGKILL');
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* Process exit cannot await asynchronous cleanup. */ }
  };
  const abortHandler = () => { void close(); };
  const close = () => closing ??= (async () => {
    process.removeListener('exit', exitHandler);
    for (const [name, handler] of handlers) process.removeListener(name, handler);
    signal?.removeEventListener('abort', abortHandler);
    cdp?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      kill('SIGTERM');
      let timer;
      await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 1500); })]); clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) { kill('SIGKILL'); await Promise.race([exited, delay(1500)]); }
    }
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  })();
  try {
    child = spawn(binary, chromeArgs({ port, userDataDir, headless, softwareGl }), { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.on('error', error => { spawnError = error; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    process.once('exit', exitHandler);
    if (handleSignals) for (const [name, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      const handler = () => { void close().finally(() => process.exit(code)); };
      handlers.set(name, handler); process.once(name, handler);
    }
    signal?.addEventListener('abort', abortHandler, { once: true });
    if (signal?.aborted) throw failure('Chrome startup aborted');
    const found = await endpoint(port, { timeoutMs, child, signal, userDataDir });
    if (spawnError) throw spawnError;
    cdp = await connectCdp(found.webSocketUrl, { timeoutMs });
    const target = await singlePage(cdp, onWarn);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const navigation = await cdp.send('Page.navigate', { url }, sessionId);
    if (navigation.errorText) throw failure(`Game navigation failed: ${navigation.errorText}`, 23);
    const page = { cdp, sessionId, port: found.port, pid: child.pid, headless, onWarn, userDataDir,
      summary: () => cdp.evaluate('window.__na.kane.summary()', sessionId), close,
    };
    page.prepare = async () => { await singlePage(cdp, onWarn, target.targetId); return preparePage(page); };
    await waitForPage(page, timeoutMs, signal);
    await page.prepare();
    return page;
  } catch (error) {
    await close();
    if (error.exitCode) throw error;
    throw failure(`Chrome/CDP launch failed: ${error.message}${stderr ? `\n${stderr}` : ''}`, 22, error);
  }
}
