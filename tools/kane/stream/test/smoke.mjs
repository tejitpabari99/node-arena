#!/usr/bin/env node
// Opt-in, credit-free browser smoke. Never selected by node --test.
// Requires build:test and installed Playwright Chromium; run from the repository:
// node tools/kane/stream/test/smoke.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, appendFile, mkdir, readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createStreamServer } from '../server.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const script = fileURLToPath(import.meta.url);
// This fake-only smoke has dedicated ports and spends no credits. Its separate
// advisory lock is the coordination exception; real Kane/default ports still
// require /tmp/node-arena-kane-resources.lock. Hold it through all cleanup.
if (process.env.KANE_STREAM_SMOKE_LOCKED !== '1') {
  const child = spawn('flock', ['-x', '-w', '600', '-E', '75', '/tmp/node-arena-kane-stream-smoke.lock', process.execPath, script], {
    cwd: root, env: { ...process.env, KANE_STREAM_SMOKE_LOCKED: '1' }, stdio: 'inherit',
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
  process.exitCode = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', code => accept(code ?? 1)); });
} else {
  await main();
}

async function main() {
  const require = createRequire(resolve(root, 'apps/web/package.json'));
  const { chromium } = require('@playwright/test');
  const evidence = resolve(root, 'kane-runs/stream-smoke');
  await mkdir(evidence, { recursive: true });
  const commonGit = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const coordination = resolve(root, commonGit, 'kane-coordination.md');
  const env = { ...process.env, KANE_STREAM_DRIVER: 'tools/kane/stream/test/fake-driver.mjs',
    KANE_STREAM_PREVIEW_PORT: '4175', KANE_STREAM_CDP_PORT: '9225', KANE_STREAM_PORT: '8787',
    KANE_STREAM_COOLDOWN_S: '2', KANE_STREAM_FAKE_DURATION_S: '12', KANE_STREAM_MIN_CREDITS: '200',
    KANE_STREAM_MAX_RUN_S: '90', KANE_IP_COOLDOWN_S: '600', KANE_DAILY_CAP: '6',
    KANE_STREAM_HOST: '127.0.0.1', KANE_STREAM_PREVIEW_HOST: '127.0.0.1', KANE_STREAM_TRUST_PROXY: '0',
    KANE_STREAM_MAX_WS: '100', KANE_STREAM_MAX_SSE: '200', KANE_STREAM_MAX_WS_PER_IP: '3', KANE_STREAM_MAX_SSE_PER_IP: '3' };
  const base = 'http://127.0.0.1:8787';
  let app, monitor, reserved = false;
  const browsers = [], extra = [], spawns = [], owned = new Map(), report = { creditFree: true, checks: [] };
  const check = (name, value) => { report.checks.push({ name, value }); console.log(`PASS ${name}: ${JSON.stringify(value)}`); };
  const save = (name, value) => writeFile(resolve(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const listeners = () => execFileSync('ss', ['-ltnp'], { encoding: 'utf8' });
  const rows = text => text.split('\n').filter(line => /:(8787|4175|9225)\s/.test(line));
  const alive = async identity => { try { return (await readFile(`/proc/${identity.pid}/stat`, 'utf8')).split(') ')[1].split(' ')[19] === identity.starttime; } catch { return false; } };
  const identity = async pid => { try { const raw = await readFile(`/proc/${pid}/stat`, 'utf8'); return { pid, starttime: raw.slice(raw.lastIndexOf(') ') + 2).split(' ')[19] }; } catch { return null; } };
  const poll = async (fn, timeout = 30000) => { const end = Date.now() + timeout; do { const result = await fn(); if (result) return result; await delay(50); } while (Date.now() < end); throw new Error('Smoke condition timed out'); };
  const sampleOwned = async () => {
    try { const record = JSON.parse(await readFile(resolve(root, 'kane-runs/stream.pid.json'), 'utf8')); for (const row of record.processes) owned.set(`${row.pid}:${row.starttime}`, row); } catch { /* Record absent before/after the run. */ }
  };
  const observedSpawn = (...args) => {
    const child = spawn(...args);
    spawns.push({ executable: args[0], args: args[1], pid: child.pid });
    void identity(child.pid).then(row => { if (row) owned.set(`${row.pid}:${row.starttime}`, row); });
    return child;
  };
  const state = async () => (await fetch(base + '/api/state')).json();
  const start = () => fetch(base + '/start', { method: 'POST', headers: { Origin: base } });
  const openWs = () => new Promise((accept, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { origin: base });
    extra.push(ws); const messages = [];
    ws.on('message', (data, binary) => messages.push({ binary, data: binary ? data : data.toString() }));
    ws.once('open', () => accept({ ws, messages })); ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => { res.resume(); accept({ status: res.statusCode }); ws.terminate(); });
  });
  async function viewer() {
    const browser = await chromium.launch({ headless: true }); browsers.push(browser);
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.addInitScript(() => {
      window.smoke = { draws: 0, frames: [], events: [] };
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) { window.smoke.draws++; return draw.apply(this, args); };
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args) { super(...args); this.addEventListener('message', async event => {
          if (!(event.data instanceof Blob)) return;
          const bytes = new Uint8Array(await event.data.arrayBuffer());
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          window.smoke.frames.push(Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join(''));
        }); }
      };
      const Source = window.EventSource;
      window.EventSource = class extends Source { constructor(...args) { super(...args); this.addEventListener('message', event => window.smoke.events.push(JSON.parse(event.data))); } };
    });
    await page.goto(base + '/kane-cli'); return page;
  }
  const pixels = page => page.evaluate(() => {
    const canvas = document.querySelector('#screen'), bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set(); let opaque = 0;
    for (let i = 0; i < bytes.length; i += 64) { colors.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`); if (bytes[i + 3]) opaque++; }
    return { width: canvas.width, height: canvas.height, colors: colors.size, opaque, ...window.smoke };
  });
  try {
    const before = listeners(); await save('listeners-before.txt', before);
    assert.equal(rows(before).length, 0, 'Smoke ports already owned; refusing to disrupt them');
    await access(resolve(root, 'apps/web/dist-test/index.html'));
    await appendFile(coordination, `\nSP05 Task7 smoke RESERVED ${new Date().toISOString()}: dedicated /tmp/node-arena-kane-stream-smoke.lock held; explicit orchestrator exception for fake-only zero-credit 8787/4175/9225 runs. Global /tmp/node-arena-kane-resources.lock remains mandatory for 4173/9222 or real Kane credits. Preserve unrelated listeners.\n`); reserved = true;
    app = await createStreamServer({ env, handleSignals: false, runDeps: { spawn: observedSpawn } }); await app.listen();
    monitor = setInterval(() => { void sampleOwned(); }, 50);
    const first = await viewer();
    await first.waitForFunction(() => !document.querySelector('#start').disabled);
    const started = first.waitForResponse(response => response.url() === base + '/start');
    await first.locator('#start').click(); assert.equal((await started).status(), 202);
    await poll(async () => (await state()).state === 'live', 60000);
    await first.waitForFunction(() => window.smoke.draws > 1);
    const second = await viewer();
    await second.waitForFunction(() => window.smoke.draws > 0 && document.querySelector('#log').textContent.includes('Credit-free live preview frame'));
    for (const page of [first, second]) { assert.equal(await page.locator('#status').textContent(), 'live'); assert.equal(await page.locator('#start').isDisabled(), true); }
    assert.equal((await start()).status, 409); check('two browsers live; Start disabled; duplicate Start', 409);
    const third = await openWs(); assert.equal(third.status, undefined);
    await poll(() => third.messages.some(message => message.binary), 2000);
    const binary = third.messages.find(message => message.binary).data;
    assert.equal(binary[0], 0xff); assert.equal(binary[1], 0xd8); check('late join receives cached JPEG', binary.length);
    assert.equal((await openWs()).status, 429); check('fourth WebSocket denied', 429);
    const sseAbort = new AbortController(); extra.push({ terminate: () => sseAbort.abort() });
    const thirdSse = await fetch(base + '/events', { signal: sseAbort.signal }); assert.equal(thirdSse.status, 200);
    const fourthSse = await fetch(base + '/events'); assert.equal(fourthSse.status, 429); await fourthSse.body.cancel(); check('fourth SSE denied', 429);
    const samples = await Promise.all([pixels(first), pixels(second)]);
    for (const sample of samples) { assert.ok(sample.draws > 0 && sample.colors > 50 && sample.opaque > 1000); assert.ok(sample.width > 100 && sample.height > 100); }
    assert.ok(samples[0].frames.some(hash => samples[1].frames.includes(hash)), 'Viewers must receive identical JPEG bytes');
    const firstEvents = samples[0].events.map(event => JSON.stringify(event));
    assert.ok(samples[1].events.some(event => firstEvents.includes(JSON.stringify(event)) && event.type === 'kane'), 'Late viewer must replay identical logs');
    const publicEvents = samples.flatMap(sample => sample.events);
    assert.ok(publicEvents.some(event => event.type === 'credits' && event.ok === true));
    assert.ok(publicEvents.some(event => event.type === 'chrome_ready'));
    assert.doesNotMatch(JSON.stringify(publicEvents), /"(?:balance|floor|pid|port|url|creditsRun|sessionDir|args)"|\/root\/|\/home\/|LT_|bearer|password/i);
    check('canvas pixels, identical frame hashes, replayed sanitized logs', samples.map(({ frames, events, ...sample }) => ({ ...sample, frames: frames.length, events: events.length })));
    await save('browser-samples.json', samples);
    await first.screenshot({ path: resolve(evidence, 'viewer-one-live.png'), fullPage: true });
    await second.screenshot({ path: resolve(evidence, 'viewer-two-live.png'), fullPage: true });
    const live = listeners(); await save('listeners-live.txt', live);
    assert.equal(rows(live).length, 3); for (const row of rows(live)) assert.match(row, /127\.0\.0\.1:(8787|4175|9225)\s/);
    check('stream, preview and CDP listeners loopback', rows(live));
    await poll(async () => (await state()).state === 'cooldown');
    assert.equal((await state()).outcome, 'failed');
    for (const page of [first, second]) { await page.waitForFunction(() => document.querySelector('#message').textContent === 'Live run unavailable'); assert.equal(await page.locator('#backup').isVisible(), false); }
    assert.equal((await fetch(base + '/kane-cli/backup.mp4', { method: 'HEAD' })).status, 404);
    await first.screenshot({ path: resolve(evidence, 'viewer-failed.png'), fullPage: true });
    await poll(async () => (await state()).state === 'idle');
    await sampleOwned();
    await poll(async () => !(await Promise.all([...owned.values()].map(alive))).some(Boolean));
    check('fake exit 30 -> failed; missing backup hidden; cooldown -> idle; owned processes gone', { state: await state(), recordedProcesses: owned.size });
    await save('owned-processes.json', [...owned.values()]);
    await save('listeners-after-run.txt', listeners());
    assert.equal(rows(listeners()).length, 1, 'Only stream listener remains after run');
    for (const ws of extra) ws.terminate();
    await app.close(); app = undefined;
    const spawnCount = spawns.length, runDirsBefore = (await readdir(resolve(root, 'kane-runs'))).filter(name => name.startsWith('stream-'));
    app = await createStreamServer({ env: { ...env, KANE_STREAM_MIN_CREDITS: '99999' }, handleSignals: false, runDeps: { spawn: observedSpawn } }); await app.listen();
    const unavailable = await start(); assert.equal(unavailable.status, 503); assert.deepEqual(await unavailable.json(), { message: 'unavailable' });
    const floorSpawns = spawns.slice(spawnCount);
    assert.equal(floorSpawns.length, 1); assert.deepEqual(floorSpawns[0].args, [resolve(root, env.KANE_STREAM_DRIVER), '--credits-only']);
    assert.deepEqual((await readdir(resolve(root, 'kane-runs'))).filter(name => name.startsWith('stream-')), runDirsBefore);
    assert.equal((await state()).state, 'idle'); assert.equal(rows(listeners()).length, 1);
    check('high floor 503: synthetic credits-only subprocess, zero paid-capable/Chrome/preview spawns', floorSpawns);
    await poll(async () => !(await Promise.all([...owned.values()].map(alive))).some(Boolean));
    await save('spawns.json', spawns);
    report.success = true;
  } catch (error) {
    report.success = false; report.error = error.stack; throw error;
  } finally {
    clearInterval(monitor);
    for (const connection of extra) connection.terminate();
    await app?.close();
    await Promise.all(browsers.map(browser => browser.close()));
    await save('listeners-final.txt', listeners());
    await save('report.json', report);
    if (reserved) await appendFile(coordination, `SP05 Task7 smoke RELEASED ${new Date().toISOString()}: browser/controller cleanup complete; result=${report.success ? 'passed' : 'failed'}; evidence=${evidence}.\n`);
  }
}
