import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createStreamServer } from '../server.mjs';

const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

async function fixture(t) {
  const run = new EventEmitter();
  let current = { state: 'idle', runId: null, attemptId: null, viewers: 0 }, lastStartAttempt;
  let starts = 0, response = 202, settleStop;
  run.snapshot = viewers => ({ ...current, viewers });
  run.start = async (_ip, attemptId) => {
    starts++;
    if (response !== 202) return { status: response };
    current = { state: 'starting', runId: null, attemptId };
    run.emit('state', current);
    await new Promise(resolve => setTimeout(resolve, 20));
    if (current.outcome === 'stopped') return { status: 503 };
    current = { state: 'starting', runId: `run-${starts}`, attemptId };
    run.emit('state', current);
    return { status: 202, runId: current.runId };
  };
  run.stop = async expectedAttemptId => {
    if (expectedAttemptId !== undefined && expectedAttemptId !== current.attemptId) return { status: 409 };
    if (!['starting', 'live'].includes(current.state)) return { status: 409 };
    current = { ...current, state: 'ending', outcome: 'stopped' };
    run.emit('state', current);
    await new Promise(resolve => { settleStop = resolve; });
    current = { ...current, state: 'cooldown' };
    run.emit('state', current);
    return { status: 200 };
  };
  run.reset = async () => {
    if (!['idle', 'cooldown'].includes(current.state)) return { status: 409 };
    current = { state: current.state, runId: null, attemptId: null, startedAt: null, endsAtMax: null };
    run.emit('reset', current); run.emit('state', current);
    return { status: 200 };
  };
  run.close = async () => {};
  const cast = new EventEmitter();
  const clients = new Set();
  cast.addClient = ws => { clients.add(ws); return true; };
  cast.removeClient = ws => clients.delete(ws);
  cast.start = cast.stop = async () => {};
  const app = await createStreamServer({ port: 0, env: {}, runController: run, screencast: cast, handleSignals: false });
  await app.listen();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await app.close(); });
  const context = await browser.newContext();
  context.on('request', request => { if (new URL(request.url()).pathname === '/start') lastStartAttempt = request.headers()['x-kane-attempt-id']; });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { page, base, errors, app, cast, clients, run,
    state(state, runId = current.runId, outcome,
      attemptId = state === 'idle' && runId === null && !outcome ? null : state === 'starting' ? lastStartAttempt ?? randomUUID() : current.attemptId ?? lastStartAttempt ?? randomUUID(),
      notify = true) {
      current = { state, runId, outcome, attemptId }; if (notify) run.emit('state', current);
    },
    finishStop() { settleStop(); }, reject(status) { response = status; }, get starts() { return starts; } };
}

const text = (page, id) => page.locator(`#${id}`).textContent();
const waitText = (page, id, value) => page.waitForFunction(({ id, value }) => document.getElementById(id).textContent === value, { id, value });

test('viewer renders all states, starts once, late joins and resets per-run replay without a reconnect loop', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(f.base);
  await waitText(page, 'status', 'idle');
  assert.equal(await page.title(), 'Kane plays Node Arena');
  assert.equal(await page.locator('#start').isEnabled(), true);
  await page.locator('#start').click();
  await waitText(page, 'status', 'starting');
  assert.equal(await page.locator('#start').isDisabled(), true);
  await page.waitForTimeout(100);
  f.state('live', 'run-1');
  await waitText(page, 'status', 'live');
  const line = { seq: 1, type: 'kane', iter: 1, event: { step: 1, status: 'passed', remark: '<img src=x onerror=alert(1)>' } };
  f.run.emit('line', JSON.stringify(line));
  f.run.emit('line', JSON.stringify(line));
  await page.waitForFunction(() => document.querySelectorAll('#log li').length === 1);
  assert.match(await text(page, 'log'), /<img src=x onerror=alert\(1\)>/);
  assert.equal(await page.locator('#log img').count(), 0);
  const late = await page.context().newPage();
  await late.goto(f.base);
  await waitText(late, 'status', 'live');
  await late.waitForFunction(() => document.querySelectorAll('#log li').length === 1);
  await page.waitForFunction(() => document.getElementById('viewers').textContent === '2');
  f.state('ending', 'run-1', 'won');
  await waitText(page, 'status', 'finished');
  f.state('cooldown', 'run-1', 'won');
  await waitText(page, 'status', 'cooldown');
  f.state('idle', null);
  await waitText(page, 'status', 'idle');
  f.state('starting', null);
  await waitText(page, 'status', 'starting');
  f.state('live', 'run-2');
  f.run.emit('line', JSON.stringify({ seq: 1, type: 'driver_start', mode: 'serve' }));
  await page.waitForFunction(() => document.querySelectorAll('#log li').length === 1 && document.getElementById('log').textContent.includes('driver_start'));
  await page.waitForTimeout(150);
  assert.equal(f.app.connectionCounts().sse, 2);
  f.state('ending', 'run-2', 'failed');
  await waitText(page, 'status', 'failed');
  assert.equal(await text(page, 'message'), 'Live run unavailable');
  assert.equal(await page.locator('#backup').isHidden(), true);
  f.state('cooldown', 'run-2', 'failed');
  await waitText(page, 'status', 'cooldown');
  assert.equal(await text(page, 'message'), 'Live run unavailable');
  assert.deepEqual(f.errors, []);
});

test('viewer handles unavailable start and offers only an existing backup', async t => {
  const f = await fixture(t), { page } = f;
  await page.route('**/backup.mp4', route => route.fulfill({ status: 200, body: '' }));
  f.reject(503);
  await page.goto(f.base);
  await waitText(page, 'status', 'idle');
  await page.locator('#start').click();
  await waitText(page, 'status', 'failed');
  assert.equal(await text(page, 'message'), 'Live run unavailable');
  await page.locator('#backup').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#backup').getAttribute('href'), '/backup.mp4');
  assert.equal(await page.locator('#start').isDisabled(), true);
  assert.equal(f.starts, 1);
});

test('viewer decodes only one frame plus latest pending, closes bitmaps and cleans transports on pagehide', async t => {
  const f = await fixture(t), { page } = f;
  await page.addInitScript(() => {
    window.frameProbe = { decoded: [], closed: [], active: 0, max: 0, release: [] };
    window.createImageBitmap = async blob => {
      const probe = window.frameProbe;
      const value = (new Uint8Array(await blob.arrayBuffer()))[0];
      probe.decoded.push(value); probe.active++; probe.max = Math.max(probe.max, probe.active);
      await new Promise(resolve => probe.release.push(resolve));
      probe.active--;
      return { width: 16, height: 9, close() { probe.closed.push(value); } };
    };
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  });
  await page.goto(f.base);
  await page.waitForFunction(() => document.getElementById('viewers').textContent === '1');
  for (const client of f.clients) client.send(Buffer.from([1]));
  await page.waitForFunction(() => window.frameProbe.decoded.length === 1);
  for (const value of [2, 3, 4]) for (const client of f.clients) client.send(Buffer.from([value]));
  await page.waitForTimeout(40);
  await page.evaluate(() => window.frameProbe.release.shift()());
  await page.waitForFunction(() => window.frameProbe.decoded.length === 2);
  assert.deepEqual(await page.evaluate(() => window.frameProbe.decoded), [1, 4]);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.evaluate(() => window.frameProbe.release.shift()());
  await page.waitForFunction(() => window.frameProbe.closed.length === 2);
  assert.equal(await page.evaluate(() => window.frameProbe.max), 1);
  await page.waitForTimeout(50);
  assert.deepEqual(f.app.connectionCounts(), { ws: 0, sse: 0 });
});

test('public assets have no unsafe HTML insertion', async () => {
  const assets = await Promise.all(['index.html', 'app.js', 'style.css'].map(file => readFile(new URL(`../public/${file}`, import.meta.url), 'utf8')));
  for (const asset of assets) assert.doesNotMatch(asset, /innerHTML|insertAdjacentHTML/i);
});


test('viewer renders real JPEG frames on canvas and keeps a responsive 16:9 stage', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(f.base);
  await page.waitForFunction(() => document.getElementById('viewers').textContent === '1');
  f.state('live', 'render-run');
  await waitText(page, 'status', 'live');
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#408050'; ctx.fillRect(0, 0, 320, 180);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  for (const client of f.clients) client.send(Buffer.from(jpeg, 'base64'));
  await page.waitForFunction(() => document.getElementById('video-message').hidden);
  const pixel = await page.evaluate(() => [...document.getElementById('screen').getContext('2d').getImageData(5, 5, 1, 1).data]);
  assert.ok(Math.abs(pixel[0] - 64) < 4 && Math.abs(pixel[1] - 128) < 4 && Math.abs(pixel[2] - 80) < 4);
  f.run.emit('line', JSON.stringify({ seq: 1, type: 'kane', iter: 1, event: { step: 1, status: 'passed', remark: 'Captured a node' } }));
  await page.waitForFunction(() => document.querySelectorAll('#log li').length === 1);
  if (process.env.KANE_VIEWER_SCREENSHOTS) await page.screenshot({ path: '/tmp/kane-viewer-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  const box = await page.locator('.stage').boundingBox();
  assert.ok(Math.abs(box.width / box.height - 16 / 9) < 0.01);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (process.env.KANE_VIEWER_SCREENSHOTS) await page.screenshot({ path: '/tmp/kane-viewer-mobile.png', fullPage: true });
  assert.deepEqual(f.errors, []);
});

// Missing Stop/Reset controls or a local-only reset must fail this shared-browser flow.
test('two viewers share explicit Stop, cleanup gating, Reset and cooldown without automatic Start', async t => {
  const f = await fixture(t), { page } = f;
  const posts = [], attempts = [];
  page.context().on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); if (new URL(request.url()).pathname === '/start') attempts.push(request.headers()['x-kane-attempt-id']); });
  await page.goto(f.base);
  await waitText(page, 'status', 'idle');
  await page.reload();
  await waitText(page, 'status', 'idle');
  assert.deepEqual(posts, []);
  await page.locator('#start').click();
  await waitText(page, 'status', 'starting');
  assert.equal(await page.locator('#stop').isVisible(), true);
  await page.waitForTimeout(60);
  f.state('live', 'run-1');
  await waitText(page, 'status', 'live');
  const other = await page.context().newPage();
  await other.goto(f.base);
  await waitText(other, 'status', 'live');
  await other.reload();
  await waitText(other, 'status', 'live');
  assert.deepEqual(posts, ['/start']);
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext('2d'); context.fillStyle = '#408050'; context.fillRect(0, 0, 160, 90);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  for (const client of f.clients) client.send(Buffer.from(jpeg, 'base64'));
  for (const viewer of [page, other]) await viewer.waitForFunction(() => document.getElementById('video-message').hidden);
  f.run.emit('line', JSON.stringify({ seq: 9, type: 'driver_start' }));
  for (const viewer of [page, other]) await viewer.locator('#log li').waitFor();
  await page.locator('#stop').click();
  for (const viewer of [page, other]) {
    await waitText(viewer, 'status', 'stopping');
    assert.equal(await viewer.locator('#reset').isVisible(), true);
    assert.equal(await viewer.locator('#reset').isDisabled(), true);
    assert.equal(await viewer.locator('#stop').isHidden(), true);
    assert.equal(await text(viewer, 'message'), 'Stopping…');
  }
  f.finishStop();
  await page.waitForFunction(() => !document.getElementById('reset').disabled);
  await waitText(page, 'status', 'stopped');
  if (process.env.KANE_VIEWER_SCREENSHOTS) {
    await page.screenshot({ path: '/tmp/kane-controls-stopped-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: '/tmp/kane-controls-stopped-mobile.png', fullPage: true });
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await other.locator('#reset').click();
  for (const viewer of [page, other]) {
    await waitText(viewer, 'status', 'cooldown');
    assert.equal(await viewer.locator('#start').isDisabled(), true);
    assert.equal(await viewer.locator('#reset').isHidden(), true);
    assert.equal(await viewer.locator('#log li').count(), 0);
    assert.equal(await text(viewer, 'video-message'), 'Waiting for a run');
    assert.deepEqual(await viewer.locator('#screen').evaluate(canvas => [canvas.width, canvas.height, canvas.getContext('2d').getImageData(5, 5, 1, 1).data[3]]), [1280, 720, 0]);
  }
  assert.equal(f.starts, 1);
  assert.deepEqual(posts, ['/start', '/stop', '/reset']);
  f.state('idle', null);
  for (const viewer of [page, other]) await waitText(viewer, 'status', 'idle');
  await page.setViewportSize({ width: 375, height: 812 });
  if (process.env.KANE_VIEWER_SCREENSHOTS) await page.screenshot({ path: '/tmp/kane-controls-ready-mobile.png', fullPage: true });
  await other.locator('#start').click();
  await waitText(page, 'status', 'starting');
  await waitText(other, 'status', 'starting');
  assert.equal(f.starts, 2);
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
  assert.notEqual(attempts[0], attempts[1]);
  await page.waitForTimeout(60);
  f.state('live', 'run-2');
  for (const viewer of [page, other]) await waitText(viewer, 'status', 'live');
  f.run.emit('line', JSON.stringify({ seq: 1, type: 'driver_start', mode: 'fresh' }));
  for (const viewer of [page, other]) {
    await viewer.waitForFunction(() => document.querySelectorAll('#log li').length === 1);
    assert.match(await text(viewer, 'log'), /fresh/);
  }
  assert.deepEqual(posts, ['/start', '/stop', '/reset', '/start']);
  assert.deepEqual(f.errors, []);
});

// A cancelled preflight can finish after Stop/Reset: its old error cannot replace Ready/new live state.
test('Stop works while Start HTTP is pending and late control responses cannot overwrite shared state', async t => {
  const f = await fixture(t), { page } = f;
  let releaseStart;
  await page.route('**/start', async route => {
    await new Promise(resolve => { releaseStart = resolve; });
    await route.fulfill({ status: 503, body: '{}' });
  });
  await page.goto(f.base);
  await waitText(page, 'status', 'idle');
  await page.locator('#start').click();
  await waitText(page, 'status', 'starting');
  assert.equal(await page.locator('#stop').isEnabled(), true);
  f.state('starting', null);
  let releaseStop;
  await page.route('**/stop', async route => {
    await new Promise(resolve => { releaseStop = resolve; });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'cooldown', runId: 'old', outcome: 'stopped', viewers: 1 }) });
  });
  await page.locator('#stop').click();
  await waitText(page, 'status', 'stopping');
  assert.equal(await page.locator('#reset').isVisible(), true);
  assert.equal(await page.locator('#reset').isDisabled(), true);
  f.state('cooldown', null, 'stopped');
  await waitText(page, 'status', 'stopped');
  assert.equal(await page.locator('#reset').isDisabled(), true);
  const other = await page.context().newPage();
  await other.goto(f.base);
  await waitText(other, 'status', 'stopped');
  await other.locator('#reset').click();
  await waitText(page, 'status', 'cooldown');
  f.state('idle', null);
  await waitText(page, 'status', 'idle');
  releaseStart();
  await page.waitForTimeout(50);
  assert.equal(await text(page, 'status'), 'idle');
  f.state('starting', null);
  f.state('live', 'fresh-run');
  await waitText(page, 'status', 'live');
  releaseStop();
  await page.waitForTimeout(50);
  assert.equal(await text(page, 'status'), 'live');
  assert.equal(await page.locator('#stop').isEnabled(), true);
  assert.deepEqual(f.errors, []);
});

// Transport doubles expose queued callbacks browsers normally hide; production viewer code remains real.
async function transportProbe(page) {
  await page.addInitScript(() => {
    window.transports = { oldAttempt: crypto.randomUUID(), newAttempt: crypto.randomUUID(), events: [], sockets: [], decoded: [], drawn: [], closed: [], releases: [], cleared: 0 };
    window.EventSource = class {
      constructor() { this.listeners = {}; window.transports.events.push(this); }
      addEventListener(type, callback) { this.listeners[type] = callback; }
      close() { this.closed = true; }
      emit(type, data) { const event = { data: JSON.stringify(data) }; if (type === 'message') this.onmessage?.(event); else this.listeners[type]?.(event); }
    };
    window.WebSocket = class {
      constructor() { window.transports.sockets.push(this); }
      close() { this.closed = true; this.onclose?.(); }
      frame(value) { this.onmessage?.({ data: new Blob([new Uint8Array([value])]) }); }
      meta(w, h) { this.onmessage?.({ data: JSON.stringify({ type: 'meta', w, h }) }); }
    };
    window.createImageBitmap = async blob => {
      const value = new Uint8Array(await blob.arrayBuffer())[0];
      window.transports.decoded.push(value);
      await new Promise(resolve => window.transports.releases.push(resolve));
      return { value, width: 16, height: 9, close() { window.transports.closed.push(value); } };
    };
    HTMLCanvasElement.prototype.getContext = () => ({
      drawImage(bitmap) { window.transports.drawn.push(bitmap.value); },
      clearRect() { window.transports.cleared++; },
    });
  });
}

test('shared Reset invalidates JPEG work, queued old socket blobs, SSE replay cursor and metadata', async t => {
  const f = await fixture(t), { page } = f;
  await transportProbe(page);
  await page.goto(f.base);
  await page.waitForFunction(() => window.transports.events.length === 1);
  await page.evaluate(() => {
    const p = window.transports;
    p.events.at(-1).emit('state', { attemptId: p.oldAttempt, state: 'live', runId: 'old-run', viewers: 2 });
    p.oldEvents = p.events.at(-1); p.oldSocket = p.sockets.at(-1);
    p.oldEvents.emit('message', { seq: 100, type: 'driver_start' });
    p.oldSocket.meta(777, 333); p.oldSocket.frame(1);
  });
  await page.waitForFunction(() => window.transports.decoded.length === 1);
  await page.evaluate(() => {
    const p = window.transports;
    p.oldSocket.frame(2);
    p.oldEvents.emit('reset', { attemptId: null, state: 'idle', runId: null, startedAt: null, endsAtMax: null, viewers: 2 });
    p.oldSocket.frame(3); p.oldSocket.meta(444, 222);
    p.oldEvents.emit('message', { seq: 101, type: 'stale_event' });
    p.oldEvents.emit('state', { attemptId: p.oldAttempt, state: 'live', runId: 'old-run' });
    p.releases.shift()();
  });
  await page.waitForFunction(() => window.transports.closed.length === 1);
  assert.equal(await text(page, 'status'), 'idle');
  assert.equal(await page.locator('#log li').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.transports.drawn), []);
  assert.deepEqual(await page.evaluate(() => window.transports.decoded), [1]);
  assert.deepEqual(await page.locator('#screen').evaluate(canvas => [canvas.width, canvas.height]), [1280, 720]);
  assert.equal(await page.evaluate(() => window.transports.oldSocket.closed), true);
  await page.evaluate(() => {
    const p = window.transports;
    p.events.at(-1).emit('state', { attemptId: p.newAttempt, state: 'starting', runId: null });
    p.events.at(-1).emit('state', { attemptId: p.newAttempt, state: 'live', runId: 'new-run' });
    p.events.at(-1).emit('message', { seq: 1, type: 'fresh_event' });
    p.sockets.at(-1).frame(4);
  });
  await page.waitForFunction(() => window.transports.decoded.length === 2);
  await page.evaluate(() => window.transports.releases.shift()());
  await page.waitForFunction(() => window.transports.drawn.length === 1);
  assert.deepEqual(await page.evaluate(() => window.transports.drawn), [4]);
  assert.match(await text(page, 'log'), /fresh_event/);
  assert.deepEqual(f.errors, []);
});

test('reconnect state detects a missed Reset and repeated null starting snapshots do not loop', async t => {
  const f = await fixture(t), { page } = f;
  await transportProbe(page);
  await page.goto(f.base);
  await page.waitForFunction(() => window.transports.events.length === 1);
  await page.evaluate(() => {
    const p = window.transports;
    p.events.at(-1).emit('state', { attemptId: p.oldAttempt, state: 'live', runId: 'missed-reset' });
    p.events.at(-1).emit('message', { seq: 50, type: 'old_event' });
    p.oldSocket = p.sockets.at(-1);
    p.events.at(-1).emit('state', { attemptId: null, state: 'idle', runId: null, startedAt: null, endsAtMax: null });
    p.oldSocket.frame(7);
  });
  assert.equal(await page.locator('#log li').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.transports.decoded), []);
  const count = await page.evaluate(() => window.transports.events.length);
  await page.evaluate(() => {
    const p = window.transports;
    for (let i = 0; i < 4; i++) p.events.at(-1).emit('state', { attemptId: p.newAttempt, state: 'starting', runId: null });
  });
  assert.equal(await page.evaluate(() => window.transports.events.length), count);
  assert.equal(await page.locator('#stop').isVisible(), true);
  assert.deepEqual(f.errors, []);
});

// Stop must not be lost if its HTTP request could reach the server before Start reserves a run.
test('Stop queued before Start reservation cancels that attempt without an unsafe early Reset', async t => {
  const f = await fixture(t), { page } = f;
  let releaseStart;
  const posts = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
  await page.route('**/start', async route => {
    await new Promise(resolve => { releaseStart = resolve; });
    await route.continue();
  });
  f.state('idle', 'previous-finished-run', 'won');
  await page.goto(f.base);
  await waitText(page, 'status', 'idle');
  await page.locator('#start').click();
  await page.locator('#stop').click();
  await page.waitForTimeout(60);
  assert.equal(await text(page, 'status'), 'stopping');
  assert.equal(await page.locator('#reset').isVisible(), true);
  assert.equal(await page.locator('#reset').isDisabled(), true);
  assert.deepEqual(posts, ['/start']);
  releaseStart();
  await page.waitForFunction(() => document.getElementById('status').textContent === 'stopping');
  await page.waitForTimeout(80);
  assert.deepEqual(posts, ['/start', '/stop']);
  f.finishStop();
  await page.waitForFunction(() => !document.getElementById('reset').disabled);
  await page.locator('#reset').click();
  await waitText(page, 'status', 'cooldown');
  assert.equal(f.starts, 1);
  assert.deepEqual(f.errors, []);
});

for (const reply of [202, 503]) {
  test(`another viewer Reset retains an unregistered cancellation until its own attempt settles (${reply})`, async t => {
    const f = await fixture(t), { page } = f;
    let releaseStart, ownAttempt;
    const stops = [];
    page.on('request', request => { if (new URL(request.url()).pathname === '/stop') stops.push(request.headers()['x-kane-attempt-id']); });
    await page.route('**/start', async route => {
      ownAttempt = route.request().headers()['x-kane-attempt-id'] ?? randomUUID();
      await new Promise(resolve => { releaseStart = resolve; });
      await route.fulfill({ status: reply, contentType: 'application/json', body: reply === 202 ? '{"runId":"own-run"}' : '{}' });
    });
    await page.goto(f.base); await waitText(page, 'status', 'idle');
    await page.locator('#start').click(); await page.locator('#stop').click();
    await f.run.reset(); await page.waitForTimeout(50);
    assert.equal(await text(page, 'status'), 'stopping');
    assert.equal(await page.locator('#reset').isDisabled(), true);
    const other = randomUUID();
    f.state('starting', null, undefined, other); f.state('live', 'unrelated-run', undefined, other);
    await page.waitForTimeout(50);
    assert.equal(await text(page, 'status'), 'stopping'); assert.deepEqual(stops, []);
    if (reply === 202) {
      f.state('starting', null, undefined, ownAttempt);
      await page.waitForTimeout(80); assert.deepEqual(stops, [ownAttempt]);
      f.finishStop(); releaseStart();
      await page.waitForFunction(() => !document.getElementById('reset').disabled);
      await waitText(page, 'status', 'stopped');
    } else {
      releaseStart(); await waitText(page, 'status', 'live');
      assert.deepEqual(stops, []);
    }
    assert.deepEqual(f.errors, []);
  });
}

test('a settled accepted Start with missed terminal events cannot carry a queued Stop into the next run', async t => {
  const f = await fixture(t), { page } = f;
  let releaseStart, ownAttempt;
  const posts = [], stopTargets = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); if (new URL(request.url()).pathname === '/stop') stopTargets.push(request.headers()['x-kane-attempt-id']); });
  await page.route('**/start', async route => {
    ownAttempt = route.request().headers()['x-kane-attempt-id'];
    await new Promise(resolve => { releaseStart = resolve; });
    f.state('idle', 'already-ended', 'won', route.request().headers()['x-kane-attempt-id'], false);
    // Model a completed attempt whose startup/terminal SSE events were missed.
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"runId":"already-ended"}' });
  });
  await page.goto(f.base);
  await waitText(page, 'status', 'idle');
  await page.locator('#start').click();
  await page.locator('#stop').click();
  releaseStart();
  await waitText(page, 'status', 'idle');
  f.state('starting', null);
  f.state('live', 'later-run');
  await waitText(page, 'status', 'live');
  assert.deepEqual(posts, ['/start', '/stop']);
  assert.deepEqual(stopTargets, [ownAttempt]);
  assert.deepEqual(f.errors, []);
});

// Terminal SSE can precede a delayed Start reply when startup/live events were missed.
// The queued cancellation belongs to that completed attempt, never the next viewer's run.
for (const { baseline, terminalState, outcome, reply, replayOutcome } of [
  { baseline: null, terminalState: 'cooldown', outcome: 'won', reply: 202 },
  { baseline: 'previous-finished', terminalState: 'ending', outcome: 'won', reply: 503 },
  { baseline: 'previous-finished', terminalState: 'idle', outcome: 'won', reply: 202 },
  { baseline: 'previous-finished', terminalState: 'cooldown', outcome: 'stopped', reply: 503, replayOutcome: 'stopped' },
]) {
  test(`queued Stop retires on ${terminalState}/${outcome} after ${baseline ?? 'null'} baseline before delayed ${reply}`, async t => {
    const f = await fixture(t), { page } = f;
    let releaseStart, ownAttempt;
    const baselineAttempt = baseline ? randomUUID() : null;
    const posts = [];
    page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
    await page.route('**/start', async route => {
      ownAttempt = route.request().headers()['x-kane-attempt-id'];
      await new Promise(resolve => { releaseStart = resolve; });
      await route.fulfill({ status: reply, contentType: 'application/json', body: reply === 202 ? '{"runId":"run-A"}' : '{}' });
    });
    f.state('idle', baseline, baseline ? 'won' : undefined, baselineAttempt);
    await page.goto(f.base);
    await waitText(page, 'status', 'idle');
    await page.locator('#start').click();
    await page.locator('#stop').click();
    // Repeated previous-run metadata or plain idle/null cannot retire this intent.
    f.state('idle', baseline, replayOutcome ?? (baseline ? 'won' : undefined), baselineAttempt);
    await page.waitForTimeout(40);
    assert.equal(await text(page, 'status'), 'stopping');
    assert.equal(await page.locator('#reset').isDisabled(), true);
    assert.deepEqual(posts, ['/start']);
    // Reconnection sees only this attempt's terminal state, never startup/live.
    f.state(terminalState, 'run-A', outcome, ownAttempt);
    await waitText(page, 'status', outcome === 'stopped' ? 'stopped' : terminalState === 'ending' ? 'finished' : terminalState);
    f.state('idle', 'run-A', outcome, ownAttempt);
    await page.waitForTimeout(40);
    // A different viewer explicitly starts B while A's HTTP reply remains held.
    const otherAttempt = randomUUID();
    f.state('starting', null, undefined, otherAttempt);
    f.state('live', 'run-B', undefined, otherAttempt);
    await page.waitForTimeout(80);
    assert.deepEqual(posts, ['/start'], 'a completed attempt must never Stop the next run');
    await waitText(page, 'status', 'live');
    const response = page.waitForResponse(value => value.request().method() === 'POST' && new URL(value.url()).pathname === '/start');
    releaseStart();
    await response;
    await page.waitForTimeout(60);
    assert.equal(await text(page, 'status'), 'live');
    assert.equal(await page.locator('#stop').isEnabled(), true);
    assert.deepEqual(posts, ['/start'], 'the delayed reply cannot revive old cancellation');
    assert.deepEqual(f.errors, []);
  });
}

for (const terminal of ['preflight-failed', 'unrelated-starting']) {
  test(`attempt-correlated queued Stop handles ${terminal} before delayed Start HTTP settles`, async t => {
    const f = await fixture(t), { page } = f;
    let releaseStart, ownAttempt;
    const stops = [];
    page.on('request', request => { if (new URL(request.url()).pathname === '/stop') stops.push(request.headers()['x-kane-attempt-id']); });
    await page.route('**/start', async route => {
      ownAttempt = route.request().headers()['x-kane-attempt-id'] ?? randomUUID();
      await new Promise(resolve => { releaseStart = resolve; });
      await route.fulfill({ status: 503, body: '{}' });
    });
    await page.goto(f.base); await waitText(page, 'status', 'idle');
    await page.locator('#start').click(); await page.locator('#stop').click();
    assert.match(ownAttempt ?? '', /^[0-9a-f-]{36}$/);
    const other = randomUUID();
    if (terminal === 'preflight-failed') {
      // Actual controller rejection: no run allocated and no terminal outcome.
      f.state('idle', null, undefined, ownAttempt);
      await page.waitForTimeout(40);
      f.state('starting', null, undefined, other); f.state('live', 'B', undefined, other);
      await page.waitForTimeout(80); assert.deepEqual(stops, []);
      await waitText(page, 'status', 'live');
      releaseStart(); await page.waitForTimeout(80);
      assert.equal(await text(page, 'status'), 'live'); assert.deepEqual(stops, []);
    } else {
      // Another attempt must neither satisfy nor retire this pending cancellation.
      f.state('starting', null, undefined, other); f.state('live', 'other', undefined, other);
      await page.waitForTimeout(60);
      assert.equal(await text(page, 'status'), 'stopping'); assert.deepEqual(stops, []);
      assert.equal(await page.locator('#reset').isDisabled(), true);
      f.state('idle', 'other', 'won', other);
      await page.waitForTimeout(30); assert.equal(await text(page, 'status'), 'stopping');
      f.state('starting', null, undefined, ownAttempt);
      await page.waitForTimeout(80);
      assert.deepEqual(stops, [ownAttempt]);
      f.finishStop(); releaseStart();
      await page.waitForFunction(() => !document.getElementById('reset').disabled);
      await waitText(page, 'status', 'stopped');
    }
    assert.deepEqual(f.errors, []);
  });
}

test('accepted Start can be conditionally stopped before startup SSE arrives', async t => {
  const f = await fixture(t), { page } = f;
  let ownAttempt;
  const stops = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/stop') stops.push(request.headers()['x-kane-attempt-id']); });
  await page.route('**/start', async route => {
    ownAttempt = route.request().headers()['x-kane-attempt-id'];
    f.state('starting', 'own', undefined, ownAttempt, false);
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"runId":"own"}' });
  });
  await page.goto(f.base); await waitText(page, 'status', 'idle');
  const accepted = page.waitForResponse(value => new URL(value.url()).pathname === '/start');
  await page.locator('#start').click(); await accepted; await page.waitForTimeout(40);
  await page.locator('#stop').click();
  assert.equal(await page.locator('#reset').isDisabled(), true);
  await page.waitForTimeout(80); assert.deepEqual(stops, [ownAttempt]);
  f.finishStop(); await page.waitForFunction(() => !document.getElementById('reset').disabled);
  await waitText(page, 'status', 'stopped'); assert.deepEqual(f.errors, []);
});

test('normal Stop targets its visible attempt and a delayed request cannot end another viewer fresh run', async t => {
  const f = await fixture(t), { page } = f;
  const a = randomUUID(), b = randomUUID(); let releaseStop, target;
  f.state('live', 'A', undefined, a);
  await page.route('**/stop', async route => {
    target = route.request().headers()['x-kane-attempt-id'];
    await new Promise(resolve => { releaseStop = resolve; }); await route.continue();
  });
  await page.goto(f.base); await waitText(page, 'status', 'live');
  await page.locator('#stop').click(); assert.equal(target, a);
  f.state('starting', null, undefined, b); f.state('live', 'B', undefined, b);
  await waitText(page, 'status', 'live');
  const rejected = page.waitForResponse(value => new URL(value.url()).pathname === '/stop');
  releaseStop(); assert.equal((await rejected).status(), 409);
  await page.waitForTimeout(50); assert.equal(await text(page, 'status'), 'live');
  assert.equal(await page.locator('#stop').isEnabled(), true); assert.deepEqual(f.errors, []);
});

test('explicit Stop ends the displayed other attempt and retains cancellation of a pending own Start', async t => {
  const f = await fixture(t), { page } = f;
  let ownAttempt, releaseStart;
  const other = randomUUID(), stops = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/stop') stops.push(request.headers()['x-kane-attempt-id']); });
  await page.route('**/start', async route => {
    ownAttempt = route.request().headers()['x-kane-attempt-id'];
    await new Promise(resolve => { releaseStart = resolve; }); await route.fulfill({ status: 503, body: '{}' });
  });
  await page.goto(f.base); await waitText(page, 'status', 'idle');
  await page.locator('#start').click();
  f.state('starting', null, undefined, other); f.state('live', 'other', undefined, other);
  await waitText(page, 'status', 'live');
  await page.locator('#stop').click(); await page.waitForTimeout(60);
  assert.deepEqual(stops, [other]);
  f.finishStop(); await page.waitForTimeout(50);
  assert.equal(await text(page, 'status'), 'stopping'); assert.equal(await page.locator('#reset').isDisabled(), true);
  f.state('starting', null, undefined, ownAttempt);
  await page.waitForTimeout(80); assert.deepEqual(stops, [other, ownAttempt]);
  f.finishStop(); releaseStart();
  await page.waitForFunction(() => !document.getElementById('reset').disabled);
  await waitText(page, 'status', 'stopped'); assert.deepEqual(f.errors, []);
});

test('accepted unseen A cannot leave Reset blocked after an explicit Stop cleans displayed B', async t => {
  const f = await fixture(t), { page } = f;
  let a, releaseStaleStop;
  const b = randomUUID(), c = randomUUID(), stops = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/stop') stops.push(request.headers()['x-kane-attempt-id']); });
  await page.route('**/start', async route => {
    a = route.request().headers()['x-kane-attempt-id'];
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"runId":"A"}' });
  });
  await page.route('**/stop', async route => {
    if (route.request().headers()['x-kane-attempt-id'] === a) {
      await new Promise(resolve => { releaseStaleStop = resolve; });
      await route.fulfill({ status: 409, body: '{}' });
    } else await route.continue();
  });
  await page.goto(f.base); await waitText(page, 'status', 'idle');
  const accepted = page.waitForResponse(value => new URL(value.url()).pathname === '/start');
  await page.locator('#start').click(); await accepted; await page.waitForTimeout(40);
  // Every A state was missed. Reconnection first observes another viewer's B.
  f.state('live', 'B', undefined, b); await waitText(page, 'status', 'live');
  assert.deepEqual(stops, []);
  await page.locator('#stop').click(); await page.waitForTimeout(80);
  f.finishStop(); await waitText(page, 'status', 'stopped');
  assert.deepEqual(stops, [b, a]);
  assert.equal(await page.locator('#reset').isDisabled(), true, 'all conditional Stop replies must settle');
  releaseStaleStop(); await page.waitForFunction(() => !document.getElementById('reset').disabled);
  await page.locator('#reset').click(); await waitText(page, 'status', 'cooldown');
  f.state('starting', null, undefined, c); f.state('live', 'C', undefined, c);
  await waitText(page, 'status', 'live'); await page.waitForTimeout(50);
  assert.deepEqual(stops, [b, a]); assert.equal(await page.locator('#stop').isEnabled(), true);
  assert.deepEqual(f.errors, []);
});

test('queued cancellation sends only its accepted nonce when delayed HTTP202 arrives during another run', async t => {
  const f = await fixture(t), { page } = f;
  let a, releaseStart;
  const b = randomUUID(), stops = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/stop') stops.push(request.headers()['x-kane-attempt-id']); });
  await page.route('**/start', async route => {
    a = route.request().headers()['x-kane-attempt-id'];
    await new Promise(resolve => { releaseStart = resolve; });
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"runId":"A"}' });
  });
  await page.goto(f.base); await waitText(page, 'status', 'idle');
  await page.locator('#start').click(); await page.locator('#stop').click();
  f.state('live', 'B', undefined, b); await page.waitForTimeout(50);
  assert.equal(await text(page, 'status'), 'stopping'); assert.deepEqual(stops, []);
  releaseStart(); await page.waitForTimeout(80);
  assert.deepEqual(stops, [a]); await waitText(page, 'status', 'live');
  assert.equal(await page.locator('#reset').isHidden(), true); assert.deepEqual(f.errors, []);
});
