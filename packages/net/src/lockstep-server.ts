import type { Command } from '@node-arena/defs';
import { CommandLog, type AppendResult, type CommandLogOptions } from './log.js';
import type { DesyncMsg, ErrorCode, SeatKind } from './messages.js';
import { MAX_INT } from './validate.js';
import { RateLimiter, type RateAdvice, type RateLimits } from './ratelimit.js';

/** Default and allowed input delay in ticks (PRD 02 R4). */
export const DEFAULT_INPUT_DELAY = 3;
export const MIN_INPUT_DELAY = 1;
export const MAX_INPUT_DELAY = 10;

export interface LockstepServerOptions {
  /** Seat kind per player index. Only 'human' seats may submit; bot cmds arrive via `closeTick`. */
  seats: readonly SeatKind[];
  inputDelay?: number;
  /** Command `from`/`to` must be `< buildingCount`. */
  buildingCount: number;
  log: CommandLogOptions;
  /** Injected clock (ms) for rate limiting; default is tick-derived (nextTick * 50), so it is deterministic and clock-free. */
  now?: () => number;
  rateLimits?: Partial<RateLimits>;
}

export type SubmitResult = { accepted: true; tick: number } | { accepted: false; rejected: ErrorCode; advice?: RateAdvice };
export type DropReason = Extract<AppendResult, { ok: false }>['reason'];
export type HashResult = { result: 'ok' } | { result: 'pending' } | { result: 'rate-limited'; advice: RateAdvice } | { result: 'desync'; msg: DesyncMsg };

/**
 * Pure, timer-free tick scheduler (PRD 02 R4/R5/R8/R10). The caller owns the clock: call `closeTick` once per
 * 20 Hz tick, step the referee with the returned `cmds`, and broadcast the same array.
 */
export class LockstepServer {
  readonly log: CommandLog;
  readonly inputDelay: number;
  readonly buildingCount: number;
  /** Shared per-seat bucket set; SP07 pause/resume/quit/ping call `limiter.hit(seat, 'control'|'ping')`. */
  readonly limiter: RateLimiter;
  private readonly seats: readonly SeatKind[];
  private readonly buffer = new Map<number, Command[]>();
  private pending = 0;
  private next = 0;

  constructor(opts: LockstepServerOptions) {
    const d = opts.inputDelay ?? DEFAULT_INPUT_DELAY;
    if (!Number.isInteger(d) || d < MIN_INPUT_DELAY || d > MAX_INPUT_DELAY) throw new RangeError(`inputDelay ${d} out of range 1..10`);
    if (!Number.isInteger(opts.buildingCount) || opts.buildingCount < 1) throw new RangeError('buildingCount must be >= 1');
    this.inputDelay = d;
    this.buildingCount = opts.buildingCount;
    this.seats = opts.seats.slice();
    this.log = new CommandLog(opts.log);
    this.limiter = new RateLimiter(opts.now ?? (() => this.next * 50), opts.rateLimits);
  }

  /** Next tick `closeTick` will produce (0 before the first). */
  get nextTick(): number { return this.next; }

  /**
   * `player`: sender's seat index resolved by the caller from the connection (null/spectator -> not-your-seat).
   * `cmd`: untrusted wire command; must be exactly {type,from,to} (an injected `player` is rejected).
   */
  submit(player: number | null, cmd: unknown): SubmitResult {
    if (player === null || !Number.isInteger(player) || this.seats[player] !== 'human') return { accepted: false, rejected: 'not-your-seat' };
    // Counted before validation: malformed / out-of-range cmds also burn budget.
    const tick = this.next + this.inputDelay;
    const v = this.limiter.hit(player, 'cmd', tick);
    if (!v.ok) return { accepted: false, rejected: 'rate-limited', advice: v.advice };
    const c = this.validate(cmd);
    if (c === null) return { accepted: false, rejected: 'bad-message' };
    // Bound memory: buffered + logged entries may never exceed the log's cmd cap; ticks past the log cap are refused.
    if (this.log.size + this.pending >= this.log.cmdCap || tick >= this.log.maxTick) return { accepted: false, rejected: 'rate-limited' };
    const full = { type: c.type, player, from: c.from, to: c.to } as Command;
    let q = this.buffer.get(tick);
    if (q === undefined) { q = []; this.buffer.set(tick, q); }
    q.push(full);
    this.pending++;
    return { accepted: true, tick };
  }

  /**
   * Close tick `nextTick`: buffered human cmds (arrival order) then `botCmds` (already player-stamped, they land on
   * this tick with no delay). Only cmds that were logged are returned, so the log, the referee and every client
   * always see the identical array. Advances `nextTick`. `dropped` counts cmds the log refused (`firstDrop` = first
   * reason); non-zero means the log is saturated and the caller (SP04) should abort the room.
   */
  closeTick(botCmds: readonly Command[] = []): { n: number; cmds: Command[]; dropped: number; firstDrop?: DropReason } {
    const n = this.next;
    const humans = this.buffer.get(n) ?? [];
    this.buffer.delete(n);
    this.pending -= humans.length;
    const cmds: Command[] = [];
    let dropped = 0;
    let firstDrop: DropReason | undefined;
    for (const cmd of [...humans, ...botCmds]) {
      const r = this.log.append(n, cmd);
      if (r.ok) cmds.push(cmd);
      else { dropped++; if (firstDrop === undefined) firstDrop = r.reason; }
    }
    this.next = n + 1;
    return firstDrop === undefined ? { n, cmds, dropped } : { n, cmds, dropped, firstDrop };
  }

  /** Referee hash after stepping, `tick` = sim.view.tick (same semantics as client `hash` msgs). */
  recordCheckpoint(tick: number, hash: string): boolean { return this.log.recordCheckpoint(tick, hash); }

  /**
   * Compare a client hash with the referee checkpoint. 'pending' = referee checkpoint for `tick` not recorded yet
   * (client ahead of the referee or evicted by cap): not a failure, caller may retry after the next recordCheckpoint
   * or ignore. Mismatch -> `{t:'desync', tick, serverHash}`.
   */
  onHash(player: number, tick: number, h: string): HashResult {
    const v = this.limiter.hit(player, 'hash');
    if (!v.ok) return { result: 'rate-limited', advice: v.advice };
    const server = this.log.checkpoint(tick);
    if (server === undefined) return { result: 'pending' };
    return server === h ? { result: 'ok' } : { result: 'desync', msg: { t: 'desync', tick, serverHash: server } };
  }

  private validate(cmd: unknown): { type: 'DrawLine' | 'CutLine'; from: number; to: number } | null {
    if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return null;
    const o = cmd as Record<string, unknown>;
    for (const k of Object.keys(o)) if (k !== 'type' && k !== 'from' && k !== 'to') return null;
    const { type, from, to } = o;
    if (type !== 'DrawLine' && type !== 'CutLine') return null;
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_INT && v < this.buildingCount;
    if (!ok(from) || !ok(to)) return null;
    return { type, from, to };
  }
}
