import { idiv, type Command, type SimView } from '@node-arena/sim';
import type { SeatBot } from '@node-arena/content';
import type { BotContext } from './index.js';
import type { ScriptRunner } from './seat.js';
import { MS_PER_TICK, countOwned, noLineBetween } from './tw-ai.js';

type ScriptOp = NonNullable<SeatBot['script']>[number];
type StepsOp = Extract<ScriptOp, { op: 'steps' }>;
type StepSpec = StepsOp['root'];

/** Runtime step node. `wait` = delay pending until `at`; `poll` = capture coroutine, next poll at `at`. */
interface Node { spec: StepSpec; own: number | null; target: number | null; phase: 'wait' | 'poll' | 'done'; at: number }

const countNodes = (n: StepSpec): number => 1 + (n.then ?? []).reduce((s, c) => s + countNodes(c), 0);
const mine = (view: SimView, me: number, i: number | null): boolean => i !== null && view.buildings.owner[i] === me;

/** Per-tick ledger: slots and pairs consumed by commands already emitted this tick. */
interface Ledger { slots: Map<number, number>; pairs: Set<string> }
const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

function tryDraw(ctx: BotContext, led: Ledger, me: number, from: number, to: number): Command | null {
  const { view } = ctx;
  if (from === to || led.pairs.has(pairKey(from, to))) return null;
  if (view.freeSlots(from) - (led.slots.get(from) ?? 0) <= 0) return null;
  if (!noLineBetween(view, from, to) || ctx.canDraw(me, from, to) !== null) return null;
  led.slots.set(from, (led.slots.get(from) ?? 0) + 1);
  led.pairs.add(pairKey(from, to));
  return { type: 'DrawLine', player: me, from, to };
}

/** R4 `scriptLine`: own -> target if possible, else first other own free tower (index order) -> target. */
function scriptLine(ctx: BotContext, led: Ledger, me: number, own: number | null, target: number | null, out: Command[]): void {
  if (target === null) return;
  const { view } = ctx;
  if (own !== null && mine(view, me, own)) {
    const c = tryDraw(ctx, led, me, own, target);
    if (c) { out.push(c); return; }
  }
  if (countOwned(view, me) < 2) return;
  for (let i = 0; i < view.ids.buildings.length; i++) {
    if (!mine(view, me, i) || i === own || i === target || !view.buildingStatic[i]!.drawsLines) continue;
    const c = tryDraw(ctx, led, me, i, target);
    if (c) { out.push(c); return; }
  }
}

/**
 * Builds the opening-script runner (timer-order-pin.md). Ops run one at a time, every op check-then-add;
 * an op finishing on tick T starts the next on T (first update T+1). Returns commands (possibly empty)
 * while active, null once the queue is exhausted (the tick after the last op finishes). No RNG.
 * Intra-tick order (assumed): op update, step-node fires, capture polls.
 */
export function createScriptRunner(script: NonNullable<SeatBot['script']>): ScriptRunner {
  const queue = script.slice();
  let began = false;
  let finished = false;
  let cur: ScriptOp | null = null;
  let timer = 0;
  // steps op state
  let nodes: Node[] = [];
  let remaining = 0;
  let rootStarted = false;

  return (ctx, tick, me) => {
    const { view } = ctx;
    const idx = new Map<string, number>();
    view.ids.buildings.forEach((id, i) => idx.set(id, i));
    const res = (id: string | null | undefined): number | null => (id == null ? null : (idx.get(id) ?? null));
    const led: Ledger = { slots: new Map(), pairs: new Set() };
    const out: Command[] = [];

    /** Dequeue next op; line ops whose own initial owner != me are skipped without consuming a tick. */
    const startNext = (): void => {
      cur = null;
      while (queue.length > 0) {
        const op = queue.shift()!;
        if (op.op === 'line') {
          const own = res(op.own);
          if (own !== null && view.buildingStatic[own]!.initialOwner !== me) continue;
        }
        cur = op; timer = 0; nodes = []; remaining = op.op === 'steps' ? countNodes(op.root) : 0; rootStarted = false;
        return;
      }
    };

    const complete = (n: Node): void => {
      n.phase = 'done'; remaining--;
      for (const child of n.spec.then ?? []) start(child);
    };
    const start = (spec: StepSpec): void => {
      const n: Node = { spec, own: res(spec.own), target: res(spec.target), phase: 'wait', at: tick + Math.max(1, idiv((spec.delayMs ?? 0) + MS_PER_TICK - 1, MS_PER_TICK)) };
      nodes.push(n);
      if (n.own !== null && !mine(view, me, n.own)) complete(n);
    };

    if (finished) return null;
    if (!began) { began = true; startNext(); }
    if (cur === null) { finished = true; return null; }
    if (countOwned(view, me) === 0) return []; // controller frozen with no towers

    const op: ScriptOp = cur;
    let done = false;
    if (op.op === 'delay') {
      if (op.ms <= timer) done = true; else timer += MS_PER_TICK;
    } else if (op.op === 'line') {
      if (op.afterMs <= timer) { scriptLine(ctx, led, me, res(op.own), res(op.target), out); done = true; } else timer += MS_PER_TICK;
    } else {
      if (!rootStarted) { rootStarted = true; start(op.root); }
      done = remaining <= 0;
      if (!done) {
        for (const n of nodes.slice()) {
          if (n.phase !== 'wait' || n.at !== tick) continue;
          if (n.own !== null && !mine(view, me, n.own)) { complete(n); continue; }
          const goal = n.spec.goal;
          if (goal === 'none') complete(n);
          else if (goal === 'line') { scriptLine(ctx, led, me, n.own, n.target, out); complete(n); }
          else {
            scriptLine(ctx, led, me, n.own, n.target, out);
            if (n.target === null) complete(n); else { n.phase = 'poll'; n.at = tick + 20; }
          }
        }
        for (const n of nodes.slice()) {
          if (n.phase !== 'poll' || n.at !== tick) continue;
          if (!mine(view, me, n.own) || mine(view, me, n.target)) complete(n); else n.at += 20;
        }
      }
    }
    if (done) startNext();
    return out;
  };
}
