import type { Command } from '@node-arena/defs';
import type { CommandLog } from './log.js';
import type { TicksMsg, TickMsg } from './messages.js';

/** Suggested `bufferedAmount` threshold (bytes) above which the caller marks a socket as lagging (PRD 02 R11). */
export const LAG_BUFFER_BYTES = 256 * 1024;

/**
 * Per-client delivery cursor (PRD 02 R11). The caller decides `lagging` (e.g. `ws.bufferedAmount > LAG_BUFFER_BYTES`)
 * and calls `deliver` once per closed tick (after `LockstepServer.closeTick` logged it). While lagging nothing is
 * sent; on the first non-lagging call the missed ticks plus the current one go out as gap-free `ticks` batch(es)
 * built from the CommandLog, then live `tick`s resume. State is per client, so other clients are unaffected.
 */
export class LagFeed {
  private nextTick: number;

  constructor(private readonly log: CommandLog, startTick = 0) {
    this.nextTick = startTick;
  }

  /** Next tick this client has not been sent. */
  get next(): number { return this.nextTick; }

  /** Messages to send for closed tick `n` (cmds `c`); `n` must be >= `next`. */
  deliver(n: number, c: readonly Command[], lagging: boolean): (TickMsg | TicksMsg)[] {
    if (n < this.nextTick || lagging) return [];
    if (n === this.nextTick) {
      this.nextTick = n + 1;
      return [c.length > 0 ? { t: 'tick', n, c: [...c] } : { t: 'tick', n }];
    }
    const out: TicksMsg[] = this.log.range(this.nextTick, n + 1).map((ch) => ({ t: 'ticks', from: ch.from, to: ch.to, cmds: ch.cmds }));
    this.nextTick = n + 1;
    return out;
  }
}
