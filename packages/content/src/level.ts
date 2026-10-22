import { BOT_KINDS, OBJECTIVES, type BotKindId, type ObjectiveId, type TwBot } from '@node-arena/defs';
import { ContentLoadError, type ContentIssue } from './fixed-point.js';
import type { Catalog } from './catalog.js';
import { parseAndConvert, type ContentSource } from './issues.js';
import type { NextBuilding, NextElement, NextLevel } from './schemas.js';

/** Seat bot block: the union of registered bot kinds (currently `tw`). */
export type SeatBot = TwBot;
export type ModuleBags = Record<string, Record<string, unknown>>;
type Footprint = NextBuilding['footprint'];

export interface LoadedLevel {
  file: string;
  /** Milli-int level data (fx3 converted). */
  level: NextLevel;
  /** Non-fatal findings: footprint overlap, elements outside bounds. */
  warnings: ContentIssue[];
}

/** Archetype module params with instance overrides merged over (flat params, so a shallow merge per module). */
export function mergeModules(archetype: ModuleBags, overrides: ModuleBags | undefined): ModuleBags {
  const out: ModuleBags = {};
  for (const [id, params] of Object.entries(archetype)) out[id] = { ...params, ...(overrides?.[id] ?? {}) };
  return out;
}

const bagsOf = (x: { modules?: unknown }) => (x.modules ?? {}) as ModuleBags;

/**
 * Derived capability set: module ids used by the level's building/element archetypes, `bot:<kind>`
 * per AI seat, `objective:<id>`. Sorted, deduplicated. Unknown archetypes are ignored (the validator reports them).
 */
export function computeRequires(catalog: Catalog, level: Pick<NextLevel, 'objective' | 'players' | 'buildings' | 'elements'>): string[] {
  const out = new Set<string>();
  for (const b of level.buildings) for (const m of Object.keys(bagsOf(catalog.buildings[b.archetype] ?? {}))) out.add(m);
  for (const e of level.elements) for (const m of Object.keys(bagsOf(catalog.elements[e.archetype] ?? {}))) out.add(m);
  for (const p of level.players) if (p.bot) out.add(`bot:${(p.bot as SeatBot).kind}`);
  out.add(`objective:${level.objective}`);
  return [...out].sort();
}

function overlaps(a: { x: number; z: number; f: Footprint }, b: { x: number; z: number; f: Footprint }): boolean {
  const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
  if (a.f.shape === 'circle' && b.f.shape === 'circle') { const r = a.f.radius! + b.f.radius!; return dx * dx + dz * dz < r * r; }
  if (a.f.shape === 'box' && b.f.shape === 'box') return dx < (a.f.w! + b.f.w!) / 2 && dz < (a.f.d! + b.f.d!) / 2;
  const [c, bx] = a.f.shape === 'circle' ? [a, b] : [b, a];
  const nx = Math.max(0, dx - bx.f.w! / 2), nz = Math.max(0, dz - bx.f.d! / 2);
  return nx * nx + nz * nz < c.f.radius! * c.f.radius!;
}

/** All semantic validation of one converted level against the catalog. */
export function validateLevel(catalog: Catalog, level: NextLevel, file: string): { issues: ContentIssue[]; warnings: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const warnings: ContentIssue[] = [];
  const err = (pointer: string, message: string) => issues.push({ file, pointer, message });
  const warn = (pointer: string, message: string) => warnings.push({ file, pointer, message });

  const fileId = /(?:^|\/)levels\/([^/]+)\.json$/.exec(file)?.[1];
  if (fileId !== undefined && fileId !== level.id) err('/id', `id "${level.id}" must equal the file name "${fileId}"`);

  const b = level.bounds;
  if (b.minX >= b.maxX) err('/bounds', 'minX must be less than maxX');
  if (b.minZ >= b.maxZ) err('/bounds', 'minZ must be less than maxZ');
  if (catalog.themes && !catalog.themes.includes(level.theme)) err('/theme', `Unknown theme "${level.theme}"`);

  // Players: human first, seat counts from the objective, unique ids and colours, bot only on AI seats.
  const objective = OBJECTIVES[level.objective as ObjectiveId];
  const playerIds = new Map<string, number>();
  const colors = new Set<string>();
  let humans = 0, ais = 0;
  level.players.forEach((p, i) => {
    if (playerIds.has(p.id)) err(`/players/${i}/id`, `Duplicate player id "${p.id}"`);
    playerIds.set(p.id, i);
    if (colors.has(p.colorKey)) err(`/players/${i}/colorKey`, `Duplicate colorKey "${p.colorKey}"`);
    colors.add(p.colorKey);
    if (catalog.colorKeys && !catalog.colorKeys.includes(p.colorKey)) err(`/players/${i}/colorKey`, `Unknown colorKey "${p.colorKey}"`);
    if (p.kind === 'human') { humans++; if (i !== 0) err(`/players/${i}/kind`, 'The human player must be first in players[]'); if (p.bot) err(`/players/${i}/bot`, 'Human players cannot have a bot'); }
    else { ais++; if (!p.bot) err(`/players/${i}`, 'AI players require a bot block'); }
  });
  if (humans !== objective.seats.human) err('/players', `Expected exactly ${objective.seats.human} human player(s), found ${humans}`);
  if (ais < 1 || ais > objective.seats.aiMax) err('/players', `Expected 1..${objective.seats.aiMax} AI players, found ${ais}`);

  // Buildings.
  const buildingIds = new Set<string>();
  let counted = 0;
  const placed: Array<{ i: number; x: number; z: number; f: Footprint }> = [];
  level.buildings.forEach((bd, i) => {
    if (buildingIds.has(bd.id)) err(`/buildings/${i}/id`, `Duplicate building id "${bd.id}"`);
    buildingIds.add(bd.id);
    if (!bd.ignoreForWin) counted++;
    if (bd.owner !== null && !playerIds.has(bd.owner)) err(`/buildings/${i}/owner`, `Unknown player "${bd.owner}"`);
    const arch = catalog.buildings[bd.archetype];
    if (!arch) { err(`/buildings/${i}/archetype`, `Unknown building archetype "${bd.archetype}"`); return; }
    const archModules = bagsOf(arch);
    const overrides = bd.params as ModuleBags | undefined;
    for (const m of Object.keys(overrides ?? {})) if (!(m in archModules)) err(`/buildings/${i}/params/${m}`, `Archetype "${bd.archetype}" has no "${m}" module to override`);
    const merged = mergeModules(archModules, overrides);
    const maxLevel = merged.level?.maxLevel;
    if (typeof maxLevel !== 'number') err(`/buildings/${i}/archetype`, `Archetype "${bd.archetype}" has no level module`);
    else if (bd.level > maxLevel) err(`/buildings/${i}/level`, `level ${bd.level} exceeds maxLevel ${maxLevel}`);
    const troop = merged.spawns?.troop;
    if (typeof troop === 'string' && !(troop in catalog.units)) err(`/buildings/${i}/params/spawns/troop`, `Unknown unit "${troop}"`);
    if (bd.pos.x < b.minX || bd.pos.x > b.maxX || bd.pos.z < b.minZ || bd.pos.z > b.maxZ) err(`/buildings/${i}/pos`, 'Building position lies outside bounds');
    placed.push({ i, x: bd.pos.x, z: bd.pos.z, f: arch.footprint });
  });
  if (level.buildings.length > 0 && counted === 0) err('/buildings', 'At least one building must not be ignoreForWin');
  for (let a = 0; a < placed.length; a++) {
    for (let c = a + 1; c < placed.length; c++) {
      const p = placed[a]!, q = placed[c]!;
      if (p.x === q.x && p.z === q.z) err(`/buildings/${q.i}/pos`, `Coincident with building at /buildings/${p.i}`);
      else if (overlaps(p, q)) warn(`/buildings/${q.i}/pos`, `Footprint overlaps building at /buildings/${p.i}`);
    }
  }

  // Elements: only logged when outside bounds.
  const elementIds = new Set<string>();
  level.elements.forEach((el, i) => {
    if (elementIds.has(el.id)) err(`/elements/${i}/id`, `Duplicate element id "${el.id}"`);
    elementIds.add(el.id);
    const arch = catalog.elements[el.archetype] as NextElement | undefined;
    if (!arch) { err(`/elements/${i}/archetype`, `Unknown element archetype "${el.archetype}"`); return; }
    for (const m of Object.keys(el.params ?? {})) if (!(m in bagsOf(arch))) err(`/elements/${i}/params/${m}`, `Archetype "${el.archetype}" has no "${m}" module to override`);
    if (el.variant !== undefined && !(arch.variants ?? []).includes(el.variant)) err(`/elements/${i}/variant`, `Archetype "${el.archetype}" has no variant "${el.variant}"`);
    if (el.pos.x < b.minX || el.pos.x > b.maxX || el.pos.z < b.minZ || el.pos.z > b.maxZ) warn(`/elements/${i}/pos`, 'Element lies outside bounds');
  });

  // Bot cross-references.
  level.players.forEach((p, i) => {
    if (!p.bot) return;
    const bot = p.bot as SeatBot;
    const kind = BOT_KINDS[bot.kind as BotKindId];
    if (!kind) { err(`/players/${i}/bot/kind`, `Unknown bot kind "${bot.kind}"`); return; }
    for (const ref of kind.buildingRefs(bot)) if (!buildingIds.has(ref)) err(`/players/${i}/bot`, `Bot references unknown building "${ref}"`);
  });

  // requires: derived, authored copy must equal the recomputed set.
  const want = computeRequires(catalog, level);
  const have = [...new Set(level.requires)].sort();
  if (have.length !== level.requires.length || have.join('\n') !== want.join('\n')) err('/requires', `requires must equal the derived set [${want.join(', ')}]`);
  return { issues, warnings };
}

/** Parse + validate one level (no other levels read). Throws `ContentLoadError` with file + pointer per issue. */
export function loadLevel(catalog: Catalog, json: ContentSource, file?: string): LoadedLevel {
  const probe = typeof json === 'string' ? safeId(json) : (json as { id?: unknown }).id;
  const name = file ?? (typeof probe === 'string' ? `data/levels/${probe}.json` : 'level.json');
  const parsed = parseAndConvert<NextLevel>(name, json, 'level');
  if (!parsed.value) throw new ContentLoadError(parsed.issues);
  const { issues, warnings } = validateLevel(catalog, parsed.value, name);
  if (issues.length) throw new ContentLoadError(issues);
  return { file: name, level: parsed.value, warnings };
}

function safeId(text: string): unknown {
  try { return (JSON.parse(text) as { id?: unknown } | null)?.id; } catch { return undefined; }
}
