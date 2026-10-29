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
}

/** Wires config -> content -> clock -> match -> rooms -> hub -> http+ws. */
export async function startServer(config: Config, opts: StartOpts = {}): Promise<RunningServer> {
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
    onStart: match.onStart, onMatchMessage: match.onMessage, onCatchUp: match.catchUp,
  });
  const hub = createHub({ versions: content.versions, log, handler: rooms, maxConns: config.maxConns, ipLimits, now });
  clock.start();
  const startedAt = Date.now();

  const http: Server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/healthz') {
      const body = JSON.stringify({
        ok: true, rooms: rooms.roomCount(), conns: hub.connCount(),
        running: rooms.runningCount(), lateP99Ms: clock.lateness().p99,
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

  return {
    port, content,
    close: async () => {
      clock.stop();
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
  startServer(config, { log: createLogger({ level: config.logLevel }) }).catch(crash('boot_failed'));
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) main();
