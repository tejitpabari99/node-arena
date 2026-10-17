import type { SimState, Channel } from './state.js';
import { arrive, clash } from './combat.js';
import { outcome, assertInvariants } from './tick.js';
export type Command =
  | { type: 'DrawLine'; player: string; from: string; to: string }
  | { type: 'CutLine'; player: string; from: string; to: string };
export type RejectReason = 'not-owner' | 'self' | 'no-slot' | 'duplicate' | 'gameover' | 'unknown-id' | 'no-component';
export type Outcome = 'won' | 'lost' | 'draw' | 'timeout';
export interface GameOver { outcome: Outcome; winnerTeam: string | null }
export type SimEvent =
  | { type: 'LineDrawn'; tick: number; channel: number; from: number; to: number; owner: number }
  | { type: 'LineCut'; tick: number; channel: number; reason: 'player' | 'slots' | 'captured' | 'replaced' }
  | { type: 'TroopSpawned'; tick: number; channel: number; seq: number; owner: number }
  | { type: 'Clash'; tick: number; channel: number; progA: number; progB: number; value: number }
  | { type: 'TroopArrived'; tick: number; tower: number; owner: number; effect: 'reinforce' | 'overflow' | 'hit' }
  | { type: 'Captured'; tick: number; tower: number; from: number; to: number }
  | { type: 'PlayerEliminated'; tick: number; player: number }
  | ({ type: 'GameOver'; tick: number } & GameOver)
  | { type: 'CommandRejected'; tick: number; cmd: unknown; reason: RejectReason };
export interface DrawValidation { reason: RejectReason | null; reverse?: Channel }
const emptyEvents: readonly SimEvent[] = Object.freeze([]);
function ids(state: SimState, player: unknown, from: unknown, to: unknown): [number, number, number] | null {
  if (typeof player !== 'string' || typeof from !== 'string' || typeof to !== 'string') return null;
  const p = state.ids.players.indexOf(player), a = state.ids.towers.indexOf(from), b = state.ids.towers.indexOf(to);
  return p < 0 || a < 0 || b < 0 ? null : [p, a, b];
}
export function validateDraw(state: SimState, player: unknown, from: unknown, to: unknown): DrawValidation {
  if (state.over) return { reason: 'gameover' };
  const indices = ids(state, player, from, to);
  if (!indices) return { reason: 'unknown-id' };
  const [p, a, b] = indices;
  if (state.tower.owner[a] !== p) return { reason: 'not-owner' };
  if (a === b) return { reason: 'self' };
  for (const component of state.components) {
    if (Object.hasOwn(state.towerParams[a]!, component.name) && component.hooks?.validateDraw) return component.hooks.validateDraw(state, p, a, b);
  }
  return { reason: 'no-component' };
}
export function cutChannel(state: SimState, channel: Channel, reason: 'player' | 'slots' | 'captured' | 'replaced'): void {
  if (!channel.drawn) return;
  channel.drawn = 0;
  state.tower.lines[channel.from] = state.tower.lines[channel.from]! - 1;
  if (state.events) state.events.push({ type: 'LineCut', tick: state.tick, channel: channel.key, reason });
}
export function step(state: SimState, commands: readonly Command[], options: { events?: boolean } = {}): readonly SimEvent[] {
  if (state.over) return emptyEvents;
  state.tick++;
  state.events = options.events === false ? null : [];
  state.pendingDepartures.fill(0);
  // Stable explicit tie-break preserves original order, including malformed shapes.
  const ordered = commands.map((cmd: unknown, index) => {
    const player = cmd !== null && typeof cmd === 'object' && 'player' in cmd ? cmd.player : undefined;
    return { cmd, index, player: typeof player === 'string' ? state.ids.players.indexOf(player) : -1 };
  }).sort((a, b) => a.player - b.player || a.index - b.index);
  for (const { cmd } of ordered) {
    let reason: RejectReason | null = 'unknown-id';
    if (cmd !== null && typeof cmd === 'object' && 'type' in cmd && 'player' in cmd && 'from' in cmd && 'to' in cmd && (cmd.type === 'DrawLine' || cmd.type === 'CutLine')) {
      const indices = ids(state, cmd.player, cmd.from, cmd.to);
      if (indices) {
        const [p, from, to] = indices;
        if (cmd.type === 'DrawLine') {
          const validation = validateDraw(state, cmd.player, cmd.from, cmd.to);
          reason = validation.reason;
          if (reason === null) {
            if (validation.reverse) cutChannel(state, validation.reverse, 'replaced');
            const channel = state.ensureChannel(from, to);
            channel.drawn = 1; channel.owner = p; channel.drawSeq = ++state.drawSeq;
            state.tower.lines[from] = state.tower.lines[from]! + 1;
            if (state.events) state.events.push({ type: 'LineDrawn', tick: state.tick, channel: channel.key, from, to, owner: p });
          }
        } else {
          const channel = state.channels[from * state.ids.towers.length + to];
          reason = channel?.drawn ? channel.owner === p ? null : 'not-owner' : 'unknown-id';
          if (reason === null) cutChannel(state, channel!, 'player');
        }
      }
    }
    if (reason !== null) {
      state.rejected++;
      if (state.events) state.events.push({ type: 'CommandRejected', tick: state.tick, cmd, reason });
    }
  }
  for (const phase of state.phases) {
    if (phase === 'clash') clash(state);
    if (phase === 'arrivals') arrive(state);
    for (const system of state.systems[phase]!) system.run(state, state.componentTowers.get(system.component)!);
    if (phase === 'win') outcome(state);
  }
  if (state.debug) assertInvariants(state);
  const events = state.events ?? emptyEvents;
  state.events = null;
  return events;
}
