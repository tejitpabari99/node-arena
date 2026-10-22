import { COMMANDS } from '@node-arena/defs';
import type { Command, CommandId, RejectReason, SimEvent } from '@node-arena/defs';
import { fireLineCut, fireLineDrawn, firstDrawRejection } from './hooks.js';
import { getChannel } from './state.js';
import type { LineCutReason, SimState } from './types.js';

const MAX_INDEX = 2147483647;
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_INDEX;

interface Parsed { readonly type: CommandId; readonly player: number; readonly from: number; readonly to: number }

/** Strict payload parse (no throw): exact keys `type, player, from, to`, index ints. */
function parse(raw: unknown, expected: CommandId | null): Parsed | null {
  try {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const type = r['type'];
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(COMMANDS, type)) return null;
    if (expected !== null && type !== expected) return null;
    const keys = Object.keys(r);
    if (keys.length !== 4) return null;
    for (const k of keys) if (k !== 'type' && k !== 'player' && k !== 'from' && k !== 'to') return null;
    const { player, from, to } = r;
    if (!isIndex(player) || !isIndex(from) || !isIndex(to)) return null;
    return { type: type as CommandId, player, from, to };
  } catch {
    return null;
  }
}

/** Ids check shared by both commands: player, from, to must exist. */
function unknownId(state: SimState, c: Parsed): boolean {
  return c.player >= state.players.n || c.from >= state.buildings.n || c.to >= state.buildings.n;
}

function checkDraw(state: SimState, c: Parsed): RejectReason | null {
  if (state.over) return 'gameover';
  if (unknownId(state, c)) return 'unknown-id';
  const b = state.buildings;
  if (b.owner[c.from] !== c.player) return 'not-owner';
  if (c.from === c.to) return 'self';
  if (state.level.buildings[c.from]!.modules['drawsLines'] === undefined) return 'not-drawer';
  if (getChannelIfAny(state, c.from, c.to)?.drawn) return 'duplicate';
  if (b.stage[c.from]! - b.lines[c.from]! <= 0) return 'no-slot';
  return firstDrawRejection(state, c.from, c.to);
}

function checkCut(state: SimState, c: Parsed): RejectReason | null {
  if (state.over) return 'gameover';
  if (unknownId(state, c)) return 'unknown-id';
  if (!getChannelIfAny(state, c.from, c.to)?.drawn) return 'no-line';
  if (state.buildings.owner[c.from] !== c.player) return 'not-owner';
  return null;
}

function getChannelIfAny(state: SimState, from: number, to: number) {
  return state.channels.get(from * state.buildings.n + to);
}

/** Public validator: reject code or null. Never throws; shares the exact validators `DrawLine` uses. */
export function canDraw(state: SimState, player: unknown, from: unknown, to: unknown): RejectReason | null {
  try {
    const c = parse({ type: 'DrawLine', player, from, to }, 'DrawLine');
    if (!c) return state.over ? 'gameover' : 'malformed';
    return state.over ? 'gameover' : checkDraw(state, c);
  } catch {
    return 'malformed';
  }
}

function emit(state: SimState, ev: SimEvent): void { state.events?.push(ev); }

/** Remove the line `from -> to`: zero drawSeq/timer (hash independent of history), free the slot, emit, hook. Troops stay. */
export function cutLine(state: SimState, from: number, to: number, reason: LineCutReason): void {
  const ch = getChannelIfAny(state, from, to);
  if (!ch || !ch.drawn) return;
  ch.drawn = 0; ch.drawSeq = 0; ch.timer = 0;
  state.buildings.lines[from]!--;
  emit(state, { type: 'LineCut', from, to, reason });
  fireLineCut(state, from, to, reason);
}

function drawLine(state: SimState, c: Parsed): void {
  const reverse = getChannelIfAny(state, c.to, c.from);
  // Same-owner reverse is replaced (troops stay); a hostile reverse coexists (head-on).
  if (reverse?.drawn && state.buildings.owner[c.to] === state.buildings.owner[c.from]) cutLine(state, c.to, c.from, 'replaced');
  const ch = getChannel(state, c.from, c.to);
  ch.drawn = 1; ch.timer = 0; ch.drawSeq = ++state.drawSeq;
  state.buildings.lines[c.from]!++;
  emit(state, { type: 'LineDrawn', from: c.from, to: c.to, owner: state.buildings.owner[c.from]!, drawSeq: ch.drawSeq });
  fireLineDrawn(state, c.from, c.to, ch.drawSeq);
}

function reject(state: SimState, raw: unknown, c: Parsed | null, reason: RejectReason): void {
  state.rejected++;
  if (!state.events) return;
  try {
    const r = raw as { type?: unknown; player?: unknown } | null;
    const type = c?.type ?? r?.type;
    const player = c?.player ?? r?.player;
    if (typeof type === 'string' && Object.prototype.hasOwnProperty.call(COMMANDS, type) && isIndex(player)) emit(state, { type: 'CommandRejected', player, command: type as CommandId, reason });
  } catch { /* unreadable input: counted only */ }
}

/** Phase 1: apply commands in (player idx, submission index) order, each validated then applied atomically. */
export function runCommands(state: SimState, commands: readonly unknown[]): void {
  const order: { raw: unknown; player: number; i: number }[] = [];
  let list: readonly unknown[] = [];
  try { list = Array.isArray(commands) ? commands : []; } catch { list = []; }
  for (let i = 0; i < list.length; i++) {
    let raw: unknown; let player = Infinity;
    try { raw = list[i]; const p = (raw as { player?: unknown } | null)?.player; if (isIndex(p)) player = p; } catch { raw = null; }
    order.push({ raw, player, i });
  }
  order.sort((a, b) => (a.player - b.player) || (a.i - b.i) || 0);
  for (const { raw } of order) {
    const c = parse(raw, null);
    if (!c) { reject(state, raw, null, state.over ? 'gameover' : 'malformed'); continue; }
    const reason = c.type === 'DrawLine' ? checkDraw(state, c) : checkCut(state, c);
    if (reason) { reject(state, raw, c, reason); continue; }
    if (c.type === 'DrawLine') drawLine(state, c); else cutLine(state, c.from, c.to, 'player');
  }
}

export type { Command };
