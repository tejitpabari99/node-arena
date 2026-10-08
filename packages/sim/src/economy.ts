import type { SimState } from './state.js';
import type { DrawValidation } from './commands.js';
import { idiv, TICK_RATE } from './math.js';
export function refreshSlots(state: SimState, towers: Int32Array): void {
  for (const i of towers) {
    let slots = 1;
    for (const threshold of state.towerParams[i]!.drawsLines!.extraSlotAbove!) if (threshold < state.tower.col['garrison.count']![i]!) slots++;
    state.tower.slots[i] = slots;
  }
}
export function validateLine(state: SimState, player: number, from: number, to: number): DrawValidation {
  const n = state.ids.towers.length;
  if (state.channels[from * n + to]?.drawn) return { reason: 'duplicate' };
  if (state.tower.lines[from]! >= state.tower.slots[from]!) return { reason: 'no-slot' };
  const reverse = state.channels[to * n + from];
  return { reason: null, ...(state.tower.owner[to] === player && reverse?.drawn && reverse.owner === player ? { reverse } : {}) };
}
export function generate(state: SimState, towers: Int32Array): void {
  const count = state.tower.col['garrison.count']!, cap = state.tower.col['garrison.cap']!, acc = state.tower.col['generates.acc']!;
  const denominator = 1000 * TICK_RATE;
  for (const i of towers) {
    const owner = state.tower.owner[i]!;
    if (owner === -1 || (state.tower.lines[i] === 0 && count[i]! >= cap[i]!)) continue;
    const total = acc[i]! + state.tower.col['generates.ratePerSec']![i]!;
    const troops = idiv(total, denominator);
    acc[i] = total % denominator;
    const value = troops * state.kinds[state.tower.col['generates.troop']![i]!]!.value;
    state.players.stats.generated[owner] = state.players.stats.generated[owner]! + value;
    if (state.tower.lines[i]! > 0) state.pendingDepartures[i] = troops;
    else {
      const added = Math.min(value, cap[i]! - count[i]!);
      count[i] = count[i]! + added;
      state.players.stats.overflowLost[owner] = state.players.stats.overflowLost[owner]! + value - added;
    }
  }
}
export function depart(state: SimState, towers: Int32Array): void {
  const n = state.ids.towers.length, cursor = state.tower.col['drawsLines.cursor']!;
  for (const from of towers) {
    while (state.pendingDepartures[from]! > 0) {
      let chosen = -1;
      for (let offset = 1; offset <= n; offset++) {
        const to = (cursor[from]! + offset) % n;
        if (state.channels[from * n + to]?.drawn) { chosen = to; break; }
      }
      if (chosen === -1) throw new Error('Pending departure without a drawn line');
      cursor[from] = chosen;
      const channel = state.channels[from * n + chosen]!, owner = state.tower.owner[from]!;
      const kind = state.tower.col['generates.troop']![from]!, value = state.kinds[kind]!.value, seq = ++state.troopSeq;
      channel.troops.push({ p0: 0, t0: state.tick, owner, kind, seq, value });
      state.players.transit[owner] = state.players.transit[owner]! + value;
      state.pendingDepartures[from] = state.pendingDepartures[from]! - 1;
      if (state.events) state.events.push({ type: 'TroopSpawned', tick: state.tick, channel: channel.key, seq, owner });
    }
  }
}
