import { TICK_RATE } from './math.js';
import type { Outcome as OutcomeId, Placement, SimState } from './types.js';

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

/** R-ELM-01 (pvp): ascending seat; no building and no troop in transit means eliminated, final. Troops are scanned only for building-less seats. */
function eliminationPass(state: SimState): void {
  const p = state.players, b = state.buildings;
  const owns = new Uint8Array(p.n);
  for (let i = 0; i < b.n; i++) { const o = b.owner[i]!; if (o >= 0 && o < p.n) owns[o] = 1; }
  for (let s = 0; s < p.n; s++) {
    if (p.eliminatedAt[s]! >= 0 || owns[s] !== 0) continue;
    // Defensive: R-CPT-01 kills troops sourced at a captured building, so a building-less seat has none in practice.
    let transit = false;
    for (const ch of state.channels.values()) {
      const r = ch.troops;
      for (let i = 0; i < r.len && !transit; i++) if (r.owner[i] === s) transit = true;
      if (transit) break;
    }
    if (transit) continue;
    p.eliminatedAt[s] = state.tick;
    state.events?.push({ type: 'SeatEliminated', player: s });
  }
}

/** R-WIN-07: final per-team metadata; equal strength/elimination ticks share competition rank. */
function placementRanking(state: SimState, seatsOf: Map<number, number[]>): Placement[] {
  const placements = new Map<number, Placement>();
  for (const [team, seats] of seatsOf) {
    let eliminatedAt: number | null = 0;
    for (const seat of seats) {
      const tick = state.players.eliminatedAt[seat]!;
      if (tick < 0) { eliminatedAt = null; break; }
      eliminatedAt = Math.max(eliminatedAt, tick);
    }
    placements.set(team, { team, seats: [...seats], rank: 0, buildings: 0, troops: 0, eliminatedAt });
  }
  const b = state.buildings;
  for (let i = 0; i < b.n; i++) {
    const owner = b.owner[i]!;
    if (owner < 0) continue;
    const placement = placements.get(state.team[owner]!)!;
    placement.buildings++; placement.troops += b.level[i]!;
  }
  for (const ch of state.channels.values()) for (let i = 0; i < ch.troops.len; i++) {
    const placement = placements.get(state.team[ch.troops.owner[i]!]!);
    if (placement) placement.troops++;
  }
  const compare = (a: Placement, b: Placement): number => {
    if (a.eliminatedAt === null) return b.eliminatedAt === null ? b.buildings - a.buildings || b.troops - a.troops : -1;
    return b.eliminatedAt === null ? 1 : b.eliminatedAt - a.eliminatedAt;
  };
  const ranking = [...placements.values()].sort((a, b) => compare(a, b) || a.team - b.team);
  for (let i = 0; i < ranking.length; i++) {
    ranking[i]!.rank = i > 0 && compare(ranking[i - 1]!, ranking[i]!) === 0 ? ranking[i - 1]!.rank : i + 1;
  }
  return ranking;
}

/** R-WIN-04..06 (pvp): last team standing, then time-limit ranking, draw on a top tie or no survivor. Null while running. */
function pvpOutcome(state: SimState): Outcome | null {
  const p = state.players, b = state.buildings, team = state.team;
  const seatsOf = new Map<number, number[]>();
  for (let s = 0; s < p.n; s++) { const t = team[s]!; const a = seatsOf.get(t); if (a) a.push(s); else seatsOf.set(t, [s]); }
  const alive: number[] = [];
  for (const [t, seats] of seatsOf) if (seats.some((s) => p.eliminatedAt[s]! < 0)) alive.push(t);
  const result = (outcome: OutcomeId, teams: number[]): Outcome => {
    const winners: number[] = [];
    for (const t of teams) winners.push(...seatsOf.get(t)!);
    winners.sort((x, y) => x - y);
    return { outcome, winner: outcome !== 'draw' && winners.length > 0 ? winners[0]! : null, winners, ranking: placementRanking(state, seatsOf) };
  };
  if (alive.length === 1) return result('victory', alive);
  if (alive.length === 0) return result('draw', []);
  const limit = state.level.timeLimitSec === null ? 0 : state.level.timeLimitSec * TICK_RATE;
  if (limit <= 0 || state.tick < limit) return null;
  const blds = new Map<number, number>(), troops = new Map<number, number>();
  for (const t of alive) { blds.set(t, 0); troops.set(t, 0); }
  const add = (m: Map<number, number>, seat: number, v: number): void => {
    if (seat < 0 || seat >= p.n) return;
    const t = team[seat]!;
    if (m.has(t)) m.set(t, m.get(t)! + v);
  };
  for (let i = 0; i < b.n; i++) {
    const o = b.owner[i]!;
    if (o < 0) continue;
    add(blds, o, 1); add(troops, o, b.level[i]!);
  }
  for (const ch of state.channels.values()) for (let i = 0; i < ch.troops.len; i++) add(troops, ch.troops.owner[i]!, 1);
  let best: number[] = [];
  for (const t of alive) {
    if (best.length === 0) { best = [t]; continue; }
    const c = best[0]!, d = blds.get(t)! - blds.get(c)! || troops.get(t)! - troops.get(c)!;
    if (d > 0) best = [t]; else if (d === 0) best.push(t);
  }
  return result(best.length === 1 ? 'timeLimit' : 'draw', best);
}

/** Phase 9: record the outcome once (final), flip ignored buildings on a win, emit `MatchOver`. */
export function winPass(state: SimState): void {
  if (state.over) return;
  const pvp = state.level.objective === 'pvp';
  if (pvp) eliminationPass(state);
  const over = pvp ? pvpOutcome(state) : evaluateOutcome(state);
  if (!over) return;
  if (over.outcome === 'won') {
    const b = state.buildings;
    for (let i = 0; i < b.n; i++) if (b.ignoreForWin[i] !== 0) b.owner[i] = over.winner!;
  }
  state.over = over;
  state.events?.push(over.winners
    ? { type: 'MatchOver', outcome: over.outcome, winner: over.winner, winners: [...over.winners] }
    : { type: 'MatchOver', outcome: over.outcome, winner: over.winner });
}
