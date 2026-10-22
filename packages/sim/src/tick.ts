import { PHASES } from '@node-arena/defs';
import type { Command, SimEvent } from '@node-arena/defs';
import { runCommands } from './commands.js';
import { arrivalPass, contactsPass } from './contacts.js';
import { IMPLS, MODULE_ORDER } from './modules/index.js';
import { carriers } from './state.js';
import type { SimState } from './types.js';

/**
 * One tick. `tick` increments first; then PHASES run in order. Core phases (commands, movement, contacts,
 * arrivals, outcome) are empty in this skeleton; module phases run in sorted module-id order.
 */
export function step(state: SimState, commands: readonly unknown[], events: boolean): SimEvent[] {
  const out: SimEvent[] = [];
  state.events = events ? out : null;
  if (state.over) {
    runCommands(state, commands); // every command is rejected `gameover`; no tick
    state.events = null;
    return out;
  }
  state.tick++;
  for (const phase of PHASES) {
    if (phase === 'commands') runCommands(state, commands);
    if (phase === 'contacts') contactsPass(state); // head-on pass, then the SP04 crossingPass stub
    if (phase === 'arrivals') arrivalPass(state);
    for (const id of MODULE_ORDER) {
      const fn = IMPLS[id].phases?.[phase];
      if (fn) fn(state, carriers(state.level, id));
    }
  }
  state.events = null;
  return out;
}

export type { Command };
