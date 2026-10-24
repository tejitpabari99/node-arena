import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { createRunController } from '../run.mjs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createStreamServer, readServerConfig } from '../server.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  const end = Date.now() + 3000;
  while (!check()) { if (Date.now() > end) throw new Error('Condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function fixture(t, options = {}) {
  const publicDir = await mkdtemp(join(tmpdir(), 'kane-stream-http-'));
  for (const [file, value] of [['index.html', '<h1>Viewer</h1>'], ['app.js', 'hello()'], ['style.css', 'body{}']]) await writeFile(join(publicDir, file), value);
  const run = new EventEmitter(), cast = new EventEmitter(), clients = new Set();
  let snapshot = { state: 'idle', runId: null, startedAt: null, endsAtMax: null }, next = 1;
  const starts = [], calls = [];
  run.snapshot = viewers => ({ ...snapshot, viewers });
  run.change = value => { snapshot = { ...snapshot, ...value }; run.emit('state', run.snapshot(0)); };
  run.start = async ip => {
    starts.push(ip);
    if (options.start) return options.start(ip, run);
    if (snapshot.state !== 'idle') return { status: 409 };
    run.change({ state: 'starting', runId: `run-${next++}` });
    return { status: 202, runId: snapshot.runId };
  };
  run.close = async () => calls.push('run.close');
  cast.start = async port => calls.push(['cast.start', port]);
  cast.stop = async () => calls.push('cast.stop');
  cast.addClient = ws => { clients.add(ws); return true; };
  cast.removeClient = ws => clients.delete(ws);
  const app = await createStreamServer({ env: {}, publicDir, runController: run, screencast: cast, port: 0, handleSignals: false, ...options });
  await app.listen();
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const send = (path, { method = 'GET', headers = {}, body, origin = base } = {}) => new Promise((resolve, reject) => {
    const req = request(base + path, { method, headers: { ...(origin ? { Origin: origin } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
  const events = (headers = {}) => new Promise((resolve, reject) => {
    const req = request(base + '/events', { headers }, res => {
      const connection = { req, res, text: '' }; res.on('data', chunk => { connection.text += chunk; }); res.on('error', () => {}); resolve(connection);
    });
    req.on('error', reject); req.end();
  });
  const connect = (origin = base, path = '/ws') => new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + path, { ...(origin ? { origin } : {}) });
    ws.once('open', () => resolve({ ws })); ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => { res.resume(); ws.terminate(); resolve({ status: res.statusCode }); });
  });
  t.after(async () => { await app.close(); await rm(publicDir, { recursive: true, force: true }); });
  return { app, base, run, cast, clients, calls, starts, publicDir, send, events, connect };
}

test('server binds loopback only, enforces timeouts, security headers and exact static routes', async t => {
  const h = await fixture(t);
  assert.equal(h.app.server.address().address, '127.0.0.1');
  assert.equal(h.app.server.maxHeaderSize, 8192);
  assert.equal(h.app.server.headersTimeout, 10000); assert.equal(h.app.server.requestTimeout, 10000);
  for (const path of ['/', '/app.js', '/style.css']) {
    const res = await h.send(path); assert.equal(res.status, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff'); assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/); assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
  for (const path of ['/../run.mjs', '/%2e%2e/run.mjs', '/app.js?x=1', '/api/state?x=1', '/ws?x=1', '/unknown']) assert.equal((await h.send(path)).status, 404, path);
  for (const [path, method] of [['/', 'POST'], ['/start', 'GET'], ['/api/state', 'POST'], ['/events', 'POST'], ['/ws', 'POST'], ['/app.js', 'HEAD']]) assert.equal((await h.send(path, { method })).status, 405);
  assert.equal((await h.send('/ws')).status, 426);
  assert.equal((await h.send('/backup.mp4', { method: 'HEAD' })).status, 404);
  await writeFile(join(h.publicDir, 'backup.mp4'), 'fake video');
  assert.equal((await h.send('/backup.mp4', { method: 'HEAD' })).status, 200);
  assert.equal((await h.send('/backup.mp4')).text, 'fake video');
});

test('server config rejects unsafe binding and maps only server max-run flag into env', () => {
  assert.equal(readServerConfig({}).host, '127.0.0.1'); assert.equal(readServerConfig({}).port, 8787);
  assert.throws(() => readServerConfig({ KANE_STREAM_HOST: '0.0.0.0' }), /unsafe/i);
  assert.throws(() => readServerConfig({ KANE_STREAM_HOST: 'localhost' }), /unsafe/i);
  assert.equal(readServerConfig({}, ['--max-run-s', '42']).env.KANE_STREAM_MAX_RUN_S, '42');
  assert.throws(() => readServerConfig({}, ['--url', 'http://evil']), /argument/i);
  assert.throws(() => readServerConfig({}, ['--max-run-s', '0']));
});

test('guarded start returns 202/409/429/503, validates Origin, limits body and never leaks errors', async t => {
  const h = await fixture(t, { env: { KANE_STREAM_TRUST_PROXY: '1' } });
  for (const origin of [null, 'https://evil.test']) assert.equal((await h.send('/start', { method: 'POST', origin })).status, 403);
  assert.equal(h.starts.length, 0);
  assert.equal((await h.send('/start', { method: 'POST', body: 'x'.repeat(1025) })).status, 413); assert.equal(h.starts.length, 0);
  assert.equal((await h.send('/api/state', { body: 'x'.repeat(1025), headers: { 'Transfer-Encoding': 'chunked' } })).status, 413);
  assert.equal((await h.send('/api/state', { headers: { 'X-Large': 'x'.repeat(8192) } })).status, 431);
  const accepted = await h.send('/start', { method: 'POST', body: 'x'.repeat(1024), headers: { 'CF-Connecting-IP': '192.0.2.1' } });
  assert.equal(accepted.status, 202); assert.deepEqual(JSON.parse(accepted.text), { runId: 'run-1' }); assert.equal(h.starts[0], '192.0.2.1');
  assert.equal((await h.send('/start', { method: 'POST' })).status, 409);
  for (const status of [429, 503]) {
    h.run.start = async () => ({ status, message: 'secret /root/key', credits: 123 });
    const res = await h.send('/start', { method: 'POST' }); assert.equal(res.status, status); assert.equal(res.text, '{"message":"unavailable"}');
  }
  h.run.start = async () => { throw new Error('/root/secret'); };
  assert.equal((await h.send('/start', { method: 'POST' })).text, '{"message":"unavailable"}');
  const state = await h.send('/api/state'); assert.equal(state.headers['cache-control'], 'no-store'); assert.equal(JSON.parse(state.text).viewers, 0);
});

test('SSE filters driver lines, replays Last-Event-ID, resets per run, and emits named public notifications', async t => {
  const h = await fixture(t, { heartbeatMs: 25 });
  h.run.emit('line', '{bad'); h.run.emit('line', '{"seq":1,"type":"warn","code":"ok","msg":"/root/secret"}');
  h.run.emit('line', '{"seq":2,"type":"credits","ok":true,"balance":999}');
  const first = await h.events({ 'Last-Event-ID': '1' });
  await until(() => first.text.includes('id: 2') && first.text.includes(': hb'));
  assert.match(first.text, /event: state\ndata: /); assert.doesNotMatch(first.text, /id: 1|balance|secret/);
  assert.equal(first.res.headers['x-accel-buffering'], 'no');
  h.run.change({ state: 'starting', runId: null });
  h.run.emit('line', '{"seq":1,"type":"driver_start","args":["secret"],"mode":"serve"}');
  h.run.emit('chrome_ready', { port: 9222, pid: 123 }); await turn();
  h.cast.emit('video_lost', { type: 'video_lost', port: 9222 });
  await until(() => first.text.includes('event: video_lost'));
  assert.doesNotMatch(first.text, /9222|123/); assert.deepEqual(h.calls.at(-1), ['cast.start', 9222]);
  const second = await h.events(); await until(() => second.text.includes('id: 1'));
  assert.doesNotMatch(second.text, /id: 2/); assert.equal(JSON.parse((await h.send('/api/state')).text).viewers, 0);
  h.run.change({ state: 'ending' }); await turn(); assert.equal(h.calls.at(-1), 'cast.stop');
  first.req.destroy(); second.req.destroy();
});

test('SSE connection admission and release, slow-client bound, and shutdown close active streams', async t => {
  const h = await fixture(t, { env: { KANE_STREAM_MAX_SSE: '1' }, sseBufferLimit: 4096 });
  const first = await h.events();
  assert.equal((await h.send('/events')).status, 429);
  first.req.destroy(); await until(() => h.app.connectionCounts().sse === 0);
  const slow = await h.events(); slow.res.pause();
  for (let seq = 1; seq <= 100; seq++) h.run.emit('line', JSON.stringify({ seq, type: 'kane', event: { step: seq, status: 'passed', remark: 'x'.repeat(300) } }));
  await until(() => h.app.connectionCounts().sse === 0); slow.req.destroy();
  const final = await h.events(); await h.app.close();
  await until(() => final.res.destroyed); assert.ok(h.calls.includes('run.close')); assert.ok(h.calls.includes('cast.stop'));
});

test('WS requires Origin, honors caps, counts only sockets, pings, closes input payloads, and releases reservations', async t => {
  const h = await fixture(t, { env: { KANE_STREAM_MAX_WS: '1' }, heartbeatMs: 25 });
  for (const origin of [null, 'https://evil.test']) assert.equal((await h.connect(origin)).status, 403);
  assert.equal((await h.connect(h.base, '/unknown')).status, 404);
  const malformed = await h.send('/ws', { headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'invalid', 'Sec-WebSocket-Version': '13' } });
  assert.equal(malformed.status, 400);
  await until(() => h.app.connectionCounts().ws === 0);
  const { ws } = await h.connect();
  await until(() => h.clients.size === 1);
  assert.equal(JSON.parse((await h.send('/api/state')).text).viewers, 1);
  assert.equal((await h.connect()).status, 429);
  await once(ws, 'ping', { signal: AbortSignal.timeout(1000) });
  const closing = once(ws, 'close'); ws.send('xx'); assert.equal((await closing)[0], 1009);
  await until(() => h.app.connectionCounts().ws === 0 && h.clients.size === 0);
  const second = await h.connect(); await h.app.close(); await until(() => second.ws.readyState === WebSocket.CLOSED);
});

test('connection caps remain atomic for simultaneous SSE and WS requests; no forwarding trust by default', async t => {
  const h = await fixture(t, { env: { KANE_STREAM_MAX_WS_PER_IP: '1', KANE_STREAM_MAX_SSE_PER_IP: '1' } });
  const sockets = await Promise.all([h.connect(), h.connect()]); assert.equal(sockets.filter(value => value.status === 429).length, 1);
  const streams = await Promise.all([h.events(), h.events()]); assert.equal(streams.filter(value => value.res.statusCode === 429).length, 1);
  await h.send('/start', { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.42' } }); assert.deepEqual(h.starts, ['127.0.0.1']);
  for (const stream of streams) stream.req.destroy();
});


test('HTTP integrates real lifecycle single lock, per-IP limit, daily budget and credit preflight failure', async t => {
  async function actual(env) {
    let pid = 4000;
    const children = [];
    const processes = {
      identity: async pid => ({ pid, pgid: pid, starttime: '1', cmdline: ['node', 'test'] }),
      load: async () => null, acquire: async () => {}, release: async () => {},
      checkPorts: async () => {}, persist: async () => {}, clear: async () => {},
      descendants: async () => [], matches: async () => false, signal: async () => {}, removeProfile: async () => {},
    };
    const spawn = (_command, args) => {
      const child = Object.assign(new EventEmitter(), { pid: pid++, stdout: new PassThrough(), stderr: new PassThrough() });
      children.push({ args, child });
      if (args.includes('--credits-only')) queueMicrotask(() => { child.stdout.end('{"credits":500}\n'); child.emit('close', 0); });
      return child;
    };
    return { run: await createRunController({ env, deps: { spawn, processes }, handleSignals: false }), children };
  }
  const env = { KANE_STREAM_TRUST_PROXY: '1', KANE_DAILY_CAP: '2', KANE_STREAM_COOLDOWN_S: '0' };
  const live = await actual(env);
  const h = await fixture(t, { env, runController: live.run });
  assert.equal((await h.send('/start', { method: 'POST' })).status, 202);
  assert.equal((await h.send('/start', { method: 'POST' })).status, 409);
  await live.run.end('won'); await until(() => live.run.snapshot().state === 'idle');
  assert.equal((await h.send('/start', { method: 'POST' })).status, 429);
  assert.equal((await h.send('/start', { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.2' } })).status, 202);
  await live.run.end('won'); await until(() => live.run.snapshot().state === 'idle');
  assert.equal((await h.send('/start', { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.3' } })).status, 429);
  assert.equal(live.children.length, 4);
  const lowEnv = { KANE_STREAM_MIN_CREDITS: '99999' }, low = await actual(lowEnv);
  const unavailable = await fixture(t, { env: lowEnv, runController: low.run });
  const response = await unavailable.send('/start', { method: 'POST' });
  assert.equal(response.status, 503); assert.equal(response.text, '{"message":"unavailable"}');
  assert.equal(low.children.length, 1); assert.ok(low.children[0].args.includes('--credits-only'));
});


test('WS heartbeat terminates a viewer that stops answering pings', async t => {
  const h = await fixture(t, { heartbeatMs: 25 });
  const ws = new WebSocket(h.base.replace('http:', 'ws:') + '/ws', { origin: h.base, autoPong: false });
  await once(ws, 'open');
  await once(ws, 'close', { signal: AbortSignal.timeout(1000) });
  await until(() => h.app.connectionCounts().ws === 0 && h.clients.size === 0);
});
