// Deliberate balance edits re-applied after mapping, so `check:import` byte parity survives them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Obj = Record<string, unknown>;
interface Override { botStartDelayMs?: Record<string, number>; botActionDelayMs?: Record<string, number>; buildingLevel?: Record<string, number>; buildingArchetype?: Record<string, string>; buildingPos?: Record<string, { x: number; z: number }> }

let cached: Record<string, Override> | undefined;
const load = (): Record<string, Override> => (cached ??= JSON.parse(readFileSync(join(import.meta.dirname, 'level-overrides.json'), 'utf8')) as Record<string, Override>);

/** Returns a patched copy of `level` (unchanged when the slug has no override). */
export function applyLevelOverrides(slug: string, level: Obj): Obj {
  const ov = load()[slug];
  if (!ov) return level;
  const out = structuredClone(level);
  for (const [id, d] of Object.entries(ov.botStartDelayMs ?? {})) {
    const p = (out['players'] as Obj[]).find((q) => q['id'] === id);
    if (!p || !p['bot']) throw new Error(`level-overrides ${slug}: no bot seat ${id}`);
    (p['bot'] as Obj)['startDelayMs'] = d;
  }
  for (const [id, d] of Object.entries(ov.botActionDelayMs ?? {})) {
    const p = (out['players'] as Obj[]).find((q) => q['id'] === id);
    if (!p || !p['bot']) throw new Error(`level-overrides ${slug}: no bot seat ${id}`);
    (p['bot'] as Obj)['actionDelayMs'] = d;
  }
  for (const [id, arch] of Object.entries(ov.buildingArchetype ?? {})) {
    const b = (out['buildings'] as Obj[]).find((q) => q['id'] === id);
    if (!b) throw new Error(`level-overrides ${slug}: no building ${id}`);
    b['archetype'] = arch;
  }
  for (const [id, lv] of Object.entries(ov.buildingLevel ?? {})) {
    const b = (out['buildings'] as Obj[]).find((q) => q['id'] === id);
    if (!b) throw new Error(`level-overrides ${slug}: no building ${id}`);
    b['level'] = lv;
  }
  for (const [id, pos] of Object.entries(ov.buildingPos ?? {})) {
    const b = (out['buildings'] as Obj[]).find((q) => q['id'] === id);
    if (!b) throw new Error(`level-overrides ${slug}: no building ${id}`);
    b['pos'] = { ...pos };
  }
  return out;
}
