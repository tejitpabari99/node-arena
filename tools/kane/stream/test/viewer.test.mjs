import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createStreamServer } from '../server.mjs';

const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

async function fixture(t) {
  const run = new EventEmitter();
  let current = { state: 'idle', runId: null, viewers: 0 };
  let starts = 0, response = 202;
  run.snapshot = viewers => ({ ...current, viewers });
  run.start = async () => {
    starts++;
    if (response !== 202) return { status: response };
    current = { state: 'starting', runId: null };
    run.emit('state', current);
    await new Promise(resolve => setTimeout(resolve, 20));
    current = { state: 'starting', runId: `run-${starts}` };
    run.emit('state', current);
    return { status: 202, runId: current.runId };
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
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { page, base, errors, app, cast, clients, run,
    state(state, runId = current.runId, outcome) { current = { state, runId, outcome }; run.emit('state', current); },
    reject(status) { response = status; }, get starts() { return starts; } };
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
