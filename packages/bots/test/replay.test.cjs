const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const bots = require('../src/index.ts');
const sim = require('../../sim/src/index.ts');
const fx = require('../../sim/test/fixtures.cjs');

const loaded = fx.content.loadContent(fx.dataFiles());
const byPosition = pos => loaded.compiled[loaded.catalog.campaigns.common.entries.find(e => e.position === pos).level];

test('covers R2: bot match is deterministic across runs (record, hash, commands)', () => {
  for (const level of [fx.compiledGolden(), byPosition(4), byPosition(6)]) {
    const run = () => bots.runMatch({ level, seed: 21, maxTicks: 3000, record: fx.metadata });
    const a = run(), b = run();
    assert.deepEqual(a.replay, b.replay);
    assert.equal(a.stats.finalHash, b.stats.finalHash);
    assert.equal(a.stats.rejected, 0);
  }
});

test('covers R2: recorded bot match verifies via playReplay and reproduces final hash', () => {
  for (const level of [fx.compiledGolden(), byPosition(4), byPosition(6)]) {
    const r = bots.runMatch({ level, seed: 33, maxTicks: 3000, record: fx.metadata });
    assert.ok(r.replay.commands.length > 0, 'bots issued commands');
    const v = sim.playReplay({ metadata: fx.metadata, level }, r.replay);
    assert.equal(v.ok, true);
    assert.equal(v.sim.hash(), r.stats.finalHash);
    assert.equal(r.replay.finalHash, r.stats.finalHash);
  }
});

test('covers R2: tampered bot replay is detected', () => {
  const level = byPosition(4);
  const r = bots.runMatch({ level, seed: 33, maxTicks: 3000, record: fx.metadata });
  const bad = JSON.parse(JSON.stringify(r.replay));
  bad.commands.pop();
  let diverged = false;
  try { diverged = sim.playReplay({ metadata: fx.metadata, level }, bad).ok === false; } catch { diverged = true; }
  assert.ok(diverged);
});
