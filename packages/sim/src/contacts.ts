import type { SimEvent } from '@node-arena/defs';
import { activeCrossings, createCrossingScratch, fillCrossingScratch, prepareCrossingRow, sweepPrepared, sweepsMayTouch, type CrossingScratch } from './crossings.js';
import { cutLine } from './commands.js';
import { fireCapture } from './hooks.js';
import { TICK_RATE, idiv } from './math.js';
import { hostile, killTroop, liveChannels, progressOf, setLevel, spawnTroop, troopPosition } from './state.js';
import type { Channel, SimState } from './types.js';

// Derived scratch never enters snapshots/hashes. Its rows are private to this
// state and contact phase; retired channels release their bounded row pools.
const crossingScratch = new WeakMap<SimState, Map<number,CrossingScratch>>();
/** R-CMB-04: deterministic pair/sequence order, after head-on. */
export function crossingPass(state: SimState): void {
  let scratch = crossingScratch.get(state);
  if (!scratch) { scratch = new Map(); crossingScratch.set(state,scratch); }
  for (const [key] of scratch) {
    const ch=state.channels.get(key);
    if (!ch || (!ch.drawn && !ch.troops.len)) scratch.delete(key);
  }
  for (const ch of liveChannels(state)) {
    if (!ch.troops.len) continue;
    let entry=scratch.get(ch.key);
    if (!entry) { entry=createCrossingScratch();scratch.set(ch.key,entry); }
    fillCrossingScratch(state,ch,entry);
  }
  for (const pair of activeCrossings(state)) {
    const A = state.channels.get(pair.a)!, B = state.channels.get(pair.b)!;
    if (!A.troops.len || !B.troops.len) continue;
    const boundA = scratch.get(A.key)!, boundB = scratch.get(B.key)!;
    if (boundA.owner !== undefined && boundB.owner !== undefined && !hostile(state, boundA.owner, boundB.owner)) continue;
    if (boundA.end < pair.windowA[0] || boundA.start > pair.windowA[1] || boundB.end < pair.windowB[0] || boundB.start > pair.windowB[1]) continue;
    for (const rowA of boundA.rows) {
      if (rowA.end < pair.windowA[0] || rowA.start > pair.windowA[1]) continue;
      for (const rowB of boundB.rows) {
        if (rowB.end < pair.windowB[0] || rowB.start > pair.windowB[1]) continue;
        if (!hostile(state, rowA.owner, rowB.owner)) continue;
        const sweepA = prepareCrossingRow(rowA,pair.laneA), sweepB = prepareCrossingRow(rowB,pair.laneB);
        if (!sweepsMayTouch(sweepA,sweepB,state.level.rules.contactDistance)) continue;
        const seqA = rowA.seq, seqB = rowB.seq;
        const ia = A.troops.indexOfSeq(seqA), ib = B.troops.indexOfSeq(seqB);
        if (ia < 0) break;
        if (ib < 0 || !hostile(state, A.troops.owner[ia]!, B.troops.owner[ib]!)) continue;
        if (sweepPrepared(state, pair, sweepA, sweepB)) exchange(state, A.key, seqA, B.key, seqB, 'crossing');
      }
    }
  }
}

export interface ExchangeResult { readonly aAlive: boolean; readonly bAlive: boolean }

/**
 * R-CMB-05 / SP04 seam. Exchange between troop `seqA` on channel key `chA` and `seqB` on `chB`: both attacks are
 * read first, damage applies simultaneously, hp <= 0 dies (`killTroop` cause clash); a second round runs only if
 * both survive (max 2 rounds). Emits one `Clash` (`kind`, default head-on) at the midpoint. Same-owner or missing
 * troops: no-op.
 */
export function exchange(state: SimState, chA: number, seqA: number, chB: number, seqB: number, kind: 'headon' | 'crossing' = 'headon'): ExchangeResult {
  const A = state.channels.get(chA), B = state.channels.get(chB);
  const ia = A ? A.troops.indexOfSeq(seqA) : -1, ib = B ? B.troops.indexOfSeq(seqB) : -1;
  if (!A || !B || ia < 0 || ib < 0) return { aAlive: ia >= 0, bAlive: ib >= 0 };
  const ownerA = A.troops.owner[ia]!, ownerB = B.troops.owner[ib]!;
  if (!hostile(state, ownerA, ownerB)) return { aAlive: true, bAlive: true };
  if (state.events) {
    const pa = troopPosition(state, A, ia), pb = troopPosition(state, B, ib);
    const ev: SimEvent = {
      type: 'Clash', kind,
      a: { channel: chA, seq: seqA, owner: ownerA }, b: { channel: chB, seq: seqB, owner: ownerB },
      x: idiv(pa.x + pb.x, 2), z: idiv(pa.z + pb.z, 2),
    };
    state.events.push(ev);
  }
  let aAlive = true, bAlive = true;
  for (let round = 0; round < 2 && aAlive && bAlive; round++) {
    const ra = A.troops.indexOfSeq(seqA), rb = B.troops.indexOfSeq(seqB);
    const atkA = state.level.units[A.troops.kind[ra]!]!.attack, atkB = state.level.units[B.troops.kind[rb]!]!.attack;
    A.troops.hp[ra]! -= atkB;
    B.troops.hp[rb]! -= atkA;
    aAlive = A.troops.hp[ra]! > 0;
    bAlive = B.troops.hp[rb]! > 0;
    if (!aAlive) killTroop(state, chA, seqA, 'clash');
    if (!bAlive) killTroop(state, chB, seqB, 'clash');
  }
  return { aAlive, bAlive };
}

/** R3 phase 6, first half: head-on pairs by ascending (from < to); new fronts are re-tested while a pair qualifies, a surviving pair waits for the next tick. */
export function headOnPass(state: SimState): void {
  const contact = state.level.rules.contactDistance * TICK_RATE;
  for (const A of liveChannels(state)) {
    if (A.from >= A.to) continue;
    const B = state.channels.get(A.to * state.buildings.n + A.from);
    if (!B) continue;
    while (A.troops.len > 0 && B.troops.len > 0) {
      if (!hostile(state, A.troops.owner[0]!, B.troops.owner[0]!)) break;
      if (progressOf(state, A, 0) + progressOf(state, B, 0) < A.length - contact) break;
      const r = exchange(state, A.key, A.troops.seq[0]!, B.key, B.troops.seq[0]!, 'headon');
      if (r.aAlive && r.bAlive) break; // max 2 rounds per pair per tick (R-CMB-05); survivors re-test next tick
    }
  }
}

/** R3 phase 6. */
export function contactsPass(state: SimState): void {
  headOnPass(state);
  crossingPass(state);
}

interface Arrival { readonly ch: Channel; readonly seq: number; readonly overshoot: number }

function emit(state: SimState, ev: SimEvent): void { state.events?.push(ev); }

/** R-CPT-01: flip owner, level 0, cancel old outgoing lines, kill every troop sourced here, reset growth, clear ignoreForWin. */
function capture(state: SimState, x: number, newOwner: number): void {
  const b = state.buildings, n = b.n, old = b.owner[x]!;
  b.owner[x] = newOwner;
  setLevel(state, x, 0);
  b.ignoreForWin[x] = 0;
  emit(state, { type: 'BuildingCaptured', building: x, from: old, to: newOwner });
  for (let to = 0; to < n; to++) cutLine(state, x, to, 'captured');
  for (const ch of liveChannels(state)) {
    if (ch.from !== x) continue;
    const seqs = Array.from(ch.troops.seq.subarray(0, ch.troops.len));
    for (const seq of seqs) killTroop(state, ch.key, seq, 'capture');
  }
  fireCapture(state, x, old, newOwner);
}

/** R-CAP-03: one fwd draw picks among drawn outgoing lines; lost (no draw) with no line or at the alive cap. */
function forwardSurplus(state: SimState, building: number, kind: number): void {
  const b = state.buildings;
  if (b.lines[building]! < 1 || b.alive[building]! >= state.level.rules.aliveCap) return;
  let k = state.fwd[building]!.below(b.lines[building]!);
  for (let to = 0; to < b.n; to++) {
    const ch = state.channels.get(building * b.n + to);
    if (!ch || !ch.drawn) continue;
    if (k-- > 0) continue;
    const seq = spawnTroop(state, building, to, kind);
    emit(state, { type: 'TroopSpawned', channel: ch.key, seq, owner: b.owner[building]!, kind: state.level.units[kind]!.id, cause: 'forward' });
    return;
  }
}

/** R3 phase 8: arrivals by overshoot desc, channel key, FIFO seq; ownership re-evaluated per arrival. */
export function arrivalPass(state: SimState): void {
  const list: Arrival[] = [];
  for (const ch of liveChannels(state)) {
    for (let i = 0; i < ch.troops.len; i++) {
      const overshoot = progressOf(state, ch, i) - ch.length;
      if (overshoot >= 0) list.push({ ch, seq: ch.troops.seq[i]!, overshoot });
    }
  }
  list.sort((p, q) => (q.overshoot - p.overshoot) || (p.ch.key - q.ch.key) || (p.seq - q.seq));
  const b = state.buildings;
  for (const { ch, seq } of list) {
    const i = ch.troops.indexOfSeq(seq);
    if (i < 0) continue; // killed by an earlier capture this tick
    const owner = ch.troops.owner[i]!, kind = ch.troops.kind[i]!, unit = state.level.units[kind]!;
    const to = ch.to;
    ch.troops.removeAt(i);
    b.alive[ch.from]!--;
    state.counters.arrived++;
    const base = { channel: ch.key, seq, owner, kind: unit.id };
    if (b.owner[to] === owner) {
      const sum = b.level[to]! + unit.defense, surplus = sum - b.maxLevel[to]!;
      setLevel(state, to, Math.min(sum, b.maxLevel[to]!));
      emit(state, { type: 'TroopArrived', ...base, effect: surplus > 0 ? 'overflow' : 'reinforce' });
      if (surplus > 0) forwardSurplus(state, to, kind);
    } else {
      const rest = b.level[to]! - unit.attack;
      emit(state, { type: 'TroopArrived', ...base, effect: 'hit' });
      if (rest < 0) capture(state, to, owner);
      else setLevel(state, to, rest);
    }
  }
}

