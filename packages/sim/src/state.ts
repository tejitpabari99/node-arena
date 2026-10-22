import type { ModuleId } from '@node-arena/defs';
import type { SimEvent } from '@node-arena/defs';
import { TICK_RATE, idiv, isqrt, mulDiv } from './math.js';
import { createCrossings, refreshCrossings } from './crossings.js';
import { TroopRing } from './ring.js';
import { createStreams } from './streams.js';
import { IMPLS, MODULE_ORDER } from './modules/index.js';
import type { Buildings, Channel, CompiledLevel, SimState } from './types.js';

const MAX_ALIVE_CAP = 1000;

/** stage(L) = 1 + number of thresholds <= L (R-GRW-02). */
export function stageOf(thresholds: readonly number[], level: number): number {
  let stage = 1;
  for (let i = 0; i < thresholds.length; i++) if (thresholds[i]! <= level) stage++;
  return stage;
}

/** Indexes of buildings that carry module `id` in their compiled bag. */
export function carriers(level: CompiledLevel, id: ModuleId): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < level.buildings.length; i++) if (level.buildings[i]!.modules[id] !== undefined) out.push(i);
  return Int32Array.from(out);
}

const isPositiveInt32 = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 2147483647;

/** Boundary validation of an untrusted compiled level (replay bundles): throws a clear error, never allocates from bad numbers. */
function validateLevel(level: CompiledLevel): Int32Array {
  const cap = level.rules.aliveCap;
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_ALIVE_CAP) throw new Error(`invalid level: rules.aliveCap ${String(cap)} not an integer in [1, ${MAX_ALIVE_CAP}]`);
  level.units.forEach((u, i) => {
    for (const field of ['attack', 'hp', 'speed'] as const) {
      if (!isPositiveInt32(u[field])) throw new Error(`invalid level: units[${i}].${field} ${String(u[field])} not an integer >= 1`);
    }
  });
  const unitOf = new Int32Array(level.buildings.length).fill(-1);
  level.buildings.forEach((b, i) => {
    const params = b.modules['spawns'] as { troop: string } | undefined;
    if (!params) return;
    const kind = level.units.findIndex((u) => u.id === params.troop);
    if (kind < 0) throw new Error(`invalid level: building ${b.id} spawns unknown troop "${params.troop}"`);
    unitOf[i] = kind;
  });
  return unitOf;
}

/** Single writer of a building's level + derived stage (R-GRW-02). */
export function setLevel(state: SimState, i: number, level: number): void {
  state.buildings.level[i] = level;
  state.buildings.stage[i] = stageOf(state.level.rules.stageThresholds, level);
}

/** Unclamped progress of ring row `i` at the current tick (arrival overshoot = progress - length). The one progress formula. */
export function progressOf(state: SimState, ch: Channel, i: number): number {
  return ch.troops.p0[i]! + (state.tick - ch.troops.t0[i]!) * state.level.units[ch.troops.kind[i]!]!.speed;
}

/** Free line slots of `building`: stage when it carries drawsLines, else 0, minus lines drawn. Single source for commands and the read view. */
export function freeSlots(state: SimState, building: number): number {
  const b = state.buildings;
  return (state.level.buildings[building]!.modules['drawsLines'] !== undefined ? b.stage[building]! : 0) - b.lines[building]!;
}

export function createState(level: CompiledLevel, seed: number): SimState {
  const unitOf = validateLevel(level);
  const n = level.buildings.length;
  const col: Record<string, Int32Array> = {};
  for (const id of MODULE_ORDER) {
    const fields = IMPLS[id].state;
    if (!fields) continue;
    for (const field of Object.keys(fields).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) col[`${id}.${field}`] = new Int32Array(n).fill(fields[field]!);
  }
  const buildings: Buildings = {
    n,
    owner: new Int32Array(n), level: new Int32Array(n), maxLevel: new Int32Array(n), stage: new Int32Array(n),
    lines: new Int32Array(n), alive: new Int32Array(n), ignoreForWin: new Int32Array(n), col,
  };
  level.buildings.forEach((b, i) => {
    buildings.owner[i] = b.owner;
    buildings.level[i] = b.level;
    buildings.maxLevel[i] = Number(b.modules['level']?.['maxLevel'] ?? 0);
    buildings.stage[i] = stageOf(level.rules.stageThresholds, b.level);
    buildings.ignoreForWin[i] = b.ignoreForWin ? 1 : 0;
  });
  const streams = createStreams(seed);
  const players = { n: level.players.length, kind: Int32Array.from(level.players, (p) => (p.kind === 'human' ? 0 : 1)) };
  const fwd = Array.from({ length: n }, (_, i) => streams.fork('fwd', i));
  const carrierMap = {} as Record<ModuleId, Int32Array>;
  for (const id of MODULE_ORDER) carrierMap[id] = carriers(level, id);
  const state: SimState = {
    level, seed, unitOf, carriers: carrierMap, tick: 0, over: null, drawSeq: 0, troopSeq: 0, rejected: 0, buildings, players,
    channels: new Map(), fwd, counters: { spawned: 0, arrived: 0, died: 0, killed: 0 }, events: null,
  };
  for (const id of MODULE_ORDER) IMPLS[id].init?.(state, carrierMap[id]);
  createCrossings(state);
  return state;
}

export function channelKey(state: SimState, from: number, to: number): number { return from * state.buildings.n + to; }

/** Inverse of `channelKey` for `n` buildings: `from = floor(key / n)`, `to = key % n`. Renderers decode `TroopBuffer.channel` with it. */
export function channelEnds(n: number, key: number): { from: number; to: number } {
  const from = idiv(key, n);
  return { from, to: key - from * n };
}

/** Lane length in progress units, symmetric in (a, b): isqrt((dx*tickRate)^2 + (dz*tickRate)^2) (R-TCK-04). */
export function laneLength(level: CompiledLevel, a: number, b: number): number {
  const p = level.buildings[a]!, q = level.buildings[b]!;
  const dx = (p.x - q.x) * TICK_RATE, dz = (p.z - q.z) * TICK_RATE;
  return isqrt(dx * dx + dz * dz);
}

/** Channel `from -> to`, created (undrawn, empty) on first use. */
export function getChannel(state: SimState, from: number, to: number): Channel {
  const key = channelKey(state, from, to);
  let ch = state.channels.get(key);
  if (!ch) {
    ch = { key, from, to, drawn: 0, drawSeq: 0, timer: 0, length: laneLength(state.level, from, to), troops: new TroopRing(state.level.rules.aliveCap) };
    state.channels.set(key, ch);
  }
  return ch;
}

export function isLive(ch: Channel): boolean { return ch.drawn !== 0 || ch.troops.len > 0; }

/** Live channels in ascending key order (the canonical iteration order). */
export function liveChannels(state: SimState): Channel[] {
  const out: Channel[] = [];
  for (const ch of state.channels.values()) if (isLive(ch)) out.push(ch);
  return out.sort((a, b) => a.key - b.key);
}

/** Append a troop at progress 0 on `from -> to` (does not emit; the caller owns the event). Returns its seq. */
export function spawnTroop(state: SimState, from: number, to: number, kind: number): number {
  const ch = getChannel(state, from, to);
  const seq = state.troopSeq++;
  ch.troops.push(0, state.tick, state.buildings.owner[from]!, kind, seq, state.level.units[kind]!.hp);
  state.buildings.alive[from]!++;
  state.counters.spawned++;
  refreshCrossings(state);
  return seq;
}

/** Milli-unit world position of ring row `i` at the current tick (progress clamped to the lane). */
export function troopPosition(state: SimState, ch: Channel, i: number): { x: number; z: number } {
  const a = state.level.buildings[ch.from]!, b = state.level.buildings[ch.to]!;
  const progress = Math.min(progressOf(state, ch, i), ch.length);
  if (ch.length === 0) return { x: a.x, z: a.z };
  return { x: a.x + mulDiv(b.x - a.x, progress, ch.length), z: a.z + mulDiv(b.z - a.z, progress, ch.length) };
}

export type KillCause = 'clash' | 'capture' | 'tower';

/**
 * Canonical troop removal (SP04 seam): physical ring removal, `alive[from]--`, ledger, `TroopDied` event.
 * Returns false when the troop is not on the channel.
 */
export function killTroop(state: SimState, channel: number, seq: number, cause: KillCause): boolean {
  const ch = state.channels.get(channel);
  if (!ch) return false;
  const i = ch.troops.indexOfSeq(seq);
  if (i < 0) return false;
  if (state.events) {
    const { x, z } = troopPosition(state, ch, i);
    const ev: SimEvent = { type: 'TroopDied', channel, seq, owner: ch.troops.owner[i]!, kind: state.level.units[ch.troops.kind[i]!]!.id, cause, x, z };
    state.events.push(ev);
  }
  ch.troops.removeAt(i);
  state.buildings.alive[ch.from]!--;
  if (cause === 'clash') state.counters.died++; else state.counters.killed++;
  return true;
}
