import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@node-arena/net';
import { createClock } from './clock.js';
import { loadConfigOrExit, type Config } from './config.js';
import type { Socket } from './conn.js';
import { loadServerContentOrExit, type ServerContent } from './content.js';
import { createHub } from './hub.js';
import { IpLimits } from './limits.js';
import { createLogger, type Logger } from './log.js';
import { createMatchController } from './match.js';
import { createRoomManager } from './room.js';

export const MAX_PAYLOAD = 4096;
/** SP09: shortest drain (ms) so the notice is delivered even with no active match; socket close grace after the window. */
export const DRAIN_MIN_MS = 3000;
export const CLOSE_GRACE_MS = 2000;
export const DRAIN_POLL_MS = 500;
/** Process hard-exit bound (ms) for a drain of `windowMs`: window + close grace + 1 s; 0 = legacy 8 s. */
export function hardExitMs(windowMs: number): number {
  return windowMs <= 0 ? 8000 : windowMs + CLOSE_GRACE_MS + 1000;
}

export function serverName(): string {
  return '@node-arena/server';
}

/** Exact match, or `*` as a single DNS label (`https://*.example.com`). */
export function originAllowed(origin: string | undefined, cfg: Pick<Config, 'allowedOrigins' | 'allowNoOrigin'>): boolean {
  if (origin === undefined || origin === '') return cfg.allowNoOrigin;
  return cfg.allowedOrigins.some((pat) => {
    if (!pat.includes('*')) return pat === origin;
    const esc = pat.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^./:]+');
    return new RegExp(`^${esc}$`).test(origin);
  });
}

/** Client IP: `Fly-Client-IP` behind Fly's proxy, else the socket peer. Key only; never logged. */
export function clientIp(req: IncomingMessage): string | undefined {
  const h = req.headers['fly-client-ip'];
  const v = Array.isArray(h) ? h[0] : h;
  return v !== undefined && v !== '' ? v : req.socket.remoteAddress;
}

function wrapWs(ws: WebSocket, ip: string | undefined): Socket {
  return {
    ...(ip !== undefined ? { ip } : {}),
    send: (d) => { ws.send(d); },
    close: (code, reason) => { ws.close(code, reason); },
    onMessage: (cb) => {
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        cb(Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as Buffer).toString('utf8'));
      });
    },
    onClose: (cb) => { ws.on('close', cb); },
    ping: () => { ws.ping(); },
    onPong: (cb) => { ws.on('pong', cb); },
    get bufferedAmount() { return ws.bufferedAmount; },
  };
}

export interface StartOpts {
  content?: ServerContent;
  log?: Logger;
}

export interface RunningServer {
  port: number;
  content: ServerContent;
  close(): Promise<void>;
  /** Graceful drain: stop accepting, `room.closed{shutdown}` to all rooms, close sockets 1001. Resolves when sockets are gone (<= `graceMs`). */
  shutdown(graceMs?: number): Promise<void>;
  /**
   * SP09: SIGTERM path. Keeps serving, refuses new work (`error draining`), then closes everything with `room.closed{server-restart}` when
   * the window elapses or no match is active (after `minMs`, default 3 s). `windowMs` 0 = legacy immediate `shutdown()`.
   */
  drain(opts?: { windowMs?: number; minMs?: number }): Promise<void>;
  /** serving -> draining -> closing -> exited. */
  phase(): 'serving' | 'draining' | 'closing' | 'exited';
}

/** Wires config -> content -> clock -> match -> rooms -> hub -> http+ws. */
export async function startServer(config: Config, opts: StartOpts = {}): Promise<RunningServer> {
  let phase: 'serving' | 'draining' | 'closing' | 'exited' = 'serving';
  const log = opts.log ?? createLogger({ level: config.logLevel });
  const content = opts.content ?? loadServerContentOrExit(config.contentDir);
  const now = (): number => performance.now();
  const clock = createClock({
    now, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as never),
    log: (ev, f) => log.warn(ev, f),
  });
  const ipLimits = new IpLimits(now);
  const match = createMatchController({ clock, now, log, onAbort: (r) => rooms.drop(r) });
  const rooms = createRoomManager({
    content, clock, now, inputDelay: config.inputDelay, maxRooms: config.maxRooms, ipLimits, log,
    tickOf: (r) => match.inspect(r)?.nextTick, onStart: match.onStart, onStartCancel: (r) => match.cancel(r), onMatchMessage: match.onMessage, onCatchUp: match.catchUp,
    onSeatDisconnect: match.onSeatDisconnect, onSeatReconnect: match.onSeatReconnect, pauseStateOf: match.pauseState, endOf: match.endOf, hasPendingDeadline: match.hasPendingDeadline,
    pausedMsOf: match.pausedMs, seatOut: match.seatOut, onRoomClosed: (r) => match.cancel(r), isDraining: () => phase !== 'serving',
  });
  let drainDeadline: number | undefined;
  const drainRemaining = (): number | undefined => drainDeadline === undefined ? undefined : Math.max(0, Math.round(drainDeadline - now()));
  const hub = createHub({ versions: content.versions, log, handler: rooms, maxConns: config.maxConns, ipLimits, now, drainRemainingMs: drainRemaining });
  clock.start();
  const startedAt = Date.now();

  const http: Server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/healthz') {
      const late = clock.lateness();
      const cpu = process.cpuUsage();
      const body = JSON.stringify({
        ok: true, rooms: rooms.roomCount(), conns: hub.connCount(),
        running: rooms.runningCount(), draining: phase !== 'serving', lateP99Ms: late.p99, lateP50Ms: late.p50,
        rss: process.memoryUsage().rss, cpuMs: Math.round((cpu.user + cpu.system) / 1000),
        uptimeS: Math.floor((Date.now() - startedAt) / 1000),
        versions: { ...content.versions, protocol: PROTOCOL_VERSION },
      });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const wss = new WebSocketServer({
    server: http,
    maxPayload: MAX_PAYLOAD,
    verifyClient: (info, cb) => {
      if (originAllowed(info.origin || undefined, config)) cb(true);
      else { log.warn('ws.origin_refused'); cb(false, 403, 'origin not allowed'); }
    },
  });
  wss.on('connection', (ws, req) => {
    ws.on('error', () => { /* close follows */ });
    hub.accept(wrapWs(ws, clientIp(req)));
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(config.port, config.host, () => { http.off('error', reject); resolve(); });
  });
  http.on('error', (e) => log.error('http.error', { error: e.message }));
  wss.on('error', (e) => log.error('wss.error', { error: e.message }));
  const port = (http.address() as AddressInfo).port;
  log.info('server.listening', { port, host: config.host });

  let closing: Promise<void> | undefined;
  /** Closes rooms (reason), sockets 1001, then http. `graceMs` bounds the wait for clients to close. */
  const closeSequence = (reason: string, graceMs: number): Promise<void> => closing ??= (async () => {
    phase = 'closing';
    log.info('server.shutdown', { reason, rooms: rooms.roomCount(), conns: hub.connCount() });
    const stopped = new Promise<void>((r) => { http.close(() => r()); });
    clock.stop();
    hub.stop();
    rooms.closeAll(reason);
    const gone: Array<Promise<void>> = [];
    for (const c of wss.clients) {
      gone.push(new Promise<void>((r) => { c.once('close', () => r()); }));
      try { c.close(1001, reason); } catch { c.terminate(); }
    }
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((r) => { timer = setTimeout(r, graceMs); });
    await Promise.race([Promise.all(gone), deadline]);
    clearTimeout(timer);
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
    http.closeAllConnections();
    await stopped;
    phase = 'exited';
  })();

  let drainRun: Promise<void> | undefined;
  let endWindow: (() => void) | undefined;
  let pollTimer: NodeJS.Timeout | undefined;
  const shutdown = (graceMs = 6000): Promise<void> => {
    endWindow?.();
    return closeSequence('shutdown', graceMs);
  };
  const drain = (dopts: { windowMs?: number; minMs?: number } = {}): Promise<void> => drainRun ??= (async () => {
    const windowMs = dopts.windowMs ?? config.drainMs;
    if (windowMs <= 0) return shutdown();
    const minMs = Math.min(dopts.minMs ?? DRAIN_MIN_MS, windowMs);
    const t0 = now();
    phase = 'draining';
    drainDeadline = t0 + windowMs;
    hub.broadcast({ t: 'server.draining', deadlineMs: windowMs });
    log.info('server.draining', { windowMs, active: rooms.activeMatchCount(), rooms: rooms.roomCount(), conns: hub.connCount() });
    await new Promise<void>((resolve) => {
      endWindow = resolve;
      pollTimer = setInterval(() => {
        const elapsed = now() - t0;
        if (elapsed >= windowMs || (elapsed >= minMs && rooms.activeMatchCount() === 0)) resolve();
      }, DRAIN_POLL_MS);
      pollTimer.unref();
    });
    clearInterval(pollTimer);
    log.info('server.drain_end', { elapsedMs: Math.round(now() - t0), active: rooms.activeMatchCount() });
    await closeSequence('server-restart', CLOSE_GRACE_MS);
  })();

  return {
    port, content, shutdown, drain, phase: () => phase,
    close: async () => {
      clearInterval(pollTimer);
      clock.stop();
      hub.stop();
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => { http.close(() => r()); http.closeAllConnections(); });
    },
  };
}

function main(): void {
  const log = createLogger();
  const crash = (ev: string) => (e: unknown): void => {
    log.error(ev, { error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    process.exit(1);
  };
  process.on('uncaughtException', crash('uncaught'));
  process.on('unhandledRejection', crash('unhandled_rejection'));
  const config = loadConfigOrExit();
  startServer(config, { log: createLogger({ level: config.logLevel }) }).then((srv) => {
    let once = false;
    const drain = (sig: string): void => {
      if (once) return;
      once = true;
      log.info('server.signal', { signal: sig });
      setTimeout(() => process.exit(1), hardExitMs(config.drainMs)).unref();
      srv.drain().then(() => process.exit(0), crash('shutdown_failed'));
    };
    process.on('SIGTERM', () => drain('SIGTERM'));
    process.on('SIGINT', () => drain('SIGINT'));
  }).catch(crash('boot_failed'));
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) main();
