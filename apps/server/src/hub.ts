import { createHmac, randomBytes } from 'node:crypto';
import { checkHello, type ClientMessage, type Versions } from '@node-arena/net';
import { noopAuth, type Auth } from './auth.js';
import { CLOSE_HEARTBEAT, CLOSE_HELLO_TIMEOUT, CLOSE_SERVER_FULL, CLOSE_SUPERSEDED, CLOSE_VERSION, Conn, type Socket } from './conn.js';
import { ConnGuard, type IpLimits } from './limits.js';
import type { Logger } from './log.js';

/** Pluggable room layer (Task 5). Default stub answers every post-hello message with an error. */
export interface HubHandler {
  /** Called after welcome is sent. Return a resume target to be included in the welcome. */
  resume?(conn: Conn): { code: string; seat: number } | undefined;
  onClientMessage(conn: Conn, msg: ClientMessage): void;
  /** Authed conn gone (closed, or superseded). */
  onDisconnect?(conn: Conn, reason: 'closed' | 'superseded'): void;
  /** Called after welcome, once the conn is registered. */
  onAuthed?(conn: Conn): void;
  /** Heartbeat silence detected on an authed conn; called just before it is closed (4004). */
  onHeartbeatTimeout?(conn: Conn): void;
}

export interface HubTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: never) => void;
  /** Optional: heartbeat runs only when provided (default timers provide it). */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: never) => void;
}

export const HEARTBEAT_INTERVAL_MS = 3000;
export const HEARTBEAT_SWEEP_MS = 1000;
export const HEARTBEAT_TIMEOUT_MS = 7000;

export interface HubDeps {
  versions: Versions;
  log?: Logger;
  handler?: HubHandler;
  auth?: Auth;
  /** Server secret for playerId derivation; default 32 random bytes. */
  secret?: Buffer | string;
  timers?: HubTimers;
  maxConns?: number;
  /** Per-IP connection cap; also see room manager for creates / failed joins. */
  ipLimits?: IpLimits;
  /** Real clock (ms) for per-connection buckets. Default performance.now. */
  now?: () => number;
}

export interface Hub {
  accept(socket: Socket): Conn;
  connCount(): number;
  connByPlayer(playerId: string): Conn | undefined;
  /** Stops heartbeat timers. */
  stop(): void;
}

const stubHandler: HubHandler = {
  onClientMessage: (conn) => conn.sendError('internal', 'not supported yet'),
};

export function playerIdFor(secret: Buffer | string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function createHub(deps: HubDeps): Hub {
  const secret = deps.secret ?? randomBytes(32);
  const handler = deps.handler ?? stubHandler;
  const auth = deps.auth ?? noopAuth;
  const log = deps.log;
  const timers: HubTimers = deps.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as never),
    setInterval: (fn, ms) => { const h = setInterval(fn, ms); h.unref(); return h; }, clearInterval: (h) => clearInterval(h as never),
  };
  const maxConns = deps.maxConns ?? Infinity;
  const now = deps.now ?? ((): number => performance.now());
  const conns = new Set<Conn>();
  const byToken = new Map<string, Conn>();
  let seq = 0;

  const beat: unknown[] = [];
  if (timers.setInterval !== undefined) {
    beat.push(timers.setInterval(() => {
      for (const c of [...conns]) if (c.authed && !c.closed) { try { c.socket.ping?.(); } catch { /* dead socket */ } }
    }, HEARTBEAT_INTERVAL_MS));
    beat.push(timers.setInterval(() => {
      const t = now();
      for (const c of [...conns]) {
        if (!c.authed || c.closed || t - c.lastSeen < HEARTBEAT_TIMEOUT_MS) continue;
        log?.info('conn.heartbeat_timeout', { conn: c.id, playerId: c.playerId });
        try { handler.onHeartbeatTimeout?.(c); } catch (e) { log?.error('handler.error', { conn: c.id, error: e instanceof Error ? e.message : String(e) }); }
        c.close(CLOSE_HEARTBEAT, 'heartbeat');
      }
    }, HEARTBEAT_SWEEP_MS));
  }

  const dropped = (conn: Conn): void => {
    conns.delete(conn);
    if (conn.ipHeld && conn.ip !== undefined) { conn.ipHeld = false; deps.ipLimits?.releaseConn(conn.ip); }
    if (conn.token !== undefined && byToken.get(conn.token) === conn) {
      byToken.delete(conn.token);
      log?.info('conn.close', { conn: conn.id, playerId: conn.playerId });
      handler.onDisconnect?.(conn, 'closed');
    }
  };

  const hello = (conn: Conn, msg: Extract<ClientMessage, { t: 'hello' }>): void => {
    const playerId = playerIdFor(secret, msg.token);
    const verdict = auth.verify(msg.auth);
    if (verdict === null) {
      conn.sendError('not-authed');
      conn.close(CLOSE_VERSION, 'auth');
      return;
    }
    const probe = checkHello(msg, deps.versions, {
      playerId,
      onBotMismatch: (c, s) => log?.warn('hello.bot_mismatch', { client: c, server: s }),
    });
    if (!probe.ok) {
      log?.info('hello.refused', { conn: conn.id, code: probe.error.code });
      conn.send(probe.error);
      conn.close(CLOSE_VERSION, 'version');
      return;
    }
    const old = byToken.get(msg.token);
    if (old !== undefined && old !== conn) {
      byToken.delete(msg.token);
      log?.info('conn.superseded', { conn: old.id, by: conn.id, playerId });
      old.close(CLOSE_SUPERSEDED, 'superseded');
      handler.onDisconnect?.(old, 'superseded');
    }
    conn.playerId = playerId;
    conn.nick = msg.nick;
    conn.token = msg.token;
    if (verdict.uid !== undefined) conn.uid = verdict.uid;
    conn.helloDone();
    byToken.set(msg.token, conn);
    const resume = handler.resume?.(conn);
    const res = resume === undefined ? probe : checkHello(msg, deps.versions, { playerId, resume });
    if (!res.ok) return;
    conn.send(res.welcome);
    log?.info('hello.ok', { conn: conn.id, playerId });
    handler.onAuthed?.(conn);
  };

  return {
    accept(socket) {
      const id = ++seq;
      const conn: Conn = new Conn(
        id,
        socket,
        {
          onHello: hello,
          onMessage: (c, m) => {
            try { handler.onClientMessage(c, m); } catch (e) {
              log?.error('handler.error', { conn: c.id, error: e instanceof Error ? e.message : String(e) });
              c.sendError('internal');
            }
          },
          onClose: dropped,
        },
        timers,
        () => {
          log?.info('hello.timeout', { conn: id });
          conn.close(CLOSE_HELLO_TIMEOUT, 'hello timeout');
        },
      );
      if (conns.size >= maxConns) {
        log?.warn('conn.rejected_full', { conn: id });
        conn.close(CLOSE_SERVER_FULL, 'server full');
        return conn;
      }
      if (deps.ipLimits !== undefined && conn.ip !== undefined) {
        if (!deps.ipLimits.acquireConn(conn.ip)) {
          log?.warn('conn.rejected_ip', { conn: id });
          conn.close(CLOSE_SERVER_FULL, 'too many connections');
          return conn;
        }
        conn.ipHeld = true;
      }
      conn.guard = new ConnGuard(now);
      conn.clock = now;
      conn.lastSeen = now();
      conns.add(conn);
      return conn;
    },
    connCount: () => conns.size,
    stop() { for (const h of beat) timers.clearInterval?.(h as never); beat.length = 0; },
    connByPlayer(playerId) {
      for (const c of byToken.values()) if (c.playerId === playerId) return c;
      return undefined;
    },
  };
}
