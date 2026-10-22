import type { Command, Sim, SimView } from '@node-arena/sim';

/** The read capabilities available to a player; no simulation internals. */
export interface BotContext {
  readonly view: SimView;
  readonly canDraw: Sim['canDraw'];
}

export interface Bot {
  readonly player: number;
  decide(ctx: BotContext, tick: number): Command[];
}

/** Fail loudly on hidden reads, including when a full Sim is passed as input. */
export function guardBotContext(context: BotContext): BotContext {
  const allowed: BotContext = Object.assign(Object.create(null), {
    view: context.view,
    canDraw: context.canDraw.bind(context),
  });
  Object.freeze(allowed);
  return new Proxy(allowed, {
    get(target, property) {
      if (property === 'view' || property === 'canDraw') {
        return target[property];
      }
      throw new TypeError(`Forbidden BotContext property: ${String(property)}`);
    },
  });
}

export { HUMAN_PROXY } from './driver.js';
export { createSeatBot, type SeatState, type ScriptRunner } from './seat.js';
export { createScriptRunner } from './script.js';
export { decideDefault, noLineBetween, sortedTargets, targetKey, freeSources, MS_PER_TICK, type SeatRng } from './tw-ai.js';
export { createBotDriver, type BotDriver } from './driver.js';
export {
  runMatch, type MatchOptions, type MatchResult, type MatchOutcome, type MatchStats,
  type MatchPlayerStats, type MatchBuildingStats, type MatchController, type ScriptedController,
} from './harness.js';
export { BOT_VERSION } from './version.js';
