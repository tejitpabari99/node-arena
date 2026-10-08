import type { PlayerState } from './state.js';

/** Reporting counters carry exact integers independently of int32 rule columns. */
export function addStat(stats: PlayerState['stats'], name: keyof PlayerState['stats'], player: number, amount: number): void {
  const value = stats[name][player]! + amount;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Stats safe-integer invariant breached');
  stats[name][player] = value;
}
