import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
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
  const gameDir = await mkdtemp(join(tmpdir(), 'kane-stream-game-'));
  await writeFile(join(gameDir, 'index.html'), '<h1>Node Arena game</h1>');
  const run = new EventEmitter(), cast = new EventEmitter(), clients = new Set();
  let snapshot = { state: 'idle', runId: null, attemptId: null, startedAt: null, endsAtMax: null }, next = 1;
  const starts = [], calls = [];
  run.snapshot = viewers => ({ ...snapshot, viewers });
  run.change = value => { snapshot = { ...snapshot, ...value }; run.emit('state', run.snapshot(0)); };
  run.start = async (ip, attemptId) => {
    starts.push(ip);
    if (options.start) return options.start(ip, run);
    if (snapshot.state !== 'idle') return { status: 409 };
    run.change({ state: 'starting', runId: `run-${next++}`, attemptId });
    return { status: 202, runId: snapshot.runId };
  };
  run.close = async () => calls.push('run.close');
  cast.start = async port => calls.push(['cast.start', port]);
  cast.stop = async () => calls.push('cast.stop');
  cast.addClient = ws => { clients.add(ws); return true; };
  cast.removeClient = ws => clients.delete(ws);
  const app = await createStreamServer({ env: {}, publicDir, gameDir, runController: run, screencast: cast, port: 0, handleSignals: false, ...options });
  await app.listen();
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const send = (path, { method = 'GET', headers = {}, body, origin = base } = {}) => new Promise((resolve, reject) => {
    const req = request(base, { path, method, headers: { ...(origin ? { Origin: origin } : {}), ...headers } }, res => {
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
  t.after(async () => { await app.close(); await rm(publicDir, { recursive: true, force: true }); await rm(gameDir, { recursive: true, force: true }); });
  return { app, base, run, cast, clients, calls, starts, publicDir, gameDir, send, events, connect };
}

test('server binds loopback only, enforces timeouts, security headers and exact static routes', async t => {
  const h = await fixture(t);
  assert.equal(h.app.server.address().address, '127.0.0.1');
  assert.equal(h.app.server.maxHeaderSize, 8192);
  assert.equal(h.app.server.headersTimeout, 10000); assert.equal(h.app.server.requestTimeout, 10000);
  for (const path of ['/', '/kane-cli', '/kane-cli/', '/kane-cli/app.js', '/kane-cli/style.css']) {
    const res = await h.send(path); assert.equal(res.status, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff'); assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/); assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
  for (const path of ['/../run.mjs', '/%2e%2e/run.mjs', '/app.js?x=1', '/api/state?x=1', '/ws?x=1', '/unknown']) assert.equal((await h.send(path)).status, 404, path);
  for (const [path, method] of [['/', 'POST'], ['/start', 'GET'], ['/api/state', 'POST'], ['/events', 'POST'], ['/ws', 'POST'], ['/kane-cli/app.js', 'HEAD']]) assert.equal((await h.send(path, { method })).status, 405);
  assert.equal((await h.send('/ws')).status, 426);
  assert.equal((await h.send('/kane-cli/backup.mp4', { method: 'HEAD' })).status, 404);
  await writeFile(join(h.publicDir, 'backup.mp4'), 'fake video');
  assert.equal((await h.send('/kane-cli/backup.mp4', { method: 'HEAD' })).status, 200);
  assert.equal((await h.send('/kane-cli/backup.mp4')).text, 'fake video');
});

test('production game static files stay confined, reject encoded/traversal paths and fail closed on symlinks', async t => {
  const h = await fixture(t);
  await mkdir(join(h.gameDir, 'textures', 'tw'), { recursive: true });
  await writeFile(join(h.gameDir, 'textures/tw/ground-green.png'), 'texture');
  await writeFile(join(h.gameDir, 'manifest.tw.json'), '{}');
  assert.equal((await h.send('/')).text, '<h1>Node Arena game</h1>');
  assert.equal((await h.send('/?kane=1')).text, '<h1>Node Arena game</h1>');
  for (const path of ['/kane-cli', '/kane-cli/']) assert.equal((await h.send(path)).text, '<h1>Viewer</h1>');
  const texture = await h.send('/textures/tw/ground-green.png');
  assert.equal(texture.status, 200); assert.equal(texture.text, 'texture'); assert.equal(texture.headers['content-type'], 'image/png');
  assert.equal((await h.send('/textures/tw/ground-green.png', { method: 'HEAD' })).text, '');
  assert.equal((await h.send('/manifest.tw.json')).status, 200);
  assert.match((await h.send('/')).headers['content-security-policy'], /style-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch((await h.send('/kane-cli')).headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
  assert.match((await h.send('/')).headers['content-security-policy'], /script-src 'self' 'unsafe-eval'/);
  for (const path of ['/../index.html', '/textures/../../index.html', '/%2e%2e/index.html', '/textures%2ftw/ground-green.png', '/textures/%252e%252e/index.html', '/textures/./tw/ground-green.png', '//index.html', '/textures\\tw/ground-green.png', '/%00.png', '/%ZZ.png', '/.env', '/package.json', '/src/main.tsx', '/apps/web/dist-test/index.html', '/editor.html', '/e2e/content-parity.html', '/tools/kane/stream/server.mjs', '/kane-runs/run.json', '/app.js', '/style.css', '/backup.mp4']) {
    assert.equal((await h.send(path)).status, 404, path);
  }
  await writeFile(join(h.publicDir, 'secret.json'), 'private');
  await symlink(join(h.publicDir, 'secret.json'), join(h.gameDir, 'secret.json'));
  await symlink(h.publicDir, join(h.gameDir, 'escape'));
  assert.equal((await h.send('/secret.json')).status, 404);
  assert.equal((await h.send('/escape/secret.json')).status, 404);
  await symlink(join(h.gameDir, 'manifest.tw.json'), join(h.gameDir, 'internal.json'));
  assert.equal((await h.send('/internal.json')).status, 404);
  await symlink(join(h.publicDir, 'secret.json'), join(h.publicDir, 'backup.mp4'));
  assert.equal((await h.send('/kane-cli/backup.mp4')).status, 404);
  assert.deepEqual(h.starts, []);
});

test('missing production output reports safe unavailability while viewer and API remain usable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kane-stream-symlink-root-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const gameDir = join(root, 'dist');
  const h = await fixture(t, { gameDir: gameDir + '/' });
  await rm(h.gameDir, { recursive: true, force: true });
  const response = await h.send('/');
  assert.equal(response.status, 503); assert.equal(response.text, 'Game temporarily unavailable.');
  assert.doesNotMatch(response.text, /\/root\//);
  assert.equal((await h.send('/kane-cli')).status, 200);
  assert.equal((await h.send('/api/state')).status, 200);
  await symlink(h.publicDir, gameDir);
  assert.equal((await h.send('/')).status, 503);
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
  const env = { KANE_STREAM_TRUST_PROXY: '1', KANE_DAILY_CAP: '2', KANE_STREAM_COOLDOWN_S: '0', KANE_STREAM_CDP_PORT: '9225' };
  const live = await actual(env);
  const h = await fixture(t, { env, runController: live.run });
  assert.equal((await h.send('/start', { method: 'POST' })).status, 202);
  assert.equal((await h.send('/start', { method: 'POST' })).status, 409);
  const driver = live.children[1].child;
  driver.stdout.write('{"type":"chrome_ready","mode":"attach","port":9225,"pid":999}\n');
  await turn();
  driver.stdout.write('{"type":"chrome_ready","mode":"launch","port":9223,"headless":true}\n');
  await turn();
  assert.deepEqual(h.calls.filter(Array.isArray), [['cast.start', 9225], ['cast.start', 9223]]);
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

test('Stop and Reset routes share exact guards, bounded bodies, public responses and generic failures', async t => {
  const h = await fixture(t); const controls = [];
  h.run.stop = async () => { controls.push('stop'); return { status: 200, private: '/root/secret', credits: 99 }; };
  h.run.reset = async () => { controls.push('reset'); return { status: 200 }; };
  for (const route of ['/stop', '/reset']) {
    assert.equal((await h.send(route, { method: 'GET' })).status, 405);
    assert.equal((await h.send(route + '?x=1', { method: 'POST' })).status, 404);
    for (const origin of [null, 'https://evil.test']) assert.equal((await h.send(route, { method: 'POST', origin })).status, 403);
    assert.equal((await h.send(route, { method: 'POST', headers: { Host: 'evil.test' } })).status, 403);
    assert.equal((await h.send(route, { method: 'POST', body: 'x'.repeat(1025) })).status, 413);
    assert.equal((await h.send(route, { method: 'POST', body: 'x'.repeat(1025), headers: { 'Transfer-Encoding': 'chunked' } })).status, 413);
    assert.equal(controls.length, route === '/stop' ? 0 : 1);
    const response = await h.send(route, { method: 'POST', body: 'x'.repeat(1024) });
    assert.equal(response.status, 200); assert.deepEqual(JSON.parse(response.text), h.run.snapshot(0));
    for (const status of [409, 503, 500]) {
      const method = route.slice(1), original = h.run[method];
      h.run[method] = async () => ({ status, message: 'secret /root/key', credits: 123 });
      const failed = await h.send(route, { method: 'POST' });
      assert.equal(failed.status, status === 500 ? 503 : status); assert.equal(failed.text, '{"message":"unavailable"}');
      h.run[method] = original;
    }
    const method = route.slice(1), original = h.run[method];
    h.run[method] = async () => { throw new Error('/root/secret'); };
    assert.equal((await h.send(route, { method: 'POST' })).text, '{"message":"unavailable"}'); h.run[method] = original;
  }
  assert.deepEqual(controls, ['stop', 'reset']); assert.equal(h.starts.length, 0);
});

test('Reset clears relay and frame cache before shared reset/state and reconnect replay', async t => {
  const h = await fixture(t); let frame = Buffer.from('old-frame');
  h.cast.addClient = ws => { h.clients.add(ws); if (frame) ws.send(frame); return true; };
  h.cast.stop = async () => { frame = null; h.calls.push('cast.stop'); };
  h.run.change({ state: 'cooldown', runId: 'old', outcome: 'stopped' });
  h.run.emit('line', '{"seq":91,"type":"warn","code":"old"}');
  const first = await h.events(); await until(() => first.text.includes('id: 91'));
  h.run.reset = async () => {
    h.run.snapshot = viewers => ({ state: 'cooldown', runId: null, attemptId: null, startedAt: null, endsAtMax: null, viewers });
    h.run.emit('reset', h.run.snapshot(0));
    assert.equal(frame, null, 'cache cleared synchronously inside reset event');
    h.run.emit('state', h.run.snapshot(0));
    return { status: 200 };
  };
  assert.equal((await h.send('/reset', { method: 'POST' })).status, 200);
  await until(() => first.text.includes('event: reset'));
  const after = first.text.slice(first.text.indexOf('event: reset'));
  assert.match(after, /event: reset\ndata: .*"runId":null/); assert.match(after, /event: state/);
  const second = await h.events({ 'Last-Event-ID': '1' }); await turn();
  assert.doesNotMatch(second.text, /id: 91/); assert.match(second.text, /"runId":null/);
  const { ws } = await h.connect(); const frames = []; ws.on('message', data => frames.push(data)); await turn();
  assert.equal(frames.length, 0); first.req.destroy(); second.req.destroy(); ws.terminate();
});

test('boot, GET/reload, WS/SSE and Reset invoke no preflight or driver; only explicit Start spawns', async t => {
  const spawned = []; let pid = 8000;
  const processes = {
    identity: async pid => ({ pid, pgid: pid, starttime: '1', cmdline: ['node', 'fixture'] }),
    load: async () => null, acquire: async () => {}, release: async () => {}, checkPorts: async () => {},
    persist: async () => {}, clear: async () => {}, descendants: async () => [], matches: async () => false,
    signal: async () => {}, removeProfile: async () => {},
  };
  const spawn = (_command, args) => {
    const child = Object.assign(new EventEmitter(), { pid: pid++, stdout: new PassThrough(), stderr: new PassThrough() }); spawned.push({ args, child });
    if (args.includes('--credits-only')) queueMicrotask(() => { child.stdout.end('{"credits":500}'); child.emit('close', 0); }); return child;
  };
  const run = await createRunController({ env: {}, deps: { spawn, processes }, handleSignals: false });
  const h = await fixture(t, { runController: run });
  assert.equal(spawned.length, 0);
  for (const route of ['/', '/kane-cli', '/api/state', '/kane-cli/app.js']) assert.equal((await h.send(route)).status, 200);
  const first = await h.events(), second = await h.events(); const { ws } = await h.connect();
  assert.equal((await h.send('/reset', { method: 'POST' })).status, 200);
  assert.equal((await h.send('/stop', { method: 'POST' })).status, 409); assert.equal(spawned.length, 0);
  assert.equal((await h.send('/start', { method: 'POST' })).status, 202); assert.equal(spawned.length, 2);
  assert.equal((await h.send('/reset', { method: 'POST' })).status, 409);
  const stop = await h.send('/stop', { method: 'POST' }); assert.equal(stop.status, 200); assert.equal(JSON.parse(stop.text).outcome, 'stopped');
  assert.equal((await h.send('/reset', { method: 'POST' })).status, 200); assert.equal(spawned.length, 2);
  first.req.destroy(); second.req.destroy(); ws.terminate();
});

test('attempt header validates canonical single UUIDs before controls, generates legacy Start IDs and forwards conditional Stop', async t => {
  const h = await fixture(t), id = '12345678-1234-4234-8234-123456789abc';
  const starts = [], stops = [];
  h.run.start = async (ip, attemptId) => { starts.push([ip, attemptId]); h.run.change({ state: 'starting', runId: 'A', attemptId }); return { status: 202, runId: 'A' }; };
  h.run.stop = async expected => { stops.push(expected); return { status: 200 }; };
  for (const route of ['/start', '/stop']) for (const value of ['', 'bad', id.toUpperCase(), `${id},${id}`, [id, id]]) {
    const response = await h.send(route, { method: 'POST', headers: { 'X-Kane-Attempt-Id': value } });
    assert.equal(response.status, 400); assert.equal(response.text, '{"message":"request rejected"}');
  }
  assert.equal(starts.length, 0); assert.equal(stops.length, 0); assert.deepEqual(h.calls, []);
  assert.equal((await h.send('/start', { method: 'POST', headers: { 'X-Kane-Attempt-Id': id } })).status, 202);
  assert.equal(starts[0][1], id); assert.equal(h.run.snapshot(0).attemptId, id);
  assert.equal((await h.send('/stop', { method: 'POST', headers: { 'X-Kane-Attempt-Id': id } })).status, 200);
  assert.deepEqual(stops, [id]);
  assert.equal((await h.send('/start', { method: 'POST' })).status, 202);
  assert.match(starts[1][1], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(starts[1][1], id);
  assert.equal((await h.send('/stop', { method: 'POST' })).status, 200); assert.equal(stops[1], undefined);
});

test('conditional HTTP Stop arriving after a fresh attempt returns 409 without ending its run or stopping cast', async t => {
  let pid = 9000;
  const spawned = [], processes = {
    identity: async pid => ({ pid, pgid: pid, starttime: '1', cmdline: ['node', 'fixture'] }),
    load: async () => null, acquire: async () => {}, release: async () => {}, checkPorts: async () => {},
    persist: async () => {}, clear: async () => {}, descendants: async () => [], matches: async () => false,
    signal: async () => {}, removeProfile: async () => {},
  };
  const spawn = (_command, args) => {
    const child = Object.assign(new EventEmitter(), { pid: pid++, stdout: new PassThrough(), stderr: new PassThrough() }); spawned.push({ args, child });
    if (args.includes('--credits-only')) queueMicrotask(() => { child.stdout.end('{"credits":500}'); child.emit('close', 0); }); return child;
  };
  const run = await createRunController({ env: { KANE_STREAM_COOLDOWN_S: '0', KANE_IP_COOLDOWN_S: '0' }, deps: { spawn, processes }, handleSignals: false });
  const h = await fixture(t, { runController: run });
  for (const path of ['/start', '/stop']) {
    assert.equal((await h.send(path, { method: 'POST', headers: { 'X-Kane-Attempt-Id': 'malformed' } })).status, 400);
    assert.equal(spawned.length, 0); assert.deepEqual(h.calls, []);
  }
  const a = '12345678-1234-4234-8234-123456789abc', b = '22345678-1234-4234-8234-123456789abc';
  const post = (path, id) => h.send(path, { method: 'POST', headers: { 'X-Kane-Attempt-Id': id } });
  assert.equal((await post('/start', a)).status, 202); assert.equal((await post('/stop', a)).status, 200);
  await until(() => run.snapshot().state === 'idle');
  assert.equal((await post('/start', b)).status, 202);
  spawned.at(-1).child.stdout.write('{"type":"chrome_ready","port":9222}\n');
  await until(() => run.snapshot().state === 'live');
  const before = run.snapshot(), calls = h.calls.length;
  assert.equal((await post('/stop', a)).status, 409);
  assert.deepEqual(run.snapshot(), before); assert.equal(h.calls.length, calls);
  assert.equal(run.snapshot().attemptId, b); assert.equal(spawned.length, 4);
  const event = await h.events(); await until(() => event.text.includes(b)); event.req.destroy();
  assert.equal((await post('/stop', b)).status, 200);
});
