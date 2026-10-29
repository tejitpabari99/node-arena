import type { Command } from '@node-arena/defs';
import type { CmdMsg, HashMsg, ServerMessage, TickCmds, WireCommand } from './messages.js';
import { HASH_INTERVAL } from './version.js';

/** One releasable tick: step the sim with `cmds` (sim tick n -> n+1). */
export interface ClientTick { n: number; cmds: Command[] }
export type PushError = 'gap' | 'duplicate' | 'bad-range';
export type PushResult = { ok: true } | { ok: false; reason: PushError };
/** Upper bound on ticks expanded from one `ticks`/`catchup` message (matches CommandLog chunk cap). */
export const MAX_EXPAND_TICKS = 2000;

/**
 * Queue-only lockstep scheduler (PRD 02 R6). Does NOT own or step the Sim; the caller steps it with
 * `drain()` output, then calls `after(n, hash)`. Tick n is the tick stepped FROM sim.view.tick === n,
 * so the first live tick is n=0 and, after stepping tick n, sim.view.tick === n+1.
 * `ticks`/`catchup` cover [from, to) (`to` exclusive), empty ticks expanded. Gap/duplicate sets
 * `needsResync` (never throws); the caller sends `resync`, rebuilds its sim and calls `reset()`.
 */
export class LockstepClient {
  private next: number;
  private queue: ClientTick[] = [];
  private head = 0;
  private resync = false;
  private lastReason: PushError | null = null;

  constructor(startTick = 0) {
    this.next = startTick;
  }

  /** Next tick number expected from the wire. */
  get expected(): number { return this.next; }
  get needsResync(): boolean { return this.resync; }
  get error(): PushError | null { return this.lastReason; }

  /** Ticks received but not yet drained. */
  queued(): number { return this.queue.length - this.head; }

  /** Queue `tick`/`ticks`/`catchup`; other message types are ignored (ok). */
  push(msg: ServerMessage): PushResult {
    if (this.resync) return { ok: false, reason: this.lastReason ?? 'gap' };
    if (msg.t === 'tick') {
      if (!Number.isInteger(msg.n)) return this.fail('bad-range');
      const bad = this.check(msg.n);
      if (bad !== null) return this.fail(bad);
      this.enqueue(msg.n, msg.c ?? []);
      this.next = msg.n + 1;
      return { ok: true };
    }
    if (msg.t === 'ticks' || msg.t === 'catchup') {
      const { from, to } = msg;
      if (!Number.isInteger(from) || !Number.isInteger(to) || to < from || to - from > MAX_EXPAND_TICKS) return this.fail('bad-range');
      if (to === from) return { ok: true };
      const bad = this.check(from);
      if (bad !== null) return this.fail(bad);
      const per: Command[][] = [];
      for (let i = from; i < to; i++) per.push([]);
      for (const e of msg.cmds as TickCmds[]) {
        if (!Number.isInteger(e.tick) || e.tick < from || e.tick >= to) return this.fail('bad-range');
        per[e.tick - from]!.push(e.cmd);
      }
      for (let i = 0; i < per.length; i++) this.enqueue(from + i, per[i]!);
      this.next = to;
      return { ok: true };
    }
    return { ok: true };
  }

  /** Release up to `maxSteps` contiguous ticks, in order; never ahead of what has arrived. */
  drain(maxSteps: number): ClientTick[] {
    if (this.resync || !(maxSteps > 0)) return [];
    // Infinity (or anything >= queued) drains all; avoid `Infinity % 1` = NaN poisoning `head`.
    const take = maxSteps >= this.queued() ? this.queued() : maxSteps - (maxSteps % 1);
    const out = this.queue.slice(this.head, this.head + take);
    this.head += take;
    if (this.head === this.queue.length) { this.queue = []; this.head = 0; }
    return out;
  }

  /**
   * Call after stepping tick `n`. Returns a `hash` message when `(n+1) % HASH_INTERVAL === 0`, with
   * tick = n+1 = sim.view.tick post-step (same as replay checkpoints). `hash` is lazy: only invoked when due.
   */
  after(n: number, hash: () => string): HashMsg | null {
    if ((n + 1) % HASH_INTERVAL !== 0) return null;
    return { t: 'hash', tick: n + 1, h: hash() };
  }

  /** Outgoing command: no tick, no player (server stamps both); no prediction. */
  cmd(c: WireCommand, cid?: number): CmdMsg {
    return cid === undefined ? { t: 'cmd', c } : { t: 'cmd', c, cid };
  }

  /** After a resync/rebuild: drop queue and error state; next expected tick = `startTick` (sim.view.tick). */
  reset(startTick: number): void {
    this.queue = []; this.head = 0; this.next = startTick; this.resync = false; this.lastReason = null;
  }

  private check(first: number): PushError | null {
    if (first < this.next) return 'duplicate';
    if (first > this.next) return 'gap';
    return null;
  }
  private fail(reason: PushError): PushResult {
    this.resync = true; this.lastReason = reason;
    return { ok: false, reason };
  }
  private enqueue(n: number, cmds: Command[]): void { this.queue.push({ n, cmds }); }
}
