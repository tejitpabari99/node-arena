const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const math = require('../src/index.ts');

// Independent arbitrary-precision Newton oracle, never using the sim helpers.
function root(n) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
// Test samples do not depend on the production PRNG.
let sampleState = 0x5eed1234;
function random() {
  sampleState = (1664525 * sampleState + 1013904223) >>> 0;
  return sampleState;
}

test('covers R-TCK-02: signed division truncates exactly, without negative zero', () => {
  assert.equal(typeof math.idiv, 'function');
  for (const [a, b] of [[7, 3], [-7, 3], [7, -3], [-7, -3], [1, -3], [0, -3],
    [Number.MAX_SAFE_INTEGER, 3], [Number.MAX_SAFE_INTEGER - 1, 3], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1]]) {
    assert.equal(math.idiv(a, b), Number(BigInt(a) / BigInt(b)));
  }
  for (let i = 0; i < 10000; i++) {
    const a = (random() * 2097152 + (random() % 2097152)) * (i % 2 ? -1 : 1);
    const b = (random() || 1) * (i % 3 ? -1 : 1);
    assert.equal(math.idiv(a, b), Number(BigInt(a) / BigInt(b)));
  }
});
test('division and multiply-divide reject unsafe, fractional or zero-divisor arithmetic', () => {
  assert.equal(typeof math.mulDiv, 'function');
  for (const bad of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => math.idiv(bad, 1), RangeError);
    assert.throws(() => math.idiv(1, bad), RangeError);
    assert.throws(() => math.mulDiv(bad, 1, 1), RangeError);
    assert.throws(() => math.mulDiv(1, bad, 1), RangeError);
    assert.throws(() => math.mulDiv(1, 1, bad), RangeError);
  }
  assert.throws(() => math.idiv(1, 0), RangeError);
  assert.throws(() => math.mulDiv(1, 1, 0), RangeError);
  assert.throws(() => math.mulDiv(Number.MAX_SAFE_INTEGER, 2, 2), RangeError);
  for (const [a, b, d] of [[3, 7, 4], [-3, 7, 4], [3001, 20, 1000], [94906265, 94906265, 100000]]) {
    assert.equal(math.mulDiv(a, b, d), Number(BigInt(a) * BigInt(b) / BigInt(d)));
  }
  for (let i = 0; i < 10000; i++) {
    const a = (random() % 94906266) * (i % 2 ? -1 : 1);
    const b = random() % 94906266;
    const d = random() % 100000 + 1;
    assert.equal(math.mulDiv(a, b, d), Number(BigInt(a) * BigInt(b) / BigInt(d)));
  }
});
test('integer square root floors at exact square boundaries through MAX_SAFE_INTEGER', () => {
  assert.equal(typeof math.isqrt, 'function');
  const values = [0, 1, 2, 3, 4, 8, 9, 10, Number.MAX_SAFE_INTEGER];
  for (const k of [2, 3001, 20000000, 28284271, 94906265]) {
    values.push(k * k - 1, k * k, k * k + 1);
  }
  for (let i = 0; i < 10000; i++) values.push(random() * 2097152 + random() % 2097152);
  for (const n of values) assert.equal(math.isqrt(n), Number(root(BigInt(n))), `sqrt ${n}`);
  for (const n of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => math.isqrt(n), RangeError);
});
test('covers R-TCK-01 / R-TCK-02: fixed-point spike matches BigInt floor-length arrival at 20 Hz', () => {
  assert.equal(typeof math.isqrt, 'function');
  assert.equal(typeof math.TICK_RATE, 'number');
  const coords = [-500000, -499999, -1, 0, 1, 499999, 500000];
  const speeds = [1, 20, 1000, 3001, 99999, 100000];
  let count = 0;
  let maxSquared = 0;
  function check(ax, ay, bx, by, speed) {
    const dx = (bx - ax) * math.TICK_RATE;
    const dy = (by - ay) * math.TICK_RATE;
    const squared = dx * dx + dy * dy;
    assert.ok(Number.isSafeInteger(squared));
    maxSquared = Math.max(maxSquared, squared);
    const exactSquared = BigInt(bx - ax) ** 2n * 400n + BigInt(by - ay) ** 2n * 400n;
    assert.equal(BigInt(squared), exactSquared);
    const length = math.isqrt(squared);
    const exactLength = root(exactSquared);
    assert.equal(BigInt(length), exactLength);
    assert.ok(length <= 2147483647 && speed <= 2147483647);
    const arrival = math.idiv(length + speed - 1, speed);
    const exactArrival = (exactLength + BigInt(speed) - 1n) / BigInt(speed);
    assert.equal(BigInt(arrival), exactArrival);
    assert.ok(Number.isSafeInteger(arrival * speed) && arrival * speed <= 2147483647);
    if (arrival > 0) assert.ok((arrival - 1) * speed < length);
    assert.ok(arrival * speed >= length);
    count++;
  }
  for (const ax of coords) for (const ay of coords) for (const bx of coords) for (const by of coords) {
    for (const speed of speeds) check(ax, ay, bx, by, speed);
  }
  for (let i = 0; i < 50000; i++) {
    check(random() % 1000001 - 500000, random() % 1000001 - 500000,
      random() % 1000001 - 500000, random() % 1000001 - 500000, random() % 100000 + 1);
  }
  assert.equal(maxSquared, 800000000000000);
  assert.equal(count, 64406);
});
test('Sfc32 emits exact unsigned 32-bit words and snapshots copy all four lanes', () => {
  assert.equal(typeof math.Sfc32, 'function');
  const generator = new math.Sfc32(12345);
  const twin = new math.Sfc32(12345);
  const state = generator.snapshot();
  const mask = 0xffffffffn;
  let [a, b, c, d] = state.map(BigInt);
  for (let i = 0; i < 10000; i++) {
    const expected = (a + b + d) & mask;
    d = (d + 1n) & mask;
    a = b ^ (b >> 9n);
    b = (c + (c << 3n)) & mask;
    c = (((c << 21n) | (c >> 11n)) + expected) & mask;
    assert.equal(generator.next(), Number(expected));
    assert.equal(twin.next(), Number(expected));
  }
  assert.deepEqual(generator.snapshot(), [a, b, c, d].map(Number));
  const detached = generator.snapshot();
  detached[0] ^= 1;
  assert.deepEqual(generator.snapshot(), [a, b, c, d].map(Number));
  assert.notDeepEqual(new math.Sfc32(12346).snapshot(), new math.Sfc32(12345).snapshot());
  assert.throws(() => new math.Sfc32(0.5), RangeError);
});
test('mixSeed is reproducible, ordered and distinguishes trailing zero parts', () => {
  assert.equal(typeof math.mixSeed, 'function');
  const results = [[], [1], [1, 0], [1, 2], [2, 1], [-1], [0xffffffff]].map(parts => math.mixSeed(...parts));
  assert.ok(results.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff));
  assert.equal(new Set(results.slice(0, 5)).size, 5);
  assert.equal(results[5], results[6]);
  assert.equal(math.mixSeed(1, 2), math.mixSeed(1, 2));
  for (const bad of [0.5, NaN, Infinity, 4294967296, -2147483649]) assert.throws(() => math.mixSeed(bad), RangeError);
});
