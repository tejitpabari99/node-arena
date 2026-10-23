// Importer core (PRD 05 R4/R5): extract -> {path: bytes}. Pure w.r.t. the output dir (no writes); cli.ts does fs.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadCatalog, type Catalog, type ContentFiles } from '@node-arena/content';
import { loadFiles } from '../files.js';
import { campaignRange, isHandAuthored, mergeCampaign, parseCampaignDoc, readCampaign, type CampaignDoc } from './campaign.js';
import type { GateResult } from './gate.js';
import { loadPrefabLevels } from './parse-prefab.js';
import { TwParseError, parseRaw, slugify } from './parse-raw.js';
import { assertUniqueIds, mapLevel, type MapResult } from './map-level.js';
import { serializeCampaign, serializeLevel } from './serialize.js';
import type { CampaignEntry } from './types.js';

export const DEFAULT_RANGE: readonly [number, number] = [4, 23];
/** Level ids become file names: only these characters, non-empty. */
export const SLUG_RE = /^[a-z0-9-]+$/;
export const LEVELS_DIR = 'data/levels';
export const CAMPAIGN_FILE = 'data/campaigns/common.json';

export interface ImportOptions {
  extractRoot: string;
  contentDir: string;
  /** Inclusive campaign positions. Default: DEFAULT_RANGE, or in check mode every importer-owned position in the committed campaign. */
  range?: readonly [number, number];
  /** Asset name (`LevelView 1`) or slug (`levelview-1`); restricts levels, and no campaign is written. */
  only?: readonly string[];
  skipBlocked?: boolean;
  /** check:import: derive the default range from the committed campaign. */
  check?: boolean;
  /** Test seam: permutes the campaign entries before the importer's own position sort (proves output ignores input order). */
  permuteEntries?: (entries: CampaignEntry[]) => CampaignEntry[];
  /** Registered themes. Default: `registeredThemes(manifestPath)`. */
  themes?: readonly string[];
  /** v2 asset manifest to read themes from (default: apps/web/assets/manifest.json next to the content package). */
  manifestPath?: string;
}
export interface ImportRow { entry: CampaignEntry; slug: string; result: MapResult }
export interface ImportResult {
  /** Content-relative path -> exact bytes. */
  files: Map<string, string>;
  rows: ImportRow[];
  blocked: { id: string; position: number; reasons: string[] }[];
  /** Campaign entries as written, merged with the committed file (empty = no campaign file). */
  campaign: { level: string; position: number }[];
  /** Level files in data/levels that this run did not produce and that are not hand-authored (check mode over the whole committed campaign only). */
  orphans: string[];
}

/**
 * Registered theme set for the gate: the theme ids of the v2 asset manifest (`schemaVersion` 2.x with `themes`, shipped by SP07).
 * Throws when the manifest is absent, unreadable or not v2: there is no fallback set.
 */
export function registeredThemes(manifestPath: string): readonly string[] {
  let m: unknown;
  try { m = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (e) { throw new Error(`cannot read theme registry ${manifestPath}: ${(e as Error).message}`); }
  const { schemaVersion, themes } = (typeof m === 'object' && m !== null ? m : {}) as { schemaVersion?: unknown; themes?: unknown };
  if (typeof schemaVersion === 'string' && /^([2-9]|\d{2,})\./.test(schemaVersion) && typeof themes === 'object' && themes !== null) return Object.keys(themes);
  throw new Error(`${manifestPath}: expected a v2 manifest (schemaVersion 2.x) with "themes" to register themes`);
}

const PREFAB_HINT = 'if this is a prefab level, copy its .ext.json from $TW_EXTRACT/converted/ext-prefab/ into tools/src/import-tw/prefab/ and commit it';

/** A per-level failure that must not abort the batch: the level is reported as blocked. */
function failedRow(entry: CampaignEntry, error: TwParseError): ImportRow {
  const slug = slugify(entry.id);
  const hint = /no raw TextAsset file matches/.test(error.message) ? ` (${PREFAB_HINT})` : '';
  const gate: GateResult = { pos: entry.position, id: slug, blocked: [{ tw: 'parse', reason: `${error.message}${hint}` }], dropped: [], droppedTw: [] };
  return { entry, slug, result: { level: null, gate, ledger: [], outside: [], inactiveIds: [] } };
}

/** Existing common.json (or null). */
function readCampaignDoc(contentDir: string): CampaignDoc | null {
  const file = join(contentDir, CAMPAIGN_FILE);
  return existsSync(file) ? parseCampaignDoc(readFileSync(file, 'utf8'), CAMPAIGN_FILE) : null;
}

export async function loadImportCatalog(contentDir: string): Promise<Catalog> {
  const files: ContentFiles = await loadFiles(contentDir);
  delete files['content.json'];
  return loadCatalog(files);
}

export async function runImport(o: ImportOptions): Promise<ImportResult> {
  const catalog = await loadImportCatalog(o.contentDir);
  const themes = o.themes ?? registeredThemes(o.manifestPath ?? join(o.contentDir, '../../apps/web/assets/manifest.json'));
  const existingDoc = readCampaignDoc(o.contentDir);
  const fullCampaign = readCampaign(o.extractRoot);
  const owned = (existingDoc?.entries ?? []).filter((e) => !isHandAuthored(e.level)).map((e) => e.position);
  const explicitRange = o.range !== undefined;
  const [from, to] = o.range ?? (o.check && owned.length > 0 ? [Math.min(...owned), Math.max(...owned)] : DEFAULT_RANGE);
  const prefabs = loadPrefabLevels();
  let entries = campaignRange(fullCampaign, from, to);
  if (o.only?.length) {
    const want = new Set(o.only.map(slugify));
    entries = entries.filter((e) => want.has(slugify(e.id)));
    if (entries.length === 0) throw new Error(`--only matched nothing in range ${from}-${to}`);
  }
  entries = [...(o.permuteEntries ? o.permuteEntries([...entries]) : entries)].sort((a, b) => a.position - b.position);
  const rows: ImportRow[] = entries.map((entry) => {
    try {
      const tw = prefabs.get(entry.id) ?? parseRaw(o.extractRoot, entry.id);
      return { entry, slug: tw.id, result: mapLevel(tw, entry.position, catalog, { themes }) };
    } catch (e) {
      if (e instanceof TwParseError) return failedRow(entry, e);
      throw e;
    }
  });
  assertUniqueIds(rows.map((r) => ({ id: r.slug })));

  const files = new Map<string, string>();
  const blocked: ImportResult['blocked'] = [];
  for (const r of rows) {
    if (r.result.level && !SLUG_RE.test(r.slug)) throw new Error(`level slug ${JSON.stringify(r.slug)} (${JSON.stringify(r.entry.id)}) is not [a-z0-9-]+`);
    if (r.result.level) files.set(`${LEVELS_DIR}/${r.slug}.json`, serializeLevel(r.result.level));
    else blocked.push({ id: r.entry.id, position: r.entry.position, reasons: r.result.gate.blocked.map((b) => b.reason) });
  }
  let campaign: ImportResult['campaign'] = [];
  if (!o.only?.length) {
    const merged = mergeCampaign(existingDoc?.entries ?? [], rows.map((r) => ({ slug: r.slug, position: r.entry.position, importable: r.result.level !== null })), { skipBlocked: o.skipBlocked ?? false, campaign: fullCampaign });
    campaign = merged.map((e) => ({ level: e.level, position: e.position }));
    if (merged.length > 0) {
      const base: Record<string, unknown> = existingDoc ? { ...existingDoc } : { $schema: '../../schemas/campaign.schema.json', schemaVersion: '2.0.0', id: 'common' };
      files.set(CAMPAIGN_FILE, serializeCampaign({ ...base, entries: merged }));
    }
  }
  const orphans: string[] = [];
  if (o.check && !explicitRange && !o.only?.length) {
    const dir = join(o.contentDir, LEVELS_DIR);
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
        if (!files.has(`${LEVELS_DIR}/${f}`) && !isHandAuthored(f)) orphans.push(`${LEVELS_DIR}/${f}`);
      }
    }
  }
  return { files, rows, blocked, campaign, orphans };
}

export const defaultContentDir = (): string => resolve(import.meta.dirname, '../../../packages/content');
