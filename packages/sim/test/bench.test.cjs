const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const adapter = path.join(__dirname, '../scripts/bench.cjs');
const bench = fs.existsSync(adapter) ? require(adapter) : {};

test('performance budgets reject each breached metric and CI tolerates only 5x', () => {
  assert.equal(typeof bench.assertBudgets, 'function');
  const good = { mean: 0.29, p99: 0.99, hash: 0.49, hashP99: 0.49 };
  assert.doesNotThrow(() => bench.assertBudgets(good));
  for (const [metric, limit] of [['mean', 0.3], ['p99', 1], ['hash', 0.5], ['hashP99', 0.5]]) {
    assert.throws(() => bench.assertBudgets({ ...good, [metric]: limit }), /budget/);
    assert.doesNotThrow(() => bench.assertBudgets({ ...good, [metric]: limit * 4.99 }, true));
    assert.throws(() => bench.assertBudgets({ ...good, [metric]: limit * 5 }, true), /budget/);
    assert.throws(() => bench.assertBudgets({ ...good, [metric]: NaN }), /budget/);
  }
});

test('benchmark fixture sustains real 2000-class FIFO work with generation and clashes', () => {
  assert.equal(typeof bench.createFixture, 'function');
  require('tsx/cjs');
  const { assertInvariants } = require('../src/tick.ts');
  const s = bench.createFixture();
  assert.equal(s.debug, false);
  assert.equal(s.view.ids.towers.length, 30);
  assert.deepEqual(s.view.players.map(p => p.kind), ['human', 'bot', 'bot', 'bot']);
  const generated = s.accounting.generated, clashes = s.accounting.clashes;
  for (let i = 0; i < 3000; i++) {
    const before = s.tick;
    s.step([], { events: false });
    assert.equal(bench.assertWorkload(s, before), 2100);
  }
  assertInvariants(s);
  assert.equal(s.view.lines.length, 30);
  assert.ok(s.accounting.generated > generated);
  assert.ok(s.accounting.clashes > clashes);
  const original = s.step;
  s.step = () => [];
  const before = s.tick; s.step([]);
  assert.throws(() => bench.assertWorkload(s, before), /active/);
  s.step = original;
  s.over = { outcome: 'timeout', winnerTeam: null };
  assert.throws(() => bench.assertWorkload(s, s.tick - 1), /active/);
  s.over = null;
  s.players.transit[0] = 0;
  assert.throws(() => bench.assertWorkload(s, s.tick - 1), /troop/);
});

test('2x event modes execute identical active workloads and quiet mode emits zero', () => {
  assert.equal(typeof bench.measure, 'function');
  const visible = bench.measure({ events: true, warmup: 50, samples: 100, stepsPerInterval: 2, hashSamples: 10 });
  const quiet = bench.measure({ events: false, warmup: 50, samples: 100, stepsPerInterval: 2, hashSamples: 10 });
  assert.equal(visible.finalHash, quiet.finalHash);
  assert.equal(visible.rejected, 0);
  assert.equal(quiet.rejected, visible.rejected);
  assert.equal(visible.activeSamples, 200);
  assert.equal(quiet.activeSamples, 200);
  assert.equal(visible.troopMin, 2100);
  assert.equal(quiet.troopMax, 2100);
  assert.equal(quiet.eventCount, 0);
  assert.equal(visible.eventTypes.TroopSpawned, 6000);
  assert.equal(visible.eventTypes.Clash, 3000);
});

test('ring word streaming preserves logical FIFO words across wrap and growth', () => {
  require('tsx/cjs');
  const { TroopRing } = require('../src/state.ts');
  const ring = new TroopRing();
  assert.equal(typeof ring.writeWords, 'function');
  const troops = Array.from({ length: 20 }, (_, i) => ({ p0: -i, t0: i, owner: i % 4, kind: i % 2, seq: i + 1, value: 1 }));
  for (const troop of troops.slice(0, 8)) ring.push(troop);
  for (let i = 0; i < 6; i++) ring.shift();
  for (const troop of troops.slice(8)) ring.push(troop);
  const words = []; ring.writeWords({ word(value) { words.push(value); } });
  assert.deepEqual(words, troops.slice(6).flatMap(troop => [troop.p0, troop.t0, troop.owner, troop.kind, troop.seq, troop.value]));
  assert.equal(ring.size, 14);
  assert.deepEqual(ring.front(), troops[6]);
});
