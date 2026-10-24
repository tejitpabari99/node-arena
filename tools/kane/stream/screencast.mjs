import { EventEmitter } from 'node:events';
import { connectCdp } from '../lib/cdp.mjs';

const METHODS = new Set(['Page.startScreencast', 'Page.stopScreencast', 'Page.screencastFrameAck',
  'Target.getTargets', 'Target.attachToTarget']);
const BUFFER_CAP = 512 * 1024;
const FRAME_CAP = BUFFER_CAP - 1024;
const cancelled = () => new Error('Screencast stopped');

/** Default-deny facade over the driver's unchanged generic CDP transport. */
export class ReadOnlyCdp {
  #client;
  constructor(client) { this.#client = client; }
  send(method, params = {}, sessionId) {
    if (!METHODS.has(method)) return Promise.reject(new Error('CDP method not allowed'));
    return this.#client.send(method, params, sessionId);
  }
}
const loopback = hostname => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
function gameTarget(target) {
  try {
    const url = new URL(target.url);
    return target.type === 'page' && ['http:', 'https:'].includes(url.protocol)
      && loopback(url.hostname) && url.searchParams.getAll('kane').includes('1');
  } catch { return false; }
}
function metaFor(metadata) {
  const w = metadata?.deviceWidth, h = metadata?.deviceHeight;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || w > 16384 || h > 16384) return null;
  const scale = Math.min(1, 1280 / w, 720 / h);
  return Object.freeze({ type: 'meta', w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) });
}

/**
 * Independent browser connection + flattened page session, with send-only WS viewers.
 * Emits video_lost ({type:'video_lost'}) after three retry attempts; never raw errors.
 * stop cancels discovery/retry and clears cached frames; viewer ownership stays with server.
 * Options are operator/test dependencies only. No client request may supply these values.
 */
export function createScreencast(options = {}) { return new Screencast(options); }
class Screencast extends EventEmitter {
  constructor({ fps = process.env.KANE_STREAM_FPS === undefined ? 10 : Number(process.env.KANE_STREAM_FPS),
    maxClients = 100, fetch: fetcher = globalThis.fetch, connect = connectCdp,
    now = Date.now, setTimeout: schedule = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout } = {}) {
    super();
    if (!Number.isFinite(fps) || fps <= 0 || fps > 60) throw new RangeError('fps must be >0 and <=60');
    if (!Number.isSafeInteger(maxClients) || maxClients < 1 || maxClients > 100) throw new RangeError('maxClients must be 1..100');
    Object.assign(this, { interval: 1000 / fps, maxClients, fetcher, connect, now, schedule, cancel });
    this.clients = new Map(); this.generation = 0; this.lastFrame = null; this.meta = null;
    this.lastSent = -Infinity; this.pending = null; this.frameTimer = null; this.connection = null; this.controller = null;
  }
  get clientCount() { return this.clients.size; }
  addClient(ws) {
    if (this.clients.has(ws)) return true;
    if (this.clients.size >= this.maxClients || ws.readyState !== 1) return false;
    const entry = { timer: null, lastMeta: null, close: () => this.removeClient(ws) };
    this.clients.set(ws, entry); ws.on('close', entry.close); ws.on('error', entry.close);
    if (this.lastFrame) this.deliver(ws, entry, this.lastFrame, this.meta);
    return true;
  }
  removeClient(ws) {
    const entry = this.clients.get(ws); if (!entry) return;
    this.cancel(entry.timer); ws.off('close', entry.close); ws.off('error', entry.close); this.clients.delete(ws);
  }
  deliver(ws, entry, frame, meta) {
    if (ws.readyState !== 1) { this.removeClient(ws); return; }
    const encodedMeta = meta ? JSON.stringify(meta) : null;
    const json = encodedMeta !== entry.lastMeta ? encodedMeta : null;
    // Include the NEXT payload (and metadata), so sends never push a healthy buffer over cap.
    if (!Number.isFinite(ws.bufferedAmount) || ws.bufferedAmount + frame.length + (json ? Buffer.byteLength(json) : 0) + 32 > BUFFER_CAP) {
      if (entry.timer === null) entry.timer = this.schedule(() => {
        this.removeClient(ws);
        // terminate immediately: a close handshake can itself remain stuck behind buffered data.
        try { ws.close(1008, 'Slow viewer'); } catch { /* server owns errors */ }
        try { ws.terminate?.(); } catch { /* already closed */ }
      }, 10000);
      return;
    }
    this.cancel(entry.timer); entry.timer = null;
    const sent = error => { if (error) this.removeClient(ws); };
    try {
      if (json) { ws.send(json, { binary: false, compress: false }, sent); entry.lastMeta = json; }
      if (this.clients.has(ws) && ws.readyState === 1) ws.send(frame, { binary: true, compress: false }, sent);
    } catch { this.removeClient(ws); }
  }
  frame(params, connection) {
    // Every own-session frame is acknowledged before validation, rate limiting or fan-out.
    connection.cdp.send('Page.screencastFrameAck', { sessionId: params?.sessionId }, connection.session)
      .catch(() => this.disconnected(connection));
    const data = params?.data;
    if (typeof data !== 'string' || data.length > Math.ceil(FRAME_CAP / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return;
    const frame = Buffer.from(data, 'base64');
    if (!frame.length || frame.length > FRAME_CAP) return;
    this.lastFrame = frame; this.meta = metaFor(params.metadata);
    this.pending = { frame, meta: this.meta };
    const wait = this.interval - (this.now() - this.lastSent);
    if (wait <= 0) this.flush();
    else if (this.frameTimer === null) this.frameTimer = this.schedule(() => { this.frameTimer = null; this.flush(); }, wait);
  }
  flush() {
    if (!this.pending) return;
    const { frame, meta } = this.pending; this.pending = null; this.lastSent = this.now();
    for (const [ws, entry] of this.clients) this.deliver(ws, entry, frame, meta);
  }
  async start(port) {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new RangeError('Invalid CDP port');
    const stopped = this.stop(), generation = this.generation;
    await stopped;
    if (generation !== this.generation) return;
    this.port = port; this.controller = new AbortController();
    await this.attachWithRetries(generation, false);
  }
  active(generation) { return this.controller && !this.controller.signal.aborted && generation === this.generation; }
  async interruptible(promise, generation, late) {
    const signal = this.controller?.signal;
    if (!this.active(generation)) throw cancelled();
    return new Promise((resolve, reject) => {
      const abort = () => reject(cancelled()); signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(value => {
        signal.removeEventListener('abort', abort);
        if (!this.active(generation)) { late?.(value); reject(cancelled()); } else resolve(value);
      }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  async delay(generation) {
    const signal = this.controller.signal;
    await new Promise(resolve => {
      let timer;
      const done = () => { this.cancel(timer); signal.removeEventListener('abort', done); resolve(); };
      signal.addEventListener('abort', done, { once: true }); timer = this.schedule(done, 2000);
      if (!this.active(generation)) done();
    });
  }
  async attachWithRetries(generation, dropped) {
    const attempts = dropped ? 3 : 4;
    for (let i = 0; i < attempts && this.active(generation); i++) {
      if (dropped || i > 0) await this.delay(generation);
      if (!this.active(generation)) return;
      try { await this.attach(generation); return; } catch { /* private transport details never leave this module */ }
    }
    if (this.active(generation)) this.emit('video_lost', { type: 'video_lost' });
  }
  async attach(generation) {
    let connection;
    try {
      const signal = this.controller.signal;
      const response = await this.interruptible(this.fetcher(`http://127.0.0.1:${this.port}/json/version`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: 'error',
      }), generation);
      if (!response.ok) throw new Error('Discovery failed');
      const info = await this.interruptible(response.json(), generation);
      const url = new URL(info.webSocketDebuggerUrl);
      if (url.protocol !== 'ws:' || !loopback(url.hostname) || url.username || url.password
        || Number(url.port || 80) !== this.port || !url.pathname.startsWith('/devtools/browser/')) throw new Error('Invalid CDP endpoint');
      const client = await this.interruptible(this.connect(url.href, { timeoutMs: 5000 }), generation, late => late.close());
      connection = { client, cdp: new ReadOnlyCdp(client), session: null, ready: false, generation };
      connection.message = event => {
        let message; try { message = JSON.parse(event.data); } catch { this.disconnected(connection); return; }
        if (message.method === 'Page.screencastFrame' && connection.session && message.sessionId === connection.session) this.frame(message.params, connection);
        if (message.method === 'Target.detachedFromTarget' && message.params?.sessionId === connection.session) this.disconnected(connection);
      };
      connection.closed = () => this.disconnected(connection);
      client.socket.addEventListener('message', connection.message);
      client.socket.addEventListener('close', connection.closed);
      client.socket.addEventListener('error', connection.closed);
      this.connection = connection;
      const targets = await this.interruptible(connection.cdp.send('Target.getTargets'), generation);
      const target = targets.targetInfos?.find(gameTarget); if (!target) throw new Error('Game target missing');
      const attached = await this.interruptible(connection.cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true }), generation);
      if (typeof attached.sessionId !== 'string' || !attached.sessionId) throw new Error('Session missing');
      connection.session = attached.sessionId;
      await this.interruptible(connection.cdp.send('Page.startScreencast', {
        format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1,
      }, connection.session), generation);
      if (this.connection !== connection) throw new Error('Session closed');
      connection.ready = true;
    } catch (error) { if (connection) this.release(connection); throw error; }
  }
  release(connection) {
    connection.ready = false;
    connection.client.socket.removeEventListener('message', connection.message);
    connection.client.socket.removeEventListener('close', connection.closed);
    connection.client.socket.removeEventListener('error', connection.closed);
    if (this.connection === connection) this.connection = null;
    connection.client.close();
  }
  disconnected(connection) {
    if (this.connection !== connection) return;
    const retry = connection.ready && this.active(connection.generation);
    this.release(connection);
    if (retry) void this.attachWithRetries(connection.generation, true);
  }
  async stop() {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.cancel(this.frameTimer); this.frameTimer = null; this.pending = null;
    this.lastFrame = null; this.meta = null; this.lastSent = -Infinity;
    for (const entry of this.clients.values()) { this.cancel(entry.timer); entry.timer = null; entry.lastMeta = null; }
    const connection = this.connection;
    if (!connection) return;
    // Closing this independent browser socket releases only our session, never the driver's.
    if (connection.ready) void connection.cdp.send('Page.stopScreencast', {}, connection.session).catch(() => {});
    this.release(connection);
  }
}
