const assert = require('node:assert/strict');
const { test, before } = require('node:test');
let api, simApi;
before(async () => {
  api = { ...await import('../dist/index.js'), ...await import('@node-arena/bots/harness') };
  simApi = await import('../../sim/dist/index.js');
});
const metadata = { rulesVersion: '1.0.0', schemaVersion: '1.0.0', contentVersion: '1.0.0' };
const idle = { id: 'idle', kind: 'idle', params: {} };
function level() {
  return {
    componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'],
    id: 'harness-fixture', simHash: 'a'.repeat(64), botHash: {}, timeLimitSec: 10, visual: 'map',
    players: [{ id: 'human', team: 'red', kind: 'human', colorKey: 'red' }, { id: 'bot', team: 'blue', kind: 'bot', colorKey: 'blue' }],
    bots: [{ player: 1, profile: idle }],
    towers: [0, 1].map(i => ({
      id: `t${i}`, x: i * 10000, y: 0, owner: i, garrison: i === 0 ? 10 : 0,
      archetype: 'tower', visual: 'tower', footprintRadius: 1000,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: i === 0 ? 20000 : 0 }, drawsLines: { extraSlotAbove: [] }, capturable: {} },
    })),
    kinds: [{ id: 'regular', value: 1, speedMilli: 20000, visual: 'troop' }],
  };
}
function run(options) {
  assert.equal(typeof api.runMatch, 'function', 'public harness must exist');
  return api.runMatch({ level: level(), seed: 42, ...options });
}
const draw = { type: 'DrawLine', player: 'human', from: 't0', to: 't1' };

test('scripted stamped commands win and record a playable replay with no bot on playback', () => {
  const result = run({ controllers: [{ player: 'human', commands: [{ tick: 2, cmd: draw }] }], record: metadata });
  assert.equal(result.outcome.outcome, 'won');
  assert.equal(result.outcome.winnerTeam, 'red');
  assert.equal(result.stats.rejected, 0);
  assert.equal(result.stats.commandCount, 1);
  assert.deepEqual(result.replay.commands, [{ tick: 2, cmd: draw }]);
  assert.equal(result.stats.finalHash, result.replay.finalHash);
  const playback = simApi.playReplay({ level: level(), metadata }, result.replay);
  assert.equal(playback.ok, true);
  assert.equal(playback.sim.rejected, 0);
  assert.equal(playback.sim.hash(), result.stats.finalHash);
  assert.deepEqual(result.stats.players.map(p => p.towers), [2, 0]);
  assert.equal(result.stats.players[0].captures, 1);
  assert.ok(result.stats.players[0].generated > 0);
  assert.ok(result.stats.players[0].overflowLost >= 0);
  assert.equal(result.stats.towers.length, 2);
});

test('idle match reaches configured timeout while safety cap explicitly truncates', () => {
  const natural = run();
  assert.deepEqual(natural.outcome, { outcome: 'timeout', winnerTeam: null });
  assert.equal(natural.ticks, 200);
  assert.equal(natural.replay, null);
  const truncated = run({ maxTicks: 5, record: metadata });
  assert.deepEqual(truncated.outcome, { outcome: 'truncated', winnerTeam: null });
  assert.equal(truncated.ticks, 5);
  assert.equal(truncated.replay.outcome, null);
  assert.equal(simApi.playReplay({ level: level(), metadata }, truncated.replay).ok, true);
  assert.equal(run({ maxTicks: 200 }).outcome.outcome, 'timeout');
});

test('Bot controllers see only guarded player capabilities and run before each tick', () => {
  const seen = [];
  const result = run({ controllers: [{ player: 'human', decide(ctx, tick) {
    assert.deepEqual(Reflect.ownKeys(ctx).sort(), ['canDraw', 'readTroops', 'view']);
    for (const key of ['events', 'snapshot', 'hash', 'rejected', 'step', 'prng']) assert.throws(() => ctx[key], /Forbidden/);
    assert.equal(ctx.view.tick, tick);
    seen.push(tick);
    return tick === 2 ? [draw] : [];
  } }] });
  assert.equal(result.outcome.outcome, 'won');
  assert.deepEqual(seen, Array.from({ length: result.ticks }, (_, tick) => tick));
});

test('profile factory binds human proxy with identical driver cadence and seat seed', () => {
  assert.equal(typeof api.createProfileBot, 'function');
  const data = level();
  const profile = { id: 'reference', kind: 'utility', params: { skill: { decisionIntervalSec: 175, noise: 300, actionsPerDecision: 1 } } };
  const proxy = api.createProfileBot(data, 42, 'human', profile);
  const defaultData = { ...data, bots: [{ player: 0, profile }] };
  const driver = api.createBotDriver(defaultData, 42), sim = simApi.create(data, 42);
  const ticks = [];
  for (let tick = 0; tick < 12; tick++) {
    const commands = proxy.decide(api.guardBotContext(sim), tick);
    assert.deepEqual(commands, driver.commands(sim));
    if (commands.length) ticks.push(tick);
    sim.step([], { events: false });
  }
  assert.equal(ticks.length, 4);
  assert.equal(ticks[1] - ticks[0], 3);
});

test('real utility opponents reproduce full recorded matches and integer final stats', () => {
  const data = level();
  data.towers[1].components.generates.ratePerSec = 10000;
  data.towers[1].garrison = 10;
  const profile = { id: 'reference', kind: 'utility', params: { skill: { decisionIntervalSec: 100, noise: 100, actionsPerDecision: 1 } } };
  data.bots = [{ player: 1, profile }];
  function match() {
    return run({ level: data, controllers: [api.createProfileBot(data, 42, 'human', profile)], record: metadata });
  }
  assert.equal(typeof api.createProfileBot, 'function');
  const first = match();
  assert.deepEqual(match(), first);
  assert.notEqual(first.outcome.outcome, 'truncated');
  assert.equal(first.stats.rejected, 0);
  assert.ok(first.stats.commandCount >= 2);
  for (const p of first.stats.players) for (const key of ['towers', 'garrison', 'transit', 'lines', 'generated', 'overflowLost', 'kills', 'captures']) assert.ok(Number.isSafeInteger(p[key]), key);
  assert.equal(simApi.playReplay({ level: data, metadata }, first.replay).ok, true);
});

test('controller mappings and scripted inputs fail before any decisions', () => {
  let calls = 0;
  const bot = { player: 'human', decide() { calls++; return []; } };
  assert.throws(() => run({ controllers: [bot, bot] }), /duplicate/i);
  assert.throws(() => run({ controllers: [{ ...bot, player: 'unknown' }] }), /player/i);
  assert.throws(() => run({ controllers: [{ player: 'human' }] }), /controller/i);
  assert.throws(() => run({ controllers: [{ player: 'human', commands: [{ tick: -1, cmd: draw }] }] }), /tick/i);
  assert.throws(() => run({ controllers: [{ player: 'human', commands: [{ tick: 2, cmd: draw }, { tick: 1, cmd: draw }] }] }), /tick/i);
  assert.throws(() => run({ controllers: [{ player: 'bot', commands: [{ tick: 1, cmd: draw }] }] }), /player/i);
  assert.throws(() => run({ maxTicks: -1 }), /maxTicks/i);
  assert.equal(calls, 0);
});

test('cross-seat commands and cumulative command rejection fail loudly without events', () => {
  assert.throws(() => run({ controllers: [{ player: 'bot', decide() { return [draw]; } }] }), /player/i);
  assert.throws(() => run({ controllers: [{ player: 'human', commands: [{ tick: 0, cmd: { ...draw, from: 't1' } }] }] }), /rejected.*tick/i);
});

// Sim outcomes retain their player-facing meaning even with tooling controlling all seats.
test('bot-only roster preserves the simulation outcome instead of inventing a win', () => {
  const data = level();
  data.players[0].kind = 'bot';
  data.bots.push({ player: 0, profile: idle });
  const result = run({ level: data, record: metadata });
  assert.deepEqual(result.outcome, { outcome: 'lost', winnerTeam: null });
  assert.equal(result.ticks, 1);
  assert.equal(simApi.playReplay({ level: data, metadata }, result.replay).ok, true);
});
