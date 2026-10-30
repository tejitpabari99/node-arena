import type { PauseHold, PauseStateMsg } from '@node-arena/net';

/** Authoritative `pause.state` snapshot plus the local receive time (display-only countdown anchor). */
export interface PauseView {
  epoch: number;
  paused: boolean;
  /** Frozen tick (next tick to close). */
  tick: number;
  unlimited: boolean;
  holds: PauseHold[];
  /** Remaining ms per seat at `receivedAt`; null = bot / unlimited. */
  budgets: (number | null)[];
  receivedAt: number;
}

export const toPauseView = (m: PauseStateMsg, receivedAt: number): PauseView => ({
  epoch: m.epoch, paused: m.paused, tick: m.tick, unlimited: m.unlimited,
  holds: m.holds.map((h) => ({ ...h })), budgets: [...m.budgets], receivedAt,
});

/**
 * Estimated remaining ms per seat at `now`: seats holding the pause count down from the snapshot; others stay
 * flat; null stays null. Display only: the server deadline is authoritative.
 */
export function pauseRemaining(p: PauseView | null, now: number): (number | null)[] {
  if (!p) return [];
  const elapsed = Math.max(0, now - p.receivedAt);
  const holding = new Set(p.holds.map((h) => h.player));
  return p.budgets.map((b, i) => (b === null || p.unlimited || !holding.has(i) ? b : Math.max(0, b - elapsed)));
}
