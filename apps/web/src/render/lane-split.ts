/** Shared head-on lane split: target from channel front progress plus a critically damped spring. Pure, no allocation. */
export const SPLIT_OMEGA = 14;
/** Largest `dt` (s) one spring step integrates; longer gaps (tab switch) are clamped. */
export const SPLIT_MAX_DT = .25;
/**
 * Target split `s` as a fraction of the lane length measured from the lower-index tower A.
 * `progA` = front (max) progress of channel lo->hi, `progB` = front progress of hi->lo (measured from hi), `length` in the same sim units.
 * Empty side: `fa = 0` / `fb = 1`. An undrawn-and-empty side (`presentA`/`presentB` false) forces the target to the other end:
 * A absent -> 0 (all B), B absent -> 1 (all A). At the sim clash condition (`progA + progB >= length`) this is exactly `progA / length`.
 */
export function splitTarget(presentA: boolean, presentB: boolean, countA: number, progA: number, countB: number, progB: number, length: number): number {
  if (!presentA && !presentB) return .5;
  if (!presentA) return 0;
  if (!presentB) return 1;
  if (!(length > 0)) return .5;
  const fa = countA > 0 ? progA / length : 0, fb = countB > 0 ? 1 - progB / length : 1;
  return Math.min(1, Math.max(0, (fa + fb) / 2));
}
/** Exact critically damped spring step toward `target`; returns position and writes velocity into `out[0]`. */
export function stepSplit(s: number, v: number, target: number, dt: number, out: Float64Array | number[], omega = SPLIT_OMEGA): number {
  const h = Math.min(Math.max(dt, 0), SPLIT_MAX_DT);
  if (h === 0) { out[0] = v; return s; }
  const x = s - target, e = Math.exp(-omega * h), j = v + omega * x;
  out[0] = (v - omega * j * h) * e;
  return target + (x + j * h) * e;
}
