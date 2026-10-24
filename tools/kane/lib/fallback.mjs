import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { attachChrome, resolveChromeBinary } from './chrome.mjs';
import { runKane } from './kane.mjs';
import { buildObjective } from './objective.mjs';

const wrapper = fileURLToPath(new URL('../chrome-wrapper.sh', import.meta.url));
export const launchState = () => ({ result: null, tick: 0, letters: [{ owner: -1 }], pairs: [{ state: 'ready' }], human: { commands: [], rejected: [], drawn: 0, cut: 0 } });
export function launchObjective() { return buildObjective(launchState(), { moves: 8 }); }
export function isConnectionFailure(response) {
  // An exit0 with a failed run_end is still a failed connection.
  return /cdp|endpoint|connect|ECONN/i.test(`${response.stderr ?? ''}\n${response.end?.reason ?? ''}\n${response.end?.reason_code ?? ''}`);
}

async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => reject(Object.assign(new Error(`Fallback CDP port ${port} unavailable: ${error.message}`), { exitCode: 22 })));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

/** Kane launches Chrome through our wrapper. Observer never navigates, prepares or clicks. */
export async function runLaunchKane(objective, options = {}, deps = {}) {
  options.signal?.throwIfAborted();
  // Atomic lock prevents two drivers observing each other's Chrome between port check and spawn.
  const lock = join(tmpdir(), 'node-arena-kane-cdp-9223.lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (cause) { throw Object.assign(new Error(`Fallback CDP9223 is already reserved: ${cause.message}`), { exitCode: 22 }); }
  try { return await launchOwned(objective, options, deps); }
  finally { await rm(lock, { recursive: true, force: true }); }
}

async function launchOwned(objective, { signal, env = process.env, chrome, onEvent, onWarn, ...options } = {}, deps = {}) {
  const port = 9223;
  await requireFreePort(port);
  const binary = await (deps.resolveChromeBinary ?? resolveChromeBinary)({ chrome, env, preferPlaywright: true });
  if (binary === wrapper) throw Object.assign(new Error('Fallback needs a real Chrome binary, not its wrapper'), { exitCode: 22 });
  const profile = await mkdtemp(join(tmpdir(), 'node-arena-kane-launch-'));
  const stop = new AbortController();
  const observerSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let page, last, announced = false, reading, observerError;
  const capture = () => reading ??= (async () => {
    try {
      if (!page || page.cdp?.closed) {
        await page?.close();
        page = await (deps.attachChrome ?? attachChrome)({ port, url: options.url, timeoutMs: 300, signal: observerSignal, waitForReady: false });
      }
      const summary = await page.summary();
      if (!summary || !Array.isArray(summary.pairs) || !Array.isArray(summary.letters) || !summary.human || !Array.isArray(summary.human.commands)) return;
      last = structuredClone(summary);
      if (!announced) {
        try { options.onReady?.({ port, headless: options.headless, summary: last }); announced = true; }
        catch (error) { observerError = error; stop.abort(error); }
      }
    } catch { /* Startup/about:blank and teardown are expected; no snapshot means exit22. */ }
  })().finally(() => { reading = undefined; });
  const watch = (async () => {
    while (!observerSignal.aborted) {
      await capture();
      try { await delay(50, undefined, { signal: observerSignal }); } catch { break; }
    }
  })();
  try {
    const response = await (deps.runKane ?? runKane)(objective, { ...options, mode: 'launch', maxSteps: 20, signal: observerSignal,
      env: { ...env, KANE_CLI_CHROME_PATH: wrapper, KANE_CHROME_REAL_BINARY: binary,
        KANE_CHROME_PROFILE: profile, KANE_CHROME_DEBUG_PORT: String(port),
        KANE_CHROME_HEADLESS: options.headless ? '1' : '0', KANE_CHROME_SOFTWARE_GL: options.softwareGl ? '1' : '0' },
      onWarn, onEvent: event => { void capture(); onEvent?.(event); },
    });
    // runProcess has reaped Kane's browser; retain the last live observation.
    stop.abort(); await watch;
    if (observerError) throw observerError;
    if (!last) throw Object.assign(new Error('Kane launch produced no readable game summary on CDP9223'), { exitCode: 22 });
    // Every Kane launch starts a fresh match. Never compare against the preceding run.
    const before = { ...last, result: null, human: launchState().human };
    return { response, before, after: last, port };
  } finally {
    stop.abort(); await watch;
    try { await page?.close(); }
    finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  }
}
