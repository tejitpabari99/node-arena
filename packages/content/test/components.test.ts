import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as content from '../src/index.js';

// These fixtures isolate schema/registry loading; public loadContent checks full semantics.
const loadPartial = (files: content.ContentFileMap, opts: content.LoadContentOptions = {}) => content.loadContent(files, { ...opts, partial: true });

const standard = { $schema: 'archetype.schema.json', schemaVersion: '1.0.0', id: 'standard', visual: 'tower.standard', footprintRadius: 3, components: { garrison: { cap: 50 }, generates: { troop: 'regular', ratePerSec: 1.125 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } };
const regular = { $schema: 'troop.schema.json', schemaVersion: '1.0.0', id: 'regular', visual: 'troop.regular', value: 1, speed: 10 };

function registry() {
  assert.ok('COMPONENT_REGISTRY' in content, 'the registry must be exported for startup parity checks');
  return content.COMPONENT_REGISTRY;
}
function issue(files: content.ContentFileMap, file: string, pointer: string) {
  assert.throws(() => loadPartial(files), (error: unknown) => {
    assert.ok(error instanceof content.ContentLoadError);
    assert.ok(error.errors.some((entry) => entry.file === file && entry.pointer === pointer), JSON.stringify(error.errors));
    return true;
  });
}

// Missing inheritance or shallow component replacement loses troop and untouched components.
test('covers R-ENT-01: resolves small/large parameter variants in loaded units without mutating inputs', () => {
  const small = { ...standard, id: 'small', extends: 'standard', visual: 'tower.small', footprintRadius: 2, components: { garrison: { cap: 20 }, generates: { ratePerSec: 0.6 }, drawsLines: { extraSlotAbove: [10] } } };
  const large = { ...standard, id: 'large', extends: 'standard', visual: 'tower.large', footprintRadius: 4, components: { generates: { ratePerSec: 2 } } };
  const files = { 'small.json': small, 'standard.json': standard, 'large.json': large };
  const before = structuredClone(files);
  const loaded = loadPartial(files);
  assert.deepEqual((loaded['small.json'] as content.Archetype).components, { garrison: { cap: 20 }, generates: { troop: 'regular', ratePerSec: 600 }, drawsLines: { extraSlotAbove: [10] }, capturable: {} });
  assert.deepEqual((loaded['large.json'] as content.Archetype).components, { garrison: { cap: 50 }, generates: { troop: 'regular', ratePerSec: 2000 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} });
  assert.equal((loaded['small.json'] as content.Archetype).footprintRadius, 2000);
  assert.deepEqual(files, before);
  (loaded['small.json'] as content.Archetype).components.drawsLines!.extraSlotAbove = [];
  assert.deepEqual((loaded['standard.json'] as content.Archetype).components.drawsLines!.extraSlotAbove, [10, 30]);
});

// Silent registry bypass would let content describe mechanics the engine cannot implement.
for (const [name, components, pointer] of [
  ['unknown component', { shoots: { ratePerSec: 1 } }, '/components/shoots'],
  ['unknown param', { garrison: { cap: 50, health: 3 } }, '/components/garrison/health'],
  ['missing required param', { generates: { ratePerSec: 1 } }, '/components/generates/troop'],
  ['zero generation', { generates: { troop: 'regular', ratePerSec: 0 } }, '/components/generates/ratePerSec'],
  ['noninteger cap', { garrison: { cap: 1.5 } }, '/components/garrison/cap'],
  ['negative threshold', { drawsLines: { extraSlotAbove: [-1] } }, '/components/drawsLines/extraSlotAbove/0'],
  ['unordered thresholds', { drawsLines: { extraSlotAbove: [30, 10] } }, '/components/drawsLines/extraSlotAbove/1'],
  ['duplicate thresholds', { drawsLines: { extraSlotAbove: [10, 10] } }, '/components/drawsLines/extraSlotAbove/1'],
  ['capturable params', { capturable: { cap: 50 } }, '/components/capturable/cap'],
] as const) {
  test(`covers R-ENT-01: rejects ${name} at its source pointer`, () => {
    issue({ 'standard.json': { ...standard, components } }, 'standard.json', pointer);
  });
}

test('covers R-ENT-02: v1 rejects tank combat value but permits unit value', () => {
  assert.ok(loadPartial({ 'regular.json': regular }));
  issue({ 'tank.json': { ...regular, id: 'tank', value: 2 } }, 'tank.json', '/value');
});

// Inheritance depth/cycles must fail regardless of file ordering, without recursion overflow.
for (const [name, variants, file] of [
  ['missing base', [{ ...standard, id: 'small', extends: 'missing', components: {} }], 'small.json'],
  ['self cycle', [{ ...standard, id: 'small', extends: 'small', components: {} }], 'small.json'],
  ['cycle', [{ ...standard, id: 'small', extends: 'large', components: {} }, { ...standard, id: 'large', extends: 'small', components: {} }], 'small.json'],
  ['depth greater than one', [{ ...standard, id: 'small', extends: 'standard', components: {} }, { ...standard, id: 'large', extends: 'small', components: {} }], 'large.json'],
] as const) {
  test(`rejects extends ${name}`, () => {
    issue({ 'standard.json': standard, ...Object.fromEntries(variants.map((entry) => [`${entry.id}.json`, entry])) }, file, '/extends');
  });
}

test('rejects adding or removing inherited components, while omitted components remain inherited', () => {
  const base = { ...standard, components: { garrison: { cap: 50 } } };
  const child = { ...standard, id: 'small', extends: 'standard', components: { capturable: {} } };
  issue({ 'standard.json': base, 'small.json': child }, 'small.json', '/components/capturable');
  issue({ 'standard.json': standard, 'small.json': { ...child, components: { capturable: null } } }, 'small.json', '/components/capturable');
  assert.deepEqual((loadPartial({ 'standard.json': standard, 'small.json': { ...child, components: {} } })['small.json'] as content.Archetype).components, { ...standard.components, generates: { troop: 'regular', ratePerSec: 1125 } });
});

test('invalid inherited params identify the base file and invalid patched params identify the variant', () => {
  const child = { ...standard, id: 'small', extends: 'standard', components: {} };
  issue({ 'small.json': child, 'standard.json': { ...standard, components: { garrison: {} } } }, 'standard.json', '/components/garrison/cap');
  issue({ 'small.json': { ...child, components: { generates: { badParam: 1 } } }, 'standard.json': standard }, 'small.json', '/components/generates/badParam');
});

// These fixtures must become supported by registry-only additions: no shape/schema changes.
test('an injected registry supports archer and tank without widening production schemas', () => {
  const v1 = registry();
  const extended: content.ComponentRegistry = {
    components: { ...v1.components, shoots: { ruleIds: ['R-SHOOT-01'], params: { ratePerSec: { type: 'number', unit: 'fx3', minimum: 1, maximum: 2147483647 }, radius: { type: 'number', unit: 'fx3', minimum: 1, maximum: 500000 }, targeting: { type: 'string', values: ['nearestHostile', 'randomHostile'] } } } },
    troopValue: { ...v1.troopValue, maximum: 2 },
  };
  const archer = { ...standard, id: 'archer', components: { garrison: { cap: 30 }, capturable: {}, shoots: { ratePerSec: 0.625, radius: 12.125, targeting: 'nearestHostile' } } };
  issue({ 'archer.json': archer }, 'archer.json', '/components/shoots');
  const loaded = loadPartial({ 'archer.json': archer, 'tank.json': { ...regular, id: 'tank', value: 2 } }, { registry: extended });
  assert.deepEqual((loaded['archer.json'] as content.Archetype).components.shoots, { ratePerSec: 625, radius: 12125, targeting: 'nearestHostile' });
  assert.equal((loaded['tank.json'] as content.Troop).value, 2);
  assert.equal(v1.troopValue.maximum, 1);
  assert.equal('shoots' in v1.components, false);
  assert.throws(() => loadPartial({ 'archer.json': { ...archer, components: { shoots: { ...archer.components.shoots, targeting: 'friendly' } } } }, { registry: extended }), /\/components\/shoots\/targeting/);
});
