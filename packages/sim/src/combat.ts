import type { Channel, SimState, Troop } from './state.js';
import { cutChannel } from './commands.js';

/** Neutral is hostile to every owner; allegiance belongs to the troop, not its source. */
export function friendly(state: SimState, a: number, b: number): boolean {
  return a !== -1 && b !== -1 && state.players.team[a] === state.players.team[b];
}
export function progress(state: SimState, troop: Troop): number {
  return troop.p0 + (state.tick - troop.t0) * state.kinds[troop.kind]!.speedPerTick;
}
export function arrivalHooks(state: SimState, hook: 'onArrive' | 'onHit', tower: number, troop: Troop): void {
  for (const component of state.components) {
    if (Object.hasOwn(state.towerParams[tower]!, component.name)) component.hooks?.[hook]?.(state, tower, troop);
  }
}
function creditKill(state: SimState, owner: number, value: number): void {
  if (owner !== -1) state.players.stats.kills[owner] = state.players.stats.kills[owner]! + value;
}
function removeTransit(state: SimState, owner: number, value: number): void {
  if (owner !== -1) state.players.transit[owner] = state.players.transit[owner]! - value;
}
/** Each unordered tower pair is inspected once; only fronts that actually clash are consumed. */
export function clash(state: SimState): void {
  const n = state.ids.towers.length;
  for (let from = 0; from < n; from++) for (let to = from + 1; to < n; to++) {
    const a = state.channels[from * n + to], b = state.channels[to * n + from];
    if (!a || !b) continue;
    while (a.troops.size && b.troops.size) {
      const frontA = a.troops.front()!, frontB = b.troops.front()!;
      if (friendly(state, frontA.owner, frontB.owner)) break;
      const progA = progress(state, frontA), progB = progress(state, frontB);
      if (progA + progB < a.length) break;
      const value = Math.min(frontA.value, frontB.value);
      state.accounting.clashes += value;
      a.troops.consumeFront(value); b.troops.consumeFront(value);
      removeTransit(state, frontA.owner, value); removeTransit(state, frontB.owner, value);
      creditKill(state, frontA.owner, value); creditKill(state, frontB.owner, value);
      if (state.events) state.events.push({ type: 'Clash', tick: state.tick, channel: a.key, progA, progB, value });
    }
  }
}
interface Arrival { channel: Channel; troop: Troop; overshoot: number; fifo: number }
/** Scan fronts only; drain arrived prefixes and totally order the resulting queue. */
export function arrive(state: SimState): void {
  const arrivals: Arrival[] = [];
  for (const channel of state.channels) {
    if (!channel) continue;
    let fifo = 0;
    while (channel.troops.size) {
      const troop = channel.troops.front()!, overshoot = progress(state, troop) - channel.length;
      if (overshoot < 0) break;
      arrivals.push({ channel, troop, overshoot, fifo: fifo++ });
      channel.troops.shift();
    }
  }
  arrivals.sort((a, b) => b.overshoot - a.overshoot || a.channel.key - b.channel.key || a.fifo - b.fifo);
  for (const { channel, troop } of arrivals) {
    removeTransit(state, troop.owner, troop.value);
    arrivalHooks(state, 'onArrive', channel.to, troop);
  }
}

/** Registered garrison behavior; core arrival scan never interprets component columns. */
export function garrisonArrive(state: SimState, tower: number, troop: Troop): void {
  const count = state.tower.col['garrison.count']!, cap = state.tower.col['garrison.cap']!;
  const owner = state.tower.owner[tower]!;
  if (friendly(state, owner, troop.owner)) {
    const added = Math.min(troop.value, cap[tower]! - count[tower]!);
    state.accounting.overflow += troop.value - added;
    count[tower] = count[tower]! + added;
    state.players.stats.overflowLost[troop.owner] = state.players.stats.overflowLost[troop.owner]! + troop.value - added;
    if (state.events) state.events.push({ type: 'TroopArrived', tick: state.tick, tower, owner: troop.owner, effect: added === troop.value ? 'reinforce' : 'overflow' });
    return;
  }
  const damage = Math.min(troop.value, count[tower]!);
  state.accounting.hits += damage;
  count[tower] = count[tower]! - damage;
  creditKill(state, troop.owner, damage); creditKill(state, owner, damage);
  if (state.events) state.events.push({ type: 'TroopArrived', tick: state.tick, tower, owner: troop.owner, effect: 'hit' });
  const remainder = troop.value - damage;
  arrivalHooks(state, 'onHit', tower, { ...troop, value: remainder });
  // A noncapturable target discards leftover value; capture already accounts its additions.
  if (state.tower.owner[tower] === owner && remainder > 0) {
    state.accounting.overflow += remainder;
    if (troop.owner !== -1) state.players.stats.overflowLost[troop.owner] = state.players.stats.overflowLost[troop.owner]! + remainder;
  }
}
/** Registered capturable behavior runs inline after the garrison has taken the hit. */
export function capturableHit(state: SimState, tower: number, troop: Troop): void {
  const count = state.tower.col['garrison.count']!;
  if (count[tower] !== 0) return;
  const from = state.tower.owner[tower]!;
  state.tower.owner[tower] = troop.owner;
  state.tower.team[tower] = troop.owner === -1 ? -1 : state.players.team[troop.owner]!;
  const added = Math.min(troop.value, state.tower.col['garrison.cap']![tower]!);
  state.accounting.overflow += troop.value - added;
  count[tower] = added;
  if (troop.owner !== -1) {
    state.players.stats.overflowLost[troop.owner] = state.players.stats.overflowLost[troop.owner]! + troop.value - added;
    state.players.stats.captures[troop.owner] = state.players.stats.captures[troop.owner]! + 1;
  }
  const n = state.ids.towers.length;
  for (let to = 0; to < n; to++) {
    const channel = state.channels[tower * n + to];
    if (channel?.drawn && channel.owner === from) cutChannel(state, channel, 'captured');
  }
  state.resetOnCapture(tower);
  if (state.events) state.events.push({ type: 'Captured', tick: state.tick, tower, from, to: troop.owner });
}
