import { idiv, type Command, type SimView } from '@node-arena/sim';
import type { SeatBot } from '@node-arena/content';

/** `1000 / TICK_RATE`; all seat timers are integer ms. */
export const MS_PER_TICK = 50;

/** Seeded per-seat stream; `below(n)` is the only draw. */
export interface SeatRng { below(n: number): number }
export type CanDraw = (player: unknown, from: unknown, to: unknown) => string | null;
export interface DefaultState { timer: number; /** ms elapsed toward `startDelayMs`. */ startElapsed?: number }

const owned = (view: SimView, me: number, i: number): boolean => view.buildings.owner[i] === me;

/** TW `HasWayWith`: any line a->b or b->a of any owner. */
export function noLineBetween(view: SimView, a: number, b: number): boolean {
  for (const line of view.lines) {
    if ((line.from === a && line.to === b) || (line.from === b && line.to === a)) return false;
  }
  return true;
}

/** Weakest-first key: garrison level, or floor((2L+1)/3) (= round(L/1.5)) for `special` targets. */
export function targetKey(view: SimView, i: number): number {
  const level = view.buildings.level[i]!;
  return view.buildingStatic[i]!.special ? idiv(2 * level + 1, 3) : level;
}

/** All non-own buildings (neutral, hostile, towers included) ascending by (key, index). */
export function sortedTargets(view: SimView, me: number): number[] {
  const keyed: { i: number; key: number }[] = [];
  for (let i = 0; i < view.ids.buildings.length; i++) if (!owned(view, me, i)) keyed.push({ i, key: targetKey(view, i) });
  return keyed.sort((a, b) => a.key - b.key || a.i - b.i).map(e => e.i);
}

/** Own line-drawing buildings with a free slot, ascending index. */
export function freeSources(view: SimView, me: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < view.ids.buildings.length; i++) {
    if (owned(view, me, i) && view.buildingStatic[i]!.drawsLines && view.freeSlots(i) > 0) out.push(i);
  }
  return out;
}

export function countOwned(view: SimView, me: number): number {
  let n = 0;
  for (let i = 0; i < view.ids.buildings.length; i++) if (owned(view, me, i)) n++;
  return n;
}

const draw = (player: number, from: number, to: number): Command => ({ type: 'DrawLine', player, from, to });

function attack(view: SimView, canDraw: CanDraw, rng: SeatRng, me: number, free: readonly number[]): Command | null {
  for (const t of sortedTargets(view, me)) {
    const cand = free.slice();
    while (cand.length > 0) {
      const k = rng.below(cand.length);
      const s = cand[k]!;
      if (noLineBetween(view, s, t) && canDraw(me, s, t) === null) return draw(me, s, t);
      cand.splice(k, 1);
    }
  }
  return null;
}

function dist2(view: SimView, a: number, b: number): number {
  const p = view.buildingStatic[a]!, q = view.buildingStatic[b]!;
  const dx = p.x - q.x, dz = p.z - q.z;
  return dx * dx + dz * dz;
}

function defense(view: SimView, canDraw: CanDraw, rng: SeatRng, me: number, free: readonly number[]): Command | null {
  const cand = free.slice();
  while (cand.length > 0) {
    const k = rng.below(cand.length);
    const d = cand[k]!;
    const others: number[] = [];
    for (let i = 0; i < view.ids.buildings.length; i++) if (i !== d && owned(view, me, i)) others.push(i);
    others.sort((a, b) => dist2(view, d, a) - dist2(view, d, b) || a - b);
    for (const o of others) if (noLineBetween(view, d, o) && canDraw(me, d, o) === null) return draw(me, d, o);
    cand.splice(k, 1);
  }
  return null;
}

/**
 * One `DefaultBehavior.UpdateBehavior` tick (timer-order-pin.md): check, then add; carry remainder.
 * Zero-building seat: timer frozen, no decision. Emits at most one `DrawLine`, never a cut.
 */
export function decideDefault(
  view: SimView, canDraw: CanDraw, rng: SeatRng, me: number, state: DefaultState, params: Pick<SeatBot, 'actionDelayMs' | 'behavior'> & { startDelayMs?: number },
): Command[] {
  if (view.over || countOwned(view, me) === 0) return [];
  const startDelay = params.startDelayMs ?? 0;
  if (startDelay > 0 && (state.startElapsed ?? 0) < startDelay) { state.startElapsed = (state.startElapsed ?? 0) + MS_PER_TICK; return []; }
  if (state.timer < params.actionDelayMs) { state.timer += MS_PER_TICK; return []; }
  state.timer -= params.actionDelayMs;
  const free = freeSources(view, me);
  const drawn = attack(view, canDraw, rng, me, free);
  if (drawn) return [drawn];
  if (params.behavior === 'full') {
    const d = defense(view, canDraw, rng, me, free);
    if (d) return [d];
  }
  return [];
}
