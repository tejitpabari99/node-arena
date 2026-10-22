// Frozen prefab levels (positions 10 `182_NB`, 23 `100_ES`): tw-level-ext files reconstructed from Unity prefabs with
// UnityPy, committed under prefab/. Hand data: not reproducible from raw TextAssets in TS.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TwLevel, TwPrefabLevel } from './types.js';
import { TwParseError, slugify } from './parse-raw.js';

export const PREFAB_DIR = join(import.meta.dirname, 'prefab');

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate a committed prefab ext document and flag it as hand data. */
export function parsePrefabText(label: string, text: string): TwPrefabLevel {
  let doc: unknown;
  try { doc = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { throw new TwParseError(`${label}: invalid JSON: ${(e as Error).message}`); }
  if (!isRecord(doc)) throw new TwParseError(`${label}: not an object`);
  const fail = (m: string): never => { throw new TwParseError(`${label}: ${m}`); };
  if (doc['schema'] !== 'node-arena/tw-level-ext@0.1') fail(`unexpected schema ${JSON.stringify(doc['schema'])}`);
  const source = doc['source'];
  if (!isRecord(source) || source['origin'] !== 'prefab' || source['dialect'] !== 'prefab-reconstructed') {
    return fail('not a prefab-reconstructed ext file (source.origin/dialect)');
  }
  if (typeof source['asset'] !== 'string') fail('source.asset missing');
  if (doc['id'] !== slugify(source['asset'] as string)) fail(`id ${JSON.stringify(doc['id'])} does not match the asset slug`);
  if (doc['name'] !== source['asset']) fail('name does not match source.asset');
  for (const k of ['players', 'buildings']) if (!Array.isArray(doc[k])) fail(`${k} is not a list`);
  if (!isRecord(doc['mapObjects'])) fail('mapObjects missing');
  return { ...(doc as unknown as TwLevel), handData: true };
}

export function parsePrefabFile(file: string): TwPrefabLevel {
  return parsePrefabText(file, readFileSync(file, 'utf8'));
}

/** All committed prefab levels, keyed by asset name (`LevelView 182_NB`). */
export function loadPrefabLevels(dir: string = PREFAB_DIR): Map<string, TwPrefabLevel> {
  const out = new Map<string, TwPrefabLevel>();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.ext.json')).sort()) {
    const level = parsePrefabFile(join(dir, name));
    if (out.has(level.source.asset)) throw new TwParseError(`${name}: duplicate prefab asset ${level.source.asset}`);
    out.set(level.source.asset, level);
  }
  return out;
}
