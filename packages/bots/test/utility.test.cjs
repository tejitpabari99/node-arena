const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('tsx/cjs');
let api;
before(async () => { api = await import('../dist/index.js'); });
function fixture(owners = [0, -1, 1], options = {}) {
  const n = owners.length;
  const column = values => Int32Array.from(values);
  const view = {
    tick: 0, over: null, timeLimitTicks: 2000,
    ids: { towers: Array.from({ length: n }, (_, i) => `t${i}`), players: ['p0', 'p1', 'p2'] },
    players: ['red', 'blue', 'red'].map(team => ({ team, kind: 'bot', colorKey: team, alive: 1, transit: 0, stats: { generated: 0, overflowLost: 0, kills: 0, captures: 0 } })),
    tower: { owner: column(owners), team: column(owners.map(i => i === -1 ? -1 : i === 1 ? 1 : 0)), slots: column(Array(n).fill(1)), lines: column(Array(n).fill(0)), col: {
      'garrison.count': column(Array(n).fill(10)), 'garrison.cap': column(Array(n).fill(50)),
      'generates.ratePerSec': column(Array(n).fill(10000)), 'generates.troop': column(Array(n).fill(0)),
    } },
    towerStatic: Array.from({ length: n }, (_, i) => ({ x: i * 10000, y: 0, archetype: 'tower', visual: 'tower', footprintRadius: 1000, components: ['garrison', 'generates', 'drawsLines', 'capturable'] })),
    lines: [], kinds: [{ value: 1, speedPerTick: 1000, visual: 'troop' }],
  };
  const troops = options.troops ?? [];
  const ctx = api.guardBotContext({ view, canDraw(player, from, to) {
    const s = view.ids.towers.indexOf(from), t = view.ids.towers.indexOf(to);
    if (view.over) return 'gameover';
    if (player !== 'p0' || view.tower.owner[s] !== 0) return 'not-owner';
    if (s === t) return 'self';
    if (view.tower.lines[s] >= view.tower.slots[s]) return 'no-slot';
    if (view.lines.some(l => l.from === s && l.to === t)) return 'duplicate';
    return options.reject?.(s, t) ?? null;
  }, readTroops(out) { troops.forEach((troop, i) => { if (i < out.seq.length) for (const key of Object.keys(out)) out[key][i] = troop[key] ?? 0; }); return troops.length; } });
  return { view, ctx };
}
function bot(n, params = {}, seed = 1) {
  assert.equal(typeof api.createUtilityBot, 'function', 'utility engine must exist');
  return api.createUtilityBot({ player: 'p0', profile: { id: 'test', kind: 'utility', params }, seed, towerCount: n });
}
const attack = { weights: { attack: { distance: 1000 }, reinforce: {}, cut: {} }, bias: { attack: 1000 }, holdThreshold: 0 };

test('attacks closest non-friendly target and ignores allied other owners', () => {
  const { ctx } = fixture([0, 2, -1, 1]);
  assert.deepEqual(bot(4, { ...attack, maxTargetsPerSource: 1 }).decide(ctx, 0), [{ type: 'DrawLine', player: 'p0', from: 't0', to: 't2' }]);
});
test('minimal valid profile has deterministic useful defaults and zero-noise seed invariance', () => {
  const { ctx } = fixture();
  assert.deepEqual(bot(3).decide(ctx, 0), [{ type: 'DrawLine', player: 'p0', from: 't0', to: 't1' }]);
  assert.deepEqual(bot(3, {}, 99).decide(ctx, 0), bot(3, {}, 3).decide(ctx, 0));
});
test('strict hold threshold prevents action at equality and when maps have no weights', () => {
  const { ctx } = fixture([0, -1]);
  assert.deepEqual(bot(2, { weights: { attack: { targetValue: 10000 } }, bias: { attack: 10000 }, holdThreshold: 1000 }).decide(ctx, 0).length, 1);
  assert.deepEqual(bot(2, { weights: { attack: { targetValue: 1000 } }, holdThreshold: 1000 }).decide(ctx, 0), []);
  assert.deepEqual(bot(2, { weights: { attack: {}, reinforce: {}, cut: {} } }).decide(ctx, 0), []);
});
test('source and target indices break equal scores, with newly used slots limiting a batch', () => {
  const { view, ctx } = fixture([0, 0, -1, -1]);
  view.tower.slots.fill(1);
  const commands = bot(4, { weights: { attack: { targetValue: 1000 }, reinforce: {}, cut: {} }, skill: { actionsPerDecision: 4, noise: 0, decisionIntervalSec: 1000 } }).decide(ctx, 0);
  assert.deepEqual(commands.map(c => [c.from, c.to]), [['t0', 't2'], ['t1', 't2']]);
});
test('attack entrants skip authoritative canDraw rejection', () => {
  const { ctx } = fixture([0, -1, -1], { reject: (_s, t) => t === 1 ? 'no-component' : null });
  assert.deepEqual(bot(3, { weights: { attack: { targetValue: 1000 } } }).decide(ctx, 0).map(c => c.to), ['t2']);
});
test('cuts only own existing friendly lines and does not draw a paired reverse in same batch', () => {
  const { view, ctx } = fixture([0, 0, 1]);
  view.lines.push({ channel: 1, from: 0, to: 1, owner: 0, length: 10000, drawSeq: 1 }, { channel: 7, from: 2, to: 1, owner: 1, length: 10000, drawSeq: 2 });
  view.tower.lines[0] = 1;
  const commands = bot(3, { weights: { attack: {}, reinforce: { targetValue: 1000 }, cut: { lineUseless: 1000 } }, skill: { actionsPerDecision: 5, noise: 0, decisionIntervalSec: 1000 } }).decide(ctx, 0);
  assert.deepEqual(commands, [{ type: 'CutLine', player: 'p0', from: 't0', to: 't1' }]);
});
test('reinforces own threatened tower while safe targets and allied other owners score no threat', () => {
  const { view, ctx } = fixture([0, 0, 1, 2]);
  view.lines.push({ channel: 9, from: 2, to: 1, owner: 1, length: 10000, drawSeq: 1 });
  view.tower.lines[2] = 1;
  assert.deepEqual(bot(4, { weights: { attack: {}, reinforce: { threatToTarget: 1000 }, cut: {} } }).decide(ctx, 0), [{ type: 'DrawLine', player: 'p0', from: 't0', to: 't1' }]);
});
test('all considerations return bounded integers; capture feasibility models generation and remaining time', () => {
  const { view, ctx } = fixture([0, -1, 1]);
  assert.equal(typeof api.createUtilityScorer, 'function');
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params: {}, seed: 1 });
  scorer.prepare(ctx, 0);
  for (const id of api.CONSIDERATION_IDS) {
    const value = scorer.consideration(id, 'attack', 0, 1);
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 1000, `${id}: ${value}`);
  }
  const timely = scorer.consideration('timeToTake', 'attack', 0, 1);
  view.timeLimitTicks = 1;
  scorer.prepare(ctx, 0);
  assert.equal(scorer.consideration('timeToTake', 'attack', 0, 1), 0);
  view.timeLimitTicks = 2000;
  view.tower.col['garrison.count'][0] = 2000000000;
  view.tower.col['generates.ratePerSec'][0] = 0;
  scorer.prepare(ctx, 0);
  assert.equal(scorer.consideration('timeToTake', 'attack', 0, 1), 0);
  assert.ok(timely > 0);
});
test('source danger lowers source safety; in-flight troops on a cut line still count', () => {
  const { view, ctx } = fixture([0, -1, 1], { troops: [{ channel: 6, owner: 1, kind: 0, progress: 19000, seq: 1 }] });
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params: {}, seed: 1 });
  scorer.prepare(ctx, 0);
  assert.ok(scorer.consideration('threatToSource', 'attack', 0, 1) < 1000);
  assert.equal(scorer.consideration('threatToTarget', 'reinforce', 0, 1), 0);
});
test('adding shoots extractor changes targetValue without modifying the consideration', () => {
  const { view, ctx } = fixture([0, -1, -1]);
  view.towerStatic[2].components.push('shoots');
  view.tower.col['shoots.damage'] = Int32Array.from([0, 0, 40]);
  const extractors = api.createComponentExtractors();
  extractors.register('shoots', (v, tower) => v.tower.col['shoots.damage'][tower]);
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params: { componentValue: { shoots: 1000 } }, seed: 1, extractors });
  scorer.prepare(ctx, 0);
  assert.equal(scorer.consideration('targetValue', 'attack', 0, 1), 0);
  assert.equal(scorer.consideration('targetValue', 'attack', 0, 2), 1000);
});
test('integer weighted normalization precedes bias and additive seeded noise is reproducible', () => {
  const { ctx } = fixture([0, -1]);
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 2, params: { weights: { attack: { targetValue: 10000 } }, bias: { attack: 10000 } }, seed: 1 });
  scorer.prepare(ctx, 0);
  assert.equal(scorer.score('attack', 0, 1), 10000);
  const noisy = seed => { const s = api.createUtilityScorer({ player: 'p0', towerCount: 2, params: { skill: { noise: 1000, actionsPerDecision: 1, decisionIntervalSec: 1000 } }, seed }); s.prepare(ctx, 0); return Array.from({ length: 20 }, () => s.score('attack', 0, 1)); };
  assert.deepEqual(noisy(1), noisy(1));
  assert.notDeepEqual(noisy(1), noisy(2));
  assert.ok(noisy(1).every(score => score >= 0 && score <= 2000));
});
test('stickiness discourages reversing a just-cut pair within cooldown', () => {
  const { view, ctx } = fixture([0, 0]);
  view.lines.push({ channel: 1, from: 0, to: 1, owner: 0, length: 10000, drawSeq: 1 });
  view.tower.lines[0] = 1;
  const b = bot(2, { holdThreshold: 999, cooldownSec: 10000, weights: { attack: {}, cut: { lineUseless: 1000 }, reinforce: { stickiness: 1000 } } });
  assert.equal(b.decide(ctx, 0)[0].type, 'CutLine');
  view.lines.length = 0; view.tower.lines[0] = 0;
  assert.deepEqual(b.decide(ctx, 1), []);
  assert.equal(b.decide(ctx, 201).length, 1);
});
test('registry rejects missing, extra, and duplicate IDs at startup', () => {
  assert.equal(typeof api.assertConsiderationParity, 'function');
  const { BOT_CONSIDERATIONS } = require('../../content/src/bot-params.ts');
  api.assertConsiderationParity(BOT_CONSIDERATIONS);
  assert.throws(() => api.assertConsiderationParity(BOT_CONSIDERATIONS.slice(1)), /parity/);
  assert.throws(() => api.assertConsiderationParity([...BOT_CONSIDERATIONS, 'extra']), /parity/);
  assert.throws(() => api.assertConsiderationParity([...BOT_CONSIDERATIONS.slice(1), BOT_CONSIDERATIONS[1]]), /parity/);
});

test('reversing a previous draw direction incurs stickiness even though both actions are draws', () => {
  const { ctx } = fixture([0, 0]);
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 2, params: { cooldownSec: 10000 }, seed: 1 });
  scorer.prepare(ctx, 0);
  scorer.record('reinforce', 0, 1, 0);
  scorer.prepare(ctx, 1);
  assert.equal(scorer.consideration('stickiness', 'reinforce', 0, 1), 1000);
  assert.equal(scorer.consideration('stickiness', 'reinforce', 1, 0), 5);
});

test('real simulation accepts a batch without overslots or a replaced-line cut rejection', async () => {
  const { create } = await import('../../sim/dist/index.js');
  const level = { componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'utility-batch', timeLimitSec: 100, bots: [], visual: 'map',
    players: [{ id: 'p0', team: 'red', kind: 'bot', colorKey: 'red' }, { id: 'p1', team: 'blue', kind: 'human', colorKey: 'blue' }],
    towers: Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, x: i * 10000, y: 0, owner: i < 2 ? 0 : i === 2 ? -1 : 1, garrison: 31, archetype: 'tower', visual: 'tower', footprintRadius: 1000,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: 20000 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } })),
    kinds: [{ id: 'regular', value: 1, speedMilli: 3000, visual: 'troop' }],
  };
  const sim = create(level, 42);
  sim.step([{ type: 'DrawLine', player: 'p0', from: 't0', to: 't1' }]);
  const ctx = api.guardBotContext(sim);
  const b = bot(4, { weights: { attack: { targetValue: 1000 }, reinforce: { targetValue: 1000 }, cut: { lineUseless: 1000 } }, skill: { actionsPerDecision: 10, decisionIntervalSec: 1000, noise: 0 } });
  const commands = b.decide(ctx, sim.tick);
  assert.ok(commands.length > 1);
  for (const command of commands) if (command.type === 'DrawLine') assert.equal(ctx.canDraw(command.player, command.from, command.to), null);
  sim.step(commands);
  assert.equal(sim.rejected, 0);
  for (let i = 0; i < 4; i++) assert.ok(sim.view.tower.lines[i] <= sim.view.tower.slots[i]);
});

test('every consideration remains bounded at supported count, weight and flow limits', () => {
  const { view, ctx } = fixture([0, 1, 1]);
  for (const key of ['garrison.count', 'garrison.cap', 'generates.ratePerSec']) view.tower.col[key].fill(2147483647);
  view.lines.push({ channel: 3, from: 1, to: 0, owner: 1, length: 10000, drawSeq: 1 }, { channel: 6, from: 2, to: 0, owner: 1, length: 20000, drawSeq: 2 });
  view.tower.lines[1] = 1; view.tower.lines[2] = 1;
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params: { weights: { attack: Object.fromEntries(api.CONSIDERATION_IDS.map(id => [id, 10000])) }, bias: { attack: 10000 }, componentValue: { generates: 10000, garrison: 10000 } }, seed: 1 });
  scorer.prepare(ctx, 0);
  for (const action of ['attack', 'reinforce', 'cut']) for (const id of api.CONSIDERATION_IDS) {
    const value = scorer.consideration(id, action, 0, 1);
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 1000, `${action}/${id}: ${value}`);
  }
  assert.ok(Number.isInteger(scorer.score('attack', 0, 1)));
});

test('valid structural component weights contribute target value instead of throwing', () => {
  const { view, ctx } = fixture([0, -1, -1]);
  view.towerStatic[1].components = ['garrison', 'generates'];
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params: { componentValue: { capturable: 1000, drawsLines: 1000 } }, seed: 1 });
  scorer.prepare(ctx, 0);
  assert.equal(scorer.consideration('targetValue', 'attack', 0, 1), 0);
  assert.equal(scorer.consideration('targetValue', 'attack', 0, 2), 1000);
});

// Exact tiny-view expectations catch incorrect normalization, team counting or slice arithmetic.
test('distance, weakness, dominance, sliceCost and targetValue have independent exact units', () => {
  const { view, ctx } = fixture([0, 1, 1]);
  view.tower.col['garrison.count'][1] = 25;
  view.tower.col['garrison.cap'][1] = 25;
  view.tower.col['generates.ratePerSec'][1] = 5000;
  view.tower.lines[0] = 1;
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params: {}, seed: 1 });
  scorer.prepare(ctx, 0);
  assert.equal(scorer.consideration('distance', 'attack', 0, 1), 500);
  assert.equal(scorer.consideration('distance', 'attack', 0, 2), 0);
  assert.equal(scorer.consideration('targetWeakness', 'attack', 0, 1), 0);
  assert.equal(scorer.consideration('ownerDominance', 'attack', 0, 1), 666);
  assert.equal(scorer.consideration('ownerDominance', 'attack', 0, 0), 333);
  assert.equal(scorer.consideration('sliceCost', 'attack', 0, 1), 500);
  assert.equal(scorer.consideration('targetValue', 'attack', 0, 1), 500);
  view.tower.col['garrison.count'][1] = 0;
  scorer.prepare(ctx, 1);
  assert.equal(scorer.consideration('targetWeakness', 'attack', 0, 1), 1000);
});

test('timeToTake decreases with defense and travel, increases with allied incoming flow', () => {
  const { view, ctx } = fixture([0, -1, 0, 1]);
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 4, params: {}, seed: 1 });
  const take = () => { scorer.prepare(ctx, 0); return scorer.consideration('timeToTake', 'attack', 0, 1); };
  const baseline = take();
  view.tower.col['garrison.count'][1] = 100;
  assert.ok(take() < baseline);
  view.tower.col['garrison.count'][1] = 10;
  view.towerStatic = view.towerStatic.map((tower, i) => i === 1 ? { ...tower, x: 20000 } : tower);
  assert.ok(take() < baseline);
  view.towerStatic = view.towerStatic.map((tower, i) => i === 1 ? { ...tower, x: 10000 } : tower);
  view.lines.push({ channel: 9, from: 2, to: 1, owner: 0, length: 10000, drawSeq: 1 });
  view.tower.lines[2] = 1;
  assert.ok(take() > baseline);
});

test('threat units distinguish hostile, allied and neutral flows and invert for cuts', () => {
  const { view, ctx } = fixture([0, 0, 1, 2]);
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 4, params: {}, seed: 1 });
  scorer.prepare(ctx, 0);
  assert.equal(scorer.consideration('threatToTarget', 'reinforce', 0, 1), 0);
  assert.equal(scorer.consideration('threatToSource', 'attack', 1, 0), 1000);
  view.lines.push({ channel: 9, from: 2, to: 1, owner: 1, length: 10000, drawSeq: 1 });
  view.tower.lines[2] = 1;
  scorer.prepare(ctx, 0);
  const danger = scorer.consideration('threatToTarget', 'reinforce', 0, 1);
  assert.ok(danger > 0);
  assert.equal(scorer.consideration('threatToSource', 'cut', 1, 0), danger);
  assert.equal(scorer.consideration('threatToSource', 'attack', 1, 0), 1000 - danger);
  view.lines.push({ channel: 13, from: 3, to: 1, owner: 2, length: 20000, drawSeq: 2 });
  view.tower.lines[3] = 1;
  scorer.prepare(ctx, 0);
  assert.ok(scorer.consideration('threatToTarget', 'reinforce', 0, 1) < danger);
});

test('lineUseless distinguishes useful attack flow from redundant allied flow and captured target', () => {
  const { view, ctx } = fixture([0, -1, 0]);
  view.lines.push({ channel: 1, from: 0, to: 1, owner: 0, length: 10000, drawSeq: 1 });
  view.tower.lines[0] = 1;
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params: {}, seed: 1 });
  scorer.prepare(ctx, 0);
  assert.equal(scorer.consideration('lineUseless', 'cut', 0, 1), 0);
  view.lines.push({ channel: 7, from: 2, to: 1, owner: 0, length: 10000, drawSeq: 2 });
  view.tower.lines[2] = 1;
  scorer.prepare(ctx, 0);
  assert.ok(scorer.consideration('lineUseless', 'cut', 0, 1) > 900);
  view.tower.owner[1] = 0;
  scorer.prepare(ctx, 1);
  assert.equal(scorer.consideration('lineUseless', 'cut', 0, 1), 1000);
});

test('safe own towers never receive threat-only reinforcement, while idle and hold emit nothing', () => {
  const { ctx } = fixture([0, 0, 1]);
  assert.deepEqual(bot(3, { weights: { attack: {}, reinforce: { threatToTarget: 1000 }, cut: {} } }).decide(ctx, 0), []);
  assert.deepEqual(bot(3, { holdThreshold: 1000 }).decide(ctx, 0), []);
});

test('zero noise preserves per-decision choices across seeds; positive noise changes actual choices', () => {
  const { ctx } = fixture([0, -1, -1, -1]);
  const decisions = (seed, noise) => {
    const b = bot(4, { weights: { attack: { targetValue: 1000 } }, skill: { noise, actionsPerDecision: 1, decisionIntervalSec: 1000 } }, seed);
    return Array.from({ length: 20 }, (_, tick) => b.decide(ctx, tick));
  };
  const seeds = [1, 2, 3, 42, 99];
  for (const seed of seeds) assert.deepEqual(decisions(seed, 0), decisions(1, 0));
  assert.deepEqual(decisions(42, 500), decisions(42, 500));
  assert.ok(new Set(seeds.map(seed => JSON.stringify(decisions(seed, 500)))).size > 1);
  assert.ok(new Set(decisions(42, 500).map(commands => commands[0].to)).size > 1);
});

test('pair geometry is cached between decisions and refreshes for a replacement public tower array', () => {
  const { view, ctx } = fixture([0, -1, 1]);
  let reads = 0;
  const decorate = towers => towers.map(tower => {
    const copy = { ...tower };
    Object.defineProperty(copy, 'x', { get() { reads++; return tower.x; } });
    Object.defineProperty(copy, 'y', { get() { reads++; return tower.y; } });
    return copy;
  });
  view.towerStatic = decorate(view.towerStatic);
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params: {}, seed: 1 });
  scorer.prepare(ctx, 0);
  const initial = scorer.consideration('timeToTake', 'attack', 0, 1);
  const before = reads;
  for (let i = 0; i < 20; i++) scorer.consideration('timeToTake', 'attack', 0, 1);
  assert.equal(reads, before, 'scoring must reuse cached geometry');
  const baseline = scorer.consideration('distance', 'attack', 0, 1);
  view.towerStatic = decorate(view.towerStatic.map((tower, i) => ({ ...tower, x: i === 1 ? 19000 : tower.x })));
  scorer.prepare(ctx, 0);
  assert.ok(scorer.consideration('timeToTake', 'attack', 0, 1) < initial);
  assert.ok(scorer.consideration('distance', 'attack', 0, 1) < baseline);
});

test('lineUseless excludes the candidate own pipeline but preserves another source pipeline', () => {
  const troops = [{ channel: 1, owner: 0, kind: 0, progress: 199000, seq: 1 }];
  const { view, ctx } = fixture([0, -1, 0], { troops });
  view.lines.push({ channel: 1, from: 0, to: 1, owner: 0, length: 200000, drawSeq: 1 });
  view.tower.lines[0] = 1;
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params: {}, seed: 1 });
  scorer.prepare(ctx, 0);
  assert.equal(scorer.consideration('lineUseless', 'cut', 0, 1), 0, 'own current line and own near-arrival troop cannot make their line redundant');
  troops.push({ channel: 7, owner: 0, kind: 0, progress: 199000, seq: 2 });
  scorer.prepare(ctx, 0);
  assert.ok(scorer.consideration('lineUseless', 'cut', 0, 1) > 0, 'distinct source near-arrival support remains relevant even after its line is cut');
});

test('complete scoring uses per-decision public column and team caches', () => {
  const { view, ctx } = fixture([0, -1, 1]);
  let reads = 0;
  const original = view.tower.col;
  view.tower.col = new Proxy(original, { get(target, key) { reads++; return target[key]; } });
  view.players = view.players.map(player => ({ ...player, get team() { reads++; return player.team; } }));
  const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params: { weights: { attack: Object.fromEntries(api.CONSIDERATION_IDS.map(id => [id, 1000])) } }, seed: 1 });
  scorer.prepare(ctx, 0);
  const before = reads;
  for (const id of api.CONSIDERATION_IDS) scorer.consideration(id, 'attack', 0, 1);
  scorer.score('attack', 0, 1);
  assert.equal(reads, before, 'scoring must reuse prepare inputs');
  original['garrison.count'][1] = 40;
  scorer.prepare(ctx, 1);
  assert.equal(scorer.consideration('targetWeakness', 'attack', 0, 1), 200, 'the next decision must refresh changing public columns');
});

test('one decision reads each public team once per preparation and enumeration', () => {
  const { view, ctx } = fixture(Array.from({ length: 30 }, (_, i) => i % 2));
  let reads = 0;
  view.players = view.players.map(player => ({ ...player, get team() { reads++; return player.team; } }));
  assert.ok(bot(30, attack).decide(ctx, 0).length > 0);
  assert.ok(reads <= view.players.length * 2, `team reads must scale with players, observed ${reads}`);
});

test('full nearest legal attack list avoids validating strictly farther discarded candidates', () => {
  const checked = [];
  const { ctx } = fixture([0, -1, -1, -1], { reject: (_s, target) => { checked.push(target); return null; } });
  assert.deepEqual(bot(4, { ...attack, maxTargetsPerSource: 1 }).decide(ctx, 0).map(cmd => cmd.to), ['t1']);
  assert.ok(!checked.includes(2) && !checked.includes(3), 'farther targets cannot enter the full nearest legal list');
});

test('reinforcement feasibility uses public facts and revalidates only selected candidates', () => {
  let calls = 0;
  const { ctx } = fixture([0, 0, 0], { reject: () => { calls++; return null; } });
  const params = { weights: { attack: {}, reinforce: { targetValue: 1000 }, cut: {} } };
  assert.deepEqual(bot(3, params).decide(ctx, 0).map(cmd => [cmd.from, cmd.to]), [['t0', 't1']]);
  assert.equal(calls, 1, 'unselected reinforcement pairs do not need an authoritative draw read');
  const veto = fixture([0, 0, 0], { reject: (_source, target) => target === 1 ? 'no-component' : null });
  assert.deepEqual(bot(3, params).decide(veto.ctx, 0).map(cmd => [cmd.from, cmd.to]), [['t0', 't2']], 'a selected hook veto falls back to another legal reinforcement');
});

test('cached nearest ordering avoids displaced validations and refreshes dynamic feasibility', () => {
  const checked = [];
  const { view, ctx } = fixture([0, -1, -1, -1], { reject: (_source, target) => { checked.push(target); return null; } });
  view.towerStatic = view.towerStatic.map((tower, i) => ({ ...tower, x: [0, 30000, 10000, 20000][i] }));
  const b = bot(4, { weights: { attack: { targetValue: 1000 }, reinforce: {}, cut: {} }, maxTargetsPerSource: 1 });
  assert.deepEqual(b.decide(ctx, 0).map(cmd => [cmd.from, cmd.to]), [['t0', 't2']]);
  assert.ok(!checked.includes(1), 'a farther early-index target must not be validated then displaced');
  view.tower.owner[2] = 0;
  assert.deepEqual(b.decide(ctx, 1).map(cmd => [cmd.from, cmd.to]), [['t0', 't3']], 'captured targets leave the nearest hostile set');
  view.lines.push({ channel: 3, from: 0, to: 3, owner: 0, length: 400000, drawSeq: 1 });
  view.tower.lines[0] = 1; view.tower.slots[0] = 2;
  assert.deepEqual(b.decide(ctx, 2).map(cmd => [cmd.from, cmd.to]), [['t0', 't1']], 'new drawn pairs are excluded without rebuilding static geometry');
  view.lines.length = 0; view.tower.lines[0] = 0;
  view.towerStatic = view.towerStatic.map((tower, i) => ({ ...tower, x: [0, 1000, 10000, 2000][i] }));
  assert.deepEqual(b.decide(ctx, 3).map(cmd => [cmd.from, cmd.to]), [['t0', 't1']], 'replacement static positions rebuild cached order');
});
