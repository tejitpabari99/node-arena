const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const bots = require('../src/index.ts');
const sim = require('../../sim/src/index.ts');
const { pvpLevel, fx } = require('./pvp-fixture.cjs');

const outcomeOnly = ({ outcome, winner, winners }) => ({ outcome, winner, ...(winners ? { winners } : {}) });
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
  assert.deepEqual(v.sim.view.over.ranking, r.outcome.ranking);
  assert.deepEqual(r.replay.outcome.ranking, r.outcome.ranking);
  assert.equal(r.replay.finalHash, r.stats.finalHash);
  return r;
}

test('covers R-WIN-04: 1v1 scripted capture is victory for the attacker', () => {
  const r = play({ owners: [0, 1], teams: [0, 1], levels: [30, 2], script: { 0: [dl(0, 0, 1)] } });
  assert.deepEqual(outcomeOnly(r.outcome), { outcome: 'victory', winner: 0, winners: [0] });
});

test('covers R-WIN-04: 4-seat FFA last seat standing wins alone', () => {
  const r = play({ owners: [0, 1, 2, 3], teams: [0, 1, 2, 3], levels: [40, 2, 2, 2], limit: 120, script: { 0: [dl(0, 0, 1), dl(0, 0, 2), dl(0, 0, 3)] } });
  assert.deepEqual(outcomeOnly(r.outcome), { outcome: 'victory', winner: 0, winners: [0] });
});

test('covers R-TEM-01, R-WIN-04: 2v2 victory lists both allied seats', () => {
  const r = play({ owners: [0, 1, 2, 3], teams: [0, 0, 1, 1], levels: [40, 40, 2, 2], limit: 120, script: { 0: [dl(0, 0, 2)], 1: [dl(1, 1, 3)] } });
  assert.deepEqual(outcomeOnly(r.outcome), { outcome: 'victory', winner: 0, winners: [0, 1] });
});

test('covers R-WIN-04: 3v1 victory lists all three allied seats', () => {
  const r = play({ owners: [0, 1, 2, 3], teams: [0, 0, 0, 1], levels: [40, 40, 40, 2], limit: 120, script: { 0: [dl(0, 0, 3)], 1: [dl(1, 1, 3)] } });
  assert.deepEqual(outcomeOnly(r.outcome), { outcome: 'victory', winner: 0, winners: [0, 1, 2] });
});

test('covers R-WIN-05, R-WIN-07: timeout ranks by troops when buildings tie', () => {
  const r = play({ owners: [0, 1], teams: [0, 1], levels: [30, 2], limit: 5 });
  assert.equal(r.outcome.outcome, 'timeLimit');
  assert.deepEqual(r.outcome.winners, [0]);
  assert.equal(r.ticks, 100);
  assert.deepEqual(r.outcome.ranking, [
    { team: 0, seats: [0], rank: 1, buildings: 1, troops: 32, eliminatedAt: null },
    { team: 1, seats: [1], rank: 2, buildings: 1, troops: 3, eliminatedAt: null },
  ]);
  assert.equal(r.stats.finalHash, '889edd608b5f8afc'); // Captured before ranking metadata was added.
});

test('covers R-WIN-06, R-WIN-07: exact timeout tie is a draw with the tied top seats', () => {
  const two = play({ owners: [0, 1], teams: [0, 1], levels: [10, 10], limit: 5 });
  assert.deepEqual(outcomeOnly(two.outcome), { outcome: 'draw', winner: null, winners: [0, 1] });
  const three = play({ owners: [0, 1, 2], teams: [0, 1, 2], levels: [10, 10, 2], limit: 5 });
  assert.deepEqual(outcomeOnly(three.outcome), { outcome: 'draw', winner: null, winners: [0, 1] });
  assert.deepEqual(three.outcome.ranking, [
    { team: 0, seats: [0], rank: 1, buildings: 1, troops: 11, eliminatedAt: null },
    { team: 1, seats: [1], rank: 1, buildings: 1, troops: 11, eliminatedAt: null },
    { team: 2, seats: [2], rank: 3, buildings: 1, troops: 3, eliminatedAt: null },
  ]);
  assert.equal(three.stats.finalHash, 'a9ea8f2441e2d49d'); // Pre-ranking hash.
});

test('covers R-SEA-01: teams absent leaves campaign headers and hashes untouched', () => {
  const level = fx.compiledGolden();
  const a = bots.runMatch({ level, seed: 5, maxTicks: 200, record: fx.metadata });
  assert.equal('teams' in a.replay.header, false);
  const b = bots.runMatch({ level, seed: 5, maxTicks: 200 });
  assert.equal(a.stats.finalHash, b.stats.finalHash);
});

test('covers R-WIN-07: scripted FFA placements preserve staggered elimination order and pre-ranking hash', () => {
  const r = play({ owners: [0, 1, 2, 3], teams: [0, 1, 2, 3], levels: [40, 2, 2, 2], limit: 120,
    script: { 0: [dl(0, 0, 1), { ...dl(0, 0, 2), tick: 100 }, { ...dl(0, 0, 3), tick: 200 }] } });
  assert.deepEqual(r.outcome.ranking, [
    { team: 0, seats: [0], rank: 1, buildings: 4, troops: 73, eliminatedAt: null },
    { team: 3, seats: [3], rank: 2, buildings: 0, troops: 0, eliminatedAt: 438 },
    { team: 2, seats: [2], rank: 3, buildings: 0, troops: 0, eliminatedAt: 254 },
    { team: 1, seats: [1], rank: 4, buildings: 0, troops: 0, eliminatedAt: 104 },
  ]);
  assert.equal(r.stats.finalHash, '51485a36ced93989'); // Pre-ranking hash.
});

test('covers R10: seat driver presets, determinism, set/clear, player check', () => {
  const bots = require('../src/index.ts');
  const sim = require('../../sim/src/index.ts');
  const { pvpLevel } = require('./pvp-fixture.cjs');
  assert.deepEqual(['easy', 'normal', 'hard'].map(k => bots.BOT_PRESETS[k].actionDelayMs), [3000, 1500, 700]);
  for (const k of ['easy', 'normal', 'hard']) {
    assert.equal(bots.BOT_PRESETS[k].behavior, 'full');
    assert.equal(bots.BOT_PRESETS[k].script.length, 0);
  }
  const level = pvpLevel([0, 1, -1, -1], [0, 1]);
  const run = () => {
    const s = sim.create(level, 11);
    const d = bots.createSeatDriver(level, 11);
    assert.equal(d.has(1), false);
    d.setBot(1, bots.BOT_PRESETS.hard);
    assert.equal(d.has(1), true);
    assert.equal(d.has(0), false);
    const log = [];
    for (let t = 0; t < 400; t++) {
      const c = d.commands(s);
      assert.deepEqual(d.commands(s), []);
      for (const x of c) assert.equal(x.player, 1);
      log.push(c);
      s.step(c);
    }
    d.setBot(1, null);
    assert.equal(d.has(1), false);
    assert.deepEqual(d.commands(s), []);
    s.step([]);
    assert.deepEqual(d.commands(s), []);
    assert.throws(() => d.setBot(9, bots.BOT_PRESETS.easy), RangeError);
    return JSON.stringify(log);
  };
  const a = run();
  assert.equal(a, run());
  assert.ok(a.includes('"player":1'));
});
