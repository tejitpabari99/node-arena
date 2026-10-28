const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const bots = require('../src/index.ts');
const sim = require('../../sim/src/index.ts');
const { pvpLevel, fx } = require('./pvp-fixture.cjs');

const dl = (player, from, to) => ({ tick: 0, cmd: { type: 'DrawLine', player, from, to } });
/** Scripted pvp match; replay must round-trip with identical final hash and header teams. */
function play({ owners, teams, levels, script = {}, limit = 60 }) {
  const level = pvpLevel(owners, teams, { limit, levels });
  const controllers = teams.map((_, p) => ({ player: p, commands: script[p] ?? [] }));
  const r = bots.runMatch({ level, seed: 1, teams, controllers, record: fx.metadata });
  assert.equal(r.stats.rejected, 0);
  assert.deepEqual(r.replay.header.teams, teams);
  const v = sim.playReplay({ metadata: fx.metadata, level }, r.replay);
  assert.equal(v.ok, true);
  assert.equal(v.sim.hash(), r.stats.finalHash);
  assert.equal(r.replay.finalHash, r.stats.finalHash);
  return r;
}

test('covers R-WIN-04: 1v1 scripted capture is victory for the attacker', () => {
  const r = play({ owners: [0, 1], teams: [0, 1], levels: [30, 2], script: { 0: [dl(0, 0, 1)] } });
  assert.deepEqual(r.outcome, { outcome: 'victory', winner: 0, winners: [0] });
});

test('covers R-WIN-04: 4-seat FFA last seat standing wins alone', () => {
  const r = play({ owners: [0, 1, 2, 3], teams: [0, 1, 2, 3], levels: [40, 2, 2, 2], limit: 120, script: { 0: [dl(0, 0, 1), dl(0, 0, 2), dl(0, 0, 3)] } });
  assert.deepEqual(r.outcome, { outcome: 'victory', winner: 0, winners: [0] });
});

test('covers R-TEM-01, R-WIN-04: 2v2 victory lists both allied seats', () => {
  const r = play({ owners: [0, 1, 2, 3], teams: [0, 0, 1, 1], levels: [40, 40, 2, 2], limit: 120, script: { 0: [dl(0, 0, 2)], 1: [dl(1, 1, 3)] } });
  assert.deepEqual(r.outcome, { outcome: 'victory', winner: 0, winners: [0, 1] });
});

test('covers R-WIN-04: 3v1 victory lists all three allied seats', () => {
  const r = play({ owners: [0, 1, 2, 3], teams: [0, 0, 0, 1], levels: [40, 40, 40, 2], limit: 120, script: { 0: [dl(0, 0, 3)], 1: [dl(1, 1, 3)] } });
  assert.deepEqual(r.outcome, { outcome: 'victory', winner: 0, winners: [0, 1, 2] });
});

test('covers R-WIN-05: timeout ranks by troops when buildings tie', () => {
  const r = play({ owners: [0, 1], teams: [0, 1], levels: [30, 2], limit: 5 });
  assert.equal(r.outcome.outcome, 'timeLimit');
  assert.deepEqual(r.outcome.winners, [0]);
  assert.equal(r.ticks, 100);
});

test('covers R-WIN-06: exact timeout tie is a draw with the tied top seats', () => {
  const two = play({ owners: [0, 1], teams: [0, 1], levels: [10, 10], limit: 5 });
  assert.deepEqual(two.outcome, { outcome: 'draw', winner: 0, winners: [0, 1] });
  const three = play({ owners: [0, 1, 2], teams: [0, 1, 2], levels: [10, 10, 2], limit: 5 });
  assert.deepEqual(three.outcome, { outcome: 'draw', winner: 0, winners: [0, 1] });
});

test('covers R-SEA-01: teams absent leaves campaign headers and hashes untouched', () => {
  const level = fx.compiledGolden();
  const a = bots.runMatch({ level, seed: 5, maxTicks: 200, record: fx.metadata });
  assert.equal('teams' in a.replay.header, false);
  const b = bots.runMatch({ level, seed: 5, maxTicks: 200 });
  assert.equal(a.stats.finalHash, b.stats.finalHash);
});
