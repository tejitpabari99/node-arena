import type { ModuleId } from '@node-arena/defs';
import { IMPLS, MODULE_ORDER } from './modules/index.js';
import type { Buildings, CompiledLevel, SimState } from './types.js';

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

export function createState(level: CompiledLevel, seed: number): SimState {
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
  const state: SimState = { level, seed, tick: 0, over: null, drawSeq: 0, troopSeq: 0, rejected: 0, buildings, events: null };
  for (const id of MODULE_ORDER) IMPLS[id].init?.(state, carriers(level, id));
  return state;
}
