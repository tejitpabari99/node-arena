import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadCatalog, loadLevel, BOUNDS_PAD, type Catalog, type ContentFiles } from '@node-arena/content';
import { loadFiles } from '../../files.js';
import { ELEMENT_EMITTERS, MapError, assertLedger, assertUniqueIds, loadColliders, mapLevel, type LedgerRow } from '../map-level.js';
import { loadFeatureMap, parseFeatureMap } from '../feature-map.js';
import { serializeLevel } from '../serialize.js';
import { ScriptError, mergeBotScript } from '../script.js';
import { parseRawFromDir, parseRaw } from '../parse-raw.js';
import { loadPrefabLevels } from '../parse-prefab.js';
import { campaignRange, readCampaign } from '../campaign.js';
import { twExtractRoot } from '../env.js';
import type { TwLevel, TwPlayer } from '../types.js';
import { FIXTURE_TEXTASSETS, TEST_THEMES } from './helpers.js';

const contentDir = resolve(import.meta.dirname, '../../../../packages/content');
const files: ContentFiles = await loadFiles(contentDir);
delete files['content.json'];
const catalog: Catalog = loadCatalog(files);
const lv = (asset: string): TwLevel => parseRawFromDir(FIXTURE_TEXTASSETS, asset);
const root = twExtractRoot();
const skip = root === null ? 'TW_EXTRACT not set' : false;

const sumOk = (rows: LedgerRow[]): void => {
  for (const r of rows) assert.equal(r.mapped + r.dropped + r.blocked + r.inactive, r.total, r.list);
};

test('golden: raw LevelView 1 -> mapped -> serialized == levelview-1.json bytes', () => {
  const m = mapLevel(lv('LevelView 1'), 4, catalog, { themes: TEST_THEMES });
  assert.ok(m.level);
  const golden = readFileSync(join(contentDir, 'data/levels/levelview-1.json'), 'utf8');
  assert.equal(serializeLevel(m.level), golden);
  sumOk(m.ledger);
});

test('invariants on fixtures: human first, 1-3 AI, unique ids, bounds contain buildings, BD order kept; loadLevel accepts', () => {
  for (const asset of ['LevelView 1', 'LevelView 3_AB', 'LevelView 8_ES']) {
    const tw = lv(asset);
    const m = mapLevel(tw, 5, catalog, { themes: TEST_THEMES });
    assert.ok(m.level, asset);
    const L = m.level as { players: { id: string; kind: string }[]; buildings: { id: string; pos: { x: number; z: number } }[]; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } };
    assert.equal(L.players[0]?.kind, 'human');
    const ai = L.players.filter((p) => p.kind === 'ai').length;
    assert.ok(ai >= 1 && ai <= 3);
    assert.equal(new Set(L.players.map((p) => p.id)).size, L.players.length);
    assert.deepEqual(L.buildings.map((b) => b.id), tw.buildings.map((b) => `b${b.id}`));
    for (const b of L.buildings) {
      assert.ok(b.pos.x >= L.bounds.minX + BOUNDS_PAD - 1 && b.pos.x <= L.bounds.maxX - BOUNDS_PAD + 1 && b.pos.z >= L.bounds.minZ && b.pos.z <= L.bounds.maxZ);
    }
    loadLevel(catalog, serializeLevel(m.level));
    sumOk(m.ledger);
  }
});

test('order rule: human-first flag only reorders buildings; default keeps P order', () => {
  const tw = lv('LevelView 3_AB');
  const a = mapLevel(tw, 5, catalog, { themes: TEST_THEMES });
  const b = mapLevel(tw, 5, catalog, { themes: TEST_THEMES, buildingOrder: 'human-first' });
  assert.ok(a.level && b.level);
  const ids = (x: typeof a): string[] => (x.level!['buildings'] as { id: string }[]).map((e) => e.id);
  assert.deepEqual([...ids(a)].sort(), [...ids(b)].sort());
  // default = TW BD flatten order per original P order (actual order, not sorted)
  assert.deepEqual(ids(a), tw.buildings.map((x) => `b${x.id}`));
  // human-first: a stable sort by seat rank, so the human's buildings (seat p1) come first and owners never decrease
  const rank = (x: typeof a): number[] => (x.level!['buildings'] as { owner: string | null }[]).map((e) => (e.owner === null ? 99 : Number(e.owner.slice(1))));
  assert.deepEqual(rank(b), [...rank(b)].sort((x, y) => x - y));
});

test('obstacles: active children only, ids o<cluster>-<child>, box + variant; inactive logged not dropped', () => {
  const tw = lv('LevelView 3_AB');
  const first = tw.mapObjects.obstacles[0]!;
  first.active = first.active.map((_, i) => i !== 1);
  const m = mapLevel(tw, 5, catalog, { themes: TEST_THEMES });
  assert.ok(m.level);
  const els = m.level['elements'] as { id: string; yawDeg: number; variant: string; footprint: { shape: string; w: number; d: number } }[];
  assert.ok(els.length > 0);
  assert.ok(!els.some((e) => e.id === 'o0-1'));
  assert.ok(els.some((e) => e.id === 'o0-0'));
  assert.equal(els[0]!.footprint.shape, 'box');
  assert.equal(els[0]!.yawDeg, 270);
  const row = m.ledger.find((r) => r.list === 'OBS:children')!;
  assert.equal(row.inactive, 1);
  sumOk(m.ledger);
});

test('blocked level yields no level; ledger counts blocked entries', () => {
  const tw = lv('LevelView 1');
  tw.mapObjects.mines = [{ pos: [0, 0, 0], rot: [0, 0, 0], active: true }];
  const m = mapLevel(tw, 4, catalog, { themes: TEST_THEMES });
  assert.equal(m.level, null);
  assert.equal(m.ledger.find((r) => r.list === 'Mine')!.blocked, 1);
  sumOk(m.ledger);
});

test('no human -> MapError; duplicate slug -> error', () => {
  const tw = lv('LevelView 1');
  tw.players = tw.players.map((p) => (p.type === 'player' ? { ...p, type: 'neutral' as const } : p));
  assert.throws(() => mapLevel(tw, 4, catalog, { themes: TEST_THEMES }), MapError);
  assert.throws(() => assertUniqueIds([{ id: 'a' }, { id: 'a' }]), /duplicate/);
});

test('bot hook: botScript fills script; behavior BT 0 -> full, else attackOnly', () => {
  const m = mapLevel(lv('LevelView 1'), 4, catalog, { themes: TEST_THEMES, botScript: () => ['x'] });
  const ai = (m.level!['players'] as { bot?: { script: unknown[] } }[])[1]!;
  assert.deepEqual(ai.bot!.script, ['x']);
});

test('conservation over positions 4-23 (TW_EXTRACT)', { skip }, () => {
  const entries = campaignRange(readCampaign(root as string), 4, 23);
  const prefabs = loadPrefabLevels();
  assert.equal(entries.length, 20);
  const ids: { id: string }[] = [];
  let mappedLevels = 0, blockedLevels = 0;
  for (const e of entries) {
    const tw = prefabs.get(e.id) ?? parseRaw(root as string, e.id);
    ids.push(tw);
    const m = mapLevel(tw, e.position, catalog, { themes: TEST_THEMES });
    sumOk(m.ledger);
    // every TW list entry is accounted: ledger totals equal the raw list sizes
    const total = (name: string): number => m.ledger.filter((r) => r.list === name || r.list.startsWith(`${name}:`)).reduce((n, r) => n + r.total, 0);
    assert.equal(total('buildings'), tw.buildings.length, e.id);
    assert.equal(total('players'), tw.players.length, e.id);
    assert.equal(total('cargo'), tw.mapObjects.cargo.length, e.id);
    if (m.level) { mappedLevels++; loadLevel(catalog, serializeLevel(m.level)); } else blockedLevels++;
  }
  assertUniqueIds(ids);
  console.log(`conservation 4-23: mapped=${mappedLevels} blocked=${blockedLevels}`);
});

test('script merge: 3_AB delay+line ordered by I; 8_ES nested steps; ids b<id>', () => {
  const ais = (a: string): { bot: { script: unknown[] } }[] => (mapLevel(lv(a), 6, catalog, { themes: TEST_THEMES }).level!['players'] as { kind: string; bot: { script: unknown[] } }[]).filter((p) => p.kind === 'ai');
  const ab = ais('LevelView 3_AB');
  assert.deepEqual(ab[0]!.bot.script, [{ op: 'line', own: 'b1', target: 'b2', afterMs: 1500 }, { op: 'delay', ms: 10000 }]);
  const es = ais('LevelView 8_ES');
  assert.deepEqual(es[0]!.bot.script, [{ op: 'steps', root: { goal: 'line', own: 'b1', target: 'b2', delayMs: 5000, then: [{ goal: 'line', own: 'b2', target: 'b5', delayMs: 11000 }] } }]);
});

test('script merge: gap/duplicate = error; unresolved ref -> null; AiRM keeps index but emits no op', () => {
  const idOf = (n: number): string | null => (n === 1 ? 'b1' : null);
  const base = { steps: { delaySteps: [{ index: 0, delay: 1 }] } } as TwPlayer['ai'];
  assert.throws(() => mergeBotScript({ steps: { delaySteps: [{ index: 1, delay: 1 }] } } as TwPlayer['ai'], idOf), ScriptError);
  assert.throws(() => mergeBotScript({ steps: { delaySteps: [{ index: 0, delay: 1 }], createWaySteps: [{ index: 0, ownHouse: 1, targetHouse: 9, attackDelay: 1 }] } } as TwPlayer['ai'], idOf), /duplicate/);
  assert.deepEqual(mergeBotScript({ steps: { ...base!.steps, createWaySteps: [{ index: 2, ownHouse: 1, targetHouse: 9, attackDelay: 0.5 }], railwayMoveSteps: [{ index: 1, targetPathPointIndex: 0, building: 1 }] } } as TwPlayer['ai'], idOf),
    [{ op: 'delay', ms: 1000 }, { op: 'line', own: 'b1', target: null, afterMs: 500 }]);
  assert.deepEqual(mergeBotScript(undefined, idOf), []);
});

test('scripted levels 4-23 (TW_EXTRACT): every bot ref resolves to a building or null; loadLevel accepts', { skip }, () => {
  let scripted = 0, nulls = 0;
  const per: string[] = [];
  for (const e of campaignRange(readCampaign(root as string), 4, 23)) {
    const tw = loadPrefabLevels().get(e.id) ?? parseRaw(root as string, e.id);
    const m = mapLevel(tw, e.position, catalog, { themes: TEST_THEMES });
    if (!m.level) continue;
    const L = m.level as { buildings: { id: string }[]; players: { bot?: { script: Record<string, unknown>[] } }[] };
    const ids = new Set(L.buildings.map((b) => b.id));
    let any = false;
    const walk = (n: Record<string, unknown>): void => {
      for (const k of ['own', 'target']) { const v = n[k]; if (v === null) nulls++; else if (v !== undefined) assert.ok(ids.has(v as string), `${e.id} ref ${String(v)}`); }
      for (const c of (n['then'] as Record<string, unknown>[] | undefined) ?? []) walk(c);
    };
    for (const p of L.players) for (const op of p.bot?.script ?? []) { any = true; walk(op['root'] ? (op['root'] as Record<string, unknown>) : op); }
    if (any) { scripted++; per.push(String(e.position)); }
    loadLevel(catalog, serializeLevel(m.level));
  }
  console.log(`scripted levels=${scripted} (pos ${per.join(',')}) nullRefs=${nulls}`);
});

test('ledger comes from the output: AI list rows exist and a mapper that loses an entry fails', () => {
  const m = mapLevel(lv('LevelView 3_AB'), 5, catalog, { themes: TEST_THEMES });
  sumOk(m.ledger);
  const ai = m.ledger.filter((r) => r.list.startsWith('ai:'));
  assert.ok(ai.length > 0 && ai.every((r) => r.mapped === r.total), JSON.stringify(ai));
  const bld = m.ledger.filter((r) => r.list.startsWith('buildings:'));
  assert.equal(bld.reduce((n, r) => n + r.mapped, 0), (m.level!['buildings'] as unknown[]).length);
  // an OBS emitter that silently loses a child
  const lossy = { OBS: (ctx: Parameters<typeof ELEMENT_EMITTERS['OBS']>[0]) => { const r = ELEMENT_EMITTERS['OBS']!(ctx); r.elements.pop(); return r; } };
  assert.throws(() => mapLevel(lv('LevelView 3_AB'), 5, catalog, { themes: TEST_THEMES, elementEmitters: lossy }), /ledger does not conserve: OBS:children/);
  assert.throws(() => assertLedger([{ list: 'x', total: 3, mapped: 2, dropped: 0, blocked: 0, inactive: 0 }]), MapError);
});

test('AI list rows: each op is counted from the emitted script; AiRM is dropped', () => {
  const tw = lv('LevelView 3_AB');
  const m = mapLevel(tw, 5, catalog, { themes: TEST_THEMES });
  const script = (m.level!['players'] as { bot?: { script: { op: string }[] } }[]).flatMap((p) => p.bot?.script ?? []);
  assert.equal(m.ledger.find((r) => r.list === 'ai:AiDS')?.mapped ?? 0, script.filter((o) => o.op === 'delay').length);
  assert.equal(m.ledger.find((r) => r.list === 'ai:AiCWS')?.mapped ?? 0, script.filter((o) => o.op === 'line').length);
  // the AiRM entry takes the next free step index (gaps in the merged script are errors)
  const last = (p: TwPlayer): number => Math.max(-1, ...Object.values(p.ai?.steps ?? {}).flatMap((l) => (l ?? []).map((e: { index: number }) => e.index)));
  const aiIdx = tw.players.findIndex((p) => p.type === 'ai');
  const ai = tw.players[aiIdx]!;
  const rm = { index: last(ai) + 1, targetPathPointIndex: 0, building: 0 };
  const tw2: TwLevel = { ...tw, players: tw.players.map((p, i) => (i === aiIdx ? { ...p, ai: { ...p.ai!, steps: { ...p.ai!.steps, railwayMoveSteps: [rm] } } } : p)) };
  const m2 = mapLevel(tw2, 5, catalog, { themes: TEST_THEMES });
  const row = m2.ledger.find((r) => r.list === 'ai:AiRM')!;
  assert.deepEqual([row.total, row.mapped, row.dropped], [1, 0, 1]);
  assert.ok(m2.level!['source'] && (m2.level!['source'] as { dropped: string[] }).dropped.includes('ai-rail-move'));
});

test('emitter registry: a map row with an archetype but no emitter is a MapError (Mine -> obstacle)', () => {
  const fm = parseFeatureMap({ rows: loadFeatureMap().rows.map((r) => (r.tw === 'Mine' ? { ...r, archetype: 'obstacle' } : r)) });
  const tw = lv('LevelView 1');
  tw.mapObjects.mines = [{ pos: [0, 0, 0], rot: [0, 0, 0], active: true }];
  assert.throws(() => mapLevel(tw, 4, catalog, { themes: TEST_THEMES, featureMap: fm }), /Mine maps to an archetype but has no element emitter/);
  // a building row likewise (rocket -> tower)
  const fm2 = parseFeatureMap({ rows: loadFeatureMap().rows.map((r) => (r.tw === 'rocket' ? { ...r, archetype: 'tower' } : r)) });
  const tw2 = lv('LevelView 1');
  tw2.buildings = [...tw2.buildings, { owner: null, kind: 'rocket_tower', id: 98, pos: [0, 0, 0], key: 'x' }];
  assert.throws(() => mapLevel(tw2, 4, catalog, { themes: TEST_THEMES, featureMap: fm2 }), /rocket maps to an archetype but has no building emitter/);
});

test('obstacle yaw = rotate(OCR.Y) only: collider yaw is not added', () => {
  const tw = lv('LevelView 3_AB');
  tw.mapObjects.obstacles[0]!.childRot[0] = [0, 30, 0];
  const colliders = JSON.parse(JSON.stringify(loadColliders())) as ReturnType<typeof loadColliders>;
  colliders.obstacle.children[0]!.yawDeg = 45;
  const m = mapLevel(tw, 5, catalog, { themes: TEST_THEMES, colliders });
  const o = (m.level!['elements'] as { id: string; yawDeg: number }[]).find((e) => e.id === 'o0-0')!;
  assert.equal(o.yawDeg, 120);
});

test('inactive obstacle children are reported by id', () => {
  const tw = lv('LevelView 3_AB');
  tw.mapObjects.obstacles[0]!.active = tw.mapObjects.obstacles[0]!.active.map((_, i) => i !== 1);
  assert.deepEqual(mapLevel(tw, 5, catalog, { themes: TEST_THEMES }).inactiveIds, ['o0-1']);
});
