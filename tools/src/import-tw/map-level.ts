// R2 level mapper: TwLevel (+ campaign position) -> canonical node-arena level object (serialize.ts writes the bytes).
// Pure: no fs. A level with blocked[] yields `level: null` (nothing to write).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXED_POINT_SCALE, computeRequires, type Catalog } from '@node-arena/content';
import type { TwBuilding, TwLevel, TwMapObjects, TwPlayer } from './types.js';
import { MAP_TOKEN, buildingToken, computeBlocked, featuresOf, themeFor, type GateOptions, type GateResult } from './gate.js';
import { archetypeKey, loadFeatureMap, resolveArchetype, type FeatureRow } from './feature-map.js';
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
  /** Test/extension hook: replaces entries of the per-token emitter registries (ELEMENT_EMITTERS / BUILDING_EMITTERS). */
  elementEmitters?: Record<string, ElementEmitter>;
  buildingEmitters?: Record<string, BuildingEmitter>;
}

export interface Colliders { obstacle: { children: { index: number; variant: 'small' | 'big'; yawDeg: number; footprint: { w: number; d: number } }[] } }
let collidersCache: Colliders | undefined;
export function loadColliders(): Colliders {
  return (collidersCache ??= JSON.parse(readFileSync(join(PREFAB_DIR, 'colliders.json'), 'utf8')) as Colliders);
}

/** One conservation row per TW list: total === mapped + dropped + blocked + inactive (mapped is counted from the output). */
export interface LedgerRow { list: string; total: number; mapped: number; dropped: number; blocked: number; inactive: number }
export interface MapResult {
  /** Canonical level object; null when the gate blocked it. */
  level: Obj | null;
  gate: GateResult;
  ledger: LedgerRow[];
  /** Ids of elements outside bounds (logged only). */
  outside: string[];
  /** Ids (`o<cluster>-<child>`) of inactive obstacle children (logged only). */
  inactiveIds: string[];
}

const COLOR_KEY = { blue: 'blue', green: 'green', red: 'red', yellow: 'yellow', gray: 'gray' } as const;
const HOUSE_PARAMS: Record<string, [string, string]> = {
  maxLevel: ['level', 'maxLevel'], spawnWarriorSpeed: ['spawns', 'spawnSpeed'], coefByWayCount: ['spawns', 'lineSpawnPenalty'], growLevelTime: ['grows', 'growTime'],
};
const TOWER_PARAMS: Record<string, [string, string]> = {
  maxLevel: ['level', 'maxLevel'], attackDelay: ['shoots', 'attackDelay'], attackRadius: ['shoots', 'attackRadius'],
  speedUpByLevel: ['shoots', 'speedUpByLevel'], radiusUpByLevel: ['shoots', 'radiusUpByLevel'], bulletSpeed: ['shoots', 'bulletSpeed'],
};
/** Handled outside the module table: archetype pick, top-level fields, or dropped (`sc`). */
const SPECIAL_PARAMS = new Set(['warriorType', 'level', 'canBeIgnored', 'spawnCoef']);

/** Per-token building emitter: the param-override table for this construct's archetype modules. */
export interface BuildingEmitter { params: Record<string, [string, string]> }
/** Building emitters, keyed by feature-map token. A map row with an archetype and no entry here is a MapError. */
export const BUILDING_EMITTERS: Readonly<Record<string, BuildingEmitter>> = {
  house: { params: HOUSE_PARAMS },
  tower: { params: TOWER_PARAMS },
};

export interface ElementEmitterCtx { tw: TwLevel; list: TwMapObjects[keyof TwMapObjects]; archetype: string; colliders: Colliders }
export interface ElementEmission { elements: Obj[]; /** items in the TW list (children for OBS). */ total: number; inactive: number; inactiveIds: string[] }
export type ElementEmitter = (ctx: ElementEmitterCtx) => ElementEmission;

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const nz = (v: number): number => (v === 0 ? 0 : v);

/** OBS: one `obstacle` per active child; yawDeg = OCR.Y (world rotation, rotated by the Frame contract) only: no collider yaw. */
const emitObstacles: ElementEmitter = ({ tw, list, archetype, colliders }) => {
  const kids = colliders.obstacle.children;
  const elements: Obj[] = [];
  const inactiveIds: string[] = [];
  let total = 0;
  (list as TwMapObjects['obstacles']).forEach((o, ci) => {
    o.childPos.forEach((cp, k) => {
      total++;
      if (!o.active[k]) { inactiveIds.push(`o${ci}-${k}`); return; }
      const c = kids[k];
      if (!c) throw new MapError(`${tw.id}: OBS[${ci}] child ${k} has no collider entry`);
      const pos = rotatePos(cp[0], cp[2]);
      elements.push({
        id: `o${ci}-${k}`, archetype, pos: { x: r2(pos.x), z: r2(pos.z) },
        yawDeg: nz(r3(rotateYaw(o.childRot[k]?.[1] ?? 0))),
        footprint: { shape: 'box', w: r3(c.footprint.w), d: r3(c.footprint.d) }, variant: c.variant,
      });
    });
  });
  return { elements, total, inactive: inactiveIds.length, inactiveIds };
};
/** Element emitters, keyed by feature-map token (same rule as BUILDING_EMITTERS). */
export const ELEMENT_EMITTERS: Readonly<Record<string, ElementEmitter>> = { OBS: emitObstacles };

function paramOverrides(catalog: Catalog, archetype: string, b: TwBuilding, table: Record<string, [string, string]>): Obj | undefined {
  const modules = (catalog.buildings[archetype] as { modules?: Record<string, Obj> } | undefined)?.modules ?? {};
  const out: Record<string, Obj> = {};
  for (const [k, v] of Object.entries((b.params ?? {}) as Obj)) {
    if (SPECIAL_PARAMS.has(k)) continue;
    const target = Object.hasOwn(table, k) ? table[k] : undefined;
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

/** Throws when any ledger row does not conserve (a mapper lost or invented an entry). */
export function assertLedger(rows: readonly LedgerRow[], who = 'level'): void {
  const bad = rows.filter((r) => r.mapped + r.dropped + r.blocked + r.inactive !== r.total);
  if (bad.length > 0) {
    throw new MapError(`${who}: ledger does not conserve: ${bad.map((r) => `${r.list} total ${r.total} != mapped ${r.mapped} + dropped ${r.dropped} + blocked ${r.blocked} + inactive ${r.inactive}`).join('; ')}`);
  }
}

const AI_OP_TOKEN: Record<string, string> = { delay: 'AiDS', line: 'AiCWS', steps: 'AiSC' };
const AI_LISTS = [['AiDS', 'delaySteps'], ['AiCWS', 'createWaySteps'], ['AiSC', 'actionSteps'], ['AiRM', 'railwayMoveSteps']] as const;

export function mapLevel(tw: TwLevel, position: number, catalog: Catalog, options: MapOptions): MapResult {
  const fm = options.featureMap ?? loadFeatureMap();
  const opts: MapOptions = { ...options, featureMap: fm };
  const gate = computeBlocked(tw, position, catalog, opts);
  const blockedTokens = new Set(gate.blocked.map((b) => b.tw));
  const droppedTw = new Set(gate.droppedTw);
  const colliders = options.colliders ?? loadColliders();
  const buildingEmitters = options.buildingEmitters ?? BUILDING_EMITTERS;
  const elementEmitters = options.elementEmitters ?? ELEMENT_EMITTERS;
  const levelBlocked = gate.blocked.length > 0;

  // Every map row with an archetype needs an emitter: otherwise the gate would pass a construct the mapper cannot write.
  for (const f of featuresOf(tw, fm)) {
    const row = fm.byTw.get(f.tw);
    if (!row || row.action !== 'map') continue;
    const hasArchetype = row.archetypeBy ? (f.keys ?? []).some((k) => resolveArchetype(row, k) !== null) : resolveArchetype(row) !== null;
    if (!hasArchetype) continue;
    const registry: Readonly<Record<string, unknown>> = row.kind === 'element' ? elementEmitters : buildingEmitters;
    if (!Object.hasOwn(registry, f.tw)) throw new MapError(`${tw.id}: feature-map row ${f.tw} maps to an archetype but has no ${row.kind} emitter in map-level.ts`);
  }

  const emitted = new Map<string, number>();
  const bump = (tok: string, n = 1): void => { emitted.set(tok, (emitted.get(tok) ?? 0) + n); };
  const rowOf = (tok: string): FeatureRow => fm.byTw.get(tok)!;

  const buildings: Obj[] = [];
  const players: Obj[] = [];
  const elements: Obj[] = [];
  const inactiveIds: string[] = [];

  if (!levelBlocked) {
    const { seatOf } = seatsOf(tw);
    const idOf = new Map<number, string>();
    const order = options.buildingOrder ?? 'original-P';
    let src = tw.buildings;
    if (order === 'human-first') {
      const rank = (b: TwBuilding): number => (b.owner === null ? 99 : Number((seatOf[b.owner] ?? 'p99').slice(1)));
      src = [...tw.buildings].map((b, i) => [b, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([b]) => b);
    }
    for (const b of src) {
      const tok = buildingToken(b.kind);
      if (droppedTw.has(tok)) continue;
      const row = rowOf(tok);
      const params = b.params as Record<string, unknown> | undefined;
      const arch = resolveArchetype(row, archetypeKey(row, params));
      if (arch === null) throw new MapError(`building ${b.id}: ${tok} resolves to no archetype`);
      const emitter = Object.hasOwn(buildingEmitters, tok) ? buildingEmitters[tok]! : undefined;
      if (!emitter) throw new MapError(`building ${b.id}: no emitter for ${tok}`);
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
      const overrides = paramOverrides(catalog, arch, b, emitter.params);
      if (overrides) out['params'] = overrides;
      buildings.push(out);
      bump(tok);
    }

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

    for (const [key, tok] of Object.entries(MAP_TOKEN)) {
      if (droppedTw.has(tok) || !Object.hasOwn(elementEmitters, tok)) continue;
      const row = rowOf(tok);
      const list = tw.mapObjects[key as keyof TwMapObjects];
      if (list.length === 0) continue;
      const arch = resolveArchetype(row);
      if (arch === null) throw new MapError(`${tw.id}: ${tok} resolves to no archetype`);
      const em = elementEmitters[tok]!({ tw, list, archetype: arch, colliders });
      elements.push(...em.elements);
      inactiveIds.push(...em.inactiveIds);
      bump(tok, em.elements.length);
    }
  }

  // ---- ledger: `mapped` is counted from what was emitted; everything else from the TW input + gate verdicts ----
  const ledger: LedgerRow[] = [];
  const classify = (tok: string): 'drop' | 'block' | 'emit' => (droppedTw.has(tok) ? 'drop' : blockedTokens.has(tok) ? 'block' : 'emit');
  const push = (list: string, total: number, tok: string, mapped: number, inactive = 0): void => {
    const active = total - inactive;
    const cls = classify(tok);
    const dropped = cls === 'drop' ? active : 0;
    // A level the gate blocked is not written, so its otherwise-mappable entries count as blocked too.
    const blocked = cls === 'block' || (cls === 'emit' && levelBlocked) ? active : 0;
    ledger.push({ list, total, mapped: cls === 'emit' && !levelBlocked ? mapped : 0, dropped, blocked, inactive });
  };
  const byTok = new Map<string, number>();
  for (const b of tw.buildings) { const t = buildingToken(b.kind); byTok.set(t, (byTok.get(t) ?? 0) + 1); }
  for (const [t, n] of [...byTok].sort()) push(`buildings:${t}`, n, t, emitted.get(t) ?? 0);
  const neutral = tw.players.filter((p) => p.type === 'neutral').length;
  // Neutral players (PT 2) have no seat: inactive.
  ledger.push({ list: 'players', total: tw.players.length, mapped: players.length, dropped: 0, blocked: levelBlocked ? tw.players.length - neutral : 0, inactive: neutral });
  for (const [key, tok] of Object.entries(MAP_TOKEN)) {
    const list = tw.mapObjects[key as keyof TwMapObjects];
    if (key === 'obstacles' || key === 'riverObstacles') {
      const kids = (list as TwMapObjects['obstacles']).reduce((n, o) => n + o.childPos.length, 0);
      const off = (list as TwMapObjects['obstacles']).reduce((n, o) => n + o.active.filter((a) => !a).length, 0);
      push(`${tok}:children`, kids, tok, emitted.get(tok) ?? 0, off);
    } else push(tok, list.length, tok, emitted.get(tok) ?? 0);
  }
  if (!options.botScript) {
    const opCount = new Map<string, number>();
    for (const pl of players) {
      for (const op of ((pl['bot'] as { script?: { op: string }[] } | undefined)?.script ?? [])) {
        const t = AI_OP_TOKEN[op.op];
        if (t) opCount.set(t, (opCount.get(t) ?? 0) + 1);
      }
    }
    for (const [tok, field] of AI_LISTS) {
      const total = tw.players.reduce((n, p) => n + (p.ai?.steps?.[field]?.length ?? 0), 0);
      if (total > 0) push(`ai:${tok}`, total, tok, opCount.get(tok) ?? 0);
    }
  }
  assertLedger(ledger, tw.id);

  if (levelBlocked) return { level: null, gate, ledger, outside: [], inactiveIds: [] };

  const bounds = levelBounds(buildings.map((b) => b['pos'] as { x: number; z: number }));
  const outside = elements.filter((e) => {
    const p = e['pos'] as { x: number; z: number };
    return p.x < bounds.minX || p.x > bounds.maxX || p.z < bounds.minZ || p.z > bounds.maxZ;
  }).map((e) => e['id'] as string);

  const dropped = new Set(gate.dropped);
  if (tw.source.scriptedComponents && tw.source.scriptedComponents.length > 0) dropped.add('tutorial-script');
  const source: Obj = { game: 'tower-war', gameVersion: tw.source.gameVersion, asset: tw.source.asset, campaignPosition: position, dialect: tw.source.dialect === 'prefab-reconstructed' ? 'prefab' : tw.source.dialect };
  if (dropped.size > 0) source['dropped'] = [...dropped].sort();

  const level: Obj = {
    $schema: '../../schemas/level.schema.json', schemaVersion: '2.0.0', id: tw.id, name: tw.name, source,
    theme: themeFor(position, options.envShift), bounds, objective: 'captureAll', timeLimitSec: null,
    players, buildings, elements,
  };
  level['requires'] = computeRequires(catalog, level as never);
  return { level, gate, ledger, outside, inactiveIds };
}

/** Duplicate slug across a batch = error (PRD 05 R2). */
export function assertUniqueIds(levels: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const l of levels) {
    if (seen.has(l.id)) throw new MapError(`duplicate level id (slug) ${l.id}`);
    seen.add(l.id);
  }
}
