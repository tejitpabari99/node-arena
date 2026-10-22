const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const sim = require('../src/internal.ts');
const { WordHash } = require('../src/math.ts');
const { compiledGolden } = require('./fixtures.cjs');

test('integer helpers stay exact at the safe-integer boundary and reject inexact intermediates', () => {
  assert.equal(sim.idiv(Number.MAX_SAFE_INTEGER, 1), Number.MAX_SAFE_INTEGER);
  assert.equal(sim.idiv(-Number.MAX_SAFE_INTEGER, 2), -4503599627370495);
  assert.equal(sim.isqrt(Number.MAX_SAFE_INTEGER), 94906265);
  assert.equal(sim.mulDiv(94906265, 94906265, 94906265), 94906265);
  assert.throws(() => sim.mulDiv(2147483647, 2147483647, 2147483647), /safe integer/);
  assert.throws(() => sim.mulDiv(Number.MAX_SAFE_INTEGER, 2, 2), /safe integer/);
  assert.throws(() => sim.idiv(1, 0), /zero/i);
  assert.throws(() => sim.idiv(1.5, 1), /safe integer/);
});

test('state hash covers int32 column extremes exactly', () => {
  const a = sim.create(compiledGolden(), 0), b = sim.create(compiledGolden(), 0);
  assert.equal(a.hash(), b.hash());
  const level = compiledGolden();
  level.buildings[0].level = 2147483647;
  const c = sim.create(level, 0);
  assert.notEqual(c.hash(), a.hash());
  assert.equal(c.view.buildings.level[0], 2147483647);
});

test('word hash is order-sensitive and wraps words to int32 deterministically', () => {
  const h = (...w) => { const x = new WordHash(); w.forEach(v => x.word(v)); return x.finish(); };
  assert.notEqual(h(1, 2), h(2, 1));
  assert.equal(h(4294967295), h(-1));
  assert.match(h(2147483647, -2147483648), /^[0-9a-f]{16}$/);
});
