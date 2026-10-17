const assert = require('node:assert/strict');
const { test } = require('node:test');
const fc = require('fast-check');
require('tsx/cjs');
const { create, createReplayRecorder, playReplay } = require('../src/index.ts');
const { hashCompiledLevel } = require('../../content/src/hash.ts');

// Each property runs 200 cases for EACH independent stable seed (600/property).
// Seeds and shrunk counterexample paths appear in fast-check failure output.
const SEEDS = [20261008, 730201, 918273];
const RUNS = 200;
const metadata = { rulesVersion: '1.0.0', schemaVersion: '1.0.0', contentVersion: '1.0.0' };
const draw = (player, from, to) => ({ type: 'DrawLine', player, from, to });
const cut = (player, from, to) => ({ type: 'CutLine', player, from, to });
const towerParams = fc.record({
  cap: fc.integer({ min: 1, max: 60 }), count: fc.nat(60), rate: fc.integer({ min: 1, max: 80000 }),
  owner: fc.integer({ min: -1, max: 2 }), kind: fc.integer({ min: 0, max: 1 }),
  thresholds: fc.uniqueArray(fc.nat(50), { maxLength: 3 }).map(a => a.sort((a, b) => a - b)),
  capturable: fc.boolean(), y: fc.integer({ min: -1500, max: 1500 }),
});
const randomCommand = fc.oneof(
  fc.record({ type: fc.constantFrom('DrawLine', 'CutLine'), player: fc.constantFrom('p0', 'p1', 'p2', 'missing'), from: fc.integer({ min: 0, max: 11 }).map(i => `t${String(i).padStart(2, '0')}`), to: fc.integer({ min: 0, max: 11 }).map(i => `t${String(i).padStart(2, '0')}`) }),
  fc.constant(null), fc.constant({ type: 'Unknown' }), fc.constant({ type: 'DrawLine', player: 7 }),
);
const scenario = fc.record({
  params: fc.array(towerParams, { minLength: 7, maxLength: 10 }),
  speeds: fc.tuple(fc.integer({ min: 10000, max: 100000 }), fc.integer({ min: 1000, max: 100000 })),
  allied: fc.boolean(), seed: fc.integer({ min: 0, max: 4294967295 }),
  limit: fc.integer({ min: 3, max: 12 }),
  batches: fc.array(fc.array(randomCommand, { maxLength: 5 }), { minLength: 40, maxLength: 90 }),
  chunks: fc.array(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 20 }),
}).map(input => {
  const towers = input.params.map((p, i) => ({
    id: `t${String(i).padStart(2, '0')}`, x: i * 1000, y: p.y, owner: p.owner,
    garrison: Math.min(p.count, p.cap), archetype: 'property', visual: 'tower.property', footprintRadius: 100,
    components: { garrison: { cap: p.cap }, generates: { troop: p.kind, ratePerSec: p.rate }, drawsLines: { extraSlotAbove: p.thresholds }, ...(p.capturable ? { capturable: {} } : {}) },
  }));
  // Productive prefix: capture an undefended neutral, clash opposite streams,
  // then cut a live stream. Two distant anchors prevent immediate game over.
  for (const [i, owner] of [[0, 0], [1, -1], [2, 0], [3, 1], [4, 0], [5, 1]]) {
    towers[i].owner = owner; towers[i].y = 0;
    towers[i].garrison = i === 1 ? 0 : 30;
    towers[i].components = { garrison: { cap: 60 }, generates: { troop: 0, ratePerSec: 20000 + input.params[i].rate }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} };
  }
  towers[4].x = 100000; towers[5].x = 200000;
  towers[6].owner = -1; towers[6].components = { garrison: { cap: input.params[6].cap } };
  const level = {
    componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'property', timeLimitSec: input.limit,
    visual: 'level.property', bounds: { w: 500000, h: 500000 },
    globals: { timeLimitSec: input.limit, theme: 'theme.property' }, bots: [], botHash: {}, towers,
    players: [0, 1, 2].map(i => ({ id: `p${i}`, kind: i ? 'bot' : 'human', colorKey: `player.${i}`, team: i === 2 && input.allied ? 'team0' : `team${i}` })),
    kinds: input.speeds.map((speedMilli, i) => ({ id: `kind${i}`, value: 1, speedMilli, visual: 'troop.property' })),
  };
  level.simHash = hashCompiledLevel(level);
  const prefix = Array.from({ length: 24 }, () => []);
  prefix[0] = [draw('p0', 't00', 't01'), draw('p0', 't02', 't03'), draw('p1', 't03', 't02'), null];
  prefix[4] = [cut('p0', 't00', 't01')];
  prefix[5] = [draw('p0', 't00', 't06')];
  return { level, seed: input.seed, commands: [...prefix, ...input.batches], chunks: input.chunks };
});
function property(name, check) {
  test(name, () => {
    for (const seed of SEEDS) fc.assert(fc.property(scenario, check), { seed, numRuns: RUNS, includeErrorInReport: true });
  });
}
function troopBuffer(size) {
  return Object.fromEntries(['channel', 'seq', 'owner', 'kind', 'progress'].map(key => [key, new Int32Array(size)]));
}
function recount(sim) {
  const size = sim.readTroops(troopBuffer(0)), out = troopBuffer(size);
  assert.equal(sim.readTroops(out), size);
  const owners = sim.view.players.map(() => 0);
  for (let i = 0; i < size; i++) owners[out.owner[i]] += sim.view.kinds[out.kind[i]].value;
  return owners;
}

// Breaks caught: cap/slot overflow, dropped/duplicated troops, wrong transit owner,
// and lost neutral-defense/noncapturable-arrival accounting. This ledger derives
// generation from pre-step columns and arrivals from events, never kill stats.
property('seeded bounds, slots, independent conservation and transit hold after every step', ({ level, seed, commands }) => {
  const sim = create(level, seed, { debug: true });
  const ledger = { initial: level.towers.reduce((n, t) => n + t.garrison, 0), generated: 0, hits: 0, clashes: 0, overflow: 0 };
  const seen = new Set();
  for (const batch of commands) {
    const before = sim.snapshot(), events = sim.step(batch);
    for (const e of events) seen.add(e.type);
    if (!before.over) {
      const counts = [...before.tower.col['garrison.count']], lines = [...before.tower.lines];
      for (const e of events) {
        if (e.type === 'LineDrawn') lines[e.from]++;
        if (e.type === 'LineCut' && ['player', 'replaced'].includes(e.reason)) lines[Math.floor(e.channel / level.towers.length)]--;
      }
      for (let i = 0; i < counts.length; i++) {
        const params = level.towers[i].components, cap = params.garrison.cap;
        if (!params.generates || before.tower.owner[i] < 0 || (!lines[i] && counts[i] >= cap)) continue;
        const units = Math.floor((before.tower.col['generates.acc'][i] + params.generates.ratePerSec) / 20000);
        ledger.generated += units;
        if (!lines[i]) { const added = Math.min(units, cap - counts[i]); counts[i] += added; ledger.overflow += units - added; }
      }
      for (const e of events) {
        if (e.type === 'Clash') ledger.clashes += e.value;
        if (e.type === 'TroopArrived') {
          if (e.effect === 'reinforce') counts[e.tower]++;
          else if (e.effect === 'overflow') ledger.overflow++;
          else if (counts[e.tower] > 0) { counts[e.tower]--; ledger.hits++; }
          else if (!level.towers[e.tower].components.capturable) ledger.overflow++;
          else counts[e.tower] = 1; // Zero-defense capture keeps the arriving unit.
        }
      }
      assert.deepEqual([...sim.view.tower.col['garrison.count']], counts, 'independent garrison ledger');
    }
    let stored = 0;
    for (let i = 0; i < level.towers.length; i++) {
      const count = sim.view.tower.col['garrison.count'][i];
      assert.ok(count >= 0 && count <= sim.view.tower.col['garrison.cap'][i], `count bound at ${i}`);
      assert.ok(sim.view.tower.lines[i] <= sim.view.tower.slots[i], `slot bound at ${i}`);
      assert.equal(sim.view.tower.lines[i], sim.view.lines.filter(line => line.from === i).length);
      stored += count;
    }
    const transit = recount(sim);
    assert.deepEqual(sim.view.players.map(p => p.transit), transit, 'transit recount');
    // Internal remaining values are checked separately from the public v1 read API.
    const remaining = sim.snapshot().channels.reduce((n, ch) => n + ch.troops.reduce((sum, t) => sum + t.value, 0), 0);
    assert.equal(remaining, transit.reduce((a, b) => a + b, 0));
    assert.equal(ledger.initial + ledger.generated, stored + remaining + 2 * ledger.hits + 2 * ledger.clashes + ledger.overflow, `conservation at tick ${sim.tick}`);
    assert.deepEqual(sim.accounting, ledger, 'independently derived accounting');
  }
  for (const type of ['LineDrawn', 'LineCut', 'TroopSpawned', 'TroopArrived', 'Captured', 'Clash', 'CommandRejected']) assert.ok(seen.has(type), `productive scenario missing ${type}`);
});

// Breaks caught: events affect rule state, nondeterministic iteration, or driver
// chunk boundaries/pause alter outcomes. Compare every tick, not just final hash.
property('seeded duplicate runs and paused/split driver scheduling have identical hashes', ({ level, seed, commands, chunks }) => {
  const visible = create(level, seed), quiet = create(level, seed), split = create(level, seed);
  const hashes = [];
  for (const batch of commands) {
    visible.step(batch); quiet.step(batch, { events: false });
    assert.equal(visible.hash(), quiet.hash());
    assert.equal(visible.rejected, quiet.rejected);
    hashes.push(visible.hash());
  }
  let next = 0, interval = 0;
  while (next < commands.length) {
    const pausedHash = split.hash(); // Driver pause performs no step.
    assert.equal(split.hash(), pausedHash);
    const steps = chunks[interval++ % chunks.length];
    for (let i = 0; i < steps && next < commands.length; i++, next++) {
      split.step(commands[next], { events: interval % 2 === 0 });
      assert.equal(split.hash(), hashes[next], `split submission ${next}`);
    }
  }
  assert.deepEqual(split.snapshot(), visible.snapshot());
});

// Breaks caught: omitted rejects, same-tick reorder, checkpoint drift, or loss of
// finalTick for partial runs. JSON serialization exercises the persisted boundary.
property('seeded replay round-trips random invalid submissions, partial and finished runs', ({ level, seed, commands }) => {
  const recorder = createReplayRecorder(level, seed, metadata), direct = create(level, seed);
  for (let i = 0; i < commands.length; i++) {
    direct.step(commands[i], { events: false }); recorder.step(commands[i], { events: false });
    assert.equal(recorder.hash(), direct.hash());
    if (i === 24 || i === commands.length - 1) {
      const record = JSON.parse(JSON.stringify(recorder.record()));
      const source = i === 24 ? { metadata, level } : { metadata, resolveLevel: id => id === level.id ? level : undefined };
      const replay = playReplay(source, record);
      assert.equal(replay.ok, true);
      assert.equal(replay.sim.tick, direct.tick);
      assert.equal(record.finalTick, direct.tick);
      assert.equal(replay.sim.hash(), direct.hash());
      assert.deepEqual(replay.sim.snapshot(), direct.snapshot());
    }
  }
});
