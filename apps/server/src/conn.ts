import { encode, parseClientMessage, type ClientMessage, type ErrorCode, type ServerMessage } from '@node-arena/net';

import { CLOSE_RATE_LIMITED, type ConnGuard } from './limits.js';

/** Transport-agnostic socket. `main.ts` wraps `ws` into this (Task 7). */
export interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(cb: (data: string | Uint8Array) => void): void;
  onClose(cb: () => void): void;
  readonly bufferedAmount: number;
  /** Peer address (Fly-Client-IP); abuse-limit key only, never logged. */
  readonly ip?: string;
}

export const CLOSE_SUPERSEDED = 4000;
export const CLOSE_HELLO_TIMEOUT = 4001;
export const CLOSE_PROTOCOL = 4002;
export const CLOSE_VERSION = 4003;
export const CLOSE_SERVER_FULL = 1013;
export const HELLO_DEADLINE_MS = 5000;

export interface ConnHooks {
  /** Pre-hello: only a `hello` reaches here. */
  onHello(conn: Conn, msg: Extract<ClientMessage, { t: 'hello' }>): void;
  onMessage(conn: Conn, msg: ClientMessage): void;
  onClose(conn: Conn): void;
}

/** One live connection. `token` is held only for the hub index; never logged or sent. */
export class Conn {
  playerId: string | undefined;
  nick = '';
  /** Secret: hub index key only. */
  token: string | undefined;
  uid: string | undefined;
  closed = false;
  /** Set by the hub: per-connection token bucket + strikes. */
  guard: ConnGuard | undefined;
  /** True while this conn holds a per-IP connection slot (hub bookkeeping). */
  ipHeld = false;
  private timer: unknown;

  constructor(
    readonly id: number,
    readonly socket: Socket,
    private readonly hooks: ConnHooks,
    private readonly timers: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (h: never) => void },
    onDeadline: () => void,
  ) {
    this.timer = timers.setTimeout(onDeadline, HELLO_DEADLINE_MS);
    socket.onMessage((d) => this.receive(d));
    socket.onClose(() => this.handleClose());
  }

  get ip(): string | undefined { return this.socket.ip; }

  get authed(): boolean { return this.playerId !== undefined; }

  send(msg: ServerMessage): void {
    if (this.closed) return;
    this.socket.send(encode(msg));
  }

  /** Pre-encoded frame (shared across recipients, e.g. tick). */
  sendFrame(raw: string): void {
    if (this.closed) return;
    this.socket.send(raw);
  }

  sendError(code: ErrorCode, detail?: string): void {
    this.send(detail === undefined ? { t: 'error', code } : { t: 'error', code, detail });
  }

  helloDone(): void {
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer as never);
    this.timer = undefined;
  }

  close(code: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.helloDone();
    try { this.socket.close(code, reason); } catch { /* socket already dead */ }
    this.hooks.onClose(this);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.helloDone();
    this.hooks.onClose(this);
  }

  private receive(data: string | Uint8Array): void {
    if (this.closed) return;
    try {
      const raw = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const r = parseClientMessage(raw);
      if (!r.ok) {
        if (r.ignorable === true) return;
        this.sendError(r.code);
        if (!this.authed) this.close(CLOSE_PROTOCOL, 'protocol');
        return;
      }
      if (!this.authed) {
        if (r.msg.t !== 'hello') { this.sendError('not-authed'); this.close(CLOSE_PROTOCOL, 'hello required'); return; }
        this.hooks.onHello(this, r.msg);
        return;
      }
      const g = this.guard?.verdict() ?? 'ok';
      if (g !== 'ok') {
        this.sendError('rate-limited');
        if (g === 'close') this.close(CLOSE_RATE_LIMITED, 'rate limited');
        return;
      }
      if (r.msg.t === 'hello') { this.sendError('bad-message', 'already authed'); return; }
      this.hooks.onMessage(this, r.msg);
    } catch {
      this.sendError('internal');
    }
  }
}
