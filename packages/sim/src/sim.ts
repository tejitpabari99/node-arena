import type { Command, SimEvent } from '@node-arena/defs';
import { hashState } from './hash.js';
import { createView, refreshView, type SimView } from './read.js';
import { createState } from './state.js';
import { step } from './tick.js';
import type { CompiledLevel } from './types.js';

export interface Sim {
  readonly view: SimView;
  step(commands: readonly Command[], options?: { events?: boolean }): SimEvent[];
  hash(): string;
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
  };
}
