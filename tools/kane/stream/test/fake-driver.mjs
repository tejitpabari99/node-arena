#!/usr/bin/env node
// Credit-free stream fixture. This file never imports or invokes Kane APIs.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { launchChrome } from '../../lib/chrome.mjs';
import { ensurePreviewServer } from '../../lib/server.mjs';
import { createEventEncoder } from '../../lib/events.mjs';

const cwd = fileURLToPath(new URL('../../../../', import.meta.url));
export async function main(argv = process.argv.slice(2), deps = {}) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const write = deps.write ?? (line => process.stdout.write(line));
  const startChrome = deps.launchChrome ?? launchChrome;
  const startPreview = deps.ensurePreviewServer ?? ensurePreviewServer;
  const sleep = deps.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  if (argv.includes('--credits-only')) {
    // Synthetic balance, deliberately fixed; this path starts no browser/process.
    write('{"credits":500}\n'); return 0;
  } else {
    const value = (flag, fallback) => { const index = argv.indexOf(flag); return index < 0 ? fallback : argv[index + 1]; };
    const port = Number(value('--port', '9222'));
    const url = value('--url', 'http://127.0.0.1:4173/?kane=1');
    const log = value('--log');
    const durationS = Number(env.KANE_STREAM_FAKE_DURATION_S ?? 12);
    if (!Number.isFinite(durationS) || durationS < 1 || durationS > 720) throw new Error('Invalid fake duration');
    const encode = createEventEncoder();
    if (log) mkdirSync(dirname(log), { recursive: true });
    const emit = (type, fields) => { const line = encode(type, fields); if (log) appendFileSync(log, line); write(line); };
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    let page, stopPreview, outcome = 'error', exitCode = 1;
    const started = now();
    try {
      if (Number(value('--min-credits', '200')) > 500) { outcome = 'credit_floor'; exitCode = 21; }
      else {
        emit('driver_start', { mode: 'attach' });
        emit('credits', { balance: 500, floor: Number(value('--min-credits', '200')), ok: true });
        stopPreview = await startPreview({ url, serve: argv.includes('--serve'), cwd, env, signal: abort.signal });
        page = await startChrome({ url, port, headless: true, softwareGl: true, signal: abort.signal, handleSignals: false });
        emit('chrome_ready', { mode: 'attach', port: page.port, pid: page.pid, headless: true });
        const initial = await page.summary();
        emit('page_ready', { levelId: 'na-kane', speed: initial.speed ?? 0.25, letters: initial.letters });
        emit('run_start', { iter: 1, phase: 'capture', objective: 'Credit-free viewer smoke', maxSteps: 3 });
        const liveStarted = now();
        for (let step = 1; now() - liveStarted < durationS * 1000; step++) {
          await page.prepare();
          const summary = await page.summary();
          emit('state', { iter: 1, tick: summary.tick, result: summary.result, ready: 1, active: 0, unavailable: 0, humanDrawn: 0, humanCut: 0 });
          emit('kane', { iter: 1, event: { step, status: 'completed', remark: 'Credit-free live preview frame' } });
          await sleep(1000, abort.signal);
        }
        emit('kane', { iter: 1, event: { status: 'completed', summary: 'Credit-free live preview complete', duration: durationS, credits_consumed: 0 } });
        emit('run_end', { iter: 1, kaneStatus: 'completed', durationMs: now() - started, creditsRun: 0 });
        // Fixture completion is not a claim that the idle demo game was won.
        outcome = 'max_runs'; exitCode = 30;
      }
    } catch {
      emit('warn', { code: abort.signal.aborted ? 'interrupted' : 'fixture_error' });
    } finally {
      try { await page?.close(); } finally { await stopPreview?.(); }
      process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    }
    emit('driver_end', { outcome, exitCode, runs: 1, wallMs: now() - started, creditsUsed: 0 });
    return exitCode;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
