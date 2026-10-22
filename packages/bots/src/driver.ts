import type { CompiledLevel, SeatBot } from '@node-arena/content';
import type { Command, Sim } from '@node-arena/sim';
import { guardBotContext, type Bot } from './index.js';
import { createSeatBot } from './seat.js';

export interface BotDriver {
  /** Call before step. Further calls at the same tick emit nothing. */
  commands(sim: Sim): Command[];
}

/**
 * Stand-in for a human seat (R6): default AI, 2000 ms action delay, no script.
 * Seat RNG fork index is the player index, as for level bots.
 */
export const HUMAN_PROXY: SeatBot = Object.freeze({
  kind: 'tw', actionDelayMs: 2000, behavior: 'full', script: Object.freeze([]) as unknown as [],
});

/** One seat bot per `level.bots` entry; every seat is consulted once per tick, in `level.bots` order. */
export function createBotDriver(level: CompiledLevel, matchSeed: number): BotDriver {
  const seats: Bot[] = level.bots.map(({ player, bot }) => createSeatBot(level, matchSeed, player, bot));
  let lastTick = -1;
  return {
    commands(sim) {
      const tick = sim.view.tick;
      if (sim.view.over || tick === lastTick) return [];
      lastTick = tick;
      const context = guardBotContext(sim);
      const out: Command[] = [];
      for (const seat of seats) {
        for (const command of seat.decide(context, tick)) {
          if (command?.player !== seat.player) throw new RangeError('Bot command player does not match seat');
          out.push(command);
        }
      }
      return out;
    },
  };
}
