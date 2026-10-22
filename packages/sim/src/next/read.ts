import { TICK_RATE } from '../math.js';
import { stageOf } from './state.js';
import type { CompiledLevel, SimState } from './types.js';

export type ReadColumn = Omit<Readonly<Int32Array>, 'set' | 'fill' | 'copyWithin' | 'reverse' | 'sort' | 'subarray'> & { subarray(begin?: number, end?: number): ReadColumn };

export interface NextView {
  tick: number;
  over: { outcome: 'won' | 'lost' | 'timeout'; winner: number | null } | null;
  readonly timeLimitTicks: number;
  readonly bounds: CompiledLevel['bounds'];
  readonly ids: { readonly buildings: readonly string[]; readonly players: readonly string[]; readonly elements: readonly string[] };
  readonly players: readonly { readonly kind: 'human' | 'ai'; readonly colorKey: string }[];
  readonly buildings: {
    readonly owner: ReadColumn; readonly level: ReadColumn; readonly maxLevel: ReadColumn; readonly stage: ReadColumn;
    readonly lines: ReadColumn; readonly alive: ReadColumn; readonly ignoreForWin: ReadColumn; readonly col: Readonly<Record<string, ReadColumn>>;
  };
  readonly buildingStatic: readonly {
    readonly x: number; readonly z: number; readonly kind: 'house' | 'tower'; readonly archetype: string; readonly visual: string;
    readonly footprint: CompiledLevel['buildings'][number]['footprint']; readonly special: boolean; readonly drawsLines: boolean;
    readonly initialOwner: number; readonly modules: readonly string[];
  }[];
  readonly elements: CompiledLevel['elements'];
  /** Refreshed per tick; empty until lines land (03 Task 3). */
  lines: readonly { channel: number; from: number; to: number; owner: number; length: number; drawSeq: number }[];
  readonly units: readonly { readonly id: string; readonly speed: number; readonly hp: number; readonly attack: number; readonly defense: number; readonly visual: string }[];
  freeSlots(building: number): number;
}

export function createView(state: SimState): NextView {
  const { level, buildings: b } = state;
  return {
    tick: 0, over: null,
    timeLimitTicks: level.timeLimitSec === null ? 0 : level.timeLimitSec * TICK_RATE,
    bounds: level.bounds,
    ids: { buildings: level.buildings.map((x) => x.id), players: level.players.map((x) => x.id), elements: level.elements.map((x) => x.id) },
    players: level.players.map((p) => ({ kind: p.kind, colorKey: p.colorKey })),
    buildings: b,
    buildingStatic: level.buildings.map((x) => ({
      x: x.x, z: x.z, kind: x.modules['shoots'] ? 'tower' : 'house', archetype: x.archetype, visual: x.visual, footprint: x.footprint,
      special: x.special, drawsLines: x.modules['drawsLines'] !== undefined, initialOwner: x.owner, modules: Object.keys(x.modules).sort((p, q) => (p < q ? -1 : p > q ? 1 : 0)),
    })),
    elements: level.elements,
    lines: [],
    units: level.units.map((u) => ({ id: u.id, speed: u.speed, hp: u.hp, attack: u.attack, defense: u.defense, visual: u.visual })),
    freeSlots: (i) => (state.level.buildings[i]!.modules['drawsLines'] !== undefined ? b.stage[i]! : 0) - b.lines[i]!,
  };
}

export function refreshView(view: NextView, state: SimState): void {
  view.tick = state.tick;
  view.over = state.over;
  for (let i = 0; i < state.buildings.n; i++) state.buildings.stage[i] = stageOf(state.level.rules.stageThresholds, state.buildings.level[i]!);
}
