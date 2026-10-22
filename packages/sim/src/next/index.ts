import type { Command, SimEvent } from '@node-arena/defs';
import { hashState } from './hash.js';
import { createView, refreshView, type NextView } from './read.js';
import { createState, assertBindings } from './state.js';
import { step } from './tick.js';
import type { CompiledLevel } from './types.js';

export interface NextSim {
  readonly view: NextView;
  step(commands: readonly Command[], options?: { events?: boolean }): SimEvent[];
  hash(): string;
}

/** Skeleton engine on CompiledLevel (staged beside v1; not exported from the package index until CUT). */
export function create(level: CompiledLevel, seed: number): NextSim {
  assertBindings();
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
  };
}

export { IMPLS } from './modules/index.js';
export type { SimModule, SimState } from './types.js';
export type { NextView } from './read.js';
