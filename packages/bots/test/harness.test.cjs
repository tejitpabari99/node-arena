const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const bots = require('../src/index.ts');
const sim = require('../../sim/src/index.ts');
const fx = require('../../sim/test/fixtures.cjs');

const level = fx.compiledGolden();
const loaded = fx.content.loadContent(fx.dataFiles());
const l4 = loaded.compiled[loaded.catalog.campaigns.common.entries.find(e => e.position === 4).level];

test('covers R2: runMatch truncates at maxTicks; rejects bad maxTicks', () => {
  const r = bots.runMatch({ level, seed: 1, maxTicks: 10 });
  assert.equal(r.ticks, 10);
  assert.deepEqual(r.outcome, { outcome: 'truncated', winner: null });
  assert.throws(() => bots.runMatch({ level, seed: 1, maxTicks: -1 }), RangeError);
  assert.throws(() => bots.runMatch({ level, seed: 1, maxTicks: 1.5 }), RangeError);
});

test('covers R2: ScriptedController applies commands at their pre-step tick, in order', () => {
  const probe = sim.create(level, 4);
  const owned = probe.view.buildings.owner.findIndex(o => o === 0);
  let pair = null;
  for (let t = 0; t < probe.view.ids.buildings.length && !pair; t++) if (t !== owned && probe.canDraw(0, owned, t) === null) pair = [owned, t];
  assert.ok(pair, 'fixture has a drawable pair for player 0');
  const cmd = { type: 'DrawLine', player: 0, from: pair[0], to: pair[1] };
  const r = bots.runMatch({ level, seed: 4, maxTicks: 5, controllers: [{ player: 0, commands: [{ tick: 2, cmd }] }] });
  assert.equal(r.stats.commandCount >= 1, true);
  assert.equal(r.stats.rejected, 0);
  const rec = bots.runMatch({ level, seed: 4, maxTicks: 5, record: fx.metadata, controllers: [{ player: 0, commands: [{ tick: 2, cmd }] }] });
  assert.ok(rec.replay.commands.some(c => c.tick === 2));
});

test('covers R2: controller validation (player range, duplicates, unordered, wrong player, bad shape)', () => {
  const cmd = p => ({ type: 'DrawLine', player: p, from: 0, to: 1 });
  const bad = controllers => () => bots.runMatch({ level, seed: 1, maxTicks: 1, controllers });
  assert.throws(bad([{ player: 9, commands: [] }]), RangeError);
  assert.throws(bad([{ player: 0, commands: [] }, { player: 0, commands: [] }]), RangeError);
  assert.throws(bad([{ player: 0, commands: [{ tick: 3, cmd: cmd(0) }, { tick: 1, cmd: cmd(0) }] }]), RangeError);
  assert.throws(bad([{ player: 0, commands: [{ tick: 0, cmd: cmd(1) }] }]), RangeError);
  assert.throws(bad([{ player: 0 }]), TypeError);
});

test('covers R2: controller override replaces default seat; unspecified level bots stay active', () => {
  const silent = { player: 1, decide: () => [] };
  const a = bots.runMatch({ level, seed: 3, maxTicks: 400 });
  const b = bots.runMatch({ level, seed: 3, maxTicks: 400, controllers: [silent] });
  assert.ok(a.stats.commandCount >= 1);
  assert.equal(b.stats.commandCount, 0);
  // override order does not matter and a Bot controller is accepted alongside a script
  const c = bots.runMatch({ level, seed: 3, maxTicks: 50, controllers: [silent, { player: 0, commands: [] }] });
  const d = bots.runMatch({ level, seed: 3, maxTicks: 50, controllers: [{ player: 0, commands: [] }, silent] });
  assert.equal(c.stats.finalHash, d.stats.finalHash);
});

test('covers R2: bot may not command for another player; BotContext guards hidden reads', () => {
  const liar = { player: 0, decide: () => [{ type: 'DrawLine', player: 1, from: 0, to: 1 }] };
  assert.throws(() => bots.runMatch({ level, seed: 1, maxTicks: 3, controllers: [liar] }), RangeError);
  const sneaky = { player: 0, decide: ctx => { ctx.snapshot; return []; } };
  assert.throws(() => bots.runMatch({ level, seed: 1, maxTicks: 3, controllers: [sneaky] }), TypeError);
});

test('covers R2: stats on a campaign level are consistent', () => {
  const r = bots.runMatch({ level: l4, seed: 8, maxTicks: 600 });
  assert.equal(r.stats.rejected, 0);
  assert.equal(r.stats.buildings.length, l4.buildings.length);
  assert.equal(r.stats.players.reduce((n, p) => n + p.buildings, 0), r.stats.buildings.filter(b => b.owner !== null).length);
});
