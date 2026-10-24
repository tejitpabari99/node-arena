import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { terminateProcessGroup } from './processes.mjs';

export function loopbackUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Preview URL must use HTTP(S) on loopback');
  }
  return url;
}

async function available(url, signal) {
  signal?.throwIfAborted();
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(750), ...(signal ? [signal] : [])]) });
    await response.body?.cancel();
    return response.ok;
  } catch { signal?.throwIfAborted(); return false; }
}

/** Returns an idempotent async cleanup function; existing services are never owned. */
export async function ensurePreviewServer({ url = 'http://localhost:4173/', serve = false, cwd, env = process.env, signal, startupTimeoutMs = 15000, spawnImpl = spawn } = {}) {
  const target = loopbackUrl(url);
  if (await available(target, signal)) return async () => {};
  if (!serve) throw new Error(`Preview server unavailable at ${target}; start preview:test or use --serve`);
  if (target.protocol !== 'http:') throw new Error('Preview server spawning requires HTTP on loopback');
  const port = target.port || '80';
  const child = spawnImpl('pnpm', ['--filter', '@node-arena/web', 'preview:test', '--port', port, '--strictPort'], {
    cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError;
  let output = '';
  child.once('error', error => { spawnError = error; });
  child.stdout?.on('data', data => { output = (output + data).slice(-8192); });
  child.stderr?.on('data', data => { output = (output + data).slice(-8192); });
  let cleanup;
  const stop = () => cleanup ??= terminateProcessGroup(child);
  const abort = () => { void stop(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Preview server exited: ${output.trim() || child.exitCode || child.signalCode}`);
      if (await available(target, signal)) {
        return async () => { signal?.removeEventListener('abort', abort); await stop(); };
      }
      await delay(100, undefined, { signal });
    }
    throw new Error(`Preview server unavailable after ${startupTimeoutMs}ms: ${output.trim()}`);
  } catch (error) {
    signal?.removeEventListener('abort', abort);
    await stop();
    throw error;
  }
}
