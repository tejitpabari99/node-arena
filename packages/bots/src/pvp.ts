import type { CompiledLevel, SeatBot } from '@node-arena/content';
import type { Command, Sim } from '@node-arena/sim';
import { guardBotContext, type Bot } from './index.js';
import { createSeatBot } from './seat.js';

export interface SeatDriver {
  /** Replace (fresh bot, timer 0) or clear (null) a seat's bot. */
  setBot(seat: number, bot: SeatBot | null): void;
  has(seat: number): boolean;
  /** Call before step. Seats consulted in ascending order; same-tick re-calls emit nothing. */
  commands(sim: Sim): Command[];
}

/** Dynamic per-seat bot driver for pvp levels (no `level.bots`). Seat RNG fork = seat index. */
export function createSeatDriver(level: CompiledLevel, matchSeed: number): SeatDriver {
  const seats = new Map<number, Bot>();
  let lastTick = -1;
  return {
    setBot(seat, bot) {
      if (!Number.isInteger(seat) || seat < 0 || seat >= level.players.length) throw new RangeError(`Seat out of range: ${seat}`);
      if (bot === null) seats.delete(seat);
      else seats.set(seat, createSeatBot(level, matchSeed, seat, bot));
    },
    has: seat => seats.has(seat),
    commands(sim) {
      const tick = sim.view.tick;
      if (sim.view.over || tick === lastTick) return [];
      lastTick = tick;
      const context = guardBotContext(sim);
      const out: Command[] = [];
      for (const seat of [...seats.keys()].sort((a, b) => a - b)) {
        const bot = seats.get(seat)!;
        for (const command of bot.decide(context, tick)) {
          if (command?.player !== seat) throw new RangeError('Bot command player does not match seat');
          out.push(command);
        }
      }
      return out;
    },
  };
}
