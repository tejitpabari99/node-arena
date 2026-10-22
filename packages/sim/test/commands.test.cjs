const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/index.ts');
const { compiledGolden } = require('./fixtures.cjs');

// levelview-1: b0 human L20 (2 slots), b1 ai L10 (2 slots), b2/b3 neutral houses, b4 neutral tower.
const draw = (player, from, to) => ({ type: 'DrawLine', player, from, to });
const cut = (player, from, to) => ({ type: 'CutLine', player, from, to });
const mk = (edit) => { const l = compiledGolden(); if (edit) edit(l); const sim = api.create(l, 3); return sim; };
const sim0 = () => mk();
const rejects = (events) => events.filter((e) => e.type === 'CommandRejected').map((e) => e.reason);

test('covers R-LIN-01: valid DrawLine draws the line, takes a slot, emits LineDrawn', () => {
  const sim = sim0();
  assert.equal(sim.canDraw(0, 0, 2), null);
  const ev = sim.step([draw(0, 0, 2)], { events: true });
  assert.deepEqual(ev, [{ type: 'LineDrawn', from: 0, to: 2, owner: 0, drawSeq: 1 }]);
  assert.equal(sim.view.buildings.lines[0], 1);
  assert.equal(sim.view.freeSlots(0), 1);
  assert.deepEqual(sim.view.lines.map((l) => [l.from, l.to, l.owner, l.drawSeq]), [[0, 2, 0, 1]]);
  assert.equal(sim.canDraw(0, 0, 2), 'duplicate');
});

test('covers R-LIN-01: rejection goldens, pinned check order, atomic (hash unchanged except tick)', () => {
  const golden = [
    ['gameover', null], // handled below
    ['malformed', { type: 'DrawLine', player: 0, from: 0 }],
    ['unknown-id', draw(0, 0, 99)],
    ['unknown-id', draw(5, 0, 2)],
    ['not-owner', draw(0, 1, 0)],
    ['not-owner', draw(0, 2, 0)], // neutral source
    ['self', draw(0, 0, 0)],
    ['no-slot', null],
    ['duplicate', null],
  ];
  for (const [reason, cmd] of golden) {
    if (!cmd) continue;
    const sim = sim0();
    const twin = sim0();
    const ev = sim.step([cmd], { events: true });
    twin.step([]);
    assert.deepEqual(rejects(ev), [reason], reason);
    assert.equal(sim.hash(), twin.hash(), `${reason} must change nothing`);
  }
  // not-owner precedes self precedes not-drawer
  assert.equal(sim0().canDraw(0, 1, 1), 'not-owner');
  assert.equal(sim0().canDraw(1, 1, 1), 'self');
  // not-drawer: human-owned tower
  const t = mk((l) => { l.buildings[4].owner = 0; });
  assert.equal(t.canDraw(0, 4, 2), 'not-drawer');
  assert.equal(t.canDraw(0, 4, 4), 'self');
  const ev = t.step([draw(0, 4, 2)], { events: true });
  assert.deepEqual(ev, [{ type: 'CommandRejected', player: 0, command: 'DrawLine', reason: 'not-drawer' }]);
  // duplicate precedes no-slot
  const s = sim0();
  s.step([draw(0, 0, 2), draw(0, 0, 3)]);
  assert.equal(s.canDraw(0, 0, 2), 'duplicate');
  assert.equal(s.canDraw(0, 0, 1), 'no-slot');
  assert.deepEqual(rejects(s.step([draw(0, 0, 1)], { events: true })), ['no-slot']);
});

test('covers R-LIN-01: gameover rejects every command', () => {
  const state = api.createState(compiledGolden(), 3);
  state.over = { outcome: 'won', winner: 0 };
  state.events = [];
  api.runCommands(state, [draw(0, 0, 2), cut(0, 0, 2), { junk: 1 }]);
  assert.deepEqual(state.events.map((e) => e.reason), ['gameover', 'gameover']); // untyped junk: counted, no event
  assert.equal(state.rejected, 3);
  assert.equal(api.canDraw(state, 0, 0, 2), 'gameover');
  assert.equal(api.canDraw(state, 'x', 0, 2), 'gameover');
  assert.equal(state.buildings.lines[0], 0);
});

test('covers R-LIN-02: no auto-cut when the level drops; free may go negative', () => {
  const l = compiledGolden();
  const state = api.createState(l, 3);
  api.runCommands(state, [draw(0, 0, 2), draw(0, 0, 3)]);
  assert.equal(state.buildings.lines[0], 2);
  state.buildings.level[0] = 5; // stage 1
  state.buildings.stage[0] = 1;
  api.runCommands(state, []);
  assert.equal(state.buildings.lines[0], 2);
  assert.equal(state.buildings.stage[0] - state.buildings.lines[0], -1);
  assert.equal(api.canDraw(state, 0, 0, 1), 'no-slot');
  api.assertInvariants(state);
});

test('covers R-LIN-03: same-owner reverse is replaced, troops stay, fresh timer', () => {
  const l = compiledGolden(); l.buildings[2].owner = 0; // human b2, level 7
  const state = api.createState(l, 3);
  api.runCommands(state, [draw(0, 0, 2), draw(0, 2, 0)].slice(0, 1));
  state.events = [];
  api.spawnTroop(state, 0, 2, 0);
  api.getChannel(state, 0, 2).timer = 4000;
  api.runCommands(state, [draw(0, 2, 0)]);
  assert.deepEqual(state.events, [
    { type: 'LineCut', from: 0, to: 2, reason: 'replaced' },
    { type: 'LineDrawn', from: 2, to: 0, owner: 0, drawSeq: 2 },
  ]);
  const old = api.getChannel(state, 0, 2);
  assert.equal(old.drawn, 0); assert.equal(old.timer, 0); assert.equal(old.drawSeq, 0);
  assert.equal(old.troops.len, 1); // troop stays in flight
  assert.equal(state.buildings.lines[0], 0);
  assert.equal(state.buildings.lines[2], 1);
  assert.equal(api.getChannel(state, 2, 0).timer, 0);
  api.assertInvariants(state);
});

test('covers R-LIN-03: hostile reverse coexists (head-on)', () => {
  const state = api.createState(compiledGolden(), 3);
  api.runCommands(state, [draw(0, 0, 1), draw(1, 1, 0)]);
  assert.equal(api.getChannel(state, 0, 1).drawn, 1);
  assert.equal(api.getChannel(state, 1, 0).drawn, 1);
  assert.equal(state.buildings.lines[0], 1); assert.equal(state.buildings.lines[1], 1);
});

test('covers R-TCK-03: commands run in player idx then submission order; draws take drawSeq in that order', () => {
  const state = api.createState(compiledGolden(), 3);
  api.runCommands(state, [draw(1, 1, 2), draw(0, 0, 3), draw(1, 1, 3), draw(0, 0, 2)]);
  assert.equal(api.getChannel(state, 0, 3).drawSeq, 1);
  assert.equal(api.getChannel(state, 0, 2).drawSeq, 2);
  assert.equal(api.getChannel(state, 1, 2).drawSeq, 3);
  assert.equal(api.getChannel(state, 1, 3).drawSeq, 4);
});

test('covers R-LIN-05: CutLine removes line, in-flight troops continue; rejections', () => {
  const sim = sim0();
  sim.step([draw(0, 0, 2)]);
  assert.deepEqual(rejects(sim.step([cut(0, 0, 3)], { events: true })), ['no-line']);
  assert.deepEqual(rejects(sim.step([cut(0, 0, 99)], { events: true })), ['unknown-id']);
  assert.deepEqual(rejects(sim.step([{ type: 'CutLine', player: 0, from: 0 }], { events: true })), ['malformed']);
  const state = api.createState(compiledGolden(), 3);
  api.runCommands(state, [draw(0, 0, 2)]);
  api.spawnTroop(state, 0, 2, 0);
  state.events = [];
  api.runCommands(state, [cut(1, 0, 2)]);
  assert.deepEqual(state.events.map((e) => e.reason), ['not-owner']);
  api.runCommands(state, [cut(0, 0, 2)]);
  assert.deepEqual(state.events[1], { type: 'LineCut', from: 0, to: 2, reason: 'player' });
  assert.equal(state.buildings.lines[0], 0);
  assert.equal(api.getChannel(state, 0, 2).troops.len, 1);
  api.runCommands(state, [cut(0, 0, 2)]);
  assert.equal(state.events[2].reason, 'no-line');
  api.assertInvariants(state);
});

test('cut then redraw: hash does not depend on history (drawSeq/timer zeroed)', () => {
  const a = api.createState(compiledGolden(), 3), b = api.createState(compiledGolden(), 3);
  api.runCommands(a, [draw(0, 0, 2)]); api.runCommands(a, [cut(0, 0, 2)]);
  assert.equal(api.hashState(a).length, 16);
  b.drawSeq = a.drawSeq;
  assert.equal(api.hashState(a), api.hashState(b));
});

test('SP04 seams: hooks fire in order; validator slot reasons surface; stubs inert', () => {
  const calls = [];
  const hooks = api.IMPLS.blocksLines.hooks;
  const saved = { ...hooks };
  hooks.validateDraw = (_s, f, t) => (t === 3 ? 'blocked-obstacle' : null);
  hooks.onLineDrawn = (_s, f, t, seq) => calls.push(['drawn', f, t, seq]);
  hooks.onLineCut = (_s, f, t, r) => calls.push(['cut', f, t, r]);
  try {
    const state = api.createState(compiledGolden(), 3);
    state.events = [];
    api.runCommands(state, [draw(0, 0, 3), draw(0, 0, 2), cut(0, 0, 2)]);
    assert.deepEqual(state.events.filter((e) => e.type === 'CommandRejected').map((e) => e.reason), ['blocked-obstacle']);
    assert.deepEqual(calls, [['drawn', 0, 2, 1], ['cut', 0, 2, 'player']]);
    assert.equal(api.canDraw(state, 0, 0, 3), 'blocked-obstacle');
  } finally {
    delete hooks.onLineDrawn; delete hooks.onLineCut; hooks.validateDraw = saved.validateDraw;
  }
  assert.equal(api.crossingPass(api.createState(compiledGolden(), 3)), undefined);
  assert.equal(api.IMPLS.blocksLines.hooks.validateDraw(), null);
});

test('malformed input fuzz never throws (step and canDraw)', () => {
  const evil = { get type() { throw new Error('boom'); } };
  const proxy = new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });
  const junk = [null, undefined, 0, 1.5, NaN, Infinity, -1, 2 ** 31, 2 ** 53, '0', '', true, [], [1], {}, evil, proxy, Object.create(null),
    { type: 'DrawLine' }, { type: 'Nope', player: 0, from: 0, to: 1 }, { type: 'DrawLine', player: 0, from: 0, to: 1, extra: 1 },
    { type: 'DrawLine', player: '0', from: 0, to: 1 }, { type: 'CutLine', player: -1, from: 0, to: 1 }, { type: 'DrawLine', player: 0.5, from: 0, to: 1 },
    { type: 'DrawLine', player: 2 ** 31, from: 0, to: 1 }, { type: '__proto__', player: 0, from: 0, to: 1 }, { type: 'toString', player: 0, from: 0, to: 1 }];
  const sim = sim0();
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 400; i++) {
    const cmds = Array.from({ length: 1 + rnd(5) }, () => (rnd(3) === 0 ? junk[rnd(junk.length)] : { type: rnd(2) ? 'DrawLine' : 'CutLine', player: [0, 1, 7, -1, 1.5, '0'][rnd(6)], from: [0, 1, 2, 3, 4, 9, null][rnd(7)], to: [0, 1, 2, 3, 4, 9, undefined][rnd(7)] }));
    assert.doesNotThrow(() => sim.step(cmds, { events: rnd(2) === 0 }));
    for (const j of junk) assert.doesNotThrow(() => sim.canDraw(j, j, j));
    assert.doesNotThrow(() => sim.step(junk[rnd(junk.length)]));
  }
  assert.doesNotThrow(() => sim.canDraw());
  assert.doesNotThrow(() => sim.step(null));
});
