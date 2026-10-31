/** Abuse controls (SP04 R17). Pure; time injected (ms). IPs are keys only: never logged or sent. */

export const CONN_RATE_PER_SEC = 40;
export const CONN_BURST = 80;
export const CONN_STRIKES = 3;
export const STRIKE_DECAY_MS = 5000;
export const MAX_CONNS_PER_IP = 8;
export const CREATES_PER_MIN = 5;
export const FAILED_JOINS_PER_MIN = 10;
export const BACKPRESSURE_CLOSE_BYTES = 2 * 1024 * 1024;
export const NEW_CONNS_PER_IP_PER_MIN = 30;
/** Min gap between full-log catch-up attaches (watch / seated reconnect) per player. */
export const CATCHUP_MIN_GAP_MS = 5000;
export const CATCHUPS_PER_IP_PER_MIN = 20;
/** Min gap between client `resync` requests per player id (seat or spectator). */
export const RESYNC_MIN_GAP_MS = 10_000;
export const CLOSE_RATE_LIMITED = 4005;
export const CLOSE_BACKPRESSURE = 4006;

/** Token bucket: `rate` tokens/s, capacity `burst`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(private readonly now: () => number, private readonly rate = CONN_RATE_PER_SEC, private readonly burst = CONN_BURST) {
    this.tokens = burst;
    this.last = now();
  }
  take(): boolean {
    const t = this.now();
    if (t > this.last) { this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate); }
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Per-connection guard: bucket + strikes (rejections close to each other); `verdict` says what to do with a message. */
export class ConnGuard {
  private readonly bucket: TokenBucket;
  private strikes = 0;
  private lastStrike = -Infinity;
  constructor(private readonly now: () => number) { this.bucket = new TokenBucket(now); }
  verdict(): 'ok' | 'rate-limited' | 'close' {
    if (this.bucket.take()) return 'ok';
    const t = this.now();
    if (t - this.lastStrike > STRIKE_DECAY_MS) this.strikes = 0;
    this.lastStrike = t;
    this.strikes++;
    return this.strikes >= CONN_STRIKES ? 'close' : 'rate-limited';
  }
}

class Window {
  private hits: number[] = [];
  constructor(private readonly now: () => number, private readonly cap: number, private readonly spanMs = 60_000) {}
  private prune(): void { const t = this.now(); this.hits = this.hits.filter((h) => t - h < this.spanMs); }
  full(): boolean { this.prune(); return this.hits.length >= this.cap; }
  add(): void { this.prune(); this.hits.push(this.now()); }
  empty(): boolean { this.prune(); return this.hits.length === 0; }
}

/** Per-IP (Fly-Client-IP) limits: open conns, creates/min, failed joins/min. */
export class IpLimits {
  private readonly conns = new Map<string, number>();
  private readonly creates = new Map<string, Window>();
  private readonly fails = new Map<string, Window>();
  private readonly newConns = new Map<string, Window>();
  private readonly catchUpsByIp = new Map<string, Window>();
  private readonly catchUpAt = new Map<string, number>();
  private readonly resyncAt = new Map<string, number>();
  constructor(private readonly now: () => number) {}

  acquireConn(ip: string): boolean {
    const n = this.conns.get(ip) ?? 0;
    if (n >= MAX_CONNS_PER_IP) return false;
    const w = this.win(this.newConns, ip, NEW_CONNS_PER_IP_PER_MIN);
    if (w.full()) return false;
    w.add();
    this.conns.set(ip, n + 1);
    return true;
  }
  releaseConn(ip: string): void {
    const n = (this.conns.get(ip) ?? 0) - 1;
    if (n <= 0) this.conns.delete(ip); else this.conns.set(ip, n);
  }
  /** Counts a create attempt; false = over 5/min. */
  allowCreate(ip: string): boolean {
    const w = this.win(this.creates, ip, CREATES_PER_MIN);
    if (w.full()) return false;
    w.add();
    return true;
  }
  /** Counts a full catch-up attach; false = player attached <5 s ago or IP over 20/min. */
  allowCatchUp(playerId: string, ip: string | undefined): boolean {
    const t = this.now();
    const last = this.catchUpAt.get(playerId);
    if (last !== undefined && t - last < CATCHUP_MIN_GAP_MS) return false;
    const w = ip === undefined ? undefined : this.win(this.catchUpsByIp, ip, CATCHUPS_PER_IP_PER_MIN);
    if (w?.full() === true) return false;
    w?.add();
    if (this.catchUpAt.size > 10_000) for (const [k, v] of this.catchUpAt) if (t - v >= CATCHUP_MIN_GAP_MS) this.catchUpAt.delete(k);
    this.catchUpAt.set(playerId, t);
    return true;
  }
  /** Counts a `resync` request; false = this player resynced <10 s ago. Checked before `allowCatchUp`. */
  allowResync(playerId: string): boolean {
    if (this.resyncBlocked(playerId)) return false;
    this.noteResync(playerId);
    return true;
  }
  /** Peek only: true = this player resynced <10 s ago. Spends nothing. */
  resyncBlocked(playerId: string): boolean {
    const last = this.resyncAt.get(playerId);
    return last !== undefined && this.now() - last < RESYNC_MIN_GAP_MS;
  }
  /** Records an accepted resync (call only after every check passed). */
  noteResync(playerId: string): void {
    const t = this.now();
    if (this.resyncAt.size > 10_000) for (const [k, v] of this.resyncAt) if (t - v >= RESYNC_MIN_GAP_MS) this.resyncAt.delete(k);
    this.resyncAt.set(playerId, t);
  }
  joinBlocked(ip: string): boolean { return this.win(this.fails, ip, FAILED_JOINS_PER_MIN).full(); }
  failedJoin(ip: string): void { this.win(this.fails, ip, FAILED_JOINS_PER_MIN).add(); }

  private win(m: Map<string, Window>, ip: string, cap: number): Window {
    let w = m.get(ip);
    if (w === undefined) {
      if (m.size > 10_000) for (const [k, v] of m) if (v.empty()) m.delete(k);
      w = new Window(this.now, cap);
      m.set(ip, w);
    }
    return w;
  }
}
