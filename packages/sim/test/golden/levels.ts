import { buildCatalog, compileLevel, computeRequires, loadLevel, type Catalog, type CompiledLevel } from '../../../content/src/index.js';
import balance from '../../../content/data/balance.json';
import houseWt1 from '../../../content/data/buildings/house-wt1.json';
import houseWt2 from '../../../content/data/buildings/house-wt2.json';
import tower from '../../../content/data/buildings/tower.json';
import soldier from '../../../content/data/units/soldier.json';
import tank from '../../../content/data/units/tank.json';

/**
 * Golden/bench levels are authored as inline level JSON and compiled with 02's `loadLevel` + `compileLevel`
 * against the shipped catalog (no SP05 campaign files). Browser-safe: only JSON imports and content exports.
 */
let cached: Catalog | undefined;
export function catalog(): Catalog {
  if (cached) return cached;
  const built = buildCatalog({
    'data/balance.json': balance,
    'data/units/soldier.json': soldier,
    'data/units/tank.json': tank,
    'data/buildings/house-wt1.json': houseWt1,
    'data/buildings/house-wt2.json': houseWt2,
    'data/buildings/tower.json': tower,
  });
  if (!built.catalog) throw new Error(`golden catalog invalid: ${JSON.stringify(built.issues)}`);
  return (cached = built.catalog);
}

/** One authored building: `at` is [x, z] in world units; `owner` is the player index (0 = human p1, 1 = ai p2) or null. */
export interface B {
  at: [number, number];
  owner: 0 | 1 | null;
  level: number;
  arch?: 'house-wt1' | 'house-wt2' | 'tower';
  /** House spawns tanks instead of soldiers (instance override). */
  tank?: boolean;
  ignore?: boolean;
}
export interface LevelOptions { timeLimitSec?: number | null }

export function buildLevel(id: string, buildings: readonly B[], options: LevelOptions = {}): CompiledLevel {
  const xs = buildings.map((b) => b.at[0]), zs = buildings.map((b) => b.at[1]);
  const pid = (o: 0 | 1 | null) => (o === null ? null : `p${o + 1}`);
  const json = {
    $schema: '../../schemas/level.schema.json', schemaVersion: '2.0.0', id, name: id, theme: 'green', objective: 'captureAll',
    bounds: { minX: Math.min(...xs) - 5, maxX: Math.max(...xs) + 5, minZ: Math.min(...zs) - 5, maxZ: Math.max(...zs) + 5 },
    timeLimitSec: options.timeLimitSec ?? null,
    players: [
      { id: 'p1', kind: 'human', colorKey: 'blue' },
      { id: 'p2', kind: 'ai', colorKey: 'red', bot: { kind: 'tw', actionDelayMs: 12000, behavior: 'full', script: [] } },
    ],
    buildings: buildings.map((b, i) => ({
      id: `b${i}`, archetype: b.arch ?? 'house-wt1', pos: { x: b.at[0], z: b.at[1] }, owner: pid(b.owner), level: b.level,
      ignoreForWin: b.ignore === true, ...(b.tank ? { params: { spawns: { troop: 'tank' } } } : {}),
    })),
    elements: [],
    requires: [] as string[],
  };
  json.requires = computeRequires(catalog(), json as never);
  return compileLevel(catalog(), loadLevel(catalog(), json).level);
}
