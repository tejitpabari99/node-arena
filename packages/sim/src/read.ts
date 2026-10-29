import { TICK_RATE } from './math.js';
import { hashState } from './hash.js';
import { freeSlots, liveChannels, progressOf } from './state.js';
import type { CompiledLevel, Placement, Outcome, SimState } from './types.js';

export type ReadColumn = Omit<Readonly<Int32Array>, 'set' | 'fill' | 'copyWithin' | 'reverse' | 'sort' | 'subarray'> & { subarray(begin?: number, end?: number): ReadColumn };

export interface SimView {
  tick: number;
  over: { outcome: Outcome; winner: number | null; winners?: number[]; ranking?: Placement[] } | null;
  readonly timeLimitTicks: number;
  readonly bounds: CompiledLevel['bounds'];
  readonly ids: { readonly buildings: readonly string[]; readonly players: readonly string[]; readonly elements: readonly string[] };
  readonly players: readonly { readonly kind: 'human' | 'ai'; readonly colorKey: string; readonly team: number }[];
  /** Per seat elimination tick; -1 = alive. Filled by seat elimination (later task). */
  readonly eliminatedAt: ReadColumn;
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
  /** Drawn lines, refreshed per tick in ascending channel key. */
  lines: readonly { channel: number; from: number; to: number; owner: number; length: number; drawSeq: number }[];
  readonly units: readonly { readonly id: string; readonly speed: number; readonly hp: number; readonly attack: number; readonly defense: number; readonly visual: string }[];
  freeSlots(building: number): number;
}

export function createView(state: SimState): SimView {
  const { level, buildings: b } = state;
  return {
    tick: 0, over: null,
    timeLimitTicks: level.timeLimitSec === null ? 0 : level.timeLimitSec * TICK_RATE,
    bounds: level.bounds,
    ids: { buildings: level.buildings.map((x) => x.id), players: level.players.map((x) => x.id), elements: level.elements.map((x) => x.id) },
    players: level.players.map((p, i) => ({ kind: p.kind, colorKey: p.colorKey, team: state.team[i]! })),
    eliminatedAt: state.players.eliminatedAt,
    buildings: b,
    buildingStatic: level.buildings.map((x) => ({
      x: x.x, z: x.z, kind: x.kind, archetype: x.archetype, visual: x.visual, footprint: x.footprint,
      special: x.special, drawsLines: x.modules['drawsLines'] !== undefined, initialOwner: x.owner, modules: Object.keys(x.modules).sort((p, q) => (p < q ? -1 : p > q ? 1 : 0)),
    })),
    elements: level.elements,
    lines: [],
    units: level.units.map((u) => ({ id: u.id, speed: u.speed, hp: u.hp, attack: u.attack, defense: u.defense, visual: u.visual })),
    freeSlots: (i) => freeSlots(state, i),
  };
}

export function refreshView(view: SimView, state: SimState): void {
  view.tick = state.tick;
  view.over = state.over;
  view.lines = liveChannels(state).filter((c) => c.drawn !== 0).map((c) => ({ channel: c.key, from: c.from, to: c.to, owner: state.buildings.owner[c.from]!, length: c.length, drawSeq: c.drawSeq }));
}

/**
 * Caller-owned troop columns; `readTroops` fills row 0.. up to the shortest column.
 * `channel` is the channel key `from * n + to` (decode with `channelEnds(n, key)`, n = number of buildings).
 * `kind` is the UNIT INDEX into `view.units` (events carry the unit id string instead).
 * `length` is the lane length in progress units, so a renderer clamps `progress + speed*alpha` to it for troops on
 * cut or replaced lines (the lane itself is no longer in `view.lines`).
 */
export interface TroopBuffer {
  channel: Int32Array; seq: Int32Array; owner: Int32Array; kind: Int32Array; progress: Int32Array; hp: Int32Array; speed: Int32Array; laneLength: Int32Array;
}

export function createTroopBuffer(capacity: number): TroopBuffer {
  const col = () => new Int32Array(capacity);
  return { channel: col(), seq: col(), owner: col(), kind: col(), progress: col(), hp: col(), speed: col(), laneLength: col() };
}

/**
 * Fill `buf` with every in-flight troop (live channels ascending key, FIFO front first). `progress` is at the
 * current tick, clamped to the lane; `speed` is the constant unit speed in progress units/tick, so a renderer
 * draws `min(progress + speed*alpha, lane length)`. Returns rows written (capped by the buffer size).
 */
export function readTroops(state: SimState, buf: TroopBuffer): number {
  const cap = Math.min(buf.channel.length, buf.seq.length, buf.owner.length, buf.kind.length, buf.progress.length, buf.hp.length, buf.speed.length, buf.laneLength.length);
  let n = 0;
  for (const ch of liveChannels(state)) {
    const r = ch.troops;
    for (let i = 0; i < r.len && n < cap; i++, n++) {
      const speed = state.level.units[r.kind[i]!]!.speed;
      buf.channel[n] = ch.key; buf.seq[n] = r.seq[i]!; buf.owner[n] = r.owner[i]!; buf.kind[n] = r.kind[i]!; buf.hp[n] = r.hp[i]!;
      buf.progress[n] = Math.min(progressOf(state, ch, i), ch.length);
      buf.speed[n] = speed; buf.laneLength[n] = ch.length;
    }
  }
  return n;
}

/** Serializable copy of the hashed state (plain JSON). `hash` equals `sim.hash()` at capture time. */
export interface SimSnapshot {
  tick: number; seed: number; hash: string;
  over: { outcome: Outcome; winner: number | null; winners?: number[]; ranking?: Placement[] } | null;
  drawSeq: number; troopSeq: number; rejected: number;
  buildings: Record<'owner' | 'level' | 'maxLevel' | 'stage' | 'lines' | 'alive' | 'ignoreForWin', number[]>;
  col: Record<string, number[]>;
  channels: { key: number; drawn: number; drawSeq: number; timer: number; troops: Record<'p0' | 't0' | 'owner' | 'kind' | 'seq' | 'hp', number[]> }[];
  fwd: [number, number, number, number][];
}

export function snapshotState(state: SimState): SimSnapshot {
  const b = state.buildings, arr = (c: Int32Array, len = c.length): number[] => Array.from(c.subarray(0, len));
  const col: Record<string, number[]> = {};
  for (const name of Object.keys(b.col).sort((p, q) => (p < q ? -1 : p > q ? 1 : 0))) col[name] = arr(b.col[name]!);
  return {
    tick: state.tick, seed: state.seed, hash: hashState(state),
    over: state.over ? { ...state.over, ...(state.over.winners ? { winners: [...state.over.winners] } : {}), ...(state.over.ranking ? { ranking: state.over.ranking.map(p => ({ ...p, seats: [...p.seats] })) } : {}) } : null,
    drawSeq: state.drawSeq, troopSeq: state.troopSeq, rejected: state.rejected,
    buildings: { owner: arr(b.owner), level: arr(b.level), maxLevel: arr(b.maxLevel), stage: arr(b.stage), lines: arr(b.lines), alive: arr(b.alive), ignoreForWin: arr(b.ignoreForWin) },
    col,
    channels: liveChannels(state).map((ch) => {
      const r = ch.troops;
      return { key: ch.key, drawn: ch.drawn, drawSeq: ch.drawSeq, timer: ch.timer, troops: { p0: arr(r.p0, r.len), t0: arr(r.t0, r.len), owner: arr(r.owner, r.len), kind: arr(r.kind, r.len), seq: arr(r.seq, r.len), hp: arr(r.hp, r.len) } };
    }),
    fwd: state.fwd.map((s) => s.snapshot()),
  };
}
