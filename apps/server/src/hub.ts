import { createHmac, randomBytes } from 'node:crypto';
import { checkHello, type ClientMessage, type Versions } from '@node-arena/net';
import { noopAuth, type Auth } from './auth.js';
import { CLOSE_HELLO_TIMEOUT, CLOSE_SERVER_FULL, CLOSE_SUPERSEDED, CLOSE_VERSION, Conn, type Socket } from './conn.js';
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
}

export interface HubTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: never) => void;
}

export interface HubDeps {
  versions: Versions;
  log?: Logger;
  handler?: HubHandler;
  auth?: Auth;
  /** Server secret for playerId derivation; default 32 random bytes. */
  secret?: Buffer | string;
  timers?: HubTimers;
  maxConns?: number;
}

export interface Hub {
  accept(socket: Socket): Conn;
  connCount(): number;
  connByPlayer(playerId: string): Conn | undefined;
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
  const timers: HubTimers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as never) };
  const maxConns = deps.maxConns ?? Infinity;
  const conns = new Set<Conn>();
  const byToken = new Map<string, Conn>();
  let seq = 0;

  const dropped = (conn: Conn): void => {
    conns.delete(conn);
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
      conns.add(conn);
      return conn;
    },
    connCount: () => conns.size,
    connByPlayer(playerId) {
      for (const c of byToken.values()) if (c.playerId === playerId) return c;
      return undefined;
    },
  };
}
