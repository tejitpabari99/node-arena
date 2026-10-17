import type { CompiledLevel } from '@node-arena/content';
import {
  create, createReplayRecorder, type Command, type GameOver, type ReplayMetadata,
  type ReplayRecord, type Sim,
} from '@node-arena/sim';
import { createProfileBot } from './driver.js';
import { guardBotContext, type Bot } from './index.js';

/** Ticks are the pre-step clock, as in ordinary replay command entries. */
export interface ScriptedController {
  readonly player: string;
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
}
export type MatchOutcome = GameOver | { outcome: 'truncated'; winnerTeam: null };
export interface MatchPlayerStats {
  player: string;
  team: string;
  alive: number;
  towers: number;
  garrison: number;
  transit: number;
  lines: number;
  generated: number;
  overflowLost: number;
  kills: number;
  captures: number;
}
export interface MatchTowerStats {
  tower: string;
  owner: string | null;
  slots: number;
  lines: number;
  /** Final visible component columns, preserving loaded integer units. */
  col: Record<string, number>;
}
export interface MatchStats {
  finalHash: string;
  rejected: number;
  commandCount: number;
  timeLimitTicks: number;
  players: MatchPlayerStats[];
  towers: MatchTowerStats[];
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
  const playerIds = new Set(level.players.map(player => player.id));
  if (playerIds.size !== level.players.length) throw new RangeError('Duplicate level player IDs');
  const overrides = new Map<string, Bot>();
  for (const controller of options.controllers ?? []) {
    if (!controller || !playerIds.has(controller.player)) throw new RangeError('Invalid controller player');
    if (overrides.has(controller.player)) throw new RangeError('Duplicate controller player');
    if ('decide' in controller && typeof controller.decide === 'function') overrides.set(controller.player, controller);
    else if ('commands' in controller && Array.isArray(controller.commands)) overrides.set(controller.player, scriptedBot(controller));
    else throw new TypeError('Invalid match controller');
  }
  const occupied = new Set<number>();
  const defaults = new Map<string, Bot>();
  for (const { player: index, profile } of level.bots) {
    const player = level.players[index];
    if (!Number.isInteger(index) || !player || occupied.has(index)) throw new RangeError('Invalid or duplicate bot player index');
    occupied.add(index);
    if (!overrides.has(player.id)) defaults.set(player.id, createProfileBot(level, seed, player.id, profile));
  }
  // Dense player order makes the result independent of override array order.
  return level.players.flatMap(player => {
    const bot = overrides.get(player.id) ?? defaults.get(player.id);
    return bot ? [bot] : [];
  });
}

function statsFor(sim: Sim, commandCount: number): MatchStats {
  const view = sim.view;
  const players: MatchPlayerStats[] = view.players.map((player, index) => ({
    player: view.ids.players[index]!, team: player.team, alive: player.alive,
    towers: 0, garrison: 0, transit: player.transit, lines: 0,
    generated: player.stats.generated, overflowLost: player.stats.overflowLost,
    kills: player.stats.kills, captures: player.stats.captures,
  }));
  const names = Object.keys(view.tower.col).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const towers = view.ids.towers.map((tower, index) => {
    const owner = view.tower.owner[index]!;
    const player = owner < 0 ? undefined : players[owner];
    if (player) {
      player.towers++;
      player.garrison += view.tower.col['garrison.count']?.[index] ?? 0;
      player.lines += view.tower.lines[index]!;
    }
    const col: Record<string, number> = {};
    for (const name of names) col[name] = view.tower.col[name]![index]!;
    return { tower, owner: player?.player ?? null, slots: view.tower.slots[index]!, lines: view.tower.lines[index]!, col };
  });
  return { finalHash: sim.hash(), rejected: sim.rejected, commandCount, timeLimitTicks: view.timeLimitTicks, players, towers };
}

/** Pure synchronous headless match. No events or hidden state enter a controller. */
export function runMatch(options: MatchOptions): MatchResult {
  if (options.maxTicks !== undefined && !validTick(options.maxTicks)) throw new RangeError('Invalid maxTicks');
  const controllers = controllersFor(options);
  const recorder = options.record ? createReplayRecorder(options.level, options.seed, options.record) : null;
  const sim: Sim = recorder ?? create(options.level, options.seed);
  const maxTicks = options.maxTicks ?? sim.view.timeLimitTicks;
  let commandCount = 0;
  while (!sim.view.over && sim.tick < maxTicks) {
    const context = guardBotContext(sim);
    const commands: Command[] = [];
    for (const bot of controllers) {
      const selected = bot.decide(context, sim.tick);
      for (const command of selected) {
        if (command?.player !== bot.player) throw new RangeError('Bot command player does not match controller');
        commands.push(command);
      }
    }
    commandCount += commands.length;
    sim.step(commands, { events: false });
    if (sim.rejected !== 0) throw new Error(`Match rejected ${sim.rejected} command(s) at tick ${sim.tick}`);
  }
  return {
    outcome: sim.view.over ? { ...sim.view.over } : { outcome: 'truncated', winnerTeam: null },
    ticks: sim.tick, replay: recorder?.record() ?? null, stats: statsFor(sim, commandCount),
  };
}
