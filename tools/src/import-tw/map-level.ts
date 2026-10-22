// R2 level mapper: TwLevel (+ campaign position) -> canonical node-arena level object (serialize.ts writes the bytes).
// Pure: no fs. A level with blocked[] yields `level: null` (nothing to write).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXED_POINT_SCALE, computeRequires, type Catalog } from '@node-arena/content';
import type { TwBuilding, TwLevel, TwPlayer } from './types.js';
import { BUILDING_TOKEN, MAP_TOKEN, computeBlocked, themeFor, type GateOptions, type GateResult } from './gate.js';
import { levelBounds, rotatePos, rotateYaw } from './rotate.js';
import { PREFAB_DIR } from './parse-prefab.js';
import { mergeBotScript } from './script.js';

type Obj = Record<string, unknown>;

export class MapError extends Error {}

/** B2/Decision 4: `original-P` = TW `BD` flatten order per ORIGINAL `P` order (the rule). `human-first` exists only as the escape hatch. */
export type BuildingOrder = 'original-P' | 'human-first';

export interface BotHookCtx { player: TwPlayer; seatId: string; buildingId: (twId: number) => string | null }
export interface MapOptions extends GateOptions {
  buildingOrder?: BuildingOrder;
  /** Fills `bot.script`. Default: `mergeBotScript` (AiDS/AiCWS/AiSC merged by I). */
  botScript?: (ctx: BotHookCtx) => unknown[];
  colliders?: Colliders;
}

export interface Colliders { obstacle: { children: { index: number; variant: 'small' | 'big'; yawDeg: number; footprint: { w: number; d: number } }[] } }
let collidersCache: Colliders | undefined;
export function loadColliders(): Colliders {
  return (collidersCache ??= JSON.parse(readFileSync(join(PREFAB_DIR, 'colliders.json'), 'utf8')) as Colliders);
}

/** One conservation row per TW list: total === mapped + dropped + blocked + inactive. */
export interface LedgerRow { list: string; total: number; mapped: number; dropped: number; blocked: number; inactive: number }
export interface MapResult {
  /** Canonical level object; null when the gate blocked it. */
  level: Obj | null;
  gate: GateResult;
  ledger: LedgerRow[];
  /** Ids of elements outside bounds (logged only). */
  outside: string[];
}

const COLOR_KEY = { blue: 'blue', green: 'green', red: 'red', yellow: 'yellow', gray: 'gray' } as const;
const HOUSE_PARAMS: Record<string, [string, string]> = {
  maxLevel: ['level', 'maxLevel'], spawnWarriorSpeed: ['spawns', 'spawnSpeed'], coefByWayCount: ['spawns', 'lineSpawnPenalty'], growLevelTime: ['grows', 'growTime'],
};
const TOWER_PARAMS: Record<string, [string, string]> = {
  maxLevel: ['level', 'maxLevel'], attackDelay: ['shoots', 'attackDelay'], attackRadius: ['shoots', 'attackRadius'],
  speedUpByLevel: ['shoots', 'speedUpByLevel'], radiusUpByLevel: ['shoots', 'radiusUpByLevel'], bulletSpeed: ['shoots', 'bulletSpeed'],
};
const PARAM_TABLE: Record<string, Record<string, [string, string]>> = { house: HOUSE_PARAMS, tower: TOWER_PARAMS };
/** Handled outside the module table: archetype pick, top-level fields, or dropped (`sc`). */
const SPECIAL_PARAMS = new Set(['warriorType', 'level', 'canBeIgnored', 'spawnCoef']);

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const nz = (v: number): number => (v === 0 ? 0 : v);

export function archetypeFor(b: TwBuilding): string {
  if (b.kind === 'tower') return 'tower';
  if (b.kind === 'house') {
    const wt = (b.params as { warriorType?: number } | undefined)?.warriorType ?? 1;
    return `house-wt${wt}`;
  }
  throw new MapError(`building ${b.id}: kind ${b.kind} has no archetype`);
}

function paramOverrides(catalog: Catalog, archetype: string, b: TwBuilding): Obj | undefined {
  const table = PARAM_TABLE[b.kind];
  const modules = (catalog.buildings[archetype] as { modules?: Record<string, Obj> } | undefined)?.modules ?? {};
  const out: Record<string, Obj> = {};
  for (const [k, v] of Object.entries((b.params ?? {}) as Obj)) {
    if (SPECIAL_PARAMS.has(k)) continue;
    const target = table?.[k];
    if (!target) throw new MapError(`building ${b.id}: param ${k} has no mapping`);
    const [mod, name] = target;
    // The compiled catalog holds fx3 (milli-int) values for fractional params; counts (maxLevel) stay plain.
    const a = modules[mod]?.[name];
    if (a === v || (typeof v === 'number' && a === Math.round(v * FIXED_POINT_SCALE))) continue;
    (out[mod] ??= {})[name] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Seat order: human first, then AI in `P` order. Neutral (PT 2) has no seat. */
function seatsOf(tw: TwLevel): { seatOf: (string | null)[]; } {
  const humans = tw.players.map((p, i) => [p, i] as const).filter(([p]) => p.type === 'player');
  if (humans.length !== 1) throw new MapError(`${tw.id}: expected exactly 1 human player, found ${humans.length}`);
  const ordered = [...humans, ...tw.players.map((p, i) => [p, i] as const).filter(([p]) => p.type === 'ai')];
  const seatOf: (string | null)[] = tw.players.map(() => null);
  ordered.forEach(([, i], n) => { seatOf[i] = `p${n + 1}`; });
  return { seatOf };
}

export function mapLevel(tw: TwLevel, position: number, catalog: Catalog, options: MapOptions = {}): MapResult {
  const gate = computeBlocked(tw, position, catalog, options);
  const blockedTokens = new Set(gate.blocked.map((b) => b.tw));
  const droppedTokens = new Set(gate.dropped);
  const colliders = options.colliders ?? loadColliders();

  const ledger: LedgerRow[] = [];
  const row = (list: string, total: number, token: string | undefined, inactive = 0): void => {
    const active = total - inactive;
    const blocked = token !== undefined && blockedTokens.has(token) ? active : 0;
    const dropped = token !== undefined && blocked === 0 && droppedTokens.has(token) ? active : 0;
    ledger.push({ list, total, mapped: active - blocked - dropped, dropped, blocked, inactive });
  };
  // Buildings are counted per construct token (house/tower/...), so a blocked kind is attributed to its own token.
  const byTok = new Map<string, number>();
  for (const b of tw.buildings) { const t = BUILDING_TOKEN[b.kind] ?? b.kind; byTok.set(t, (byTok.get(t) ?? 0) + 1); }
  for (const [t, n] of [...byTok].sort()) row(`buildings:${t}`, n, t);
  row('players', tw.players.length, undefined);
  for (const [key, tok] of Object.entries(MAP_TOKEN)) {
    const list = tw.mapObjects[key as keyof TwLevel['mapObjects']];
    if (key === 'obstacles' || key === 'riverObstacles') {
      const kids = (list as TwLevel['mapObjects']['obstacles']).reduce((n, o) => n + o.childPos.length, 0);
      const off = (list as TwLevel['mapObjects']['obstacles']).reduce((n, o) => n + o.active.filter((a) => !a).length, 0);
      row(`${tok}:children`, kids, tok, off);
    } else row(tok, list.length, tok);
  }

  if (gate.blocked.length > 0) return { level: null, gate, ledger, outside: [] };

  const { seatOf } = seatsOf(tw);
  const idOf = new Map<number, string>();
  const order = options.buildingOrder ?? 'original-P';
  let src = tw.buildings;
  if (order === 'human-first') {
    const rank = (b: TwBuilding): number => (b.owner === null ? 99 : Number((seatOf[b.owner] ?? 'p99').slice(1)));
    src = [...tw.buildings].map((b, i) => [b, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([b]) => b);
  }
  const buildings = src.map((b) => {
    const arch = archetypeFor(b);
    const id = `b${b.id}`;
    if (idOf.has(b.id)) throw new MapError(`${tw.id}: duplicate building id ${b.id}`);
    idOf.set(b.id, id);
    const p = b.params as { level?: number; canBeIgnored?: boolean } | undefined;
    const pos = rotatePos(b.pos[0], b.pos[2]);
    const out: Obj = {
      id, archetype: arch, pos: { x: r2(pos.x), z: r2(pos.z) },
      owner: b.owner === null ? null : (seatOf[b.owner] ?? null),
      level: p?.level ?? 1, ignoreForWin: p?.canBeIgnored ?? false,
    };
    const params = paramOverrides(catalog, arch, b);
    if (params) out['params'] = params;
    return out;
  });

  const players: Obj[] = [];
  const seatsInOrder = tw.players.map((pl, i) => [pl, i] as const).filter(([, i]) => seatOf[i] !== null)
    .sort((a, b) => Number(seatOf[a[1]]!.slice(1)) - Number(seatOf[b[1]]!.slice(1)));
  for (const [pl, i] of seatsInOrder) {
    const seatId = seatOf[i]!;
    const p: Obj = { id: seatId, kind: pl.type === 'player' ? 'human' : 'ai', colorKey: COLOR_KEY[pl.color] };
    if (pl.type === 'ai') {
      const ad = pl.ai?.actionDelay;
      if (ad === undefined) throw new MapError(`${tw.id}: AI player ${i} has no AD`);
      p['bot'] = {
        kind: 'tw', actionDelayMs: Math.round(ad * 1000), behavior: (pl.ai?.behavior ?? 0) === 0 ? 'full' : 'attackOnly',
        script: options.botScript
          ? options.botScript({ player: pl, seatId, buildingId: (n) => idOf.get(n) ?? null })
          : mergeBotScript(pl.ai, (n) => idOf.get(n) ?? null, `${tw.id}/${seatId}`),
      };
    }
    players.push(p);
  }

  const kids = colliders.obstacle.children;
  const elements: Obj[] = [];
  tw.mapObjects.obstacles.forEach((o, ci) => {
    o.childPos.forEach((cp, k) => {
      if (!o.active[k]) return;
      const c = kids[k];
      if (!c) throw new MapError(`${tw.id}: OBS[${ci}] child ${k} has no collider entry`);
      const pos = rotatePos(cp[0], cp[2]);
      elements.push({
        id: `o${ci}-${k}`, archetype: 'obstacle', pos: { x: r2(pos.x), z: r2(pos.z) },
        yawDeg: nz(r3(rotateYaw((o.childRot[k]?.[1] ?? 0) + c.yawDeg))),
        footprint: { shape: 'box', w: r3(c.footprint.w), d: r3(c.footprint.d) }, variant: c.variant,
      });
    });
  });

  const bounds = levelBounds(buildings.map((b) => b['pos'] as { x: number; z: number }));
  const outside = elements.filter((e) => {
    const p = e['pos'] as { x: number; z: number };
    return p.x < bounds.minX || p.x > bounds.maxX || p.z < bounds.minZ || p.z > bounds.maxZ;
  }).map((e) => e['id'] as string);

  // Reaction-delay bot params are not recorded (golden source.dropped is [cargo, sc]); the gate still reports them.
  const dropped = new Set(gate.dropped.filter((t) => t !== 'MinRD' && t !== 'MaxRD').map((t) => (t === 'AiRM' ? 'ai-rail-move' : t)));
  if (tw.source.scriptedComponents && tw.source.scriptedComponents.length > 0) dropped.add('tutorial-script');
  const source: Obj = { game: 'tower-war', gameVersion: tw.source.gameVersion, asset: tw.source.asset, campaignPosition: position, dialect: tw.source.dialect === 'prefab-reconstructed' ? 'prefab' : tw.source.dialect };
  if (dropped.size > 0) source['dropped'] = [...dropped].sort();

  const level: Obj = {
    $schema: '../../schemas/level.schema.json', schemaVersion: '2.0.0', id: tw.id, name: tw.name, source,
    theme: themeFor(position, options.envShift), bounds, objective: 'captureAll', timeLimitSec: null,
    players, buildings, elements,
  };
  level['requires'] = computeRequires(catalog, level as never);
  return { level, gate, ledger, outside };
}

/** Duplicate slug across a batch = error (PRD 05 R2). */
export function assertUniqueIds(levels: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const l of levels) {
    if (seen.has(l.id)) throw new MapError(`duplicate level id (slug) ${l.id}`);
    seen.add(l.id);
  }
}
