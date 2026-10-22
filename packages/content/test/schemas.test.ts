import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import * as content from '../src/index.js';
import { createAjv, convertFixedPoint, type NumericSchema } from '../src/index.js';

const root = new URL('../', import.meta.url);
const readJson = async (path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8')) as Record<string, any>;
const schemaOf = (name: keyof typeof content.NextSchemas) => JSON.parse(JSON.stringify(content.NextSchemas[name])) as NumericSchema;

test('generated schemas are committed and current', async () => {
  for (const [name, schema] of Object.entries(content.NextSchemas)) {
    const committed = await readFile(new URL(`schemas/${name}.schema.json`, root), 'utf8');
    assert.equal(committed, `${JSON.stringify(schema, null, 2)}\n`, `${name} schema stale`);
  }
});

test('every authored data file validates against its schema and converts to milli-units', async () => {
  const ajv = createAjv();
  const kinds: Record<string, keyof typeof content.NextSchemas> = { units: 'unit', buildings: 'building', elements: 'element', campaigns: 'campaign' };
  const files: Array<[string, keyof typeof content.NextSchemas]> = [['data/balance.json', 'balance']];
  for (const [dir, schema] of Object.entries(kinds)) {
    for (const f of await readdir(new URL(`data/${dir}/`, root))) files.push([`data/${dir}/${f}`, schema]);
  }
  assert.ok(files.length >= 8);
  for (const [path, schemaName] of files) {
    const data = await readJson(path);
    const validate = ajv.compile(content.NextSchemas[schemaName]);
    assert.equal(validate(data), true, `${path}: ${JSON.stringify(validate.errors)}`);
    convertFixedPoint(data, schemaOf(schemaName), path);
  }
});

test('shipped values: balance thresholds 10/30, no boosters; unit and building facts', async () => {
  const balance = await readJson('data/balance.json');
  assert.deepEqual(balance.stageThresholds, [10, 30]);
  assert.equal('boosters' in balance, false);
  const [soldier, tank] = await Promise.all([readJson('data/units/soldier.json'), readJson('data/units/tank.json')]);
  assert.deepEqual([soldier.hp, soldier.attack, soldier.defense, soldier.speed], [1, 1, 1, 5]);
  assert.deepEqual([tank.hp, tank.attack, tank.defense, tank.speed], [2, 2, 1, 5]);
  const [wt1, wt2, tower, obstacle] = await Promise.all(['house-wt1', 'house-wt2', 'tower'].map((n) => readJson(`data/buildings/${n}.json`)).concat(readJson('data/elements/obstacle.json')));
  assert.deepEqual([wt1!.special, wt2!.special, tower!.special], [false, true, false]);
  assert.deepEqual([wt1!.modules.grows.growTime, wt2!.modules.grows.growTime], [1.7, 2]);
  assert.deepEqual(obstacle!.footprint, { shape: 'box', w: 0.713, d: 0.713 });
});

test('Type.Partial instance overrides scale like archetype values (fx3 never under a combinator)', async () => {
  const tower = await readJson('data/buildings/tower.json');
  const archetype = convertFixedPoint(tower, schemaOf('building'), 'tower.json') as any;
  assert.equal(archetype.modules.shoots.attackRadius, 1600);
  assert.equal(archetype.modules.shoots.troopPad, 350);
  assert.equal(archetype.modules.level.maxLevel, 64, 'counts are never scaled');
  const level = levelSample({ params: { shoots: { attackRadius: 1.2, neutralFires: false }, level: { maxLevel: 30 }, grows: { growTime: 2 } } });
  const ajv = createAjv();
  const validate = ajv.compile(content.NextSchemas.level);
  assert.equal(validate(level), true, JSON.stringify(validate.errors));
  const converted = convertFixedPoint(level, schemaOf('level'), 'level.json') as any;
  assert.equal(converted.buildings[0].params.shoots.attackRadius, 1200);
  assert.equal(converted.buildings[0].params.grows.growTime, 2000);
  assert.equal(converted.buildings[0].params.level.maxLevel, 30);
  assert.equal(converted.buildings[0].pos.x, -6790);
  assert.equal(converted.bounds.minX, -9000);
  assert.equal(converted.elements[0].yawDeg, 30000);
  // Partial: unknown param and unknown module are rejected, partial bag accepted.
  for (const params of [{ shoots: { bogus: 1 } }, { nope: {} }, { spawns: { spawnSpeed: 'x' } }]) {
    assert.equal(validate(levelSample({ params })), false);
  }
});

test('no fx3-tagged field sits under oneOf/anyOf/allOf/if/then/else (walker contract)', () => {
  const combinators = new Set(['oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else']);
  const offenders: string[] = [];
  const walk = (node: unknown, path: string, under: boolean): void => {
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}/${i}`, under)); return; }
    if (node === null || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (rec['x-unit'] === 'fx3' && under) offenders.push(path);
    for (const [k, v] of Object.entries(rec)) walk(v, `${path}/${k}`, under || combinators.has(k));
  };
  for (const [name, schema] of Object.entries(content.NextSchemas)) walk(JSON.parse(JSON.stringify(schema)), name, false);
  assert.deepEqual(offenders, []);
});

test('footprint: circle needs radius, box needs w and d, no mixing', () => {
  const validate = createAjv().compile(content.FootprintSchema);
  assert.equal(validate({ shape: 'circle', radius: 0.45 }), true);
  assert.equal(validate({ shape: 'box', w: 1.5, d: 1.5 }), true);
  for (const bad of [{ shape: 'circle' }, { shape: 'box', w: 1.5 }, { shape: 'circle', radius: 1, w: 1 }, { shape: 'box', w: 1, d: 1, radius: 1 }, { shape: 'hex', radius: 1 }, { shape: 'circle', radius: 0 }]) {
    assert.equal(validate(bad), false, JSON.stringify(bad));
  }
});

test('seat bot is validated by BOT_KINDS; ai needs no bot at schema level, extra fields rejected', () => {
  const validate = createAjv().compile(content.NextSchemas.level);
  assert.equal(validate(levelSample({})), true, JSON.stringify(validate.errors));
  const withBot = (bot: unknown) => { const l = levelSample({}); l.players[1].bot = bot; return l; };
  assert.equal(validate(withBot({ kind: 'tw', actionDelayMs: 12000, behavior: 'full', script: [{ op: 'line', own: 'b0', target: null, afterMs: 0 }] })), true);
  for (const bad of [{ kind: 'nope', actionDelayMs: 1 }, { kind: 'tw', actionDelayMs: 12000, behavior: 'x' }, { kind: 'tw', actionDelayMs: 12.5, behavior: 'full' }, { kind: 'tw', actionDelayMs: 100, behavior: 'full', junk: 1 }]) {
    assert.equal(validate(withBot(bad)), false, JSON.stringify(bad));
  }
  const noSource = levelSample({}); delete noSource.source;
  assert.equal(validate(noSource), true, 'source is optional');
  assert.equal(validate({ ...levelSample({}), objective: 'other' }), false);
});

function levelSample(overrides: { params?: Record<string, unknown> }): any {
  return {
    $schema: '../schemas/level.schema.json', schemaVersion: '2.0.0', id: 'levelview-1', name: 'LevelView 1',
    source: { game: 'tower-war', gameVersion: '1.29.3', asset: 'LevelView 1', campaignPosition: 4, dialect: 'v1-short', dropped: ['cargo'] },
    theme: 'green', bounds: { minX: -9, maxX: 6, minZ: -7, maxZ: 8 },
    objective: 'captureAll', timeLimitSec: null,
    players: [{ id: 'p1', kind: 'human', colorKey: 'blue' }, { id: 'p2', kind: 'ai', colorKey: 'red', bot: { kind: 'tw', actionDelayMs: 12000, behavior: 'full', script: [] } }],
    buildings: [{ id: 'b0', archetype: 'tower', pos: { x: -6.79, z: 0.1 }, owner: 'p1', level: 20, ignoreForWin: false, ...(overrides.params ? { params: overrides.params } : {}) }],
    elements: [{ id: 'e0', archetype: 'obstacle', pos: { x: 0, z: 0 }, yawDeg: 30, variant: 'big' }],
    requires: ['bot:tw', 'level', 'shoots'],
  };
}
