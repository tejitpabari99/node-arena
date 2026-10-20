import { BufferAttribute, BufferGeometry, CapsuleGeometry, Float32BufferAttribute, SphereGeometry, type Box3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type TroopLod = 'high' | 'low';
export type TroopLodMode = TroopLod | 'auto';
/** Auto policy thresholds (PRD Req 9). Exported so SP05's perf ladder can lower them via `TroopRendererOptions.lodThresholds`. */
export const LOD_LOW_COUNT = 600, LOD_HIGH_COUNT = 400, LOD_LOW_EMA_MS = 20, LOD_HIGH_EMA_MS = 14;
export const LOD_LOW_HOLD_S = 1, LOD_HIGH_HOLD_S = 3;
export interface LodThresholds { lowCount: number; highCount: number; lowEmaMs: number; highEmaMs: number; lowHoldSec: number; highHoldSec: number }
export const DEFAULT_LOD_THRESHOLDS: Readonly<LodThresholds> = { lowCount: LOD_LOW_COUNT, highCount: LOD_HIGH_COUNT, lowEmaMs: LOD_LOW_EMA_MS, highEmaMs: LOD_HIGH_EMA_MS, lowHoldSec: LOD_LOW_HOLD_S, highHoldSec: LOD_HIGH_HOLD_S };
const EMA_TAU_S = .25, MAX_FRAME_S = 1;
export function parseLodMode(value: string | null | undefined): TroopLodMode { return value === 'low' || value === 'high' ? value : 'auto'; }

/**
 * Auto LOD state machine, wall-clock driven (`nowSeconds` is injected: a fake clock in tests).
 * -> low: live > lowCount (immediate) OR frame-time EMA > lowEmaMs continuously for lowHoldSec.
 * -> high: live < highCount AND EMA < highEmaMs continuously for highHoldSec. Gaps (EMA 14..20 ms, live 400..600) keep the current state.
 * Allocation-free after construction.
 */
export function createLodPolicy(overrides: Partial<LodThresholds> = {}, initial: TroopLod = 'high') {
  const t: LodThresholds = { ...DEFAULT_LOD_THRESHOLDS, ...overrides };
  let state = initial, ema = 0, hasEma = false, last = -Infinity, since = -1;
  function update(live: number, nowSeconds: number): TroopLod {
    const dt = nowSeconds - last; last = nowSeconds;
    if (dt > 0 && dt <= MAX_FRAME_S) { const ms = dt * 1000; if (hasEma) ema += (1 - Math.exp(-dt / EMA_TAU_S)) * (ms - ema); else { ema = ms; hasEma = true; } }
    else if (dt > MAX_FRAME_S) since = -1; // paused/hidden tab: do not count the gap towards a hold
    if (state === 'high') {
      if (live > t.lowCount) { state = 'low'; since = -1; }
      else if (hasEma && ema > t.lowEmaMs) { if (since < 0) since = nowSeconds; if (nowSeconds - since >= t.lowHoldSec) { state = 'low'; since = -1; } }
      else since = -1;
    } else if (live < t.highCount && hasEma && ema < t.highEmaMs) {
      if (since < 0) since = nowSeconds; if (nowSeconds - since >= t.highHoldSec) { state = 'high'; since = -1; }
    } else since = -1;
    return state;
  }
  return { update, get state() { return state; }, get emaMs() { return ema; }, thresholds: t as Readonly<LodThresholds> };
}

/**
 * ~80-tri fallback figure in the high model's own units: team-masked capsule body + skin head sphere, same total height and (clamped) footprint
 * as `box`, so the shared troopScale/yOffset/pose give the same height and placement. Attributes match the patched-material contract
 * (position, normal, color, teamMask; vertexColors on).
 */
export function buildLowTroopGeometry(box: Box3): BufferGeometry {
  const height = Math.max(1e-3, box.max.y - box.min.y), foot = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const rb = Math.min(foot / 2, .22 * height), rh = .16 * height, bodyTop = .7 * height;
  const body = new CapsuleGeometry(rb, Math.max(1e-3, bodyTop - 2 * rb), 1, 8); body.translate(cx, box.min.y + bodyTop / 2, cz);
  const head = new SphereGeometry(rh, 8, 3); head.translate(cx, box.min.y + height - rh, cz);
  const parts: BufferGeometry[] = [];
  for (const [geometry, color, mask] of [[body, [1, 1, 1], 1], [head, [.95, .78, .62], 0]] as const) {
    geometry.deleteAttribute('uv'); const n = geometry.getAttribute('position').count;
    geometry.setAttribute('color', new Float32BufferAttribute(Array.from({ length: n }, (_, i) => color[i % 3]!), 3));
    geometry.setAttribute('teamMask', new BufferAttribute(new Float32Array(n).fill(mask), 1)); parts.push(geometry);
  }
  const merged = mergeGeometries(parts, false)!; for (const part of parts) part.dispose();
  merged.clearGroups(); merged.addGroup(0, merged.index ? merged.index.count : merged.getAttribute('position').count, 0); // array-material meshes draw nothing without a group
  merged.computeBoundingBox(); merged.computeBoundingSphere(); return merged;
}
