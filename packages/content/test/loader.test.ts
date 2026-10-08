import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import Type from 'typebox';
import * as content from '../src/index.js';

const file = 'data/troops/regular.json';
const troop = { $schema: '../../schemas/troop.schema.json', schemaVersion: '1.0.0', id: 'regular', visual: 'troop.regular', value: 1, speed: 1.125 };
// Namespace access lets missing APIs produce a test assertion, rather than an import error, in RED.
function api() {
  assert.equal(typeof content.loadContent, 'function');
  assert.equal(typeof content.convertFixedPoint, 'function');
  return content;
}

// Missing field-specific conversion would leave speed authored or scale troop value too.
test('loads strings and objects, scales only tagged fields, and leaves inputs untouched', () => {
  const { loadContent } = api();
  const input = { [file]: Object.freeze({ ...troop }) };
  const loaded = loadContent(input);
  assert.deepEqual(loaded[file], { ...troop, speed: 1125 });
  assert.deepEqual(loadContent({ [file]: JSON.stringify(troop) }), loaded);
  assert.deepEqual(input[file], troop);
  assert.notEqual(loaded[file], input[file]);
});

// Using decimal string length or exact float equality would wrongly reject these values.
for (const [authored, expected] of [[0.001, 1], [0.29, 290], [1.001, 1001], [100, 100000]] as const) {
  test(`loads the three-decimal boundary ${authored}`, () => {
    assert.equal(api().loadContent({ [file]: { ...troop, speed: authored } })[file]?.speed, expected);
  });
}

for (const [name, speed] of [['four decimal places', 1.0001], ['NaN', NaN], ['infinity', Infinity], ['scaled overflow', 2147483.648]] as const) {
  test(`rejects ${name} with the source file and JSON pointer`, () => {
    assert.throws(() => api().loadContent({ [file]: { ...troop, speed } }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /data\/troops\/regular\.json/);
      assert.match(error.message, /\/speed/);
      return true;
    });
  });
}

// Dropping recursive schema traversal would leave nested coordinates unscaled.
test('converts nested tagged fields and escapes JSON pointer property names', () => {
  const schema = Type.Object({
    positions: Type.Array(Type.Object({ x: Type.Number({ 'x-unit': 'fx3' }), count: Type.Integer() })),
    'a/b~c': Type.Number({ 'x-unit': 'fx3' }),
  });
  const input = { positions: [{ x: -1.125, count: 2 }], 'a/b~c': 0.001 };
  assert.deepEqual(api().convertFixedPoint(input, schema, file), { positions: [{ x: -1125, count: 2 }], 'a/b~c': 1 });
  assert.deepEqual(input, { positions: [{ x: -1.125, count: 2 }], 'a/b~c': 0.001 });
  assert.throws(() => api().convertFixedPoint({ ...input, 'a/b~c': 0.0001 }, schema, file), /\/a~1b~0c/);
  assert.throws(() => api().convertFixedPoint({ ...input, positions: [{ x: 0.0001, count: 2 }] }, schema, file), /\/positions\/0\/x/);
});

// Bitwise coercion would silently wrap instead of validating the symmetric PRD bounds.
test('accepts the PRD int32 limits and rejects values beyond either limit', () => {
  const schema = Type.Number({ 'x-unit': 'fx3' });
  for (const [value, expected] of [[2147483.647, 2147483647], [-2147483.647, -2147483647]] as const) {
    assert.equal(api().convertFixedPoint(value, schema, file), expected);
  }
  for (const value of [2147483.648, -2147483.648, -0.0001]) {
    assert.throws(() => api().convertFixedPoint(value, schema, file));
  }
});

// Validating after conversion would reject a valid authored speed of 1.125 (>100 after scaling).
// Skipping raw validation would accept unknown fields or malformed input.
for (const [name, value, pointer] of [
  ['unknown fields', { ...troop, unexpected: 1 }, '/unexpected'],
  ['invalid speed range', { ...troop, speed: 101 }, '/speed'],
  ['wrong speed type', { ...troop, speed: 'fast' }, '/speed'],
  ['missing required fields', { ...troop, id: undefined }, '/id'],
  ['unsupported schema', { ...troop, $schema: '../../schemas/unknown.schema.json' }, '/$schema'],
  ['invalid JSON', '{', ''],
] as const) {
  test(`loader rejects ${name}`, () => {
    assert.throws(() => api().loadContent({ [file]: value }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(file));
      assert.ok(error.message.includes(pointer));
      return true;
    });
  });
}

// Hidden dependence on Node globals would fail the same loader in the web dev panel.
test('the unchanged loader runs without Node globals in a browser-like runtime', () => {
  api();
  const script = `
    const { loadContent } = await import(${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)});
    const output = console.log.bind(console);
    globalThis.process = undefined;
    globalThis.Buffer = undefined;
    globalThis.global = undefined;
    output(JSON.stringify(loadContent(${JSON.stringify({ [file]: troop })})));
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { [file]: { ...troop, speed: 1125 } });
});
