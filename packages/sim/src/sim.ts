import type { Command, RejectReason, SimEvent } from '@node-arena/defs';
import { canDraw } from './commands.js';
import { hashState } from './hash.js';
import { createView, readTroops, refreshView, snapshotState, type SimSnapshot, type SimView, type TroopBuffer } from './read.js';
import { createState } from './state.js';
import { step } from './tick.js';
import type { CompiledLevel } from './types.js';

export interface Sim {
  readonly view: SimView;
  step(commands: readonly Command[], options?: { events?: boolean }): SimEvent[];
  hash(): string;
  /** Reject code `DrawLine` would give now, or null. Never throws; any input type. */
  canDraw(player: unknown, from: unknown, to: unknown): RejectReason | null;
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
    readTroops: (buf) => readTroops(state, buf),
    snapshot: () => snapshotState(state),
  };
}
