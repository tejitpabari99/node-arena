import { compareDistanceSq, compareRadiusSq, distanceSq, laneIntervals, makeLane } from '../geometry.js';
import type { DistanceSq, Interval, Lane, Point } from '../geometry.js';
import { checked, idiv } from '../math.js';
import { hostile, killTroop, liveChannels, progressOf, setLevel, troopPosition } from '../state.js';
import { TICK_MT } from '../timers.js';
import type { SimModuleFor, SimState } from '../types.js';

interface Params {
  attackDelay: number; attackRadius: number; speedUpByLevel: number;
  radiusUpByLevel: number; radiusUnit: number; minRadius: number;
  neutralFires?: boolean; troopPad?: number; hitsNeutralHouses?: boolean;
}
interface StageCache { lanes: readonly Interval[][]; houses: readonly number[] }
interface TowerCache { stages: readonly StageCache[] }
interface Cache { lanes: readonly Lane[]; towers: ReadonlyMap<number, TowerCache> }
const caches = new WeakMap<SimState, Cache>();
const params = (state: SimState, i: number): Params | undefined => state.level.buildings[i]?.modules['shoots'] as Params | undefined;
const radiusAt = (p: Params, stage: number): number => idiv(checked(checked(p.attackRadius + checked(p.radiusUpByLevel * (stage - 1))) * p.radiusUnit), 1000);
const delayMt = (p: Params, level: number): number => idiv(checked(p.speedUpByLevel * 1200000), checked(checked(p.attackDelay * level) + 60000));

/** Closed inner disc is excluded, including its integer-progress boundary. */
function annulus(lane: Lane, point: Point, radius: number, minRadius: number): Interval[] {
  const outer = laneIntervals(lane, { ...point, shape: 'circle', radius });
  const inner = laneIntervals(lane, { ...point, shape: 'circle', radius: minRadius })[0];
  if (!inner) return outer;
  const out: Interval[] = [];
  for (const [lo, hi] of outer) {
    if (lo < inner[0]) out.push([lo, Math.min(hi, inner[0] - 1)]);
    if (hi > inner[1]) out.push([Math.max(lo, inner[1] + 1), hi]);
  }
  return out;
}

/** Cold cache for every stage and ordered lane. Stage changes only select a
 * cache; no draw hook, capture hook or tick ever invokes BigInt geometry. */
function init(state: SimState, carriers: Int32Array): void {
  const { level } = state, n = state.buildings.n;
  const lanes: Lane[] = [];
  const towers = new Map<number, TowerCache>();
  for (let from = 0; from < n; from++) for (let to = 0; to < n; to++) lanes.push(makeLane(level.buildings[from]!, level.buildings[to]!));
  for (const i of carriers) {
    const p = params(state, i)!, point = level.buildings[i]!;
    state.buildings.col['shoots.cooldown']![i] = delayMt(p, state.buildings.level[i]!);
    const stages: StageCache[] = [];
    for (let stage = 1; stage <= level.rules.stageThresholds.length + 1; stage++) {
      const radius = radiusAt(p, stage);
      const houses: number[] = [];
      for (let j = 0; j < n; j++) {
        const house = level.buildings[j]!;
        if (house.kind !== 'house') continue;
        const f = house.footprint;
        const dx = checked(house.x - point.x), dz = checked(house.z - point.z);
        // Building footprints have no yaw. Doubled offsets preserve odd box
        // dimensions exactly; circle footprints retain their compiled meaning.
        const distance = f.shape === 'box' ? {
          x: Math.max(0, checked(2 * Math.abs(dx)) - f.w!),
          z: Math.max(0, checked(2 * Math.abs(dz)) - f.d!), denominator: 2,
        } : { x: dx, z: dz, denominator: 1 };
        if (compareRadiusSq(distance, radius + (f.shape === 'circle' ? f.radius! : 0)) <= 0) houses.push(j);
      }
      const centreDistance = (j: number): DistanceSq => ({ x: level.buildings[j]!.x - point.x, z: level.buildings[j]!.z - point.z, denominator: 1 });
      houses.sort((a, b) => compareDistanceSq(centreDistance(a), centreDistance(b)) || a - b);
      stages.push({ lanes: lanes.map(lane => annulus(lane, point, checked(radius + (p.troopPad ?? 350)), p.minRadius)), houses });
    }
    towers.set(i, { stages });
  }
  caches.set(state, { lanes, towers });
}

export const shoots: SimModuleFor<'shoots'> = {
  id: 'shoots', state: { cooldown: 0 }, init,
  phases: {
    towers(state, carriers) {
      const b = state.buildings, cooldown = b.col['shoots.cooldown']!, cache = caches.get(state)!;
      for (const i of carriers) {
        cooldown[i] = Math.max(0, cooldown[i]! - TICK_MT);
        const p = params(state, i)!;
        if (cooldown[i]! > 0 || b.level[i]! < 1 || (b.owner[i]! < 0 && !(p.neutralFires ?? true))) continue;
        const stage = cache.towers.get(i)!.stages[b.stage[i]! - 1]!, point = state.level.buildings[i]!;
        let best: { channel: number; seq: number; owner: number; distance: DistanceSq; point: Point } | null = null;
        for (const ch of liveChannels(state)) {
          const intervals = stage.lanes[ch.key]!;
          if (!intervals.length) continue;
          const ring = ch.troops;
          for (let row = 0; row < ring.len; row++) {
            const owner = ring.owner[row]!, seq = ring.seq[row]!;
            if (!hostile(state, owner, b.owner[i]!)) continue;
            const progress = Math.min(progressOf(state, ch, row), ch.length);
            if (!intervals.some(([lo, hi]) => progress >= lo && progress <= hi)) continue;
            const distance = distanceSq(cache.lanes[ch.key]!, point, progress);
            const order = best === null ? -1 : compareDistanceSq(distance, best.distance);
            if (order < 0 || (order === 0 && (owner < best!.owner || (owner === best!.owner && seq < best!.seq)))) {
              best = { channel: ch.key, seq, owner, distance, point: troopPosition(state, ch, row) };
            }
          }
        }
        if (best) {
          killTroop(state, best.channel, best.seq, 'tower');
          state.events?.push({ type: 'TowerShot', tower: i, target: { kind: 'troop', channel: best.channel, seq: best.seq }, ...best.point });
        } else {
          // Opponents' houses first; neutral houses only when no opponent house is in reach (R-TWR-02).
          const eligible = (j: number) => hostile(state, b.owner[j]!, b.owner[i]!) && b.level[j]! >= 1;
          const target = stage.houses.find(j => eligible(j) && b.owner[j]! >= 0)
            ?? ((p.hitsNeutralHouses ?? true) ? stage.houses.find(j => eligible(j) && b.owner[j]! < 0) : undefined);
          if (target === undefined) continue;
          setLevel(state, target, Math.max(0, b.level[target]! - 1));
          const house = state.level.buildings[target]!;
          state.events?.push({ type: 'TowerShot', tower: i, target: { kind: 'house', building: target }, x: house.x, z: house.z });
        }
        cooldown[i] = delayMt(p, b.level[i]!);
      }
    },
  },
};

/** Radius of the tower's current stage, in world milli-units. */
export function towerRadiusMilli(state: SimState, building: number): number {
  const p = params(state, building);
  return p ? radiusAt(p, state.buildings.stage[building]!) : 0;
}
