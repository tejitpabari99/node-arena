import { TICK_RATE } from './math.js';
import type { SimState } from './types.js';

type Outcome = NonNullable<SimState['over']>;

/** Human seat index (first `kind` 0), or -1. */
function humanSeat(state: SimState): number {
  const kind = state.players.kind;
  for (let i = 0; i < state.players.n; i++) if (kind[i] === 0) return i;
  return -1;
}

/** Pure outcome evaluation (R-WIN-01..03): win, then loss, then timeout. Null while the match runs. */
export function evaluateOutcome(state: SimState): Outcome | null {
  const human = humanSeat(state);
  if (human < 0) return null;
  const b = state.buildings;
  let owned = 0, other = 0;
  for (let i = 0; i < b.n; i++) {
    if (b.ignoreForWin[i] !== 0) continue;
    if (b.owner[i] === human) owned++; else other++;
  }
  if (other === 0 && owned > 0) return { outcome: 'won', winner: human };
  if (owned === 0) return { outcome: 'lost', winner: null };
  const limit = state.level.timeLimitSec === null ? 0 : state.level.timeLimitSec * TICK_RATE;
  if (limit > 0 && state.tick >= limit) return { outcome: 'timeout', winner: null };
  return null;
}

/** Phase 9: record the outcome once (final), flip ignored buildings on a win, emit `MatchOver`. */
export function winPass(state: SimState): void {
  if (state.over) return;
  const over = evaluateOutcome(state);
  if (!over) return;
  if (over.outcome === 'won') {
    const b = state.buildings;
    for (let i = 0; i < b.n; i++) if (b.ignoreForWin[i] !== 0) b.owner[i] = over.winner!;
  }
  state.over = over;
  state.events?.push({ type: 'MatchOver', outcome: over.outcome, winner: over.winner });
}
