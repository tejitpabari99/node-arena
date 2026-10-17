import type { CompiledLevel, ResolvedBotProfile } from '@node-arena/content';
import { idiv, mixSeed, Sfc32, TICK_RATE, type Command, type Sim } from '@node-arena/sim';
import { guardBotContext, type Bot, type BotContext } from './index.js';
import { createUtilityBot } from './utility.js';

export interface BotDriver {
  /** Call before step. Further calls at the same tick emit nothing. */
  commands(sim: Sim): Command[];
}

/** Profile IDs are validated ASCII identifiers. FNV-1a's prime multiplication
 * uses shifts and addition to keep the core's deterministic integer policy. */
function fnv32(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash;
}

/** Bind a tooling profile to any seat, with the same cadence/seed as level bots.
 * Call decide before each tick. A fresh instance is required for each match. */
export function createProfileBot(level: CompiledLevel, matchSeed: number, player: string, profile: ResolvedBotProfile): Bot {
  return createProfileSeat(level, matchSeed, player, profile).bot;
}

function createProfileSeat(level: CompiledLevel, matchSeed: number, player: string, profile: ResolvedBotProfile) {
  const index = level.players.findIndex(seat => seat.id === player);
  if (index < 0) throw new RangeError('Invalid profile bot player');
  const seed = mixSeed(matchSeed, index, fnv32(profile.id));
  const intervalTicks = profile.params.skill === undefined ? 1 :
    Math.max(1, idiv(profile.params.skill.decisionIntervalSec * TICK_RATE, 1000));
  const phase = new Sfc32(seed).next() % intervalTicks;
  const bot: Bot = profile.kind === 'idle' ? { player, decide: () => [] } :
    createUtilityBot({ player, profile, seed, towerCount: level.towers.length });
  let lastTick = -1;
  const scheduled: Bot = { player, decide(context, tick) {
    if (tick === lastTick) return [];
    lastTick = tick;
    if (tick % intervalTicks !== phase) return [];
    if (context.view.ids.players[index] !== player) {
      throw new RangeError('Bot player mapping does not match simulation');
    }
    return bot.decide(guardBotContext(context), tick);
  } };
  return { bot: scheduled, intervalTicks, phase };
}

/** One match-local driver: no content runtime, events or simulation RNG access. */
export function createBotDriver(level: CompiledLevel, matchSeed: number): BotDriver {
  const occupied = new Set<number>();
  const seats = level.bots.map(({ player: index, profile }) => {
    const player = level.players[index];
    if (!Number.isInteger(index) || !player || occupied.has(index)) {
      throw new RangeError('Invalid or duplicate bot player index');
    }
    occupied.add(index);
    return createProfileSeat(level, matchSeed, player.id, profile);
  });
  let lastTick = -1;
  return { commands(sim: Sim): Command[] {
    const tick = sim.tick;
    const commands: Command[] = [];
    if (tick === lastTick || seats.length === 0) return commands;
    let context: BotContext | undefined;
    for (const seat of seats) {
      if (tick % seat.intervalTicks !== seat.phase) continue;
      context ??= guardBotContext(sim);
      commands.push(...seat.bot.decide(context, tick));
    }
    lastTick = tick;
    return commands;
  } };
}
