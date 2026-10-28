import type { CompiledLevel } from '@node-arena/content';
import {
  create, createReplayRecorder, type Command, type ReplayMetadata,
  type ReplayRecord, type SeatSetup, type Sim, type SimView,
} from '@node-arena/sim';
import { guardBotContext, type Bot } from './index.js';
import { createSeatBot } from './seat.js';

/** Ticks are the pre-step clock, as in ordinary replay command entries. */
export interface ScriptedController {
  readonly player: number;
  readonly commands: readonly { readonly tick: number; readonly cmd: Command }[];
}
export type MatchController = Bot | ScriptedController;
export interface MatchOptions {
  level: CompiledLevel;
  seed: number;
  /** Overrides matching default seats; unspecified level bots remain active. */
  controllers?: readonly MatchController[];
  /** Safety cap only; absent means the full configured level duration. */
  maxTicks?: number;
  /** Authoritative content envelope versions; omitted/false disables recording. */
  record?: ReplayMetadata | false;
  /** Team id per seat (pvp). Absent = identity; recorded in the replay header only when given. */
  teams?: readonly number[];
}
export type MatchOutcome = NonNullable<SimView['over']> | { outcome: 'truncated'; winner: null };
export interface MatchPlayerStats {
  player: string;
  buildings: number;
  /** Sum of owned buildings' garrison level. */
  garrison: number;
  lines: number;
}
export interface MatchBuildingStats {
  building: string;
  owner: string | null;
  lines: number;
  freeSlots: number;
  level: number;
  /** Final visible component columns, preserving loaded integer units. */
  col: Record<string, number>;
}
export interface MatchStats {
  finalHash: string;
  rejected: number;
  commandCount: number;
  timeLimitTicks: number;
  players: MatchPlayerStats[];
  buildings: MatchBuildingStats[];
}
export interface MatchResult {
  outcome: MatchOutcome;
  ticks: number;
  replay: ReplayRecord | null;
  stats: MatchStats;
}

function validTick(tick: number): boolean {
  return Number.isInteger(tick) && tick >= 0 && tick <= 2147483647;
}

function scriptedBot(controller: ScriptedController): Bot {
  let previous = -1;
  // Copy the schedule so decisions cannot rewrite the caller's later commands.
  const commands = controller.commands.map(entry => {
    if (!validTick(entry.tick) || entry.tick < previous) throw new RangeError('Invalid or unordered script tick');
    previous = entry.tick;
    if (entry.cmd?.player !== controller.player) throw new RangeError('Script command player does not match controller');
    return { tick: entry.tick, cmd: { ...entry.cmd } };
  });
  let index = 0;
  return { player: controller.player, decide(_context, tick) {
    const result: Command[] = [];
    while (index < commands.length && commands[index]!.tick === tick) result.push(commands[index++]!.cmd);
    return result;
  } };
}

function controllersFor(options: MatchOptions): Bot[] {
  const { level, seed } = options;
  const count = level.players.length;
  const overrides = new Map<number, Bot>();
  for (const controller of options.controllers ?? []) {
    if (!controller || !Number.isInteger(controller.player) || controller.player < 0 || controller.player >= count) throw new RangeError('Invalid controller player');
    if (overrides.has(controller.player)) throw new RangeError('Duplicate controller player');
    if ('decide' in controller && typeof controller.decide === 'function') overrides.set(controller.player, controller);
    else if ('commands' in controller && Array.isArray(controller.commands)) overrides.set(controller.player, scriptedBot(controller));
    else throw new TypeError('Invalid match controller');
  }
  const occupied = new Set<number>();
  const defaults = new Map<number, Bot>();
  for (const { player, bot } of level.bots) {
    if (!Number.isInteger(player) || player < 0 || player >= count || occupied.has(player)) throw new RangeError('Invalid or duplicate bot player index');
    occupied.add(player);
    if (!overrides.has(player)) defaults.set(player, createSeatBot(level, seed, player, bot));
  }
  // Dense player order makes the result independent of override array order.
  return level.players.flatMap((_player, index) => {
    const bot = overrides.get(index) ?? defaults.get(index);
    return bot ? [bot] : [];
  });
}

function statsFor(sim: Sim, rejected: number, commandCount: number): MatchStats {
  const view = sim.view;
  const players: MatchPlayerStats[] = view.ids.players.map(player => ({ player, buildings: 0, garrison: 0, lines: 0 }));
  const names = Object.keys(view.buildings.col).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const buildings = view.ids.buildings.map((building, index) => {
    const owner = view.buildings.owner[index]!;
    const player = owner < 0 ? undefined : players[owner];
    const level = view.buildings.level[index]!;
    if (player) {
      player.buildings++;
      player.garrison += level;
      player.lines += view.buildings.lines[index]!;
    }
    const col: Record<string, number> = {};
    for (const name of names) col[name] = view.buildings.col[name]![index]!;
    return { building, owner: player?.player ?? null, lines: view.buildings.lines[index]!, freeSlots: view.freeSlots(index), level, col };
  });
  return { finalHash: sim.hash(), rejected, commandCount, timeLimitTicks: view.timeLimitTicks, players, buildings };
}

/** Pure synchronous headless match. No events or hidden state enter a controller. */
export function runMatch(options: MatchOptions): MatchResult {
  if (options.maxTicks !== undefined && !validTick(options.maxTicks)) throw new RangeError('Invalid maxTicks');
  const controllers = controllersFor(options);
  const setup: SeatSetup | undefined = options.teams ? { teams: options.teams } : undefined;
  const recorder = options.record ? createReplayRecorder(options.level, options.seed, options.record, setup) : null;
  const sim: Sim = recorder ?? create(options.level, options.seed, setup);
  if (options.maxTicks === undefined && sim.view.timeLimitTicks === 0) throw new RangeError('maxTicks required for an untimed level');
  const maxTicks = options.maxTicks ?? sim.view.timeLimitTicks;
  let commandCount = 0;
  let rejected = 0;
  while (!sim.view.over && sim.view.tick < maxTicks) {
    const context = guardBotContext(sim);
    const commands: Command[] = [];
    for (const bot of controllers) {
      const selected = bot.decide(context, sim.view.tick);
      for (const command of selected) {
        if (command?.player !== bot.player) throw new RangeError('Bot command player does not match controller');
        commands.push(command);
      }
    }
    commandCount += commands.length;
    sim.step(commands);
    rejected = sim.rejected;
    if (rejected !== 0) throw new Error(`Match rejected ${rejected} command(s) at tick ${sim.view.tick}`);
  }
  return {
    outcome: sim.view.over ? { ...sim.view.over } : { outcome: 'truncated', winner: null },
    ticks: sim.view.tick, replay: recorder?.record() ?? null, stats: statsFor(sim, rejected, commandCount),
  };
}
