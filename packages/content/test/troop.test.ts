import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Ajv } from 'ajv';

const sample = JSON.parse(await readFile(new URL('../data/troops/regular.json', import.meta.url), 'utf8'));
// With no generated schema, Ajv has no constraints. These tests must catch that missing contract.
const schema = JSON.parse(await readFile(new URL('../schemas/troop.schema.json', import.meta.url), 'utf8').catch((error) => {
  if (error.code !== 'ENOENT') throw error;
  return '{}';
}));
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addKeyword({ keyword: 'x-unit', schemaType: 'string', valid: true });
ajv.addKeyword({ keyword: 'x-presentation', schemaType: 'boolean', valid: true });
const validate = ajv.compile(schema);

test('the emitted schema validates the authored regular troop file', () => {
  assert.equal(validate(sample), true);
});

for (const [name, patch] of [
  ['unknown fields', { unknown: 1 }],
  ['invalid ids', { id: 'Regular troop' }],
  ['non-positive speed', { speed: 0 }],
  ['speed above the simulation bound', { speed: 100.001 }],
  ['fractional troop value', { value: 1.5 }],
  ['unsupported schema versions', { schemaVersion: '2.0.0' }],
] as const) {
  test(`the emitted schema rejects ${name}`, () => {
    assert.equal(validate({ ...sample, ...patch }), false);
  });
}

test('the emitted schema requires the editor schema reference', () => {
  const { $schema: _, ...missingReference } = sample;
  assert.equal(validate(missingReference), false);
});
