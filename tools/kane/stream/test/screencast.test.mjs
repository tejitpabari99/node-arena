import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ReadOnlyCdp, createScreencast } from '../screencast.mjs';

class FakeSocket extends EventTarget {
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
function clock() {
  let time = 0, id = 0;
  const timers = new Map();
  return { now: () => time, timers, setTimeout(fn, ms) { const key = ++id; timers.set(key, { at: time + ms, fn }); return key; },
    clearTimeout(key) { timers.delete(key); },
    async advance(ms) { const end = time + ms; for (;;) { const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; time = next[1].at; timers.delete(next[0]); next[1].fn(); await settle(); } time = end; await settle(); },
  };
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness(options = {}) {
  const time = clock(), clients = [], calls = [], endpoints = [], connects = [];
  const targets = options.targets ?? [
    { type: 'page', targetId: 'wrong', url: 'http://127.0.0.1:4173/?other=kane=1' },
    { type: 'page', targetId: 'game', url: 'http://127.0.0.1:4173/?kane=1' },
  ];
  const stream = createScreencast({ ...time, fetch: async (url, opts) => { endpoints.push([url, opts]); return { ok: true, json: async () => ({ webSocketDebuggerUrl: options.wsUrl ?? 'ws://127.0.0.1:9222/devtools/browser/test' }) }; },
    connect: async () => {
      connects.push(true);
      if (options.failConnect) throw new Error('private failure');
      const socket = new FakeSocket(), session = `session-${clients.length}`;
      const client = { socket, async send(method, params, sessionId) { calls.push({ method, params, sessionId }); if (method === 'Target.getTargets') return { targetInfos: targets }; if (method === 'Target.attachToTarget') return { sessionId: session }; return {}; }, close() { socket.dispatchEvent(new Event('close')); } };
      clients.push(client); return client;
    }, ...options });
  const frame = (data = 'frame', sessionId = `session-${clients.length - 1}`, metadata = { deviceWidth: 1280, deviceHeight: 720 }) => clients.at(-1).socket.message({ method: 'Page.screencastFrame', sessionId, params: { sessionId: 42, data: Buffer.from(data).toString('base64'), metadata } });
  return { stream, time, clients, calls, frame, endpoints, options, connects };
}
function viewer(bufferedAmount = 0, grow = false) {
  return Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount, messages: [], closes: [], send(data, options, callback) { this.messages.push([data, options]); if (grow) this.bufferedAmount += Buffer.byteLength(data); callback?.(); }, close(...args) { this.closes.push(args); this.readyState = 3; this.emit('close'); }, terminate() { this.readyState = 3; this.emit('close'); } });
}

test('read-only wrapper rejects every nonallowlisted method before transport', async () => {
  const sent = [], cdp = new ReadOnlyCdp({ send: async (...args) => sent.push(args) });
  for (const method of ['In' + 'put.dispatchMouseEvent', 'Runtime.evaluate', 'Page.navigate', 'Page.enable', 'Target.detachFromTarget', 'toString']) await assert.rejects(cdp.send(method, {}), /not allowed/);
  for (const method of ['Target.getTargets', 'Target.attachToTarget', 'Page.startScreencast', 'Page.stopScreencast', 'Page.screencastFrameAck']) await cdp.send(method, {}, 'second');
  assert.equal(sent.length, 5);
  assert.equal(sent.at(-1)[2], 'second');
});

test('attaches independent flat session to parsed game query, never enables or detaches driver', async () => {
  const h = harness(); await h.stream.start(9222);
  assert.equal(h.endpoints[0][0], 'http://127.0.0.1:9222/json/version');
  assert.deepEqual(h.calls.slice(0, 3), [
    { method: 'Target.getTargets', params: {}, sessionId: undefined },
    { method: 'Target.attachToTarget', params: { targetId: 'game', flatten: true }, sessionId: undefined },
    { method: 'Page.startScreencast', params: { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 }, sessionId: 'session-0' },
  ]);
  h.frame('wrong-session', 'driver-session'); assert.equal(h.stream.lastFrame, null);
  h.frame(); await settle();
  assert.equal(h.calls.filter(c => c.method === 'Page.screencastFrameAck').length, 1);
  await h.stream.stop(); assert.equal(h.calls.at(-1).method, 'Page.stopScreencast');
  assert.equal(h.time.timers.size, 0);
});

test('acks all frames immediately, caps at 10fps latest wins and replays cached frame/meta', async () => {
  const h = harness(), client = viewer(); h.stream.addClient(client); await h.stream.start(9222);
  h.frame('first'); h.frame('superseded'); h.frame('latest'); await settle();
  assert.equal(h.calls.filter(c => c.method === 'Page.screencastFrameAck').length, 3);
  assert.equal(client.messages.filter(([, o]) => o?.binary).length, 1);
  await h.time.advance(100);
  assert.deepEqual(client.messages.filter(([, o]) => o?.binary).map(([b]) => b.toString()), ['first', 'latest']);
  assert.equal(client.messages.filter(([, o]) => o?.binary === false).length, 1);
  const late = viewer(); h.stream.addClient(late);
  assert.deepEqual(JSON.parse(late.messages[0][0]), { type: 'meta', w: 1280, h: 720 });
  assert.equal(late.messages[1][0].toString(), 'latest');
  await h.stream.stop(); assert.equal(h.time.timers.size, 0);
});

test('slow client stays within total cap and closes after 10s even with no further frames', async () => {
  const h = harness(), slow = viewer(512 * 1024 - 5, true); h.stream.addClient(slow); await h.stream.start(9222);
  h.frame('too-large-for-buffer'); await settle();
  assert.equal(slow.messages.length, 0); assert.ok(slow.bufferedAmount <= 512 * 1024);
  await h.time.advance(9999); assert.equal(slow.closes.length, 0);
  await h.time.advance(1); assert.equal(slow.closes.length, 1); assert.equal(h.stream.clientCount, 0);
  await h.stream.stop();
});

test('rejects oversized frames after ack and never caches or fans them out', async () => {
  const h = harness(), client = viewer(); h.stream.addClient(client); await h.stream.start(9222);
  h.frame(Buffer.alloc(512 * 1024 + 1)); await settle();
  assert.equal(h.calls.at(-1).method, 'Page.screencastFrameAck'); assert.equal(h.stream.lastFrame, null); assert.equal(client.messages.length, 0);
  await h.stream.stop();
});

test('retry after connection loss uses new session; third failed retry emits log-only video lost', async () => {
  const h = harness(); const lost = []; h.stream.on('video_lost', value => lost.push(value)); await h.stream.start(9222);
  h.clients[0].socket.dispatchEvent(new Event('close')); await h.time.advance(2000);
  assert.equal(h.clients.length, 2); h.frame('recovered'); assert.equal(h.stream.lastFrame.toString(), 'recovered');
  h.options.failConnect = true;
  h.clients[1].socket.message({ method: 'Target.detachedFromTarget', params: { sessionId: 'session-1' } });
  await h.time.advance(6000);
  assert.equal(h.connects.length, 5); // initial + recovery + exactly three failed retries
  assert.deepEqual(lost, [{ type: 'video_lost' }]);
  await h.stream.stop();
  const failure = harness({ failConnect: true }); const startupLost = [];
  failure.stream.on('video_lost', value => startupLost.push(value));
  const started = failure.stream.start(9222); await settle(); await failure.time.advance(6000); await started;
  assert.equal(failure.connects.length, 4); // initial plus three retries
  assert.deepEqual(startupLost, [{ type: 'video_lost' }]);
  await failure.stream.stop(); assert.equal(failure.time.timers.size, 0);
});

test('discovery refuses remote websocket and non-game targets, stop cancels retry', async () => {
  const h = harness({ wsUrl: 'ws://example.com:9222/devtools/browser/test' });
  const start = h.stream.start(9222); await settle(); assert.equal(h.clients.length, 0);
  await h.stream.stop(); await start; assert.equal(h.time.timers.size, 0);
  const wrong = harness({ targets: [{ type: 'page', targetId: 'wrong', url: 'http://localhost/?x=kane=1' }] });
  const pending = wrong.stream.start(9222); await settle(); assert.equal(wrong.calls.some(c => c.method === 'Target.attachToTarget'), false);
  await wrong.stream.stop(); await pending;
  await assert.rejects(h.stream.start('9222'), /port/);
});

test('removed and closed viewers release listeners and skip timers', async () => {
  const h = harness(), client = viewer(512 * 1024); h.stream.addClient(client); await h.stream.start(9222); h.frame();
  assert.equal(client.listenerCount('close'), 1); h.stream.removeClient(client);
  assert.equal(client.listenerCount('close'), 0); await h.stream.stop(); assert.equal(h.time.timers.size, 0);
});


test('continuous sending to a growing buffer never exceeds cap and resumes after drain', async () => {
  const h = harness(), client = viewer(0, true); h.stream.addClient(client); await h.stream.start(9222);
  for (let i = 0; i < 8; i++) { h.frame(Buffer.alloc(100000)); await h.time.advance(100); assert.ok(client.bufferedAmount <= 512 * 1024); }
  assert.equal(client.messages.filter(([, opts]) => opts?.binary).length, 5);
  client.bufferedAmount = 0; h.frame('drained'); await h.time.advance(100);
  await h.time.advance(10000); assert.equal(client.closes.length, 0);
  await h.stream.stop();
});

test('stop cancels pending connect and closes a connection that arrives after stop', async () => {
  let resolveConnect;
  const h = harness({ connect: () => new Promise(resolve => { resolveConnect = resolve; }) });
  const start = h.stream.start(9222); await settle();
  await h.stream.stop(); await start;
  let closed = 0; resolveConnect({ close() { closed++; } }); await settle();
  assert.equal(closed, 1); assert.equal(h.stream.connection, null); assert.equal(h.time.timers.size, 0);
});

test('concurrent starts keep only newest connection and first frames during start are acked', async () => {
  const h = harness();
  const first = h.stream.start(9222), second = h.stream.start(9222); await Promise.all([first, second]);
  assert.equal(h.clients.length, 1);
  const connection = h.stream.connection; connection.ready = false; h.frame('early'); await settle();
  assert.equal(h.calls.at(-1).method, 'Page.screencastFrameAck');
  connection.ready = true; await h.stream.stop();
});

test('viewer limit is bounded and duplicate adds do not multiply listeners', async () => {
  const h = harness({ maxClients: 1 }), first = viewer(), second = viewer();
  assert.equal(h.stream.addClient(first), true); assert.equal(h.stream.addClient(first), true);
  assert.equal(h.stream.addClient(second), false); assert.equal(first.listenerCount('close'), 1);
  first.emit('close'); assert.equal(h.stream.clientCount, 0); assert.equal(first.listenerCount('error'), 0);
  await h.stream.stop();
});
