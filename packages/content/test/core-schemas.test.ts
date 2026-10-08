import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as content from '../src/index.js';

const envelope = (kind: string) => ({ $schema: `../../schemas/${kind}.schema.json`, schemaVersion: '1.0.0' });
const samples = {
  content: { ...envelope('content'), contentVersion: '1.0.0', rulesVersion: '1.0.0' },
  balance: { ...envelope('balance'), defaults: { timeLimitSec: 300, theme: 'theme.downtown' } },
  archetype: { ...envelope('archetype'), id: 'standard', visual: 'tower.standard', footprintRadius: 3, components: { garrison: { cap: 50 }, generates: { troop: 'regular', ratePerSec: 1.125 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } },
  level: { ...envelope('level'), id: 'first-steps', name: 'First steps', order: 1, band: 1, bounds: { w: 120, h: 80 }, players: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, kind: i === 0 ? 'human' : 'bot', team: `p${i}`, colorKey: `player.${i}`, ...(i ? { botProfile: 'easy' } : {}) })), towers: [{ id: 't1', archetype: 'standard', pos: { x: -40.125, y: 0.001 }, owner: 'p0', garrison: 10 }], obstacles: [], mapObjects: [], overrides: {} },
};

async function validator(kind: string) {
  // A missing generated contract must fail behaviorally rather than fail the import.
  const source = await readFile(new URL(`../schemas/${kind}.schema.json`, import.meta.url), 'utf8').catch(() => '{}');
  return content.createAjv().compile(JSON.parse(source));
}

for (const [kind, sample] of Object.entries(samples)) {
  test(`${kind} schema accepts its authored shape and rejects unknown fields and missing envelope`, async () => {
    const validate = await validator(kind);
    assert.equal(validate(sample), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...sample, junk: 1 }), false);
    const { schemaVersion: _, ...missing } = sample;
    assert.equal(validate(missing), false);
    assert.equal(validate({ ...sample, schemaVersion: '2.0.0' }), false);
  });
}

test('archetype params permit partial inheritance and future components but reject structural junk', async () => {
  const validate = await validator('archetype');
  assert.equal(validate({ ...samples.archetype, id: 'small', extends: 'standard', components: { generates: { ratePerSec: 0.6 }, drawsLines: { extraSlotAbove: [10] } } }), true);
  assert.equal(validate({ ...samples.archetype, components: { shoots: { ratePerSec: 1, radius: 12, targeting: 'nearestHostile' } } }), true);
  for (const components of [{ generates: [] }, { shoots: { nested: { junk: true } } }, { drawsLines: { extraSlotAbove: [1, 'junk'] } }, { garrison: { cap: 1.5 } }]) {
    assert.equal(validate({ ...samples.archetype, components }), false);
  }
});

test('level permits reserved objects and param patches but rejects entity and component structure additions', async () => {
  const validate = await validator('level');
  assert.equal(validate({ ...samples.level, mapObjects: [{ kind: 'gate', pos: { x: 1, y: 2 }, footprintRadius: 1.5, delta: 1 }], obstacles: [{ kind: 'rock', pos: { x: 0, y: 0 }, footprintRadius: 2 }], overrides: { globals: { timeLimitSec: 120 }, troops: { regular: { speed: 2.125 } }, archetypes: { standard: { components: { generates: { ratePerSec: 1.5 } } } } } }), true);
  for (const patch of [
    { towers: [{ ...samples.level.towers[0], surprise: 1 }] },
    { players: [{ ...samples.level.players[0], junk: true }] },
    { bounds: { w: 120, h: 80, junk: true } },
    { overrides: { troops: { regular: { visual: 'other' } } } },
    { overrides: { archetypes: { standard: { visual: 'other' } } } },
    { overrides: { archetypes: { standard: { components: { generates: { params: { nested: true } } } } } } },
    { mapObjects: [{ kind: 'gate', junk: true }] },
  ]) assert.equal(validate({ ...samples.level, ...patch }), false);
});

test('balance keeps tickRate out of data and requires both v1 defaults', async () => {
  const validate = await validator('balance');
  assert.equal(validate({ ...samples.balance, tickRate: 20 }), false);
  assert.equal(validate({ ...samples.balance, defaults: { timeLimitSec: 300, tickRate: 20 } }), false);
});

test('loader dispatches core files and converts nested and override field units without scaling counts', () => {
  const level = { ...samples.level, overrides: { troops: { regular: { value: 2, speed: 2.125 } }, archetypes: { standard: { components: { generates: { ratePerSec: 0.625 }, garrison: { cap: 20 }, drawsLines: { extraSlotAbove: [10] } } } } } };
  const loaded = content.loadContent({ 'content.json': samples.content, 'balance.json': samples.balance, 'standard.json': samples.archetype, 'level.json': level });
  assert.deepEqual(loaded['standard.json'], { ...samples.archetype, footprintRadius: 3000, components: { ...samples.archetype.components, generates: { troop: 'regular', ratePerSec: 1125 } } });
  assert.deepEqual(loaded['level.json'], { ...level, bounds: { w: 120000, h: 80000 }, towers: [{ ...level.towers[0], pos: { x: -40125, y: 1 } }], overrides: { troops: { regular: { value: 2, speed: 2125 } }, archetypes: { standard: { components: { generates: { ratePerSec: 625 }, garrison: { cap: 20 }, drawsLines: { extraSlotAbove: [10] } } } } } });
  assert.deepEqual(loaded['balance.json'], samples.balance);
  assert.throws(() => content.loadContent({ 'level.json': { ...level, overrides: { archetypes: { standard: { components: { generates: { ratePerSec: 0.0001 } } } } } } }), /\/overrides\/archetypes\/standard\/components\/generates\/ratePerSec/);
});

// Untagged arbitrary fractional params could escape loading as floats into simulation.
test('extension params keep untagged numbers integral and scale reserved and future component units', async () => {
  const validate = await validator('archetype');
  assert.equal(validate({ ...samples.archetype, components: { shoots: { damage: 0.5 } } }), false);
  const archer = { ...samples.archetype, components: { shoots: { ratePerSec: 0.625, radius: 12.125, targeting: 'nearestHostile' } } };
  const level = { ...samples.level, mapObjects: [{ kind: 'gate', pos: { x: 1.125, y: -2.625 }, footprintRadius: 0.25, delta: 1 }] };
  const registry: content.ComponentRegistry = {
    ...content.COMPONENT_REGISTRY,
    components: { ...content.COMPONENT_REGISTRY.components, shoots: {
      ruleIds: ['R-SHOOT-01'], params: {
        ratePerSec: { type: 'number', unit: 'fx3', minimum: 1, maximum: 2147483647 },
        radius: { type: 'number', unit: 'fx3', minimum: 0, maximum: 500000 },
        targeting: { type: 'string', values: ['nearestHostile', 'randomHostile'] },
      },
    } },
  };
  const loaded = content.loadContent({ 'archer.json': archer, 'level.json': level }, { registry });
  assert.deepEqual(loaded['archer.json'], { ...archer, footprintRadius: 3000, components: { shoots: { ratePerSec: 625, radius: 12125, targeting: 'nearestHostile' } } });
  assert.deepEqual((loaded['level.json'] as content.Level).mapObjects, [{ kind: 'gate', pos: { x: 1125, y: -2625 }, footprintRadius: 250, delta: 1 }]);
});
