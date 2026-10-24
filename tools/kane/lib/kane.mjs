import { parseBalance } from './balance.mjs';
import { runProcess } from './processes.mjs';

/** Free, bounded balance lookup. Never sends credentials to logs. */
export async function readCredits({ signal, env = process.env, runProcessImpl = runProcess } = {}) {
  const result = await runProcessImpl('kane-cli', ['balance'], { env: { ...env, KANE_CLI_USER_AGENT: 'codex' }, signal, timeoutMs: 30000 });
  if (result.code !== 0) throw new Error(`Kane balance/auth failed: ${result.stderr.trim() || result.code}`);
  return parseBalance(result.stdout);
}

/** Attach reuses one browser; launch starts a fresh URL with a longer bounded objective. */
export function kaneRunArgs(objective, { port = 9222, maxSteps = 8, runTimeout = 150, mode = 'attach', url, headless = false } = {}) {
  return ['run', objective, ...(mode === 'launch' ? ['--url', url, ...(headless ? ['--headless'] : [])] : ['--cdp-endpoint', `http://127.0.0.1:${port}`, '--allow-missing-url']), '--agent',
    '--max-steps', String(mode === 'launch' ? 20 : maxSteps), '--timeout', String(runTimeout),
    '--assertion-mode', 'dom', '--final-validation', 'off', '--bug-detection', 'off'];
}

export async function runKane(objective, { signal, env = process.env, onEvent, onWarn, runProcessImpl = runProcess, argsBuilder = kaneRunArgs, ...options } = {}) {
  const stop = new AbortController();
  const childSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let buffered = '', end = null, callbackError;
  const started = Date.now();
  const line = value => {
    if (!value.trim() || callbackError) return;
    try {
      let event;
      try { event = JSON.parse(value); }
      catch { onWarn?.({ code: 'kane_output', msg: value.slice(0, 2000) }); return; }
      if (!event || typeof event !== 'object' || Array.isArray(event)) { onWarn?.({ code: 'kane_output', msg: value.slice(0, 2000) }); return; }
      onEvent?.(event);
      if (event.type === 'run_end') end = event;
    } catch (error) { callbackError = error; stop.abort(error); }
  };
  const result = await runProcessImpl('kane-cli', argsBuilder(objective, options), {
    env: { ...env, KANE_CLI_USER_AGENT: 'codex' }, signal: childSignal, timeoutMs: (options.runTimeout ?? 150) * 1000 + 30000,
    onStdout: chunk => {
      buffered += chunk;
      let index;
      while ((index = buffered.indexOf('\n')) !== -1) { line(buffered.slice(0, index)); buffered = buffered.slice(index + 1); }
      if (buffered.length > 1048576) { callbackError ??= new Error('Kane output line exceeds 1 MiB'); stop.abort(callbackError); buffered = ''; }
    },
  });
  line(buffered);
  if (callbackError) throw callbackError;
  return { ...result, end, durationMs: Date.now() - started };
}
