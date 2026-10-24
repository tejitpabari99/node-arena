import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/** All managed children use detached process groups; never signal an unowned group. */
export async function terminateProcessGroup(child, graceMs = 500) {
  if (!child?.pid) return;
  const send = signal => {
    try { process.kill(-child.pid, signal); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  };
  if (!send('SIGTERM')) return;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await delay(25);
    if (!send(0)) return;
  }
  send('SIGKILL');
}

/** Bounded capture, stdin closed, and descendant cleanup even after the leader exits. */
export async function runProcess(command, args, { cwd, env = process.env, signal, onStdout, onStderr, timeoutMs = 180000, spawnImpl = spawn } = {}) {
  signal?.throwIfAborted();
  const child = spawnImpl(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let failure;
  let cleanup;
  const stop = () => cleanup ??= terminateProcessGroup(child);
  const abort = () => { failure ??= signal.reason ?? new Error('Aborted'); void stop(); };
  child.stdout?.on('data', data => { stdout = (stdout + data).slice(-1048576); onStdout?.(data.toString()); });
  child.stderr?.on('data', data => { stderr = (stderr + data).slice(-65536); onStderr?.(data.toString()); });
  const timer = setTimeout(() => { failure ??= new Error(`${command} timed out after ${timeoutMs}ms`); void stop(); }, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => { void stop(); });
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    await stop();
    if (failure) throw failure;
    return { ...result, stdout, stderr };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await stop();
  }
}
