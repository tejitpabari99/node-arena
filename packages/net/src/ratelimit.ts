/**
 * Per-connection abuse limiter (PRD 02 R9; SP07 control messages share the same bucket set).
 * Pure: time is injected via `now` (ms). Fixed 1 s windows per (key, kind); `cmd` additionally has a per-tick cap.
 */
export type LimitKind = 'cmd' | 'hash' | 'ping' | 'control';
/** 'error' = reply `rate-limited`; 'disconnect' = abuse persisted, caller should drop the connection. */
export type RateAdvice = 'error' | 'disconnect';
export type RateVerdict = { ok: true } | { ok: false; advice: RateAdvice };

export interface RateLimits {
  cmdsPerTick: number;
  cmdsPerSec: number;
  hashPerSec: number;
  pingPerSec: number;
  /** pause / resume / quit (SP07). */
  controlPerSec: number;
  /** Rejections (within `violationDecayMs` of each other) before advice becomes 'disconnect'. */
  disconnectAfter: number;
  violationDecayMs: number;
}

export const DEFAULT_RATE_LIMITS: Readonly<RateLimits> = {
  cmdsPerTick: 8,
  cmdsPerSec: 20,
  hashPerSec: 4,
  pingPerSec: 5,
  controlPerSec: 5,
  disconnectAfter: 30,
  violationDecayMs: 5000,
};

interface Win { start: number; n: number }
interface Entry { win: Partial<Record<LimitKind, Win>>; tick: number; tickN: number; violations: number; lastViolation: number }

const WINDOW_MS = 1000;

export class RateLimiter {
  readonly limits: Readonly<RateLimits>;
  private readonly now: () => number;
  private readonly entries = new Map<number | string, Entry>();

  constructor(now: () => number, limits: Partial<RateLimits> = {}) {
    this.now = now;
    this.limits = { ...DEFAULT_RATE_LIMITS, ...limits };
  }

  /**
   * Count one event for `key` (seat or connection id). `tick` is the tick a `cmd` is stamped for (per-tick cap);
   * rejected events still count toward escalation, never toward the windows.
   */
  hit(key: number | string, kind: LimitKind, tick?: number): RateVerdict {
    const t = this.now();
    let e = this.entries.get(key);
    if (e === undefined) { e = { win: {}, tick: -1, tickN: 0, violations: 0, lastViolation: -Infinity }; this.entries.set(key, e); }
    const cap = this.cap(kind);
    let w = e.win[kind];
    if (w === undefined || t - w.start >= WINDOW_MS || t < w.start) { w = { start: t, n: 0 }; e.win[kind] = w; }
    let over = w.n >= cap;
    if (kind === 'cmd' && tick !== undefined) {
      if (e.tick !== tick) { e.tick = tick; e.tickN = 0; }
      if (e.tickN >= this.limits.cmdsPerTick) over = true;
    }
    if (over) {
      if (t - e.lastViolation > this.limits.violationDecayMs) e.violations = 0;
      e.violations++;
      e.lastViolation = t;
      return { ok: false, advice: e.violations >= this.limits.disconnectAfter ? 'disconnect' : 'error' };
    }
    w.n++;
    if (kind === 'cmd' && tick !== undefined) e.tickN++;
    return { ok: true };
  }

  reset(key: number | string): void { this.entries.delete(key); }

  private cap(kind: LimitKind): number {
    switch (kind) {
      case 'cmd': return this.limits.cmdsPerSec;
      case 'hash': return this.limits.hashPerSec;
      case 'ping': return this.limits.pingPerSec;
      case 'control': return this.limits.controlPerSec;
    }
  }
}
