import { idiv, isqrt, mulDiv } from './math.js';

/** R-TCK-06: one eligible tick adds this many milli-ticks (`numericScale`). */
export const TICK_MT = 1000;

/** R-SPN-01: `K = 1000 + penalty*(n-1)`; `period = idiv(K*1_200_000, spawnSpeed*L + 60000)`, clamped to >= 1000. */
export function spawnPeriodMt(level: number, lines: number, spawnSpeed: number, lineSpawnPenalty: number): number {
  const k = TICK_MT + mulDiv(lineSpawnPenalty, Math.max(lines, 1) - 1, 1);
  const period = mulDiv(k, 1_200_000, mulDiv(spawnSpeed, level, 1) + 60000);
  return Math.max(TICK_MT, period);
}

/** R-GRW-01: `k = idiv(L,10)+1`; `period = idiv((idiv(base*1000, isqrt(k*1e6)) + 1000) * growTime, 50)`, clamped to >= 1000. */
export function growPeriodMt(level: number, growTime: number, growthBase: number): number {
  const k = idiv(level, 10) + 1;
  const inner = idiv(mulDiv(growthBase, 1000, 1), isqrt(mulDiv(k, 1_000_000, 1))) + 1000;
  return Math.max(TICK_MT, mulDiv(inner, growTime, 50));
}
