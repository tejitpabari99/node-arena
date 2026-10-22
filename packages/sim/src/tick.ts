import { PHASES } from '@node-arena/defs';
import type { Command, SimEvent } from '@node-arena/defs';
import { IMPLS, MODULE_ORDER } from './modules/index.js';
import { carriers } from './state.js';
import type { SimState } from './types.js';

/**
 * One tick. `tick` increments first; then PHASES run in order. Core phases (commands, movement, contacts,
 * arrivals, outcome) are empty in this skeleton; module phases run in sorted module-id order.
 */
export function step(state: SimState, _commands: readonly unknown[], events: boolean): SimEvent[] {
  const out: SimEvent[] = [];
  if (state.over) return out;
  state.events = events ? out : null;
  state.tick++;
  for (const phase of PHASES) {
    for (const id of MODULE_ORDER) {
      const fn = IMPLS[id].phases?.[phase];
      if (fn) fn(state, carriers(state.level, id));
    }
  }
  state.events = null;
  return out;
}

export type { Command };
