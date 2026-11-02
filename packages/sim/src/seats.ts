import type { CompiledLevel } from './types.js';

/**
 * Seat-reduced view of a level (R-SEA-01): the first `n` player slots stay, buildings authored for a slot >= n become neutral
 * (owner -1, authored level kept). Pure; `n >= level.players.length` returns `level` itself. `id` and `simHash` are unchanged.
 */
export function forSeats(level: CompiledLevel, n: number): CompiledLevel {
  if (!Number.isInteger(n) || n < 0) throw new Error(`forSeats: invalid seat count ${String(n)}`);
  if (n >= level.players.length) return level;
  return {
    ...level,
    players: level.players.slice(0, n),
    buildings: level.buildings.map((b) => (b.owner >= n ? { ...b, owner: -1 } : b)),
  };
}
