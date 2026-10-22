import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import * as content from '../src/index.js';
import { ContentLoadError } from '../src/index.js';

const SV = '2.0.0';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const fp = { shape: 'box', w: 1.5, d: 1.5 };

/** Inline catalog files (authored units). Real data files are checked separately. */
function files(): Record<string, object> {
  const house = (id: string, growTime: number) => ({
    $schema: 'x/building.schema.json', schemaVersion: SV, id, kind: 'house', visual: `building.${id}`, footprint: fp, special: false,
    modules: { level: { maxLevel: 64 }, drawsLines: {}, spawns: { troop: 'soldier', spawnSpeed: 0.5, lineSpawnPenalty: 0.3 }, grows: { growTime } },
  });
  return {
    'data/balance.json': { $schema: 'x/balance.schema.json', schemaVersion: SV, stageThresholds: [10, 30], spawn: { aliveCap: 30 }, growth: { base: 0.9 }, contactDistance: 0.7, laneHalfWidth: 0.19 },
    'data/units/soldier.json': { $schema: 'x/unit.schema.json', schemaVersion: SV, id: 'soldier', visual: 'unit.soldier', speed: 5, hp: 1, attack: 1, defense: 1 },
    'data/units/tank.json': { $schema: 'x/unit.schema.json', schemaVersion: SV, id: 'tank', visual: 'unit.tank', speed: 5, hp: 2, attack: 2, defense: 1 },
    'data/buildings/house-wt1.json': house('house-wt1', 1.7),
    'data/buildings/tower.json': {
      $schema: 'x/building.schema.json', schemaVersion: SV, id: 'tower', kind: 'tower', visual: 'building.tower', footprint: fp, special: false,
      modules: { level: { maxLevel: 64 }, shoots: { attackDelay: 2, attackRadius: 1.6, speedUpByLevel: 1.75, radiusUpByLevel: 0.9, radiusUnit: 2.4, minRadius: 1, neutralFires: true, troopPad: 0.35, hitsNeutralHouses: true, bulletSpeed: 12 } },
    },
    'data/elements/obstacle.json': { $schema: 'x/element.schema.json', schemaVersion: SV, id: 'obstacle', visual: 'element.obstacle', footprint: { shape: 'circle', radius: 0.45 }, modules: { blocksLines: {} }, variants: ['small', 'big'] },
    'data/campaigns/common.json': { $schema: 'x/campaign.schema.json', schemaVersion: SV, id: 'common', entries: [{ level: 'lv-test', position: 4 }] },
  };
}

function level(): any {
  const b = [
    { id: 'b0', archetype: 'house-wt1', pos: { x: -6, z: 0 }, owner: 'p1', level: 20, ignoreForWin: false },
    { id: 'b1', archetype: 'house-wt1', pos: { x: 4, z: 0.5 }, owner: 'p2', level: 5, ignoreForWin: false, params: { grows: { growTime: 2 } } },
    { id: 'b2', archetype: 'tower', pos: { x: 0, z: 5 }, owner: null, level: 1, ignoreForWin: true },
  ];
  return {
    $schema: 'x/level.schema.json', schemaVersion: SV, id: 'lv-test', name: 'Test', source: { game: 'tower-war', gameVersion: '1', asset: 'x' },
    theme: 'green', bounds: content.boundsFromPositions(b.map((x) => x.pos)), objective: 'captureAll', timeLimitSec: null,
    players: [{ id: 'p1', kind: 'human', colorKey: 'blue' }, { id: 'p2', kind: 'ai', colorKey: 'red', bot: { kind: 'tw', actionDelayMs: 12000, behavior: 'full', script: [{ op: 'line', own: 'b1', target: 'b0', afterMs: 0 }] } }],
    buildings: b,
    elements: [{ id: 'e0', archetype: 'obstacle', pos: { x: 1, z: 2 }, yawDeg: 30, variant: 'big' }],
    requires: ['blocksLines', 'bot:tw', 'drawsLines', 'grows', 'level', 'objective:captureAll', 'shoots', 'spawns'],
  };
}

const cat = () => content.loadCatalog(files());
const compile = (l: any = level(), c = cat()) => content.compileLevel(c, content.loadLevel(c, l).level);

function failures(fn: () => unknown): Array<{ file: string; pointer: string; message: string }> {
  try { fn(); } catch (e) { assert.ok(e instanceof ContentLoadError, String(e)); return e.errors; }
  assert.fail('expected ContentLoadError');
}
const expectIssue = (fn: () => unknown, file: string, pointer: string, text?: RegExp) => {
  const errs = failures(fn);
  const hit = errs.find((e) => e.file === file && e.pointer === pointer && (!text || text.test(e.message)));
  assert.ok(hit, `no ${file}#${pointer} in ${JSON.stringify(errs)}`);
};

test('compiled level: R5 shape, milli-ints, -1 neutral owner, referenced units sorted + dense', () => {
  const c = compile();
  assert.equal(c.id, 'lv-test');
  assert.deepEqual(c.rules, { timeLimitSec: null, stageThresholds: [10, 30], aliveCap: 30, growth: { base: 900 }, contactDistance: 700, laneHalfWidth: 190 });
  assert.deepEqual(c.bounds, { minX: -8000, maxX: 6000, minZ: -2000, maxZ: 7000 });
  assert.deepEqual(c.players, [{ id: 'p1', kind: 'human', colorKey: 'blue' }, { id: 'p2', kind: 'ai', colorKey: 'red' }]);
  assert.deepEqual(c.units.map((u) => u.id), ['soldier'], 'only referenced units, tank omitted');
  assert.deepEqual(c.buildings.map((b) => [b.id, b.owner, b.x, b.z]), [['b0', 0, -6000, 0], ['b1', 1, 4000, 500], ['b2', -1, 0, 5000]]);
  assert.equal(c.buildings[1]!.modules.grows!.growTime, 2000, 'override merged over archetype');
  assert.equal(c.buildings[0]!.modules.grows!.growTime, 1700);
  assert.equal(c.buildings[0]!.modules.level!.maxLevel, 64);
  assert.deepEqual(c.buildings[0]!.footprint, { shape: 'box', w: 1500, d: 1500 });
  assert.equal(c.buildings[2]!.ignoreForWin, true);
  assert.deepEqual(c.elements[0], { id: 'e0', archetype: 'obstacle', x: 1000, z: 2000, yawMilliDeg: 30000, footprint: { shape: 'circle', radius: 450 }, visual: 'element.obstacle', variant: 'big', modules: { blocksLines: {} } });
  assert.deepEqual(c.bots.map((b) => b.player), [1]);
  assert.deepEqual(c.requires, level().requires);
  assert.deepEqual(Object.keys(c.botHash), ['lv-test#p2']);
  assert.match(c.simHash, /^[0-9a-f]{64}$/);
});

test('element footprint: instance override wins over the archetype footprint, is hashed; variant stays presentation', () => {
  const base = compile();
  assert.deepEqual(base.elements[0]!.footprint, { shape: 'circle', radius: 450 }, 'no override -> archetype');
  const withBox = (w: number) => { const l = level(); l.elements[0]!.footprint = { shape: 'box', w, d: 0.6 }; return l; };
  const a = compile(withBox(1.2)), b = compile(withBox(2.4));
  assert.deepEqual(a.elements[0]!.footprint, { shape: 'box', w: 1200, d: 600 });
  assert.deepEqual(b.elements[0]!.footprint, { shape: 'box', w: 2400, d: 600 });
  assert.notEqual(a.simHash, base.simHash);
  assert.notEqual(a.simHash, b.simHash);
  const bad = level(); bad.elements[0]!.footprint = { shape: 'box', w: 1 };
  assert.ok(failures(() => compile(bad)).some((e) => e.pointer.startsWith('/elements/0/footprint')));
});

test('hashes: stable across runs, pinned digests', () => {
  const a = compile(), b = compile();
  assert.equal(a.simHash, b.simHash);
  assert.deepEqual(a.botHash, b.botHash);
  assert.equal(a.simHash, PINNED_SIM);
  assert.equal(a.botHash['lv-test#p2'], PINNED_BOT);
});

test('simHash excludes name, source, theme, visual, variant, x-presentation params, bots; includes the rest', () => {
  const base = compile().simHash;
  const same = (mutate: (l: any, f: Record<string, any>) => void) => {
    const l = level(), f = clone(files()); mutate(l, f);
    assert.equal(compile(l, content.loadCatalog(f)).simHash, base);
  };
  same((l) => { l.name = 'Other'; });
  same((l) => { delete l.source; });
  same((l) => { l.theme = 'snow'; });
  same((l) => { l.elements[0].variant = 'small'; });
  same((_l, f) => { f['data/buildings/tower.json'].visual = 'building.other'; });
  same((_l, f) => { f['data/units/soldier.json'].visual = 'unit.other'; });
  same((_l, f) => { f['data/elements/obstacle.json'].visual = 'element.other'; });
  same((_l, f) => { f['data/buildings/tower.json'].modules.shoots.bulletSpeed = 20; });
  same((l) => { l.players[1].bot.actionDelayMs = 999; });
  same((l) => { l.buildings[2].params = { shoots: { bulletSpeed: 3 } }; });

  const differs = (mutate: (l: any, f: Record<string, any>) => void) => {
    const l = level(), f = clone(files()); mutate(l, f);
    assert.notEqual(compile(l, content.loadCatalog(f)).simHash, base);
  };
  differs((l) => { l.bounds.maxX += 1; });
  differs((l) => { l.timeLimitSec = 120; });
  differs((l) => { l.buildings[0].level = 21; });
  differs((l) => { l.buildings[0].pos.x = -6.5; });
  differs((l) => { l.buildings[0].owner = null; });
  differs((l) => { l.elements[0].yawDeg = 31; });
  differs((l) => { l.players[0].colorKey = 'green'; });
  differs((_l, f) => { f['data/balance.json'].growth.base = 0.8; });
  differs((_l, f) => { f['data/units/soldier.json'].hp = 2; });
  differs((_l, f) => { f['data/buildings/tower.json'].modules.shoots.attackRadius = 1.7; });
  differs((l) => { l.buildings[2].params = { shoots: { attackRadius: 1.2 } }; });
  differs((l) => { [l.buildings[0], l.buildings[1]] = [l.buildings[1], l.buildings[0]]; }); // array order is semantic
});

test('botHash: keyed level#player, moves with bot only', () => {
  const base = compile();
  const l = level(); l.players[1].bot.actionDelayMs = 999;
  const moved = compile(l);
  assert.notEqual(moved.botHash['lv-test#p2'], base.botHash['lv-test#p2']);
  assert.equal(moved.simHash, base.simHash);
  const l2 = level(); l2.players.push({ id: 'p3', kind: 'ai', colorKey: 'green', bot: l2.players[1].bot });
  const three = compile(l2);
  assert.deepEqual(Object.keys(three.botHash), ['lv-test#p2', 'lv-test#p3']);
  assert.notEqual(three.botHash['lv-test#p2'], three.botHash['lv-test#p3']);
});

test('level validation: every failure reports file + JSON pointer', () => {
  const F = 'data/levels/lv-test.json';
  const bad = (mutate: (l: any) => void, pointer: string, text?: RegExp, c = cat()) => {
    const l = level(); mutate(l);
    expectIssue(() => content.loadLevel(c, l), F, pointer, text);
  };
  bad((l) => { l.buildings[0].archetype = 'nope'; }, '/buildings/0/archetype', /Unknown building archetype/);
  bad((l) => { l.elements[0].archetype = 'nope'; }, '/elements/0/archetype', /Unknown element archetype/);
  bad((l) => { l.buildings[0].owner = 'p9'; }, '/buildings/0/owner', /Unknown player/);
  bad((l) => { l.buildings[0].level = 65; }, '/buildings/0/level', /exceeds maxLevel 64/);
  bad((l) => { l.buildings[0].level = 31; l.buildings[0].params = { level: { maxLevel: 30 } }; }, '/buildings/0/level', /exceeds maxLevel 30/);
  bad((l) => { l.buildings[0].params = { shoots: { attackRadius: 1 } }; }, '/buildings/0/params/shoots', /no "shoots" module/);
  bad((l) => { l.buildings[0].params = { spawns: { troop: 'ghost' } }; }, '/buildings/0/params/spawns/troop', /Unknown unit/);
  bad((l) => { l.buildings[0].pos.x = 50; }, '/buildings/0/pos', /outside bounds/);
  bad((l) => { l.buildings.forEach((b: any) => { b.ignoreForWin = true; }); }, '/buildings', /ignoreForWin/);
  bad((l) => { l.buildings[1].pos = { ...l.buildings[0].pos }; }, '/buildings/1/pos', /Coincident/);
  bad((l) => { l.buildings[1].id = 'b0'; }, '/buildings/1/id', /Duplicate building id/);
  bad((l) => { l.elements.push({ ...l.elements[0] }); }, '/elements/1/id', /Duplicate element id/);
  bad((l) => { l.elements[0].variant = 'huge'; }, '/elements/0/variant');
  bad((l) => { l.requires = ['level']; }, '/requires', /derived set/);
  bad((l) => { l.requires = [...l.requires, 'level']; }, '/requires');
  bad((l) => { l.players[1].bot.script[0].target = 'b99'; }, '/players/1/bot', /unknown building "b99"/);
  bad((l) => { l.players.reverse(); }, '/players/1/kind', /human player must be first/);
  bad((l) => { l.players[1].colorKey = 'blue'; }, '/players/1/colorKey', /Duplicate colorKey/);
  bad((l) => { delete l.players[1].bot; }, '/players/1', /require a bot/);
  bad((l) => { l.players[0].bot = l.players[1].bot; }, '/players/0/bot', /Human players cannot/);
  bad((l) => { l.players[1].kind = 'human'; delete l.players[1].bot; }, '/players', /Expected exactly 1 human/);
  bad((l) => { for (const id of ['p3', 'p4', 'p5']) l.players.push({ id, kind: 'ai', colorKey: id, bot: l.players[1].bot }); }, '/players', /1\.\.3 AI/);
  bad((l) => { l.bounds.minX = 7; }, '/bounds', /minX/);
  bad((l) => { l.players.push({ id: 'p1', kind: 'ai', colorKey: 'x', bot: l.players[1].bot }); }, '/players/2/id', /Duplicate player id/);
  bad((l) => { l.theme = 'lava'; }, '/theme', /Unknown theme/, content.loadCatalog(files(), { themes: ['green'], colorKeys: ['blue', 'red'] }));
  bad((l) => { l.players[1].colorKey = 'pink'; }, '/players/1/colorKey', /Unknown colorKey/, content.loadCatalog(files(), { themes: ['green', 'lava'], colorKeys: ['blue', 'red'] }));
  // schema-level + numeric failures also carry file + pointer
  bad((l) => { l.buildings[0].pos.x = 1.2345; }, '/buildings/0/pos/x', /three decimal/);
  bad((l) => { l.buildings[0].extra = 1; }, '/buildings/0/extra');
  expectIssue(() => content.loadLevel(cat(), '{not json'), 'level.json', '', /Invalid JSON/);
  expectIssue(() => content.loadLevel(cat(), level(), 'data/levels/other.json'), 'data/levels/other.json', '/id', /file name/);
});

test('warnings: footprint overlap and element outside bounds are logged, not fatal', () => {
  const l = level();
  l.buildings[1].pos = { x: -5.5, z: 0.5 }; // 0.5 / 0.5 apart, boxes 1.5 wide
  l.elements.push({ id: 'e1', archetype: 'obstacle', pos: { x: 25, z: 25 }, yawDeg: 0 });
  const r = content.loadLevel(cat(), l);
  assert.deepEqual(r.warnings.map((w) => [w.file, w.pointer]), [['data/levels/lv-test.json', '/buildings/1/pos'], ['data/levels/lv-test.json', '/elements/1/pos']]);
  assert.equal(content.compileLevel(cat(), r.level).elements.length, 2);
  const apart = level(); apart.buildings[1].pos = { x: -3, z: 0 };
  assert.deepEqual(content.loadLevel(cat(), apart).warnings, []);
});

test('computeRequires: module ids + bot kinds + objective, sorted; derived from archetypes', () => {
  const lv = content.loadLevel(cat(), level()).level;
  assert.deepEqual(content.computeRequires(cat(), lv), level().requires);
  const noElements = { ...lv, elements: [], buildings: [lv.buildings[2]!] };
  assert.deepEqual(content.computeRequires(cat(), noElements), ['bot:tw', 'level', 'objective:captureAll', 'shoots']);
});

test('bounds helper: AABB + exported pad, floor/ceil outward', () => {
  assert.equal(content.BOUNDS_PAD, 2);
  assert.deepEqual(content.boundsFromPositions([{ x: -6.79, z: 0.1 }, { x: 4.2, z: 5.5 }]), { minX: -9, maxX: 7, minZ: -2, maxZ: 8 });
  assert.deepEqual(content.boundsFromPositions([{ x: 1, z: 1 }]), { minX: -1, maxX: 3, minZ: -1, maxZ: 3 });
  assert.throws(() => content.boundsFromPositions([]));
});

test('catalog failures carry file + pointer', () => {
  const broken = (mutate: (f: Record<string, any>) => void) => { const f = clone(files()); mutate(f); return () => content.loadCatalog(f); };
  expectIssue(broken((f) => { delete f['data/balance.json']; }), 'balance.json', '', /Missing/);
  expectIssue(broken((f) => { f['data/balance.json'].stageThresholds = [30, 10]; }), 'data/balance.json', '/stageThresholds');
  expectIssue(broken((f) => { f['data/units/soldier.json'].id = 'other'; }), 'data/units/soldier.json', '/id', /file name/);
  expectIssue(broken((f) => { f['data/buildings/tower.json'].modules.shoots.bogus = 1; }), 'data/buildings/tower.json', '/modules/shoots/bogus');
  expectIssue(broken((f) => { f['data/buildings/house-wt1.json'].modules.spawns.troop = 'ghost'; }), 'data/buildings/house-wt1.json', '/modules/spawns/troop', /Unknown unit/);
  expectIssue(broken((f) => { f['data/campaigns/common.json'].entries.push({ level: 'lv-test', position: 5 }); }), 'data/campaigns/common.json', '/entries/1/level', /Duplicate/);
  expectIssue(broken((f) => { f['data/units/soldier.json'].speed = 5.0001; }), 'data/units/soldier.json', '/speed', /three decimal/);
  expectIssue(broken((f) => { f['data/stuff.txt'] = {}; }), 'data/stuff.txt', '', /Unrecognised/);
  assert.throws(() => content.loadCatalog({ ...files(), 'data/units/bad.json': '{oops' }), (e: unknown) => e instanceof ContentLoadError && e.errors[0]!.pointer === '' && e.errors[0]!.file === 'data/units/bad.json');
  // a string source is accepted like an object
  assert.doesNotThrow(() => content.loadCatalog(Object.fromEntries(Object.entries(files()).map(([k, v]) => [k, JSON.stringify(v)]))));
});

test('loadCatalog ignores level files and never reads them; loadLevel needs only the catalog', () => {
  const f: Record<string, any> = { ...files(), 'data/levels/lv-test.json': '{this is not even json' };
  assert.doesNotThrow(() => content.loadCatalog(f));
  const c = content.loadCatalog(files());
  assert.doesNotThrow(() => content.loadLevel(c, level()));
});

test('loadContent: aggregates level errors and campaign refs', () => {
  const f = { ...files(), 'data/levels/lv-test.json': level() };
  const ok = content.loadContent(f);
  assert.deepEqual(Object.keys(ok.compiled), ['lv-test']);
  assert.equal(ok.compiled['lv-test']!.simHash, PINNED_SIM);
  const l = level(); l.buildings[0].level = 99;
  const errs = failures(() => content.loadContent({ ...files(), 'data/levels/lv-test.json': l }));
  assert.ok(errs.some((e) => e.file === 'data/levels/lv-test.json' && e.pointer === '/buildings/0/level'));
  expectIssue(() => content.loadContent({ ...files(), 'data/levels/other.json': { ...level(), id: 'other' } }), 'data/campaigns/common.json', '/entries/0/level', /Unknown level/);
});

test('real data files load as a catalog', async () => {
  const root = new URL('../data/', import.meta.url);
  const all: Record<string, string> = {};
  all['data/balance.json'] = await readFile(new URL('balance.json', root), 'utf8');
  for (const dir of ['units', 'buildings', 'elements', 'campaigns']) {
    for (const name of await readdir(new URL(`${dir}/`, root))) all[`data/${dir}/${name}`] = await readFile(new URL(`${dir}/${name}`, root), 'utf8');
  }
  const c = content.loadCatalog(all);
  assert.deepEqual(Object.keys(c.units).sort(), ['soldier', 'tank']);
  assert.equal((c.buildings['tower']!.modules.shoots as { attackRadius: number }).attackRadius, 1600);
  assert.equal(c.balance.laneHalfWidth, 190);
});

// Pinned: moving these means simulation-affecting compile semantics changed.
const PINNED_SIM = '3ef0e05c020642aa75d6dcb52a5718c8d16836891c6a522897f196f941e12740';
const PINNED_BOT = 'a378728773bfbf5f6493cc6ddb6acc37ada5c58f04878b2dcb2d75fa8beca554';
