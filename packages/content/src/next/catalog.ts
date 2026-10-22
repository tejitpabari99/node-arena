import { ContentLoadError, type ContentIssue } from '../fixed-point.js';
import { parseAndConvert, type ContentSource, type NextSchemaName } from './issues.js';
import type { NextBalance, NextBuilding, NextCampaign, NextElement, NextUnit } from './schemas.js';

/** Path-keyed file map: `data/balance.json`, `data/units/<id>.json`, ..., `data/levels/<id>.json`. */
export type ContentFiles = Record<string, ContentSource>;

type Rec<T> = Record<string, T>;
const rec = <T>(): Rec<T> => Object.create(null) as Rec<T>;

/** Validated, milli-int content minus levels. Records are null-prototype maps keyed by id. */
export interface Catalog {
  balance: NextBalance;
  units: Rec<NextUnit>;
  buildings: Rec<NextBuilding>;
  elements: Rec<NextElement>;
  campaigns: Rec<NextCampaign>;
  /** Manifest-derived ref sets (SP07). When present, level `theme` / `colorKey` must be members. */
  themes?: readonly string[];
  colorKeys?: readonly string[];
}

export interface CatalogOptions { themes?: readonly string[]; colorKeys?: readonly string[] }

export type FileKind = 'balance' | 'units' | 'buildings' | 'elements' | 'campaigns' | 'levels';
const DIR_SCHEMA = { units: 'unit', buildings: 'building', elements: 'element', campaigns: 'campaign' } as const;

export function classifyFile(file: string): { kind: FileKind; id?: string } | undefined {
  const dir = /(?:^|\/)(units|buildings|elements|campaigns|levels)\/([^/]+)\.json$/.exec(file);
  if (dir) return { kind: dir[1] as FileKind, id: dir[2]! };
  if (/(?:^|\/)balance\.json$/.test(file)) return { kind: 'balance' };
  return undefined;
}

export interface CatalogBuild { catalog?: Catalog; issues: ContentIssue[]; levelFiles: Record<string, ContentSource> }

/** Collects every issue; `loadCatalog` throws them. Level files are set aside, never parsed here. */
export function buildCatalog(files: ContentFiles, options: CatalogOptions = {}): CatalogBuild {
  const issues: ContentIssue[] = [];
  const levelFiles: Record<string, ContentSource> = {};
  const catalog: Catalog = { balance: undefined as unknown as NextBalance, units: rec(), buildings: rec(), elements: rec(), campaigns: rec() };
  if (options.themes) catalog.themes = options.themes;
  if (options.colorKeys) catalog.colorKeys = options.colorKeys;
  let haveBalance = false;
  const fileOf: Record<string, string> = {};
  for (const [file, source] of Object.entries(files)) {
    const cls = classifyFile(file);
    if (!cls) { issues.push({ file, pointer: '', message: 'Unrecognised content file path' }); continue; }
    if (cls.kind === 'levels') { levelFiles[file] = source; continue; }
    const name: NextSchemaName = cls.kind === 'balance' ? 'balance' : DIR_SCHEMA[cls.kind];
    const parsed = parseAndConvert<{ id?: string }>(file, source, name);
    issues.push(...parsed.issues);
    if (!parsed.value) continue;
    if (cls.kind === 'balance') {
      if (haveBalance) issues.push({ file, pointer: '', message: 'Duplicate balance.json' });
      catalog.balance = parsed.value as unknown as NextBalance; haveBalance = true; fileOf.balance = file;
      continue;
    }
    const id = parsed.value.id!;
    if (id !== cls.id) issues.push({ file, pointer: '/id', message: `id "${id}" must equal the file name "${cls.id}"` });
    const bucket = catalog[cls.kind] as Rec<unknown>;
    if (id in bucket) { issues.push({ file, pointer: '/id', message: `Duplicate ${cls.kind} id "${id}"` }); continue; }
    bucket[id] = parsed.value; fileOf[`${cls.kind}/${id}`] = file;
  }
  if (!haveBalance) issues.push({ file: 'balance.json', pointer: '', message: 'Missing balance.json' });
  else {
    const [a, b] = catalog.balance.stageThresholds;
    if (a! >= b!) issues.push({ file: fileOf.balance!, pointer: '/stageThresholds', message: 'stageThresholds must be strictly ascending' });
  }
  for (const [id, b] of Object.entries(catalog.buildings)) {
    const troop = (b.modules.spawns as { troop?: string } | undefined)?.troop;
    if (troop !== undefined && !(troop in catalog.units)) issues.push({ file: fileOf[`buildings/${id}`]!, pointer: '/modules/spawns/troop', message: `Unknown unit "${troop}"` });
  }
  for (const [id, c] of Object.entries(catalog.campaigns)) {
    const seen = new Set<string>();
    c.entries.forEach((e, i) => {
      if (seen.has(e.level)) issues.push({ file: fileOf[`campaigns/${id}`]!, pointer: `/entries/${i}/level`, message: `Duplicate campaign level "${e.level}"` });
      seen.add(e.level);
    });
  }
  return { ...(issues.length ? {} : { catalog }), issues, levelFiles };
}

/** Validates everything except levels once. Throws `ContentLoadError` (file + JSON pointer per issue). */
export function loadCatalog(files: ContentFiles, options: CatalogOptions = {}): Catalog {
  const built = buildCatalog(files, options);
  if (!built.catalog) throw new ContentLoadError(built.issues);
  return built.catalog;
}
