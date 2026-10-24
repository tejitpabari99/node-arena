import type { CompiledLevel } from '@node-arena/content';
import { create, type RejectReason, type SimView } from '@node-arena/sim';

/** Stable bijective base-26 label for an index in view.ids.buildings. */
export function buildingLetter(index: number): string {
  let letter = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + (n - 1) % 26) + letter;
  }
  return letter;
}

export type PairState = 'ready' | 'active' | 'unavailable';
export interface Pair {
  from: number;
  to: number;
  fromLetter: string;
  toLetter: string;
  state: PairState;
  reason: RejectReason | null;
  text: string;
}
export interface Group {
  from: number;
  letter: string;
  text: string;
  pairs: Pair[];
}
export type CanDraw = (from: number, to: number) => RejectReason | null;

/** Ordered numeric building indexes, independent of letter length. */
export function pairKey(from: number, to: number): string { return `${from}>${to}`; }

/** Compute once on level load from static geometry, for ordered pairs with drawer sources.
 * All probe buildings are owned. A fresh sim has stage >=1, zero drawn lines and no
 * result, so ownership, duplicate and no-slot checks cannot mask geometry. Original
 * modules are preserved: non-drawer buildings block routes but have no source group.
 */
export function computeBlocked(level: CompiledLevel): Set<string> {
  const probe = create({
    ...level,
    buildings: level.buildings.map(b => ({ ...b, owner: 0, modules: { ...b.modules } })),
  }, 0);
  const blocked = new Set<string>();
  for (let from = 0; from < level.buildings.length; from++) {
    // Non-drawers never produce a panel group (the tower E has no outgoing pairs).
    if (level.buildings[from]!.modules.drawsLines === undefined) continue;
    for (let to = 0; to < level.buildings.length; to++) {
      if (from === to) continue;
      const reason = probe.canDraw(0, from, to);
      if (reason === 'blocked-building' || reason === 'blocked-obstacle') blocked.add(pairKey(from, to));
    }
  }
  return blocked;
}

export function reasonWords(reason: RejectReason): string {
  return reason === 'no-slot' ? 'no free route' : reason.replaceAll('-', ' ');
}

function buildingDescription(view: SimView, index: number): string {
  const owner = view.buildings.owner[index]!;
  return `${owner < 0 ? 'grey' : view.players[owner]!.colorKey} ${view.buildings.level[index]!}`;
}

export function derivePairs(view: SimView, canDraw: CanDraw, blocked: ReadonlySet<string>): Group[] {
  const active = new Set(view.lines.map(line => pairKey(line.from, line.to)));
  const groups: Group[] = [];
  for (let from = 0; from < view.ids.buildings.length; from++) {
    if (view.buildings.owner[from] !== 0 || !view.buildingStatic[from]!.drawsLines) continue;
    const letter = buildingLetter(from), rows: Pair[] = [];
    for (let to = 0; to < view.ids.buildings.length; to++) {
      if (from === to || blocked.has(pairKey(from, to))) continue;
      const toLetter = buildingLetter(to), isActive = active.has(pairKey(from, to));
      const reason = isActive ? null : canDraw(from, to);
      const state: PairState = isActive ? 'active' : reason === null ? 'ready' : 'unavailable';
      const suffix = state === 'ready' ? `ready · ${toLetter}: ${buildingDescription(view, to)}` : state === 'active' ? 'active' : reasonWords(reason!);
      rows.push({ from, to, fromLetter: letter, toLetter, state, reason, text: `${letter} → ${toLetter} · ${suffix}` });
    }
    rows.sort((a, b) => Number(a.state === 'unavailable') - Number(b.state === 'unavailable') || a.to - b.to);
    groups.push({ from, letter, text: `${letter} (${buildingDescription(view, from)})`, pairs: rows });
  }
  return groups;
}

/** Pending submissions are keyed by pair and stamped with the submission tick. */
export type PendingPairs = ReadonlyMap<string, number>;
export function addPending(pending: PendingPairs, from: number, to: number, tick: number): Map<string, number> {
  return new Map(pending).set(pairKey(from, to), tick);
}
export function clearPending(pending: PendingPairs, tick: number): Map<string, number> {
  return new Map([...pending].filter(([, submittedTick]) => tick <= submittedTick));
}

export type PairAction = 'draw' | 'cut' | 'reason' | 'ignore';
/** Wall-clock guard prevents a ready-button double-click drawing then immediately cutting. */
export function decidePairAction(
  state: PairState, gesture: 'click' | 'dblclick', pending: boolean, drawnAt: number | undefined, now: number,
): PairAction {
  if (pending) return 'ignore';
  if (gesture === 'click') return state === 'ready' ? 'draw' : state === 'unavailable' ? 'reason' : 'ignore';
  return state === 'active' && drawnAt !== undefined && now - drawnAt >= 700 ? 'cut' : 'ignore';
}
