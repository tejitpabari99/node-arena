import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAjv, validateTroop, type Troop } from '../src/index.js';

test('the shared Ajv rejects unknown schema keywords in strict mode', () => {
  assert.throws(() => createAjv().compile({ type: 'object', typo: true }), /unknown keyword/);
});

test('the shared validator reports every invalid field without mutating input', () => {
  const troop = { $schema: '../../schemas/troop.schema.json', schemaVersion: '1.0.0', id: 'bad id', visual: 'troop.regular', value: 1, speed: 0, extra: true };
  const before = structuredClone(troop);
  assert.equal(validateTroop(troop), false);
  const errors = validateTroop.errors;
  assert.ok(errors);
  assert.ok(errors.some((error) => error.keyword === 'additionalProperties'));
  assert.ok(errors.some((error) => error.instancePath === '/id'));
  assert.ok(errors.some((error) => error.instancePath === '/speed'));
  assert.deepEqual(troop, before);
});

// Compiled during pnpm build: a schema-derived type must reject invalid authored values.
const typedTroop: Troop = { $schema: '../../schemas/troop.schema.json', schemaVersion: '1.0.0', id: 'regular', visual: 'troop.regular', value: 1, speed: 10 };
// @ts-expect-error Troop speed is numeric, never a string.
const invalidTypedTroop: Troop = { ...typedTroop, speed: 'fast' };
void invalidTypedTroop;
