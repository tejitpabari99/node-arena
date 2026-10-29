import type { CompiledLevel } from '@node-arena/content';
import { TICK_RATE } from '@node-arena/sim';
import { playPvp, PVP_CAP_MARGIN, DEFAULT_MAX_TICKS, type PlayPvp } from './levels.js';
/** Self-play proxy action delays (ms) for `balance --mode pvp` (03 R9). */
export const PVP_BALANCE_DELAYS = [1000, 2000, 4000] as const;
export interface PvpFairnessRow {
  level: string; position: number; runs: number; decisive: number; victory: number; timeLimit: number; draws: number; truncated: number;
  /** Per seat: share (%) of decisive runs the seat was among the winners; null when no decisive run (vacuous). */
  seatShares: (number | null)[]; meanSeconds: number; rejected: number;
  /** Order-stable digest input for rerun checks: `seed/delay:finalHash`. */
  hashes: string[];
}
/** All seats run the same proxy config; seeds 1..seeds x delays. Identical configs mean seat rotation is implicit: each seat meets every seed. Bounds are the caller's; nothing here fails. */
export function pvpFairness(level: CompiledLevel, position: number, seeds: number, delays: readonly number[] = PVP_BALANCE_DELAYS, run: PlayPvp = playPvp): PvpFairnessRow {
  const cap = (level.timeLimitSec === null ? DEFAULT_MAX_TICKS : level.timeLimitSec * TICK_RATE) + PVP_CAP_MARGIN;
  const row: PvpFairnessRow = { level: level.id, position, runs: 0, decisive: 0, victory: 0, timeLimit: 0, draws: 0, truncated: 0, seatShares: [], meanSeconds: 0, rejected: 0, hashes: [] };
  const seatWins = level.players.map(() => 0); let ticks = 0;
  for (const ad of delays) for (let seed = 1; seed <= seeds; seed++) {
    const r = run(level, seed, ad, cap);
    row.runs++; ticks += r.ticks; row.rejected += r.rejected ?? 0; row.hashes.push(`${seed}/${ad}:${r.finalHash}`);
    if (r.outcome === 'victory' || r.outcome === 'timeLimit') {
      row.decisive++; if (r.outcome === 'victory') row.victory++; else row.timeLimit++;
      for (const w of r.winners ?? []) seatWins[w] = (seatWins[w] ?? 0) + 1;
    } else if (r.outcome === 'draw') row.draws++;
    else row.truncated++;
  }
  row.seatShares = seatWins.map(w => row.decisive ? Math.round(1000 * w / row.decisive) / 10 : null);
  row.meanSeconds = row.runs ? Math.round(10 * ticks / TICK_RATE / row.runs) / 10 : 0;
  return row;
}
