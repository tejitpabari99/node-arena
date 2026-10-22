import type { Command, RejectReason, SimEvent } from '@node-arena/defs';
import { canDraw } from './commands.js';
import { hashState } from './hash.js';
import { createView, readTroops, refreshView, snapshotState, type SimSnapshot, type SimView, type TroopBuffer } from './read.js';
import { explainDraw } from './modules/blocksLines.js';
import { towerRadiusMilli } from './modules/shoots.js';
import { createState } from './state.js';
import { step } from './tick.js';
import type { CompiledLevel, DrawExplanation } from './types.js';

export interface Sim {
  readonly view: SimView;
  step(commands: readonly Command[], options?: { events?: boolean }): SimEvent[];
  hash(): string;
  /** Reject code `DrawLine` would give now, or null. Never throws; any input type. */
  canDraw(player: unknown, from: unknown, to: unknown): RejectReason | null;
  /** Blocker detail for a rejected draw (red preview): `{reason, point, ref}` or null. SP04 fills; null until then. Never throws. */
  explainDraw(player: unknown, from: unknown, to: unknown): DrawExplanation | null;
  /** Tower attack radius in milli world units at its current stage (R-TWR-01). 0 until SP04. */
  towerRadiusMilli(view: SimView, building: number): number;
  /** Fill `buf` with in-flight troops; returns rows written. See `readTroops`. */
  readTroops(buf: TroopBuffer): number;
  snapshot(): SimSnapshot;
}

/** Engine on CompiledLevel (skeleton: phases fill in with SP03/SP04). */
export function create(level: CompiledLevel, seed: number): Sim {
  const state = createState(level, seed);
  const view = createView(state);
  refreshView(view, state);
  return {
    view,
    step(commands, options) {
      const out = step(state, commands, options?.events === true);
      refreshView(view, state);
      return out;
    },
    hash: () => hashState(state),
    canDraw: (player, from, to) => canDraw(state, player, from, to),
    explainDraw: (player, from, to) => explainDraw(state, player, from, to),
    towerRadiusMilli: (_view, building) => towerRadiusMilli(state, building),
    readTroops: (buf) => readTroops(state, buf),
    snapshot: () => snapshotState(state),
  };
}
