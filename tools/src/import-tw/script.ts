// R2 bot script merge: AiDS/AiCWS/AiSC merged by `I` into the defs `tw` bot `script` ops (06 R5). Pure.
import type { TwAiAction, TwPlayer } from './types.js';

export class ScriptError extends Error {}

type Obj = Record<string, unknown>;
export type BuildingIdOf = (twId: number) => string | null;

const ms = (sec: number): number => Math.round(sec * 1000);
const GOAL = ['none', 'line', 'capture'] as const;

function stepNode(a: TwAiAction, idOf: BuildingIdOf): Obj {
  const goal = GOAL[a.goal];
  if (goal === undefined) throw new ScriptError(`unknown step goal GT ${String(a.goal)}`);
  const node: Obj = { goal, own: idOf(a.ownHouse), target: idOf(a.targetHouse), delayMs: ms(a.startDelay) };
  if (a.then && a.then.length > 0) node['then'] = a.then.map((c) => stepNode(c, idOf));
  return node;
}

/** Merge a player's step lists by `I` (order = TW queue). Gaps/duplicates across all 4 lists (AiRM included, then dropped) = error. */
export function mergeBotScript(ai: TwPlayer['ai'], idOf: BuildingIdOf, who = 'ai'): Obj[] {
  const s = ai?.steps;
  if (!s) return [];
  const slots = new Map<number, Obj | null>();
  const put = (index: number, op: Obj | null): void => {
    if (!Number.isInteger(index) || index < 0) throw new ScriptError(`${who}: invalid step index ${String(index)}`);
    if (slots.has(index)) throw new ScriptError(`${who}: duplicate step index ${index}`);
    slots.set(index, op);
  };
  for (const d of s.delaySteps ?? []) put(d.index, { op: 'delay', ms: ms(d.delay) });
  for (const c of s.createWaySteps ?? []) put(c.index, { op: 'line', own: idOf(c.ownHouse), target: idOf(c.targetHouse), afterMs: ms(c.attackDelay) });
  for (const r of s.railwayMoveSteps ?? []) put(r.index, null); // AiRM: dropped (ai-rail-move), index still occupied
  for (const a of s.actionSteps ?? []) put(a.index, { op: 'steps', root: stepNode(a.action, idOf) });
  for (let i = 0; i < slots.size; i++) if (!slots.has(i)) throw new ScriptError(`${who}: gap in step indices at ${i}`);
  return [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([, op]) => op).filter((o): o is Obj => o !== null);
}
