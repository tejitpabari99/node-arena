import { PROTOCOL_VERSION, encode, parseServerMessage, type ClientMessage, type ServerMessage, type Versions } from '@node-arena/net';

export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'lost' | 'refused' | 'superseded';

export interface WebSocketLike {
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
export const JITTER = 0.2;
export const GIVE_UP_MS = 60_000;
export const CLOSE_SUPERSEDED = 4000;
export const CLOSE_VERSION = 4003;
/** Server closes a seated reconnect that asks for a full catch-up again within CATCHUP_MIN_GAP_MS (server limits.ts). Retryable. */
export const CLOSE_RATE_LIMITED = 4005;
export const CATCHUP_MIN_GAP_MS = 5000;
/** Reconnect after a 4005 waits at least this long so the next catch-up is allowed. */
export const RATE_LIMITED_MIN_DELAY_MS = CATCHUP_MIN_GAP_MS + 500;
/** Backoff attempt/outage counters reset only after a connection stays welcomed this long (welcome precedes a rate-limit close). */
export const STABLE_MS = 10_000;
/** App-level `ping` cadence while connected (server also pongs; refreshes its lastSeen when WS ping frames are not relayed). */
export const PING_INTERVAL_MS = 3000;

export interface PvpConnectionOpts {
  url: string;
  nick: string;
  token: string;
  versions: Versions;
  createSocket: (url: string) => WebSocketLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  rand?: () => number;
  now?: () => number;
}

/** Client-local backoff state for the banner (not wire). */
export interface ConnInfo {
  /** Reconnect attempts scheduled in the current outage (0 once stable). */
  attempt: number;
  /** Absolute `now()` ms of the pending reconnect, null when none is scheduled. */
  nextRetryAt: number | null;
  outageStartedAt: number | null;
  /** Close code of the most recent socket close, null before any. */
  lastCloseCode: number | null;
}

export interface PvpConnection {
  readonly state: ConnState;
  /** Current backoff info; already updated when `onState` callbacks run. */
  readonly info: ConnInfo;
  send(msg: ClientMessage): boolean;
  onMessage(cb: (msg: ServerMessage) => void): () => void;
  onState(cb: (state: ConnState) => void): () => void;
  retry(): void;
  close(): void;
}

/** Backoff delay for 0-based attempt with jitter in [-20%, +20%]; `r` in [0,1). */
export function backoffDelay(attempt: number, r: number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
  return Math.round(base * (1 + (r * 2 - 1) * JITTER));
}

export function createPvpConnection(o: PvpConnectionOpts): PvpConnection {
  const setT = o.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearT = o.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>));
  const rand = o.rand ?? Math.random;
  const now = o.now ?? Date.now;
  const msgCbs = new Set<(m: ServerMessage) => void>();
  const stateCbs = new Set<(s: ConnState) => void>();
  let state: ConnState = 'connecting';
  let sock: WebSocketLike | null = null;
  let timer: unknown = null;
  let attempt = 0;
  let outageStart: number | null = null;
  let closed = false;
  let pingTimer: unknown = null;
  let pingId = 0;
  let stableTimer: unknown = null;
  let rateLimited = false;
  let nextRetryAt: number | null = null;
  let lastCloseCode: number | null = null;

  /** `force` re-notifies on an unchanged state so subscribers re-read `info` (e.g. reconnect attempt counter). */
  const setState = (s: ConnState, force = false) => {
    if (state === s && !force) return;
    state = s;
    for (const cb of [...stateCbs]) cb(s);
  };
  const stopPing = () => { if (pingTimer !== null) { clearT(pingTimer); pingTimer = null; } };
  const schedulePing = (s: WebSocketLike) => {
    pingTimer = setT(() => {
      pingTimer = null;
      if (sock !== s || state !== 'connected') return;
      try { s.send(encode({ t: 'ping', id: ++pingId })); } catch { /* close follows */ }
      schedulePing(s);
    }, PING_INTERVAL_MS);
  };
  const stopStable = () => { if (stableTimer !== null) { clearT(stableTimer); stableTimer = null; } };
  const detach = (s: WebSocketLike) => { s.onopen = s.onmessage = s.onclose = s.onerror = null; };
  const terminal = (s: ConnState) => {
    if (timer !== null) { clearT(timer); timer = null; }
    stopPing();
    stopStable();
    if (sock) { const old = sock; sock = null; detach(old); try { old.close(); } catch { /* ignore */ } }
    setState(s);
  };

  const open = () => {
    timer = null;
    nextRetryAt = null;
    const s = o.createSocket(o.url);
    sock = s;
    s.onopen = () => {
      if (sock !== s) return;
      setState('connected');
      s.send(encode({ t: 'hello', pv: PROTOCOL_VERSION, versions: o.versions, nick: o.nick, token: o.token }));
      stopPing();
      schedulePing(s);
    };
    s.onmessage = (ev) => {
      if (sock !== s) return;
      const r = parseServerMessage(ev.data);
      if (!r.ok) return;
      const m = r.msg;
      if (m.t === 'welcome') {
        stopStable();
        stableTimer = setT(() => { stableTimer = null; if (sock === s) { attempt = 0; outageStart = null; } }, STABLE_MS);
      }
      if (m.t === 'error' && m.code === 'version-mismatch') { terminal('refused'); return; }
      for (const cb of [...msgCbs]) cb(m);
    };
    s.onerror = () => { /* close follows */ };
    s.onclose = (ev) => {
      if (sock !== s) return;
      sock = null;
      stopPing();
      stopStable();
      lastCloseCode = ev.code;
      rateLimited = ev.code === CLOSE_RATE_LIMITED;
      if (ev.code === CLOSE_SUPERSEDED) { setState('superseded'); return; }
      if (ev.code === CLOSE_VERSION) { setState('refused'); return; }
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const t = now();
    if (outageStart === null) outageStart = t;
    let delay = backoffDelay(attempt, rand());
    if (rateLimited) delay = Math.max(delay, RATE_LIMITED_MIN_DELAY_MS);
    rateLimited = false;
    if (t - outageStart + delay > GIVE_UP_MS) { nextRetryAt = null; setState('lost'); return; }
    attempt++;
    nextRetryAt = t + delay;
    setState('reconnecting', true);
    timer = setT(open, delay);
  };

  open();

  return {
    get state() { return state; },
    get info() { return { attempt, nextRetryAt, outageStartedAt: outageStart, lastCloseCode }; },
    send(msg) {
      if (state !== 'connected' || !sock) return false;
      try { sock.send(encode(msg)); return true; } catch { return false; }
    },
    onMessage(cb) { msgCbs.add(cb); return () => { msgCbs.delete(cb); }; },
    onState(cb) { stateCbs.add(cb); return () => { stateCbs.delete(cb); }; },
    retry() {
      if (closed || state !== 'lost') return;
      attempt = 0; outageStart = null;
      setState('connecting');
      open();
    },
    close() {
      closed = true;
      nextRetryAt = null;
    terminal(state);
    },
  };
}
