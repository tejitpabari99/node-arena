import type { Command } from '@node-arena/defs';

/** One logged command; array of these is shape-identical to `ReplayRecord.commands`. */
export interface LogEntry { tick: number; cmd: Command }
/** Sparse chunk covering ticks [from, to) (to exclusive: sim.view.tick === to after stepping it). */
export interface LogChunk { from: number; to: number; cmds: LogEntry[] }
export type AppendResult = { ok: true } | { ok: false; reason: 'tick-cap' | 'cmd-cap' | 'out-of-order' | 'bad-tick' };

export interface CommandLogOptions {
  /** Match length in ticks; hard tick cap is this + `slackTicks`. */
  timeLimitTicks: number;
  slackTicks?: number;
  cmdCap?: number;
  checkpointCap?: number;
}
export const DEFAULT_CMD_CAP = 20000;
export const DEFAULT_CHECKPOINT_CAP = 480;
export const DEFAULT_SLACK_TICKS = 200;
export const MAX_CHUNK_TICKS = 2000;

/** Bounded append-only command log. Never throws on overflow; returns a result. */
export class CommandLog {
  readonly maxTick: number;
  readonly cmdCap: number;
  readonly checkpointCap: number;
  private readonly entries: LogEntry[] = [];
  private readonly checkpoints = new Map<number, string>();

  constructor(opts: CommandLogOptions) {
    this.maxTick = opts.timeLimitTicks + (opts.slackTicks ?? DEFAULT_SLACK_TICKS);
    this.cmdCap = opts.cmdCap ?? DEFAULT_CMD_CAP;
    this.checkpointCap = opts.checkpointCap ?? DEFAULT_CHECKPOINT_CAP;
  }

  get size(): number { return this.entries.length; }

  /** Entries in append order; ticks are non-decreasing. Pass as `ReplayRecord.commands`. */
  get commands(): readonly LogEntry[] { return this.entries; }

  append(tick: number, cmd: Command): AppendResult {
    if (!Number.isInteger(tick) || tick < 0) return { ok: false, reason: 'bad-tick' };
    if (tick >= this.maxTick) return { ok: false, reason: 'tick-cap' };
    if (this.entries.length >= this.cmdCap) return { ok: false, reason: 'cmd-cap' };
    const last = this.entries[this.entries.length - 1];
    if (last !== undefined && tick < last.tick) return { ok: false, reason: 'out-of-order' };
    this.entries.push({ tick, cmd });
    return { ok: true };
  }

  /** Contiguous chunks covering [from, to) with no gap or overlap, each <= maxTicks (clamped to 1..2000). */
  range(from: number, to: number, maxTicks: number = MAX_CHUNK_TICKS): LogChunk[] {
    const span = Math.max(1, Math.min(maxTicks - (maxTicks % 1), MAX_CHUNK_TICKS));
    const chunks: LogChunk[] = [];
    let i = this.lowerBound(from);
    for (let start = from; start < to; start += span) {
      const end = Math.min(start + span, to);
      const cmds: LogEntry[] = [];
      while (i < this.entries.length && this.entries[i]!.tick < end) cmds.push(this.entries[i++]!);
      chunks.push({ from: start, to: end, cmds });
    }
    return chunks;
  }

  /** Store a referee hash. Returns false when the cap is reached (new tick) or inputs are invalid. */
  recordCheckpoint(tick: number, hash: string): boolean {
    if (!Number.isInteger(tick) || tick < 0) return false;
    if (!this.checkpoints.has(tick) && this.checkpoints.size >= this.checkpointCap) return false;
    this.checkpoints.set(tick, hash);
    return true;
  }

  checkpoint(tick: number): string | undefined { return this.checkpoints.get(tick); }
  get checkpointCount(): number { return this.checkpoints.size; }

  private lowerBound(tick: number): number {
    let lo = 0, hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.entries[mid]!.tick < tick) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
}
