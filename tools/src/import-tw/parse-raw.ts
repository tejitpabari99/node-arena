// Raw Tower War TextAsset -> TwLevel. v1-short dialect only; long / v0 / boss are refused explicitly (PRD Decision 2).
// Mapping mirrors the archived converter (_tools/p2_tw2na.py `to_ext`), so output equals converted/ext.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  TwBuilding, TwCategory, TwLevel, TwMapObjects, TwPlayer, TwAi, TwAiAction, TwVec, TwColor,
} from './types.js';
import { TEXTASSET_DIR } from './env.js';

type Json = Record<string, unknown>;

const BT_KIND: Record<number, string> = {
  0: 'house', 1: 'tower', 2: 'resource', 3: 'rocket_tower', 4: 'fortess', 5: 'flag',
  6: 'speed_tower', 7: 'selectable_fortess', 8: 'capture_rocket_tower', 9: 'boss_tower', 10: 'trolley',
};
const PT_TYPE = { 0: 'player', 1: 'ai', 2: 'neutral' } as const;
const PC_COLOR: Record<number, TwColor> = { 0: 'blue', 1: 'green', 2: 'red', 3: 'yellow', 4: 'gray' };
const SLOT_BY_PT = { 0: 'p', 1: 'ai_p', 2: 'n_p' } as const;

/** kind -> [semantic, short raw key]; `vec` marks vector-valued fields. */
const KIND_FIELDS: Record<string, [string, string][]> = {
  house: [['warriorType', 'WT'], ['level', 'l'], ['maxLevel', 'ml'], ['canBeIgnored', 'cbi'], ['spawnWarriorSpeed', 'ws'], ['coefByWayCount', 'cwc'], ['spawnCoef', 'sc'], ['growLevelTime', 'gl']],
  tower: [['level', 'l'], ['maxLevel', 'ml'], ['canBeIgnored', 'cbi'], ['attackDelay', 'ad'], ['attackRadius', 'ar'], ['speedUpByLevel', 'supl'], ['radiusUpByLevel', 'rupl'], ['bulletSpeed', 'bs']],
  rocket_tower: [['level', 'l'], ['maxLevel', 'ml'], ['canBeIgnored', 'cbi'], ['delayToShoot', 'ds'], ['coefByLevelUp', 'lup']],
  fortess: [['level', 'l'], ['maxLevel', 'ml'], ['canBeIgnored', 'cbi'], ['attackCooldown', 'ac'], ['bulletSpeed', 'bs']],
  flag: [['level', 'l'], ['maxLevel', 'ml'], ['canBeIgnored', 'cbi']],
  selectable_fortess: [['warriorType', 'wt'], ['level', 'l'], ['maxLevel', 'ml'], ['canBeIgnored', 'cbi'], ['spawnWarriorSpeed', 'ws'], ['coefByWayCount', 'cwc'], ['spawnCoef', 'sc'], ['attackCooldown', 'ac'], ['bulletSpeed', 'bs'], ['spawnedWarriorCount', 'swc'], ['warriorsCountPerParachute', 'wcpr'], ['delayTimeToSpawnCargo', 'dtsc']],
  capture_rocket_tower: [['level', 'l'], ['maxLevel', 'ml'], ['canBeIgnored', 'cbi'], ['startChargingPoints', 'scp'], ['maxChargingPoints', 'mcp'], ['chargingCooldown', 'cc']],
  boss_tower: [['configuredMovePositions', 'cmp'], ['movePositions', 'mp'], ['canBeIgnored', 'cbi']],
  trolley: [['level', 'l'], ['maxLevel', 'ml']],
  resource: [['rotation', 'r'], ['count', 'c']],
};
const VEC_FIELDS = new Set(['rotation', 'configuredMovePositions', 'movePositions']);

type FieldKind = 'v' | 'vl' | 's';
const MAPOBJ: Record<keyof TwMapObjects, [string, [string, string, FieldKind][]]> = {
  obstacles: ['OBS', [['parentPos', 'OPP', 'v'], ['parentRot', 'OPR', 'v'], ['childPos', 'OCP', 'vl'], ['childRot', 'OCR', 'vl'], ['active', 'S', 's']]],
  riverObstacles: ['ROBS', [['parentPos', 'OPP', 'v'], ['parentRot', 'OPR', 'v'], ['childPos', 'OCP', 'vl'], ['childRot', 'OCR', 'vl'], ['active', 'S', 's']]],
  mines: ['Mine', [['pos', 'P', 'v'], ['rot', 'R', 'v'], ['active', 'S', 's']]],
  walls: ['Wall', [['pos', 'P', 'v'], ['rot', 'R', 'v'], ['active', 'S', 's'], ['hp', 'Hp', 's'], ['punchStrength', 'PS', 's']]],
  sheep: ['Sheep', [['pos', 'P', 'v'], ['rot', 'R', 'v'], ['active', 'S', 's'], ['delayToReturn', 'D', 's'], ['isSquare', 'IsS', 's']]],
  rivers: ['River', [['pos', 'P', 'v'], ['rot', 'R', 'v'], ['type', 'T', 's'], ['bridgeWidth', 'W', 's'], ['distance', 'D', 's']]],
  cargo: ['Cargo', [['building', 'BId', 's'], ['points', 'P', 'vl']]],
  gates: ['Gate', [['type', 'T', 's'], ['coef', 'C', 's'], ['pos', 'P', 'v'], ['rot', 'R', 'v']]],
  railways: ['Railway', [['pos', 'P', 'v'], ['connectedBuilding', 'CTI', 's'], ['pathPoints', 'PPP', 'vl'], ['startPathPointIndex', 'SCV', 's']]],
};

const FAMILY_CATEGORY: Record<string, TwCategory> = {
  LevelView: 'campaign', LevelViewPvp: 'pvp', ChallengeTowerLevel: 'challengeTower', LevelViewArena: 'arena',
  TerminatorLevelView: 'festival', LevelViewDraw: 'daily', LevelViewDaily: 'daily-unlisted', LevelViewBoss: 'boss',
};

const AI_SCALARS: [string, string][] = [['actionDelay', 'AD'], ['reactionDelayMin', 'MinRD'], ['reactionDelayMax', 'MaxRD'], ['behavior', 'BT']];
const AI_STEP_LISTS = ['AiDS', 'AiCWS', 'AiRM', 'AiSC'];
const LONG_BUILDING_KEYS = ['BuildingsType', 'Id', 'Position'];

export class TwParseError extends Error {
  constructor(message: string) { super(message); this.name = 'TwParseError'; }
}

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(asset: string, message: string): never {
  throw new TwParseError(`${asset}: ${message}`);
}

/** `LevelViewPvp 12_ES` -> family `LevelViewPvp`, number 12, author `ES`. */
export function nameParts(asset: string): { family: string; number: number | null; author: string | null } {
  const m = /^(.*?) (\d+)(?:_(.*))?$/.exec(asset);
  if (!m) return { family: asset, number: null, author: null };
  return { family: m[1] ?? asset, number: Number(m[2]), author: m[3] ?? null };
}

export function slugify(asset: string): string {
  return asset.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function toVec(asset: string, where: string, v: unknown): TwVec {
  if (!isRecord(v) || typeof v['X'] !== 'number' || typeof v['Y'] !== 'number' || typeof v['Z'] !== 'number') {
    fail(asset, `${where}: expected {X,Y,Z}`);
  }
  return [v['X'], v['Y'], v['Z']];
}

function toVecAny(asset: string, where: string, v: unknown): unknown {
  return Array.isArray(v) ? v.map((x, i) => toVec(asset, `${where}[${i}]`, x)) : toVec(asset, where, v);
}

/** Refuse long-key / v0 / unknown shapes before any conversion. */
function checkDialect(asset: string, d: Json): void {
  if (!('P' in d)) {
    if ('Player' in d) fail(asset, 'v0 dialect (legacy {Player, AI, ...}) is not supported: v1-short only');
    fail(asset, 'unknown dialect: no "P" player list');
  }
  if (!Array.isArray(d['P'])) fail(asset, 'unknown dialect: "P" is not a list');
  const buildings: unknown[] = [];
  for (const p of d['P'] as unknown[]) {
    if (!isRecord(p)) fail(asset, 'unknown dialect: player entry is not an object');
    if (Array.isArray(p['BD'])) buildings.push(...(p['BD'] as unknown[]));
  }
  if (Array.isArray(d['WOD'])) buildings.push(...(d['WOD'] as unknown[]));
  for (const b of buildings) {
    if (isRecord(b) && LONG_BUILDING_KEYS.some((k) => k in b)) {
      fail(asset, 'long dialect (C# property-name building keys) is not supported: v1-short only');
    }
  }
}

function buildingToExt(asset: string, b: Json, owner: number | null): TwBuilding {
  const bt = b['bt'];
  if (typeof bt !== 'number') fail(asset, `building id ${String(b['id'])}: missing numeric "bt"`);
  const kind = Object.hasOwn(BT_KIND, bt) ? BT_KIND[bt]! : `bt${bt}`;
  const used = new Set<string>(['key', 'bt']);
  const out: Record<string, unknown> = { owner, kind };
  for (const [sem, raw] of [['id', 'id'], ['style', 'lt'], ['pos', 'p']] as const) {
    if (raw in b) {
      used.add(raw);
      out[sem] = sem === 'pos' ? toVec(asset, 'building.p', b[raw]) : b[raw];
    }
  }
  const params: Record<string, unknown> = {};
  for (const [sem, raw] of (Object.hasOwn(KIND_FIELDS, kind) ? KIND_FIELDS[kind] : undefined) ?? []) {
    if (raw in b) {
      used.add(raw);
      params[sem] = VEC_FIELDS.has(sem) ? toVecAny(asset, `building.${raw}`, b[raw]) : b[raw];
    }
  }
  const extra: Json = {};
  for (const [k, v] of Object.entries(b)) if (!used.has(k)) extra[k] = v;
  if (Object.keys(params).length > 0) out['params'] = params;
  if (Object.keys(extra).length > 0) out['extra'] = extra;
  out['key'] = b['key'];
  return out as unknown as TwBuilding;
}

function actionToExt(a: unknown): TwAiAction {
  const r = a as Json;
  return {
    goal: r['GT'], ownHouse: r['OHId'], targetHouse: r['THId'], startDelay: r['DS'],
    then: r['OS'] === null ? null : (r['OS'] as unknown[]).map(actionToExt),
  } as TwAiAction;
}

function aiToExt(p: Json): TwAi {
  const ai: Record<string, unknown> = {};
  for (const [sem, raw] of AI_SCALARS) if (raw in p) ai[sem] = p[raw];
  const steps: Record<string, unknown> = {};
  const list = (key: string): Json[] | null | undefined => {
    if (!(key in p)) return undefined;
    const v = p[key];
    return v === null ? null : (v as Json[]);
  };
  const ds = list('AiDS');
  if (ds !== undefined) steps['delaySteps'] = ds === null ? null : ds.map((s) => ({ index: s['I'], delay: s['D'] }));
  const cw = list('AiCWS');
  if (cw !== undefined) steps['createWaySteps'] = cw === null ? null : cw.map((s) => ({ index: s['I'], ownHouse: s['OHId'], targetHouse: s['THId'], attackDelay: s['AD'] }));
  const rm = list('AiRM');
  if (rm !== undefined) steps['railwayMoveSteps'] = rm === null ? null : rm.map((s) => ({ index: s['I'], targetPathPointIndex: s['TPPI'], building: s['BId'] }));
  const sc = list('AiSC');
  if (sc !== undefined) steps['actionSteps'] = sc === null ? null : sc.map((s) => ({ index: s['I'], action: actionToExt(s['AiSA']) }));
  ai['steps'] = steps;
  return ai as unknown as TwAi;
}

/** Convert an already-parsed raw v1-short document. `asset` is the addressable name (`LevelView 3_AB`). */
export function rawToTwLevel(asset: string, doc: unknown): TwLevel {
  if (!isRecord(doc)) fail(asset, 'level JSON is not an object');
  checkDialect(asset, doc);
  const { family, number, author } = nameParts(asset);
  const category = Object.hasOwn(FAMILY_CATEGORY, family) ? FAMILY_CATEGORY[family]! : 'other';
  if (category === 'boss') fail(asset, 'boss level (LevelViewBoss) is not supported: v1-short campaign levels only');

  const level: TwLevel = {
    schema: 'node-arena/tw-level-ext@0.1',
    id: slugify(asset),
    name: asset,
    category,
    source: { game: 'tower-war', gameVersion: '1.29.3', asset, family, number, author, dialect: 'v1-short' },
    players: [],
    buildings: [],
    mapObjects: {} as TwMapObjects,
  };

  (doc['P'] as Json[]).forEach((p, pi) => {
    const pt = p['PT'];
    if (pt === 3) fail(asset, `player ${pi}: boss player (PT 3) is not supported`);
    if (pt !== 0 && pt !== 1 && pt !== 2) fail(asset, `player ${pi}: unknown PT ${String(pt)}`);
    const pc = p['PC'];
    const color = typeof pc === 'number' ? PC_COLOR[pc] : undefined;
    if (color === undefined) fail(asset, `player ${pi}: unknown PC ${String(pc)}`);
    if (p['key'] !== SLOT_BY_PT[pt]) fail(asset, `player ${pi}: key ${JSON.stringify(p['key'])} does not match PT ${pt}`);
    const player: TwPlayer = { type: PT_TYPE[pt], pt, color, pc: pc as TwPlayer['pc'], slotKey: SLOT_BY_PT[pt] };
    if (pt === 1) player.ai = aiToExt(p);
    const nulls: number[] = [];
    const bd = p['BD'];
    if (bd !== null && !Array.isArray(bd)) fail(asset, `player ${pi}: BD is not a list`);
    (bd ?? []).forEach((b: unknown, bi: number) => {
      if (b === null) { nulls.push(bi); return; }
      if (!isRecord(b)) fail(asset, `player ${pi}: BD[${bi}] is not an object`);
      level.buildings.push(buildingToExt(asset, b, pi));
    });
    if (nulls.length > 0) player.nullSlots = nulls;
    if (bd === null) player.bdNull = true;
    const known = new Set(['PT', 'PC', 'BD', 'key', ...AI_SCALARS.map(([, k]) => k), ...AI_STEP_LISTS]);
    const extra: Json = {};
    for (const [k, v] of Object.entries(p)) if (!known.has(k)) extra[k] = v;
    if (Object.keys(extra).length > 0) player.extra = extra;
    level.players.push(player);
  });

  for (const b of (doc['WOD'] ?? []) as unknown[]) {
    if (!isRecord(b)) fail(asset, 'WOD entry is not an object');
    level.buildings.push(buildingToExt(asset, b, null));
  }

  const listKeys = new Set<string>(['P', 'WOD']);
  for (const [name, [rawKey, fields]] of Object.entries(MAPOBJ) as [keyof TwMapObjects, (typeof MAPOBJ)[keyof TwMapObjects]][]) {
    listKeys.add(rawKey);
    const raw = doc[rawKey] ?? [];
    if (!Array.isArray(raw)) fail(asset, `${rawKey} is not a list`);
    level.mapObjects[name] = raw.map((o: unknown, i: number) => {
      if (!isRecord(o)) fail(asset, `${rawKey}[${i}] is not an object`);
      const e: Json = {};
      for (const [sem, k, kind] of fields) {
        if (!(k in o)) fail(asset, `${rawKey}[${i}]: missing key "${k}"`);
        const v = o[k];
        e[sem] = kind === 'v' ? toVec(asset, `${rawKey}[${i}].${k}`, v) : kind === 'vl' ? toVecAny(asset, `${rawKey}[${i}].${k}`, v) : v;
      }
      const used = new Set(fields.map((f) => f[1]));
      const extra: Json = {};
      for (const [k, v] of Object.entries(o)) if (!used.has(k)) extra[k] = v;
      if (Object.keys(extra).length > 0) e['extra'] = extra;
      return e;
    }) as never;
  }
  const topExtra: Json = {};
  for (const [k, v] of Object.entries(doc)) if (!listKeys.has(k)) topExtra[k] = v;
  if (Object.keys(topExtra).length > 0) level.extra = topExtra;
  return level;
}

/** Parse raw TextAsset text (UTF-8, optional BOM). */
export function parseRawText(asset: string, text: string): TwLevel {
  let doc: unknown;
  try { doc = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { fail(asset, `invalid JSON: ${(e as Error).message}`); }
  return rawToTwLevel(asset, doc);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The one file name for `asset` among `names`: anchored `^<asset>_-?\d+\.json$` (`LevelView 1_` is also a prefix of
 * `LevelView 1_AB_<id>.json`, so the suffix must be digits only). 0 or >1 matches = error.
 */
export function matchRawFileName(names: readonly string[], asset: string): string {
  const re = new RegExp(`^${escapeRegExp(asset)}_-?\\d+\\.json$`);
  const hits = names.filter((n) => re.test(n));
  if (hits.length === 0) throw new TwParseError(`${asset}: no raw TextAsset file matches ${re}`);
  if (hits.length > 1) throw new TwParseError(`${asset}: ambiguous raw TextAsset files (${hits.length}): ${[...hits].sort().join(', ')}`);
  return hits[0] as string;
}

/** Parse `asset` from a TextAsset directory (`<extract>/assets/defaultlocalgroup_assets/TextAsset`). */
export function parseRawFromDir(textAssetDir: string, asset: string): TwLevel {
  const file = matchRawFileName(readdirSync(textAssetDir), asset);
  return parseRawText(asset, readFileSync(join(textAssetDir, file), 'utf8'));
}

/** Parse `asset` from a Tower War extract root. */
export function parseRaw(extractRoot: string, asset: string): TwLevel {
  return parseRawFromDir(join(extractRoot, TEXTASSET_DIR), asset);
}
