import type { Page } from '@playwright/test';
import duel from '../../../packages/content/data/levels/na-pvp-duel-s.json' with { type: 'json' };

export type Pos = { x: number; z: number };
export type DrawLineCmd = { type: 'DrawLine'; player: number; from: number; to: number };
export type AttackView = { over: unknown; buildings: { owner: number[] } };

/** Building positions of Duel S in sim index order (level array order). */
export const DUEL_S_POSITIONS: Pos[] = duel.buildings.map((b) => b.pos);

/**
 * Pure greedy attack: for every building owned by `player`, draw to the nearest building not owned
 * by `player` (enemy or neutral). Duplicates / blocked lines are rejected by the sim harmlessly.
 */
export function scriptedAttack(view: AttackView, positions: readonly Pos[], player: number): DrawLineCmd[] {
  if (view.over) return [];
  const { owner } = view.buildings;
  const d2 = (a: Pos, b: Pos): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  const cmds: DrawLineCmd[] = [];
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== player) continue;
    let best = -1, bestD = Infinity;
    for (let j = 0; j < owner.length; j++) {
      if (owner[j] === player) continue;
      const d = d2(positions[i]!, positions[j]!);
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best >= 0) cmds.push({ type: 'DrawLine', player, from: i, to: best });
  }
  return cmds;
}

/** Runs the script in the page every `everyMs` (default 2 s) via the real `__na.submit` path. Returns a stop fn. */
export async function runScriptedAttack(page: Page, player: number, positions: readonly Pos[] = DUEL_S_POSITIONS, everyMs = 2000): Promise<() => void> {
  let stopped = false;
  const loop = (async () => {
    while (!stopped && !page.isClosed()) {
      try {
        const cmds = await page.evaluate(() => (window as any).__na.view as AttackView).then((v) => scriptedAttack(v, positions, player));
        for (const cmd of cmds) { await page.evaluate((c) => (window as any).__na.pvp.submit(c), cmd); }
      } catch { /* page navigating/closing */ }
      await new Promise((r) => setTimeout(r, everyMs));
    }
  })();
  return () => { stopped = true; void loop; };
}
