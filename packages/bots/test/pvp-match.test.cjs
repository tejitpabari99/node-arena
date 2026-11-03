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
  assert.deepEqual(['easy', 'normal', 'hard'].map(k => bots.BOT_PRESETS[k].actionDelayMs), [3000, 1500, 1000]);
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

// --- n < N (R-SEA-01) on the real Cross map ---
const crossLevel = () => require('../../sim/test/fixtures.cjs').content.loadContent(require('../../sim/test/fixtures.cjs').dataFiles()).compiled['na-pvp-cross'];

test('covers R-SEA-01: seat driver on forSeats(cross, 3) targets neutral homes, never indexes seat 3, is deterministic', () => {
  const bots = require('../src/index.ts');
  const sim = require('../../sim/src/index.ts');
  const cross = crossLevel();
  const deadHomes = new Set(cross.buildings.map((b, i) => (b.owner === 3 ? i : -1)).filter((i) => i >= 0));
  assert.ok(deadHomes.size > 0);
  const run = () => {
    const level = sim.forSeats(cross, 3);
    const s = sim.create(cross, 21, { teams: [0, 1, 2] });
    const d = bots.createSeatDriver(level, 21);
    for (const seat of [0, 1, 2]) d.setBot(seat, bots.BOT_PRESETS.hard);
    assert.throws(() => d.setBot(3, bots.BOT_PRESETS.hard), RangeError);
    assert.equal(d.has(3), false);
    const log = [];
    for (let t = 0; t < 1500 && !s.view.over; t++) {
      const cmds = d.commands(s);
      for (const c of cmds) assert.ok(c.player >= 0 && c.player <= 2, `player ${c.player}`);
      log.push(cmds);
      s.step(cmds);
    }
    assert.equal(s.view.players.length, 3);
    assert.equal(s.rejected, 0);
    return { log, hash: s.hash() };
  };
  const a = run(), b = run();
  assert.equal(JSON.stringify(a.log), JSON.stringify(b.log));
  assert.equal(a.hash, b.hash);
  const draws = a.log.flat().filter((c) => c.type === 'DrawLine');
  assert.ok(draws.length > 0);
  assert.ok(draws.some((c) => deadHomes.has(c.to)), 'a bot targets a neutral dead-slot home');
});

test('covers R-SEA-01: harness teams shorter than the level reduce via forSeats (controller range follows seats)', () => {
  const bots = require('../src/index.ts');
  const cross = crossLevel();
  const r = bots.runMatch({ level: cross, seed: 5, teams: [0, 1], maxTicks: 40 });
  assert.equal(r.stats.players.length, 2);
  assert.equal(r.ticks, 40);
  const noop = (player) => ({ player, decide: () => [] });
  assert.doesNotThrow(() => bots.runMatch({ level: cross, seed: 5, teams: [0, 1], maxTicks: 5, controllers: [noop(1)] }));
  assert.throws(() => bots.runMatch({ level: cross, seed: 5, teams: [0, 1], maxTicks: 5, controllers: [noop(2)] }), RangeError);
  assert.doesNotThrow(() => bots.runMatch({ level: cross, seed: 5, teams: [0, 1, 0, 1], maxTicks: 5, controllers: [noop(3)] }));
  const again = bots.runMatch({ level: cross, seed: 5, teams: [0, 1], maxTicks: 40 });
  assert.equal(again.stats.finalHash, r.stats.finalHash);
});

test('covers R-SEA-01: pvp target shuffle is deterministic per seat stream; different seat streams differ', () => {
  const bots = require('../src/index.ts');
  const sim = require('../../sim/src/index.ts');
  const { createStreams } = sim;
  const view = {
    over: null, players: [{ team: 0 }, { team: 1 }],
    ids: { buildings: ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6'], players: ['p0', 'p1'], elements: [] },
    buildings: { owner: [0, 1, -1, -1, -1, -1, -1], level: [5, 5, 3, 3, 3, 3, 3], lines: [0, 0, 0, 0, 0, 0, 0] },
    buildingStatic: [[0, 0], [9000, 0], [1000, 0], [0, 1000], [-1000, 0], [0, -1000], [700, 700]].map(([x, z]) => ({ x, z, special: false, drawsLines: true })),
    lines: [], freeSlots: () => 2,
  };
  const order = (seed, seat) => {
    const rng = createStreams(seed).fork('bot.tw', seat);
    return bots.sortedTargets(view, 0, true, rng).join(',');
  };
  assert.equal(order(7, 0), order(7, 0));
  assert.equal(order(7, 1), order(7, 1));
  const distinct = new Set();
  for (let seat = 0; seat < 8; seat++) distinct.add(order(7, seat));
  assert.ok(distinct.size > 1, 'seat streams give different tie orders');
  const bySeed = new Set();
  for (let seed = 1; seed <= 8; seed++) bySeed.add(order(seed, 0));
  assert.ok(bySeed.size > 1, 'match seeds give different tie orders');
});

test('covers R-SEA-01: pvp phase is 0 when actionDelayMs is below one tick (no rng draw, no throw)', () => {
  const bots = require('../src/index.ts');
  const sim = require('../../sim/src/index.ts');
  const pvp = require('./pvp-fixture.cjs').pvpLevel([0, 1, -1], [0, 1]);
  const first = (seed, seat, actionDelayMs) => {
    const bot = bots.createSeatBot(pvp, seed, seat, { kind: 'tw', actionDelayMs, behavior: 'attackOnly', script: [] });
    const game = sim.create(pvp, 1);
    for (let t = 0; t < 10; t++) if (bot.decide({ view: game.view, canDraw: (p, f, to) => game.canDraw(p, f, to) }, t).length) return t;
    return -1;
  };
  const seen = new Set();
  for (let seed = 1; seed <= 10; seed++) for (const seat of [0, 1]) seen.add(first(seed, seat, 49));
  assert.equal(seen.size, 1, `identical start for every seed/seat, got ${[...seen]}`);
  assert.ok([...seen][0] >= 0);
  for (let seed = 1; seed <= 3; seed++) assert.doesNotThrow(() => first(seed, 0, 0));
  assert.equal(first(1, 0, 49), first(2, 1, 1));
});
