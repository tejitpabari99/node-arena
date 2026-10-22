import { createStreams, type Command } from '@node-arena/sim';
import type { CompiledLevel, SeatBot } from '@node-arena/content';
import type { Bot, BotContext } from './index.js';
import { decideDefault, type DefaultState, type SeatRng } from './tw-ai.js';

export interface SeatState extends DefaultState {
  /** True once the script queue is exhausted (default AI then runs forever). */
  scriptDone: boolean;
}

/**
 * Script hook (Task 3 supplies the interpreter). Returns commands while the queue is active,
 * or null once it is exhausted; the seat then hands off to the default AI with `timer = 0`.
 */
export type ScriptRunner = (ctx: BotContext, tick: number, me: number, rng: SeatRng) => Command[] | null;

/** One seat's TW AI. Randomness: `streams.fork('bot.tw', seatIndex)` only; sim RNG is never touched. */
export function createSeatBot(
  _level: CompiledLevel, matchSeed: number, seatIndex: number, params: SeatBot, script?: ScriptRunner,
): Bot {
  const rng = createStreams(matchSeed).fork('bot.tw', seatIndex);
  const state: SeatState = { timer: 0, scriptDone: script === undefined };
  return {
    player: seatIndex,
    decide(ctx, tick) {
      if (!state.scriptDone) {
        const out = script!(ctx, tick, seatIndex, rng);
        if (out) return out;
        state.scriptDone = true;
        state.timer = 0;
      }
      return decideDefault(ctx.view, ctx.canDraw, rng, seatIndex, state, params);
    },
  };
}
