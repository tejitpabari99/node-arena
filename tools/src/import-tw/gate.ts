// Gating (PRD 05 R4): features + catalog -> blocked[] / dropped[]. Pure: no fs, so there is no write path for blocked levels.
import type { Catalog } from '@node-arena/content';
import type { TwLevel } from './types.js';
import { FeatureMapError, loadFeatureMap, type FeatureMap } from './feature-map.js';

/** Theme cycle (02#4.4). Used as the registered set while the catalog carries no manifest `themes`. */
export const ENV = ['green', 'snow', 'lava', 'mine', 'jungle', 'darkmine'] as const;
export const DEFAULT_ENV_SHIFT = 0;

export function themeFor(position: number, envShift: number = DEFAULT_ENV_SHIFT): string {
  return ENV[Math.floor((position - 1 + envShift) / 20) % ENV.length]!;
}

export interface Feature { tw: string; count: number; /** house: warriorType values seen. */ warriorTypes?: number[] }

export const BUILDING_TOKEN: Record<string, string> = {
  house: 'house', tower: 'tower', rocket_tower: 'rocket', selectable_fortess: 'selectable',
  capture_rocket_tower: 'capture-rocket', trolley: 'trolley', flag: 'flag', boss_tower: 'boss', resource: 'WOD',
};
export const MAP_TOKEN: Record<keyof TwLevel['mapObjects'], string> = {
  obstacles: 'OBS', riverObstacles: 'ROBS', mines: 'Mine', walls: 'Wall', sheep: 'Sheep', rivers: 'River', cargo: 'cargo', gates: 'Gate', railways: 'Railway',
};

/** Every TW construct present in the level. Unknown building kinds are returned verbatim so the gate can reject them. */
export function featuresOf(level: TwLevel): Feature[] {
  const out = new Map<string, Feature>();
  const add = (tw: string, wt?: number): void => {
    const f = out.get(tw) ?? { tw, count: 0 };
    f.count++;
    if (wt !== undefined) (f.warriorTypes ??= []).push(wt);
    out.set(tw, f);
  };
  for (const b of level.buildings) {
    const tok = BUILDING_TOKEN[b.kind] ?? b.kind;
    const p = b.params as { warriorType?: number; spawnCoef?: number } | undefined;
    add(tok, b.kind === 'house' ? (p?.warriorType ?? 1) : undefined);
    if (p?.spawnCoef !== undefined) add('sc');
  }
  for (const [key, tok] of Object.entries(MAP_TOKEN)) {
    const n = level.mapObjects[key as keyof TwLevel['mapObjects']].length;
    for (let i = 0; i < n; i++) add(tok);
  }
  for (const pl of level.players) {
    if (pl.ai?.reactionDelayMin !== undefined) add('MinRD');
    if (pl.ai?.reactionDelayMax !== undefined) add('MaxRD');
    if (pl.ai?.steps.railwayMoveSteps?.length) add('AiRM');
  }
  if (level.category === 'boss') add('boss');
  return [...out.values()];
}

export interface Blocked { tw: string; reason: string }
export interface GateResult {
  pos: number;
  id: string;
  blocked: Blocked[];
  /** Sorted source.dropped tokens for drop rows that apply to this level. */
  dropped: string[];
}

export interface GateOptions { featureMap?: FeatureMap; envShift?: number }

/** Throws FeatureMapError for a construct with no feature-map row. */
export function computeBlocked(level: TwLevel, position: number, catalog: Catalog, options: GateOptions = {}): GateResult {
  const fm = options.featureMap ?? loadFeatureMap();
  const blocked: Blocked[] = [];
  const dropped = new Set<string>();
  const known = (id: string, kind: 'building' | 'element'): boolean => (kind === 'building' ? catalog.buildings : catalog.elements)[id] !== undefined;

  for (const f of featuresOf(level)) {
    const row = fm.byTw.get(f.tw);
    if (!row) throw new FeatureMapError(`unlisted TW construct "${f.tw}" in ${level.id}: add a row to feature-map.json`);
    if (row.action === 'drop') {
      if (row.onlyLevels && !row.onlyLevels.includes(level.id)) blocked.push({ tw: f.tw, reason: `${f.tw}: drop policy covers only ${row.onlyLevels.join(', ')}` });
      else dropped.add(f.tw);
    } else if (row.action === 'block') {
      blocked.push({ tw: f.tw, reason: `${f.tw}: not importable` });
    } else if (row.archetypeBy) {
      for (const wt of new Set(f.warriorTypes ?? [])) {
        const arch = row.archetypeBy.map[String(wt)];
        if (arch === undefined) blocked.push({ tw: f.tw, reason: `${f.tw}: no archetype for ${row.archetypeBy.param} ${wt}` });
        else if (!known(arch, row.kind === 'element' ? 'element' : 'building')) blocked.push({ tw: f.tw, reason: `${f.tw}: archetype ${arch} absent from catalog` });
      }
    } else if (row.archetype === null || row.archetype === undefined) {
      blocked.push({ tw: f.tw, reason: `${f.tw}: no archetype registered yet` });
    } else if (!known(row.archetype, row.kind === 'element' ? 'element' : 'building')) {
      blocked.push({ tw: f.tw, reason: `${f.tw}: archetype ${row.archetype} absent from catalog` });
    }
  }

  const theme = themeFor(position, options.envShift);
  const registered: readonly string[] = catalog.themes ?? ENV;
  if (!registered.includes(theme)) blocked.push({ tw: 'theme', reason: `theme ${theme} not registered` });

  return { pos: position, id: level.id, blocked, dropped: [...dropped].sort() };
}

/** Levels that may be written: only those with no blocked[] entries. */
export function importable<T extends GateResult>(results: readonly T[]): T[] {
  return results.filter((r) => r.blocked.length === 0);
}
