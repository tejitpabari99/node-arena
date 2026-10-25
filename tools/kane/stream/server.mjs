import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { admitConnection, releaseConnection, createConnectionState, readGuardConfig, checkOrigin, clientIp } from './guards.mjs';
import { createRelayBuffer, serializeSse } from './relay.mjs';
import { createRunController } from './run.mjs';
import { createScreencast } from './screencast.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GAME = fileURLToPath(new URL('../../../apps/web/dist/', import.meta.url));
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const BODY_LIMIT = 1024, SSE_BUFFER_LIMIT = 512 * 1024;
const STATIC = new Map([
  ['/kane-cli', ['index.html', 'text/html; charset=utf-8']],
  ['/kane-cli/', ['index.html', 'text/html; charset=utf-8']],
  ['/kane-cli/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/kane-cli/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/kane-cli/backup.mp4', ['backup.mp4', 'video/mp4']],
]);
const METHODS = new Map([...STATIC.keys()].map(path => [path, path.endsWith('.mp4') ? ['GET', 'HEAD'] : ['GET']]));
for (const [path, methods] of [['/api/state', ['GET']], ['/events', ['GET']], ['/start', ['POST']], ['/stop', ['POST']], ['/reset', ['POST']], ['/ws', ['GET']]]) METHODS.set(path, methods);
const MIME = new Map(Object.entries({
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}));
// Reject ambiguous encodings and path components before filesystem access. Only
// the root document accepts queries (including ?kane=1, harmless in production).
function gameEntry(url) {
  if (url === '/' || url.startsWith('/?')) return ['index.html', 'text/html; charset=utf-8'];
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(url)) return null;
  const type = MIME.get(extname(url));
  return type ? [url.slice(1), type] : null;
}
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src blob:; connect-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
};

const GAME_HEADERS = { ...HEADERS,
  // Preact sets inline style properties; Three loads same-origin textures/models,
  // FontFace loads the game font, WebAudio fetches same-origin audio, and
  // AJV compiles the existing schemas with Function; MeshoptDecoder also
  // instantiates WebAssembly. Keep these permissions off the viewer.
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

// Walk through pinned directory descriptors on Linux. O_NOFOLLOW protects every
// component, including parents, even if a directory is replaced during a request.
async function openStatic(root, path) {
  let directory = await open(resolve(root), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const parts = path.split('/');
    for (const part of parts.slice(0, -1)) {
      const child = await open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await directory.close(); directory = child;
    }
    return await open(`/proc/self/fd/${directory.fd}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } finally { await directory.close(); }
}

function integer(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('Invalid server configuration');
  return Number(value);
}

// Correlation only: a public nonce is never an authorization capability.
function readAttemptId(req) {
  const values = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === 'x-kane-attempt-id') values.push(req.rawHeaders[i + 1]);
  }
  if (values.length === 0) return undefined;
  return values.length === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values[0]) ? values[0] : null;
}

/** Operator-only configuration: no request data is ever passed to the driver. */
export function readServerConfig(input = {}, argv = []) {
  const env = { ...input };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--max-run-s' || i + 1 >= argv.length) throw new Error('Unknown server argument');
    const value = integer(argv[++i], undefined, 1, 86400);
    env.KANE_STREAM_MAX_RUN_S = String(value);
  }
  const host = env.KANE_STREAM_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('Unsafe KANE_STREAM_HOST override: only 127.0.0.1 is allowed');
  return { host, port: integer(env.KANE_STREAM_PORT, 8787, 1, 65535), env };
}

/** Side-effect-free import. Inject controllers for tests; listen() is explicit. */
export async function createStreamServer(options = {}) {
  const config = readServerConfig(options.env ?? process.env, options.argv ?? []);
  const { env, host } = config;
  const port = integer(options.port, config.port, 0, 65535);
  const heartbeatMs = integer(options.heartbeatMs, 15000, 1, 30000);
  const sseBufferLimit = integer(options.sseBufferLimit, SSE_BUFFER_LIMIT, 1024, SSE_BUFFER_LIMIT);
  const guardConfig = readGuardConfig(env);
  const cast = options.screencast ?? createScreencast({
    fps: env.KANE_STREAM_FPS === undefined ? 10 : Number(env.KANE_STREAM_FPS), maxClients: Math.max(1, Math.min(100, guardConfig.maxWs)),
  });
  const run = options.runController ?? await createRunController({
    env, cwd: options.cwd ?? ROOT, guardConfig, handleSignals: false, deps: options.runDeps,
  });
  const publicDir = options.publicDir ?? PUBLIC;
  const gameDir = options.gameDir ?? GAME;
  const relay = createRelayBuffer();
  const sse = new Set(), sockets = new Set(), websocket = new Set(), signalHandlers = new Map();
  let connections = createConnectionState(), closing, closed = false;
  const snapshot = () => run.snapshot(connections.ws.size);
  const reserve = (kind, ip, id) => {
    const result = admitConnection(connections, { kind, ip, id }, guardConfig);
    connections = result.state; return result.allowed;
  };
  const release = (kind, id) => { connections = releaseConnection(connections, kind, id); };
  const json = (res, status, value) => {
    if (res.destroyed || res.writableEnded) return;
    const body = JSON.stringify(value);
    res.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }); res.end(body);
  };
  const error = (res, status) => json(res, status, { message: status === 503 || status === 429 || status === 409 ? 'unavailable' : 'request rejected' });
  const dropSse = res => { sse.delete(res); release('sse', res); };
  const writeSse = (res, data) => {
    if (res.destroyed || res.writableEnded || res.writableLength + Buffer.byteLength(data) > sseBufferLimit) {
      dropSse(res); res.destroy(); return;
    }
    try {
      // Bound the complete writable queue, including bursts during replay.
      // Reconnect recovers from the current-run buffer after the cap is reached.
      res.write(data);
    } catch { dropSse(res); res.destroy(); }
  };
  const broadcast = data => { for (const res of sse) writeSse(res, data); };
  const named = (event, value) => broadcast(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  const publicState = () => named('state', snapshot());
  const videoLost = () => named('video_lost', { type: 'video_lost' });
  const stopCast = () => { try { void Promise.resolve(cast.stop()).catch(() => {}); } catch { /* private transport failure */ } };
  const onState = state => {
    // The lifecycle enters starting BEFORE allocating a new runId or spawning.
    if (state.state === 'starting') relay.reset();
    if (state.state === 'ending') stopCast();
    publicState();
  };
  const onReset = () => {
    relay.reset(); stopCast();
    named('reset', snapshot());
  };
  const onLine = line => {
    let raw; try { raw = JSON.parse(line); } catch { return; }
    const event = relay.append(raw); if (event) broadcast(serializeSse(event));
  };
  const onChrome = event => {
    if (closed) return;
    try { void Promise.resolve(cast.start(event.port)).catch(videoLost); } catch { videoLost(); }
  };
  run.on('reset', onReset); run.on('state', onState); run.on('line', onLine); run.on('chrome_ready', onChrome); cast.on('video_lost', videoLost);

  async function staticFile(req, res, entry, game = false) {
    let file;
    try {
      file = await openStatic(game ? gameDir : publicDir, entry[0]);
      const stat = await file.stat();
      if (!stat.isFile()) { await file.close(); error(res, 404); return; }
      if (res.destroyed) { await file.close(); return; }
      res.writeHead(200, { ...(game ? GAME_HEADERS : HEADERS), 'Content-Type': entry[1], 'Content-Length': stat.size });
      if (req.method === 'HEAD') { await file.close(); res.end(); return; }
      const stream = file.createReadStream();
      stream.on('error', () => res.destroy()); res.once('close', () => stream.destroy()); stream.pipe(res);
    } catch {
      await file?.close().catch(() => {});
      if (res.headersSent) res.destroy();
      else if (game && entry[0] === 'index.html') {
        const body = 'Game temporarily unavailable.';
        res.writeHead(503, { ...GAME_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body);
      } else error(res, 404);
    }
  }
  async function start(req, res) {
    if (!checkOrigin(req, guardConfig)) { req.resume(); error(res, 403); return; }
    try {
      if (closed || req.aborted || res.destroyed) return;
      const attemptId = readAttemptId(req);
      if (attemptId === null) { error(res, 400); return; }
      const result = await run.start(clientIp(req, guardConfig), attemptId ?? randomUUID());
      if (result.status === 202 && typeof result.runId === 'string') json(res, 202, { runId: result.runId });
      else error(res, [409, 429, 503].includes(result.status) ? result.status : 503);
    } catch { if (!req.aborted) error(res, 503); }
  }
  // Stop waits for owned cleanup; both controls return only the public snapshot.
  async function control(req, res, method) {
    try {
      if (closed || req.aborted || res.destroyed) return;
      const expectedAttemptId = method === 'stop' ? readAttemptId(req) : undefined;
      if (expectedAttemptId === null) { error(res, 400); return; }
      const result = await run[method](expectedAttemptId);
      if (result.status === 200) json(res, 200, snapshot());
      else error(res, [409, 503].includes(result.status) ? result.status : 503);
    } catch { if (!req.aborted) error(res, 503); }
  }
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 10000, requestTimeout: 10000,
    keepAliveTimeout: 5000, connectionsCheckingInterval: 1000 }, async (req, res) => {
    res.on('error', () => {});
    if (closed) { error(res, 503); return; }
    const game = METHODS.has(req.url) ? null : gameEntry(req.url);
    const methods = METHODS.get(req.url) ?? (game ? ['GET', 'HEAD'] : null);
    if (!methods) { req.resume(); error(res, 404); return; }
    if (!methods.includes(req.method)) { req.resume(); res.setHeader('Allow', methods.join(', ')); error(res, 405); return; }
    if (Number(req.headers['content-length'] ?? 0) > BODY_LIMIT) { req.resume(); error(res, 413); return; }
    if (['/start', '/stop', '/reset'].includes(req.url) && !checkOrigin(req, guardConfig)) { req.resume(); error(res, 403); return; }
    // Read every accepted route through the same bounded decoder, including GET
    // bodies sent with chunked transfer coding. No headers/side effects precede it.
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > BODY_LIMIT) { error(res, 413); return; }
      }
    } catch { if (!req.aborted) error(res, 400); return; }
    if (closed || req.aborted || res.destroyed) return;
    if (req.url === '/start') { void start(req, res); return; }
    if (req.url === '/stop' || req.url === '/reset') { void control(req, res, req.url.slice(1)); return; }
    if (STATIC.has(req.url)) { void staticFile(req, res, STATIC.get(req.url)); return; }
    if (game) { void staticFile(req, res, game, true); return; }
    if (req.url === '/api/state') { json(res, 200, snapshot()); return; }
    if (req.url === '/ws') { error(res, 426); return; }
    if (!reserve('sse', clientIp(req, guardConfig), res)) { error(res, 429); return; }
    res.once('close', () => dropSse(res)); req.once('aborted', () => { dropSse(res); res.destroy(); });
    try {
      res.writeHead(200, { ...HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders(); sse.add(res);
      writeSse(res, `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
      for (const event of relay.replaySince(req.headers['last-event-id'])) {
        if (!sse.has(res)) break;
        writeSse(res, serializeSse(event));
      }
    } catch { dropSse(res); res.destroy(); }
  });
  server.maxHeadersCount = 100;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1, perMessageDeflate: false });
  const rejectUpgrade = (socket, status) => {
    // End the socket after a small, fixed response; never retain an invalid upgrade.
    socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (closed) { rejectUpgrade(socket, 503); return; }
    if (req.url !== '/ws') { rejectUpgrade(socket, METHODS.has(req.url) ? 405 : 404); return; }
    if (req.method !== 'GET') { rejectUpgrade(socket, 405); return; }
    if (!checkOrigin(req, guardConfig)) { rejectUpgrade(socket, 403); return; }
    if (!reserve('ws', clientIp(req, guardConfig), socket)) { rejectUpgrade(socket, 429); return; }
    socket.once('close', () => { release('ws', socket); });
    const failed = () => release('ws', socket); socket.once('error', failed);
    try {
      wss.handleUpgrade(req, socket, head, ws => {
        socket.removeListener('error', failed);
        if (closed) { release('ws', socket); ws.terminate(); return; }
        websocket.add(ws); ws.alive = true;
        const done = () => { if (!websocket.delete(ws)) return; release('ws', socket); cast.removeClient(ws); publicState(); };
        ws.on('close', done); ws.on('error', () => { done(); ws.terminate(); });
        ws.on('pong', () => { ws.alive = true; });
        // Client data has no command handler; ws enforces the one-byte payload cap.
        try { if (!cast.addClient(ws)) { done(); ws.terminate(); return; } }
        catch { done(); ws.terminate(); return; }
        publicState();
      });
    } catch { release('ws', socket); socket.destroy(); }
  });
  const heartbeat = setInterval(() => {
    broadcast(': hb\n\n');
    for (const ws of websocket) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      try { ws.ping(); } catch { ws.terminate(); }
    }
  }, heartbeatMs);
  heartbeat.unref();

  function close() {
    if (closing) return closing;
    closed = true; clearInterval(heartbeat);
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    run.off('reset', onReset); run.off('state', onState); run.off('line', onLine); run.off('chrome_ready', onChrome); cast.off('video_lost', videoLost);
    closing = (async () => {
      const stopped = new Promise(resolveClose => server.close(() => resolveClose()));
      for (const res of sse) { dropSse(res); res.destroy(); }
      for (const ws of websocket) { cast.removeClient(ws); ws.terminate(); }
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled([run.close(), cast.stop()]);
      await new Promise(resolveClose => wss.close(() => resolveClose()));
      await stopped;
    })();
    return closing;
  }
  if (options.handleSignals !== false) for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => { void close().catch(() => {}); }; signalHandlers.set(signal, handler); process.once(signal, handler);
  }
  return { server, close,
    listen: () => new Promise((accept, reject) => {
      if (closed) { reject(new Error('Stream server closed')); return; }
      const failed = error => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', failed); accept(server.address()); };
      server.once('error', failed); server.once('listening', ready); server.listen(port, host);
    }),
    connectionCounts: () => ({ ws: connections.ws.size, sse: connections.sse.size }),
  };
}

// CLI failures stay generic. Detailed driver output remains in its private log.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let app;
  try {
    app = await createStreamServer({ argv: process.argv.slice(2) });
    const address = await app.listen();
    console.log(`Kane stream listening on http://127.0.0.1:${address.port}`);
  } catch {
    await app?.close(); console.error('Kane stream unavailable'); process.exitCode = 1;
  }
}
