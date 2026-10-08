import type { Command, RejectReason, SimEvent, GameOver } from './commands.js';
import type { SimState, Troop } from './state.js';
import { sortedNames } from './registry.js';

/** A borrowed typed array: callers must not mutate its elements or backing buffer. */
export type ReadColumn = Omit<Readonly<Int32Array>, 'set' | 'fill' | 'copyWithin' | 'reverse' | 'sort' | 'subarray'> & { subarray(begin?: number, end?: number): ReadColumn };
export interface PlayerView {
  readonly team: string; readonly kind: 'human' | 'bot'; readonly colorKey: string;
  readonly alive: number; readonly transit: number;
  readonly stats: { readonly generated: number; readonly overflowLost: number; readonly kills: number; readonly captures: number };
}
export interface LineView { readonly channel: number; readonly from: number; readonly to: number; readonly owner: number; readonly length: number; readonly drawSeq: number }
export interface SimView {
  readonly tick: number; readonly over: Readonly<GameOver> | null; readonly timeLimitTicks: number;
  readonly ids: { readonly towers: readonly string[]; readonly players: readonly string[] };
  readonly players: readonly PlayerView[];
  readonly tower: { readonly owner: ReadColumn; readonly team: ReadColumn; readonly slots: ReadColumn; readonly lines: ReadColumn; readonly col: Readonly<Record<string, ReadColumn>> };
  readonly towerStatic: readonly { readonly x: number; readonly y: number; readonly archetype: string; readonly visual: string; readonly footprintRadius: number; readonly components: readonly string[] }[];
  readonly lines: readonly LineView[];
  readonly kinds: readonly { readonly value: number; readonly speedPerTick: number; readonly visual: string }[];
}
export interface TroopBuf { channel: Int32Array; seq: Int32Array; owner: Int32Array; kind: Int32Array; progress: Int32Array }
export interface Sim {
  readonly tick: number; readonly view: SimView; readonly rejected: number;
  step(commands: readonly Command[], options?: { events?: boolean }): readonly SimEvent[];
  canDraw(player: string, from: string, to: string): RejectReason | null;
  /** Returns total required count. Writes the first min(count, all column lengths) entries; suffix is unspecified. */
  readTroops(out: TroopBuf): number;
  hash(): string;
  snapshot(): SimSnapshot;
}
export interface SimSnapshot {
  tick: number; over: GameOver | null; timeLimitTicks: number; drawSeq: number; troopSeq: number; rejected: number;
  prng: number[]; eliminated: number[]; ids: { towers: string[]; players: string[] };
  players: { team: string; kind: 'human' | 'bot'; colorKey: string; alive: number; transit: number; stats: { generated: number; overflowLost: number; kills: number; captures: number } }[];
  tower: { owner: number[]; team: number[]; slots: number[]; lines: number[]; col: Record<string, number[]> };
  towerStatic: { x: number; y: number; archetype: string; visual: string; footprintRadius: number; components: string[] }[];
  kinds: { id: string; value: number; speedPerTick: number; visual: string }[];
  channels: { key: number; from: number; to: number; length: number; owner: number; drawn: number; drawSeq: number; troops: Troop[] }[];
}

export function createView(state: SimState): SimView {
  const players: PlayerView[] = state.ids.players.map((_, i) => ({
    get team() { return state.teamIds[state.players.team[i]!]!; },
    get kind() { return state.players.kind[i]!; }, get colorKey() { return state.players.colorKey[i]!; },
    get alive() { return state.players.alive[i]!; }, get transit() { return state.players.transit[i]!; },
    stats: { get generated() { return state.players.stats.generated[i]!; }, get overflowLost() { return state.players.stats.overflowLost[i]!; }, get kills() { return state.players.stats.kills[i]!; }, get captures() { return state.players.stats.captures[i]!; } },
  }));
  const lines: LineView[] = [];
  return { get tick() { return state.tick; }, get over() { return state.over; }, timeLimitTicks: state.timeLimitTicks,
    ids: state.ids, players, tower: state.tower, towerStatic: state.towerStatic, kinds: state.kinds,
    lines,
  };
}

/** Refresh the stable line cache once per tick; it never enters the semantic hash. */
export function refreshView(state: SimState): void {
  const lines = state.view.lines as LineView[];
  lines.length = 0;
  for (const channel of state.channels) if (channel?.drawn) lines.push({ channel: channel.key, from: channel.from, to: channel.to, owner: channel.owner, length: channel.length, drawSeq: channel.drawSeq });
}

/** No closures, troop objects or temporary arrays on this hot read path. */
export function readTroops(state: SimState, out: TroopBuf): number {
  const capacity = Math.min(out.channel.length, out.seq.length, out.owner.length, out.kind.length, out.progress.length);
  let count = 0;
  for (let key = 0; key < state.channels.length; key++) {
    const channel = state.channels[key];
    if (!channel) continue;
    for (let i = 0; i < channel.troops.size; i++) {
      if (count < capacity) {
        const kind = channel.troops.read('kind', i);
        out.channel[count] = key; out.seq[count] = channel.troops.read('seq', i);
        out.owner[count] = channel.troops.read('owner', i); out.kind[count] = kind;
        out.progress[count] = channel.troops.read('p0', i) + (state.tick - channel.troops.read('t0', i)) * state.kinds[kind]!.speedPerTick;
      }
      count++;
    }
  }
  return count;
}

export function snapshot(state: SimState): SimSnapshot {
  const col: Record<string, number[]> = Object.create(null) as Record<string, number[]>;
  for (const name of sortedNames(state.tower.col)) col[name] = Array.from(state.tower.col[name]!);
  const channels: SimSnapshot['channels'] = [];
  for (const channel of state.channels) if (channel) {
    const troops: Troop[] = [];
    for (let i = 0; i < channel.troops.size; i++) troops.push({ p0: channel.troops.read('p0', i), t0: channel.troops.read('t0', i), owner: channel.troops.read('owner', i), kind: channel.troops.read('kind', i), seq: channel.troops.read('seq', i), value: channel.troops.read('value', i) });
    channels.push({ key: channel.key, from: channel.from, to: channel.to, length: channel.length, owner: channel.owner, drawn: channel.drawn, drawSeq: channel.drawSeq, troops });
  }
  return { tick: state.tick, over: state.over ? { ...state.over } : null, timeLimitTicks: state.timeLimitTicks, drawSeq: state.drawSeq, troopSeq: state.troopSeq, rejected: state.rejected,
    prng: state.prng.snapshot(), eliminated: Array.from(state.eliminated), ids: { towers: [...state.ids.towers], players: [...state.ids.players] },
    players: state.view.players.map(player => ({ team: player.team, kind: player.kind, colorKey: player.colorKey, alive: player.alive, transit: player.transit, stats: { ...player.stats } })),
    tower: { owner: Array.from(state.tower.owner), team: Array.from(state.tower.team), slots: Array.from(state.tower.slots), lines: Array.from(state.tower.lines), col },
    towerStatic: state.towerStatic.map(tower => ({ ...tower, components: [...tower.components] })), kinds: state.kinds.map(kind => ({ ...kind })), channels,
  };
}

