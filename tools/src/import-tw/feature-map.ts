// Typed loader for feature-map.json: the importer's dropped-construct policy (PRD 05 R2, Decision 3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type FeatureAction = 'map' | 'drop' | 'block';
export type FeatureKind = 'building' | 'element' | 'param' | 'bot';

export interface FeatureRow {
  tw: string;
  action: FeatureAction;
  kind: FeatureKind;
  /** map rows: catalog archetype id; null = none exists yet (can only block). */
  archetype?: string | null;
  /** map rows whose archetype depends on a building param (house -> warriorType). */
  archetypeBy?: { param: string; map: Record<string, string> };
  /** drop rows: drop applies only to these level ids; any other level blocks. */
  onlyLevels?: string[];
}

export interface FeatureMap { rows: FeatureRow[]; byTw: ReadonlyMap<string, FeatureRow> }

export class FeatureMapError extends Error {
  constructor(message: string) { super(message); this.name = 'FeatureMapError'; }
}

const ACTIONS: readonly string[] = ['map', 'drop', 'block'];
const KINDS: readonly string[] = ['building', 'element', 'param', 'bot'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate + index raw JSON. Duplicate / malformed rows are errors. */
export function parseFeatureMap(doc: unknown): FeatureMap {
  if (!isObj(doc) || !Array.isArray(doc['rows'])) throw new FeatureMapError('feature-map: "rows" array missing');
  const rows: FeatureRow[] = [];
  const byTw = new Map<string, FeatureRow>();
  for (const [i, r] of (doc['rows'] as unknown[]).entries()) {
    if (!isObj(r)) throw new FeatureMapError(`feature-map: row ${i} is not an object`);
    const tw = r['tw'];
    if (typeof tw !== 'string' || tw === '') throw new FeatureMapError(`feature-map: row ${i} has no tw`);
    if (typeof r['action'] !== 'string' || !ACTIONS.includes(r['action'])) throw new FeatureMapError(`feature-map: ${tw}: bad action`);
    if (typeof r['kind'] !== 'string' || !KINDS.includes(r['kind'])) throw new FeatureMapError(`feature-map: ${tw}: bad kind`);
    if (byTw.has(tw)) throw new FeatureMapError(`feature-map: duplicate row ${tw}`);
    const row: FeatureRow = { tw, action: r['action'] as FeatureAction, kind: r['kind'] as FeatureKind };
    if ('archetype' in r) {
      if (r['archetype'] !== null && typeof r['archetype'] !== 'string') throw new FeatureMapError(`feature-map: ${tw}: bad archetype`);
      row.archetype = r['archetype'] as string | null;
    }
    const by = r['archetypeBy'];
    if (by !== undefined) {
      if (!isObj(by) || typeof by['param'] !== 'string' || !isObj(by['map'])) throw new FeatureMapError(`feature-map: ${tw}: bad archetypeBy`);
      row.archetypeBy = { param: by['param'], map: by['map'] as Record<string, string> };
    }
    const only = r['onlyLevels'];
    if (only !== undefined) {
      if (!Array.isArray(only) || !only.every((x) => typeof x === 'string')) throw new FeatureMapError(`feature-map: ${tw}: bad onlyLevels`);
      if (row.action !== 'drop') throw new FeatureMapError(`feature-map: ${tw}: onlyLevels is only valid on drop rows`);
      row.onlyLevels = only as string[];
    }
    if (row.action === 'map' && row.archetype === undefined && row.archetypeBy === undefined) throw new FeatureMapError(`feature-map: ${tw}: map row needs archetype or archetypeBy`);
    rows.push(row);
    byTw.set(tw, row);
  }
  return { rows, byTw };
}

let cached: FeatureMap | undefined;
/** The committed feature-map.json. */
export function loadFeatureMap(): FeatureMap {
  cached ??= parseFeatureMap(JSON.parse(readFileSync(join(import.meta.dirname, 'feature-map.json'), 'utf8')));
  return cached;
}
