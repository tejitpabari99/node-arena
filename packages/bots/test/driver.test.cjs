const assert = require('node:assert/strict');
const { test, before } = require('node:test');
let api, simApi;
before(async () => {
  api = await import('../dist/index.js');
  simApi = await import('../../sim/dist/index.js');
});

function level(interval = 175, kind = 'utility') {
  return {
    componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'],
    id: 'driver-fixture', timeLimitSec: 100, visual: 'map',
    players: [{ id: 'human', team: 'red', kind: 'human', colorKey: 'red' }, { id: 'bot', team: 'blue', kind: 'bot', colorKey: 'blue' }],
    bots: [{ player: 1, profile: { id: 'test', kind, params: { skill: { decisionIntervalSec: interval, noise: 300, actionsPerDecision: 1 } } } }],
    towers: Array.from({ length: 3 }, (_, i) => ({
      id: `t${i}`, x: i * 20000, y: 0, owner: i === 0 ? 1 : i === 2 ? 0 : -1,
      garrison: 10, archetype: 'tower', visual: 'tower', footprintRadius: 1000,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: 10000 }, drawsLines: { extraSlotAbove: [] }, capturable: {} },
    })),
    kinds: [{ id: 'regular', value: 1, speedMilli: 3000, visual: 'troop' }],
  };
}

function driver(data, seed = 42) {
  assert.equal(typeof api.createBotDriver, 'function', 'public bot driver must exist');
  return api.createBotDriver(data, seed);
}

// Stable command observations expose cadence without relying on a test-only bot factory.
function decisionTicks(data, seed, count) {
  const sim = simApi.create(data, seed), d = driver(data, seed), ticks = [];
  for (let i = 0; i < count; i++) {
    if (d.commands(sim).length) ticks.push(sim.tick);
    sim.step([], { events: false });
  }
  return ticks;
}

test('loaded milli-second cadence floors to ticks and uses the ordered per-seat seed phase', () => {
  // FNV-1a("test") = 0xafd071e5. 175 milli-seconds at 20Hz floors to 3 ticks.
  const seed = simApi.mixSeed(42, 1, 0xafd071e5);
  const phase = new simApi.Sfc32(seed).next() % 3;
  assert.deepEqual(decisionTicks(level(), 42, 12), Array.from({ length: 4 }, (_, i) => phase + i * 3));
});

test('sub-tick interval clamps to one and omitted skill defaults to every tick', () => {
  assert.deepEqual(decisionTicks(level(1), 42, 4), [0, 1, 2, 3]);
  const data = level();
  data.bots[0].profile.params = {};
  assert.deepEqual(decisionTicks(data, 42, 4), [0, 1, 2, 3]);
});

test('idle and empty driver emit no commands', () => {
  assert.deepEqual(decisionTicks(level(1, 'idle'), 42, 10), []);
  const data = level(); data.bots = [];
  assert.deepEqual(decisionTicks(data, 42, 10), []);
});

test('same inputs reproduce complete command logs and final hashes without events', () => {
  function run() {
    const data = level(), sim = simApi.create(data, 42), d = driver(data), log = [];
    for (let i = 0; i < 150 && !sim.view.over; i++) {
      const commands = d.commands(sim);
      log.push([sim.tick, commands]);
      sim.step(commands, { events: false });
    }
    assert.equal(sim.rejected, 0);
    return { log, hash: sim.hash() };
  }
  const first = run();
  assert.ok(first.log.some(([, commands]) => commands.length));
  assert.deepEqual(run(), first);
});

test('driver passes the ordered seat seed to utility noise independently of simulation seed', () => {
  const data = level(1), sim = simApi.create(data, 999), d = driver(data, 42);
  const bot = api.createUtilityBot({ player: 'bot', profile: data.bots[0].profile,
    seed: simApi.mixSeed(42, 1, 0xafd071e5), towerCount: 3 });
  for (let tick = 0; tick < 12; tick++) {
    assert.deepEqual(d.commands(sim), bot.decide(api.guardBotContext(sim), tick));
    sim.step([], { events: false });
  }
});

test('repeated invocation on one tick emits no duplicate commands or noise draws', () => {
  const data = level(1), sim = simApi.create(data, 42), d = driver(data);
  assert.equal(d.commands(sim).length, 1);
  assert.deepEqual(d.commands(sim), []);
  sim.step([], { events: false });
  const cleanSim = simApi.create(data, 42), cleanDriver = driver(data);
  cleanDriver.commands(cleanSim); cleanSim.step([], { events: false });
  assert.deepEqual(d.commands(sim), cleanDriver.commands(cleanSim));
});

test('driver reads only the public clock and guarded visible capabilities', () => {
  const data = level(1), sim = simApi.create(data, 42);
  const allowed = new Set(['tick', 'view', 'canDraw', 'readTroops']);
  const restricted = new Proxy(sim, { get(target, key) {
    if (!allowed.has(key)) throw new Error(`Hidden Sim read: ${String(key)}`);
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  assert.equal(driver(data).commands(restricted).length, 1);
});

test('all compiled bot entries drive their own dense player seats', () => {
  const data = level(1);
  data.players[0].kind = 'bot';
  data.bots.push({ player: 0, profile: { id: 'second', kind: 'utility', params: {} } });
  const sim = simApi.create(data, 42);
  assert.deepEqual(driver(data).commands(sim).map(command => command.player), ['bot', 'human']);
});

test('invalid dense player mappings and duplicate bot seats fail before decisions', () => {
  for (const player of [-1, 2, 1.5]) {
    const data = level(); data.bots[0].player = player;
    assert.throws(() => driver(data), /player/i);
  }
  const duplicate = level(); duplicate.bots.push(duplicate.bots[0]);
  assert.throws(() => driver(duplicate), /player/i);
  const data = level(1), other = level(1); other.players[1].id = 'wrong';
  assert.throws(() => driver(data).commands(simApi.create(other, 42)), /player/i);
});
