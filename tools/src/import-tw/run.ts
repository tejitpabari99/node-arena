// Importer core (PRD 05 R4/R5): extract -> {path: bytes}. Pure w.r.t. the output dir (no writes); cli.ts does fs.
import { resolve } from 'node:path';
import { loadCatalog, type Catalog, type ContentFiles } from '@node-arena/content';
import { loadFiles } from '../files.js';
import { campaignRange, readCampaign } from './campaign.js';
import { loadPrefabLevels } from './parse-prefab.js';
import { parseRaw } from './parse-raw.js';
import { assertUniqueIds, mapLevel, type MapResult } from './map-level.js';
import { serializeCampaign, serializeLevel } from './serialize.js';
import type { CampaignEntry } from './types.js';

export const DEFAULT_RANGE: readonly [number, number] = [4, 23];
export const LEVELS_DIR = 'data/levels';
export const CAMPAIGN_FILE = 'data/campaigns/common.json';

export interface ImportOptions {
  extractRoot: string;
  contentDir: string;
  range?: readonly [number, number];
  /** Asset name (`LevelView 1`) or slug (`levelview-1`); restricts levels, and no campaign is written. */
  only?: readonly string[];
  skipBlocked?: boolean;
}
export interface ImportRow { entry: CampaignEntry; slug: string; result: MapResult }
export interface ImportResult {
  /** Content-relative path -> exact bytes. */
  files: Map<string, string>;
  rows: ImportRow[];
  blocked: { id: string; position: number; reasons: string[] }[];
  /** Campaign entries as written (empty = no campaign file). */
  campaign: { level: string; position: number }[];
}

export async function loadImportCatalog(contentDir: string): Promise<Catalog> {
  const files: ContentFiles = await loadFiles(contentDir);
  delete files['content.json'];
  return loadCatalog(files);
}

export async function runImport(o: ImportOptions): Promise<ImportResult> {
  const catalog = await loadImportCatalog(o.contentDir);
  const [from, to] = o.range ?? DEFAULT_RANGE;
  const prefabs = loadPrefabLevels();
  let entries = campaignRange(readCampaign(o.extractRoot), from, to);
  if (o.only?.length) {
    const want = new Set(o.only.map((s) => s.toLowerCase().replace(/[ _]+/g, '-')));
    entries = entries.filter((e) => want.has(e.id.toLowerCase().replace(/[ _]+/g, '-')));
    if (entries.length === 0) throw new Error(`--only matched nothing in range ${from}-${to}`);
  }
  entries = [...entries].sort((a, b) => a.position - b.position);
  const rows: ImportRow[] = entries.map((entry) => {
    const tw = prefabs.get(entry.id) ?? parseRaw(o.extractRoot, entry.id);
    return { entry, slug: tw.id, result: mapLevel(tw, entry.position, catalog) };
  });
  assertUniqueIds(rows.map((r) => ({ id: r.slug })));

  const files = new Map<string, string>();
  const blocked: ImportResult['blocked'] = [];
  for (const r of rows) {
    if (r.result.level) files.set(`${LEVELS_DIR}/${r.slug}.json`, serializeLevel(r.result.level));
    else blocked.push({ id: r.entry.id, position: r.entry.position, reasons: r.result.gate.blocked.map((b) => b.reason) });
  }
  const campaign: ImportResult['campaign'] = [];
  if (!o.only?.length) {
    for (const r of rows) {
      if (!r.result.level) { if (o.skipBlocked) continue; break; }
      campaign.push({ level: r.slug, position: r.entry.position });
    }
    if (campaign.length > 0) files.set(CAMPAIGN_FILE, serializeCampaign({ $schema: '../../schemas/campaign.schema.json', schemaVersion: '2.0.0', id: 'common', entries: campaign }));
  }
  return { files, rows, blocked, campaign };
}

export const defaultContentDir = (): string => resolve(import.meta.dirname, '../../../packages/content');
