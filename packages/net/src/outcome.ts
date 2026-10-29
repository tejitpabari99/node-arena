import type { SimView } from '@node-arena/sim';
import type { EndMsg } from './messages.js';

/**
 * Outcome adapter (PRD 02 R10): the ONLY net file that touches SP01 outcome types.
 * Clients display this verbatim; they never derive winners. SP01's names win over the PRD's assumed ones.
 * Wire fields mirror sim pvp `over`: `winner` = lowest winning seat (null on any draw), `winners` = all winning seats.
 * `ranking?` (placements, M2 SP01 Task 11) is deliberately absent until SP01 ships it.
 */
export type WireOutcomeKind = 'victory' | 'timeLimit' | 'draw';
export type EndOutcome = { outcome: WireOutcomeKind; winners: number[]; winner: number | null };

/** The sim's real `view.over` type (not a copy). */
export type SimOver = SimView['over'];

/**
 * Map sim `over` to the wire outcome. Returns `null` (never throws) for a still-running match (`over === null`)
 * and for campaign outcomes ('won' | 'lost' | 'timeout'), which never occur in pvp. Callers treat null as a server bug.
 */
export function toWireOutcome(over: SimOver): EndOutcome | null {
  if (over === null) return null;
  const o = over.outcome;
  if (o !== 'victory' && o !== 'timeLimit' && o !== 'draw') return null;
  return { outcome: o, winners: [...(over.winners ?? [])], winner: over.winner };
}

/** Build the `end` message, or null when `over` is not a pvp outcome. */
export function endMessage(over: SimOver, finalTick: number, finalHash: string): EndMsg | null {
  const outcome = toWireOutcome(over);
  return outcome === null ? null : { t: 'end', outcome, finalTick, finalHash };
}
