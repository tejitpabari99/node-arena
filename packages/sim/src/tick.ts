import type { SimState } from './state.js';
import type { Outcome } from './commands.js';
import { sortedNames } from './registry.js';

/** Eliminate by ownership plus transit, then apply timeout before any team result. */
export function outcome(state: SimState): void {
  const owned = new Int32Array(state.ids.players.length);
  for (const owner of state.tower.owner) if (owner !== -1) owned[owner] = owned[owner]! + 1;
  const teams = new Set<number>();
  let humanAlive = false;
  for (let player = 0; player < owned.length; player++) {
    const alive = owned[player]! > 0 || state.players.transit[player]! > 0;
    state.players.alive[player] = alive ? 1 : 0;
    if (alive) {
      teams.add(state.players.team[player]!);
      if (state.players.kind[player] === 'human') humanAlive = true;
    } else if (!state.eliminated[player]) {
      state.eliminated[player] = 1;
      if (state.events) state.events.push({ type: 'PlayerEliminated', tick: state.tick, player });
    }
  }
  let result: Outcome | null = null;
  if (state.tick >= state.timeLimitTicks) result = 'timeout';
  else if (teams.size === 0) result = 'draw';
  else if (!humanAlive) result = 'lost';
  else if (teams.size === 1) result = 'won';
  if (result !== null) {
    const winnerTeam = result !== 'timeout' && teams.size === 1 ? state.teamIds[teams.values().next().value!]! : null;
    state.over = { outcome: result, winnerTeam };
    if (state.events) state.events.push({ type: 'GameOver', tick: state.tick, ...state.over });
  }
}
function int32(value: number): void {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('int32 invariant breached');
}
function column(values: Int32Array): void { for (const value of values) int32(value); }
/** Deliberately opt-in: full ring recount would defeat lazy movement on production ticks. */
export function assertInvariants(state: SimState): void {
  for (const value of [state.tick, state.rejected, state.drawSeq, state.troopSeq, state.timeLimitTicks]) int32(value);
  for (const values of [state.tower.owner, state.tower.team, state.tower.slots, state.tower.lines, state.pendingDepartures, state.players.team, state.players.alive, state.players.transit, state.eliminated]) column(values);
  for (const name of sortedNames(state.tower.col)) column(state.tower.col[name]!);
  const transit = Array.from({ length: state.ids.players.length }, () => 0);
  const lines = new Int32Array(state.ids.towers.length);
  let inflight = 0, garrison = 0;
  for (const channel of state.channels) {
    if (!channel) continue;
    for (const value of [channel.key, channel.from, channel.to, channel.length, channel.drawn, channel.drawSeq, channel.owner, channel.troops.size]) int32(value);
    if (channel.drawn) lines[channel.from] = lines[channel.from]! + 1;
    channel.troops.forEach(troop => {
      for (const value of [troop.p0, troop.t0, troop.owner, troop.kind, troop.seq, troop.value]) int32(value);
      if (troop.value <= 0 || troop.owner < 0 || troop.owner >= transit.length || troop.kind < 0 || troop.kind >= state.kinds.length) throw new Error('Troop invariant breached');
      transit[troop.owner] = transit[troop.owner]! + troop.value;
      inflight += troop.value;
    });
  }
  for (let player = 0; player < transit.length; player++) {
    if (transit[player] !== state.players.transit[player]) throw new Error('Transit recount invariant breached');
    for (const name of sortedNames(state.players.stats)) {
      const value = state.players.stats[name as keyof typeof state.players.stats][player]!;
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Stats safe-integer invariant breached');
    }
  }
  const count = state.tower.col['garrison.count'], cap = state.tower.col['garrison.cap'];
  for (let tower = 0; tower < lines.length; tower++) {
    if (lines[tower] !== state.tower.lines[tower] || lines[tower]! > state.tower.slots[tower]!) throw new Error('Line slots invariant breached');
    if (count && cap) {
      if (count[tower]! < 0 || count[tower]! > cap[tower]!) throw new Error('Garrison invariant breached');
      garrison += count[tower]!;
    }
  }
  const { initial, generated, hits, clashes, overflow } = state.accounting;
  for (const value of [initial, generated, hits, clashes, overflow]) if (!Number.isSafeInteger(value) || value < 0) throw new Error('Accounting integer invariant breached');
  if (initial + generated !== garrison + inflight + 2 * hits + 2 * clashes + overflow) throw new Error('Conservation invariant breached');
}
