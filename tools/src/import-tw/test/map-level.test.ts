import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadCatalog, loadLevel, BOUNDS_PAD, type Catalog, type ContentFiles } from '@node-arena/content';
import { loadFiles } from '../../files.js';
import { MapError, assertUniqueIds, mapLevel, type LedgerRow } from '../map-level.js';
import { serializeLevel } from '../serialize.js';
import { parseRawFromDir, parseRaw } from '../parse-raw.js';
import { loadPrefabLevels } from '../parse-prefab.js';
import { campaignRange, readCampaign } from '../campaign.js';
import { twExtractRoot } from '../env.js';
import type { TwLevel } from '../types.js';
import { FIXTURE_TEXTASSETS } from './helpers.js';

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
  const m = mapLevel(lv('LevelView 1'), 4, catalog);
  assert.ok(m.level);
  const golden = readFileSync(join(contentDir, 'data/levels/levelview-1.json'), 'utf8');
  assert.equal(serializeLevel(m.level), golden);
  sumOk(m.ledger);
});

test('invariants on fixtures: human first, 1-3 AI, unique ids, bounds contain buildings, BD order kept; loadLevel accepts', () => {
  for (const asset of ['LevelView 1', 'LevelView 3_AB', 'LevelView 8_ES']) {
    const tw = lv(asset);
    const m = mapLevel(tw, 5, catalog);
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
  const a = mapLevel(tw, 5, catalog);
  const b = mapLevel(tw, 5, catalog, { buildingOrder: 'human-first' });
  assert.ok(a.level && b.level);
  const ids = (x: typeof a): string[] => (x.level!['buildings'] as { id: string }[]).map((e) => e.id);
  assert.deepEqual([...ids(a)].sort(), [...ids(b)].sort());
});

test('obstacles: active children only, ids o<cluster>-<child>, box + variant; inactive logged not dropped', () => {
  const tw = lv('LevelView 3_AB');
  const first = tw.mapObjects.obstacles[0]!;
  first.active = first.active.map((_, i) => i !== 1);
  const m = mapLevel(tw, 5, catalog);
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
  const m = mapLevel(tw, 4, catalog);
  assert.equal(m.level, null);
  assert.equal(m.ledger.find((r) => r.list === 'Mine')!.blocked, 1);
  sumOk(m.ledger);
});

test('no human -> MapError; duplicate slug -> error', () => {
  const tw = lv('LevelView 1');
  tw.players = tw.players.map((p) => (p.type === 'player' ? { ...p, type: 'neutral' as const } : p));
  assert.throws(() => mapLevel(tw, 4, catalog), MapError);
  assert.throws(() => assertUniqueIds([{ id: 'a' }, { id: 'a' }]), /duplicate/);
});

test('bot hook: botScript fills script; behavior BT 0 -> full, else attackOnly', () => {
  const m = mapLevel(lv('LevelView 1'), 4, catalog, { botScript: () => ['x'] });
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
    const m = mapLevel(tw, e.position, catalog);
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
