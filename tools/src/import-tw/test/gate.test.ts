import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadCatalog, type Catalog, type ContentFiles } from '@node-arena/content';
import { loadFiles } from '../../files.js';
import { FeatureMapError, loadFeatureMap, parseFeatureMap, recordedToken, resolveArchetype, archetypeKey } from '../feature-map.js';
import { computeBlocked, featuresOf, importable, themeFor } from '../gate.js';
import { parseRawFromDir } from '../parse-raw.js';
import type { TwLevel, TwWall } from '../types.js';
import { FIXTURE_TEXTASSETS, TEST_THEMES } from './helpers.js';

const contentDir = resolve(import.meta.dirname, '../../../../packages/content');
const files: ContentFiles = await loadFiles(contentDir);
delete files['content.json'];
const catalogOf = (drop: string[] = []): Catalog => {
  const kept: ContentFiles = {};
  for (const [k, v] of Object.entries(files)) if (!drop.some((d) => k.endsWith(`/${d}.json`))) kept[k] = v;
  return loadCatalog(kept);
};
const lv = (asset: string): TwLevel => parseRawFromDir(FIXTURE_TEXTASSETS, asset);
const wall = (): TwWall => ({ pos: [0, 0, 0], rot: [0, 0, 0], active: true, hp: 1, punchStrength: 1 });

test('levelview-1 passes against the full catalog; cargo is a drop token', () => {
  const r = computeBlocked(lv('LevelView 1'), 4, catalogOf(), { themes: TEST_THEMES });
  assert.deepEqual(r.blocked, []);
  assert.equal(r.id, 'levelview-1');
  assert.ok(r.dropped.includes('cargo'));
  assert.equal(importable([r]).length, 1);
});

test('catalog without tower blocks levelview-1 with a reason; importable() filters it out', () => {
  const r = computeBlocked(lv('LevelView 1'), 4, catalogOf(['tower']), { themes: TEST_THEMES });
  assert.equal(r.blocked.length, 1);
  assert.equal(r.blocked[0]?.tw, 'tower');
  assert.match(r.blocked[0]!.reason, /archetype tower absent from catalog/);
  assert.deepEqual(importable([r]), []);
});

test('theme gate: the registered set is explicit and required; catalog.themes is ignored', () => {
  const l = lv('LevelView 1');
  assert.deepEqual(computeBlocked(l, 21, catalogOf(), { themes: TEST_THEMES }).blocked, []);
  // a level whose position needs an unregistered theme (lava) is blocked (no fallback to the full cycle)
  assert.equal(themeFor(41), 'lava');
  assert.match(computeBlocked(l, 41, catalogOf(), { themes: TEST_THEMES }).blocked[0]!.reason, /theme lava not registered/);
  // an explicit set (manifest themes) wins
  assert.deepEqual(computeBlocked(l, 41, catalogOf(), { themes: ['green', 'snow', 'lava'] }).blocked, []);
  assert.match(computeBlocked(l, 21, catalogOf(), { themes: ['green'] }).blocked[0]!.reason, /theme snow not registered/);
  // the catalog's own themes no longer widen/narrow the gate
  assert.deepEqual(computeBlocked(l, 21, { ...catalogOf(), themes: ['green'] }, { themes: TEST_THEMES }).blocked, []);
  assert.equal(themeFor(20), 'green');
  assert.equal(themeFor(21), 'snow');
  assert.equal(themeFor(20, 1), 'snow');
});

test('wall: dropped only for levelview-100-es, blocked for any other level', () => {
  const base = lv('LevelView 1');
  const es100: TwLevel = { ...base, id: 'levelview-100-es', mapObjects: { ...base.mapObjects, walls: [wall()] } };
  const es101: TwLevel = { ...es100, id: 'levelview-101-es' };
  const r100 = computeBlocked(es100, 10, catalogOf(), { themes: TEST_THEMES });
  assert.deepEqual(r100.blocked, []);
  assert.ok(r100.dropped.includes('wall'), 'recorded token is lowercase wall');
  assert.ok(r100.droppedTw.includes('Wall'));
  const r101 = computeBlocked(es101, 24, catalogOf(), { themes: TEST_THEMES });
  assert.equal(r101.blocked[0]?.tw, 'Wall');
  assert.match(r101.blocked[0]!.reason, /levelview-100-es/);
});

test('null-archetype and block rows block; house WT3 blocks as absent', () => {
  const base = lv('LevelView 1');
  const withKind = (kind: string): TwLevel => ({ ...base, buildings: [...base.buildings, { owner: null, kind, id: 99, pos: [0, 0, 0], key: 'x' }] });
  assert.match(computeBlocked(withKind('rocket_tower'), 4, catalogOf(), { themes: TEST_THEMES }).blocked[0]!.reason, /no archetype registered/);
  assert.match(computeBlocked(withKind('boss_tower'), 4, catalogOf(), { themes: TEST_THEMES }).blocked[0]!.reason, /not importable/);
  const wt3: TwLevel = { ...base, buildings: [{ ...base.buildings[0]!, params: { warriorType: 3 } }] };
  assert.match(computeBlocked(wt3, 4, catalogOf(), { themes: TEST_THEMES }).blocked[0]!.reason, /house-wt3 absent/);
  assert.equal(computeBlocked({ ...base, category: 'boss' }, 4, catalogOf(), { themes: TEST_THEMES }).blocked[0]?.tw, 'boss');
});

test('fortess / speed_tower have block rows; AiRM records ai-rail-move, MinRD/MaxRD are not recorded', () => {
  const base = lv('LevelView 1');
  for (const kind of ['fortess', 'speed_tower']) {
    const l: TwLevel = { ...base, buildings: [...base.buildings, { owner: null, kind, id: 98, pos: [0, 0, 0], key: 'x' }] };
    assert.match(computeBlocked(l, 4, catalogOf(), { themes: TEST_THEMES }).blocked[0]!.reason, /not importable/, kind);
  }
  const fm = loadFeatureMap();
  assert.equal(recordedToken(fm.byTw.get('AiRM')!), 'ai-rail-move');
  assert.equal(recordedToken(fm.byTw.get('MinRD')!), null);
  assert.equal(recordedToken(fm.byTw.get('MaxRD')!), null);
  assert.equal(recordedToken(fm.byTw.get('Wall')!), 'wall');
  assert.equal(recordedToken(fm.byTw.get('cargo')!), 'cargo');
  assert.throws(() => parseFeatureMap({ rows: [{ tw: 'a', action: 'map', kind: 'bot', archetype: null, record: false }] }), /only valid on drop/);
});

test('unlisted construct is a parse error (level kind and map row)', () => {
  const base = lv('LevelView 1');
  const odd: TwLevel = { ...base, buildings: [...base.buildings, { owner: null, kind: 'bt99', id: 98, pos: [0, 0, 0], key: 'x' }] };
  assert.throws(() => computeBlocked(odd, 4, catalogOf(), { themes: TEST_THEMES }), FeatureMapError);
  const fm = parseFeatureMap({ rows: loadFeatureMap().rows.filter((r) => r.tw !== 'tower') });
  assert.throws(() => computeBlocked(base, 4, catalogOf(), { themes: TEST_THEMES, featureMap: fm }), /unlisted TW construct "tower"/);
});

test('feature-map.json: required rows and validation', () => {
  const fm = loadFeatureMap();
  for (const tw of ['house', 'tower', 'rocket', 'selectable', 'capture-rocket', 'trolley', 'flag', 'boss', 'ROBS', 'Mine', 'Wall', 'Sheep', 'River', 'Gate', 'Railway', 'WOD']) assert.ok(fm.byTw.has(tw), tw);
  assert.equal(fm.byTw.get('cargo')?.action, 'drop');
  assert.equal(fm.byTw.get('AiRM')?.action, 'drop');
  assert.throws(() => parseFeatureMap({ rows: [{ tw: 'a', action: 'nope', kind: 'bot' }] }), /bad action/);
  assert.throws(() => parseFeatureMap({ rows: [{ tw: 'a', action: 'drop', kind: 'bot' }, { tw: 'a', action: 'drop', kind: 'bot' }] }), /duplicate row/);
  assert.throws(() => parseFeatureMap({ rows: [{ tw: 'a', action: 'map', kind: 'bot' }] }), /needs archetype/);
});

test('every fixture level has only listed features', () => {
  for (const a of ['LevelView 1', 'LevelView 3_AB', 'LevelView 8_ES']) {
    for (const f of featuresOf(lv(a))) assert.ok(loadFeatureMap().byTw.has(f.tw), `${a}: ${f.tw}`);
  }
});

test('single resolver: house archetype by warriorType (default key), plain rows, null rows', () => {
  const fm = loadFeatureMap();
  const house = fm.byTw.get('house')!;
  assert.equal(resolveArchetype(house, archetypeKey(house, { warriorType: 2 })), 'house-wt2');
  assert.equal(resolveArchetype(house, archetypeKey(house, {})), 'house-wt1');
  assert.equal(resolveArchetype(house, archetypeKey(house, { warriorType: 9 })), null);
  assert.equal(resolveArchetype(house, '__proto__'), null);
  assert.equal(resolveArchetype(fm.byTw.get('tower')!), 'tower');
  assert.equal(resolveArchetype(fm.byTw.get('Mine')!), null);
  assert.equal(resolveArchetype(fm.byTw.get('cargo')!), null);
});
