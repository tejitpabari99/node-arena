const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/index.ts');
const { step } = require('../src/tick.ts');
const { compiledGolden } = require('./fixtures.cjs');

const TANK = { id: 'tank', visual: 'unit.tank', speed: 5000, hp: 2, attack: 2, defense: 1 };
// Buildings: 0 (p0, L20), 1 (p1, L10), 2,3,4 neutral. Unit 0 = soldier, unit 1 = tank (added).
const mk = (edit, seed = 3) => { const l = compiledGolden(); l.units.push({ ...TANK }); if (edit) edit(l); const s = api.createState(l, seed); s.events = []; return s; };
const draw = (state, p, from, to) => api.runCommands(state, [{ type: 'DrawLine', player: p, from, to }]);
/** Place a troop of `kind` on from->to at absolute progress (state.tick = 0 so t0 = 0). */
const put = (state, from, to, kind, progress) => {
  const seq = api.spawnTroop(state, from, to, kind);
  const ch = api.getChannel(state, from, to);
  const i = ch.troops.indexOfSeq(seq);
  ch.troops.p0[i] = progress;
  return seq;
};
const len = (state, a, b) => api.getChannel(state, a, b).length;
const types = (state, t) => state.events.filter((e) => e.type === t);

test('covers R-CMB-05: E-EXCHANGE soldier vs tank: soldier dies, tank 2 -> 1; one round', () => {
  const s = mk();
  const sa = put(s, 0, 1, 0, 1000), tb = put(s, 1, 0, 1, 1000);
  const r = api.exchange(s, api.channelKey(s, 0, 1), sa, api.channelKey(s, 1, 0), tb);
  assert.deepEqual(r, { aAlive: false, bAlive: true });
  const cb = api.getChannel(s, 1, 0);
  assert.equal(cb.troops.len, 1);
  assert.equal(cb.troops.hp[0], 1);
  assert.equal(api.getChannel(s, 0, 1).troops.len, 0);
  assert.equal(types(s, 'Clash').length, 1);
  assert.deepEqual(types(s, 'TroopDied').map((e) => [e.cause, e.owner, e.kind]), [['clash', 0, 'soldier']]);
  api.assertInvariants(s);
});

test('covers R-CMB-05: soldier vs soldier and tank vs tank both die in round 1', () => {
  for (const kind of [0, 1]) {
    const s = mk();
    const a = put(s, 0, 1, kind, 500), b = put(s, 1, 0, kind, 500);
    assert.deepEqual(api.exchange(s, api.channelKey(s, 0, 1), a, api.channelKey(s, 1, 0), b), { aAlive: false, bAlive: false });
    assert.equal(s.counters.died, 2);
    api.assertInvariants(s);
  }
});

test('covers R-CMB-05: second round runs when both survive (hp 3 vs hp 3, atk 1)', () => {
  const s = mk((l) => { l.units[0].hp = 3; });
  const a = put(s, 0, 1, 0, 500), b = put(s, 1, 0, 0, 500);
  const r = api.exchange(s, api.channelKey(s, 0, 1), a, api.channelKey(s, 1, 0), b);
  assert.deepEqual(r, { aAlive: true, bAlive: true });
  assert.equal(api.getChannel(s, 0, 1).troops.hp[0], 1); // exactly two rounds, then stops
  assert.equal(api.getChannel(s, 1, 0).troops.hp[0], 1);
  api.assertInvariants(s);
});

test('covers R-CMB-05: same-owner fronts never fight', () => {
  const s = mk();
  const a = put(s, 0, 1, 0, 500);
  const b = put(s, 0, 2, 0, 500);
  const r = api.exchange(s, api.channelKey(s, 0, 1), a, api.channelKey(s, 0, 2), b);
  assert.deepEqual(r, { aAlive: true, bAlive: true });
  assert.equal(types(s, 'Clash').length, 0);
});

test('covers R-CMB-01: E-HEADON threshold progA + progB >= length - contact*tickRate; Clash event shape', () => {
  const s = mk();
  const L = len(s, 0, 1), thr = L - 700 * 20;
  const a = put(s, 0, 1, 0, 0), b = put(s, 1, 0, 0, 0);
  const A = api.getChannel(s, 0, 1), B = api.getChannel(s, 1, 0);
  A.troops.p0[0] = Math.floor(thr / 2); B.troops.p0[0] = thr - Math.floor(thr / 2) - 1; // sum = thr - 1
  api.headOnPass(s);
  assert.equal(A.troops.len + B.troops.len, 2, 'one below threshold: no fight');
  B.troops.p0[0] += 1; // sum == thr
  api.headOnPass(s);
  assert.equal(A.troops.len + B.troops.len, 0);
  const [clash] = types(s, 'Clash');
  assert.equal(clash.kind, 'headon');
  assert.deepEqual([clash.a.seq, clash.b.seq, clash.a.owner, clash.b.owner], [a, b, 0, 1]);
  assert.equal(Number.isInteger(clash.x) && Number.isInteger(clash.z), true);
  api.assertInvariants(s);
});

test('covers R-CMB-01: after an exchange new fronts are retested; troops behind wait; cut lines do not protect', () => {
  const s = mk();
  const L = len(s, 0, 1), thr = L - 700 * 20;
  put(s, 0, 1, 0, thr / 2 | 0); put(s, 0, 1, 0, 100); // second troop far behind
  put(s, 1, 0, 0, thr - (thr / 2 | 0)); put(s, 1, 0, 0, thr - 200);
  // after front pair dies: A next at 100 + B next at thr-200 = thr-100 < thr: waits
  api.headOnPass(s);
  assert.equal(api.getChannel(s, 0, 1).troops.len, 1);
  assert.equal(api.getChannel(s, 1, 0).troops.len, 1);
  // move the second pair into range: they now qualify and fight in the same pass
  api.getChannel(s, 0, 1).troops.p0[0] = thr; 
  api.headOnPass(s);
  assert.equal(api.getChannel(s, 0, 1).troops.len + api.getChannel(s, 1, 0).troops.len, 0);
  api.assertInvariants(s);
});

test('covers R-CMB-01: same-owner opposing fronts (replaced line) do not fight; tick wiring runs head-on in phase 6', () => {
  const s = mk();
  const L = len(s, 0, 1);
  put(s, 0, 1, 0, L / 2 | 0); put(s, 1, 0, 0, L / 2 | 0);
  s.buildings.owner[1] = 0; // both troops owned by p0 -> ring owner decides
  api.getChannel(s, 1, 0).troops.owner[0] = 0;
  api.headOnPass(s);
  assert.equal(api.getChannel(s, 0, 1).troops.len + api.getChannel(s, 1, 0).troops.len, 2);
  const s2 = mk();
  const A = put(s2, 0, 1, 0, 0), B = put(s2, 1, 0, 0, 0);
  void A; void B;
  const L2 = len(s2, 0, 1), thr = L2 - 14000;
  api.getChannel(s2, 0, 1).troops.p0[0] = thr - 1000; // + 5000*tick per step
  api.getChannel(s2, 1, 0).troops.p0[0] = 0;
  s2.tick = 0;
  // step increments tick to 1: progress = p0 + 5000 each; sum = thr -1000 + 10000 < thr -> no clash until later
  let clash = false;
  for (let i = 0; i < 4 && !clash; i++) { const ev = step(s2, [], true); clash = ev.some((e) => e.type === 'Clash'); api.assertInvariants(s2); }
  assert.equal(clash, true);
});

test('covers R-CMB-02: arrival order overshoot desc, then channel key, then FIFO', () => {
  const s = mk();
  // p1 house 1 receives hostile from 0 (b0 -> b1) and friendly from... use neutral target 2 to observe order via events
  const L02 = len(s, 0, 2), L12 = len(s, 1, 2), L01 = len(s, 0, 1);
  const a = put(s, 0, 2, 0, L02 + 5);
  const b = put(s, 1, 2, 0, L12 + 9);
  const c = put(s, 0, 2, 0, L02 + 5);
  void L01; void c;
  api.arrivalPass(s);
  const order = types(s, 'TroopArrived').map((e) => e.seq);
  // seq order: a=0 (0->2, os5), b=1 (1->2, os9), c=2 (0->2, os5). Expected: b (9), then channel 0->2 FIFO: a, c. c enqueued behind a with equal progress
  assert.deepEqual(order, [b, a, c]);
  api.assertInvariants(s);
});

test('covers R-CMB-02, R-CPT-02: E-ARRIVAL ownership re-evaluated per arrival; captured-source arrival cancelled', () => {
  const s = mk((l) => { l.buildings[1].level = 0; });
  // b1 (p1, L0) with its own troop T in flight 1->2 that is also an arrival; p0 soldier overshoot 9 from b0, 6 from b0 (second), p1 soldier os 2.
  const L01 = len(s, 0, 1), L21 = len(s, 2, 1);
  s.buildings.owner[2] = 1; s.buildings.level[2] = 0; // p1 neutral->p1 helper source for friendly arrival
  const hostile1 = put(s, 0, 1, 0, L01 + 9);
  const hostile2 = put(s, 0, 1, 0, L01 + 6);
  const friend = put(s, 2, 1, 0, L21 + 2);
  const T = put(s, 1, 2, 0, 1234); // in flight from b1
  s.buildings.owner[2] = 1;
  api.arrivalPass(s);
  const ev = types(s, 'TroopArrived').map((e) => [e.seq, e.effect]);
  // 1st hostile: n=-1 captured by p0. 2nd: seq of same owner now friendly -> reinforce (level 0+1). friend (p1) now hostile: 1-1=0, not captured.
  assert.deepEqual(ev, [[hostile1, 'hit'], [hostile2, 'reinforce'], [friend, 'hit']]);
  assert.equal(s.buildings.owner[1], 0);
  assert.equal(s.buildings.level[1], 0);
  assert.equal(api.getChannel(s, 1, 2).troops.indexOfSeq(T), -1, 'T killed by capture');
  assert.deepEqual(types(s, 'TroopDied').map((e) => [e.seq, e.cause]), [[T, 'capture']]);
  assert.deepEqual(types(s, 'BuildingCaptured'), [{ type: 'BuildingCaptured', building: 1, from: 1, to: 0 }]);
  api.assertInvariants(s);
});

test('covers R-CMB-02, R-CPT-01: arrival queued from the captured source is cancelled (no TroopArrived)', () => {
  const s = mk((l) => { l.buildings[1].level = 0; });
  const L01 = len(s, 0, 1), L10 = len(s, 1, 0);
  const hit = put(s, 0, 1, 0, L01 + 50);
  const doomed = put(s, 1, 0, 0, L10 + 1); // arrives at b0 later than capture of b1, but sourced from b1
  api.arrivalPass(s);
  assert.deepEqual(types(s, 'TroopArrived').map((e) => e.seq), [hit]);
  assert.equal(api.getChannel(s, 1, 0).troops.indexOfSeq(doomed), -1);
  assert.equal(s.buildings.level[0], 20);
  assert.equal(s.counters.killed, 1);
  assert.equal(s.counters.arrived, 1);
  api.assertInvariants(s);
});

test('covers R-CMB-03, R-CAP-01: E-CAPTURE soldier and tank damage; capture only when damage > level', () => {
  const cases = [
    [0, 3, 3 - 1, 1], [0, 1, 0, 1], [0, 0, 0, 0], // soldier: L3->2 keep, L1->0 keep, L0 captured at 0
    [1, 3, 1, 1], [1, 2, 0, 1], [1, 1, 0, 0],      // tank: L3->1, L2->0, L1 captured at 0
  ];
  for (const [kind, lvl, expLvl, keeps] of cases) {
    const s = mk((l) => { l.buildings[1].level = lvl; });
    put(s, 0, 1, kind, len(s, 0, 1) + 77);
    api.arrivalPass(s);
    assert.equal(s.buildings.level[1], expLvl, `kind ${kind} L${lvl}`);
    assert.equal(s.buildings.owner[1], keeps ? 1 : 0, `kind ${kind} L${lvl} owner`);
    assert.equal(types(s, 'TroopArrived')[0].effect, 'hit');
    api.assertInvariants(s);
  }
});

test('covers R-CMB-03: neutral building hit and captured by a player troop; neutral level reduced', () => {
  const s = mk();
  put(s, 0, 2, 1, len(s, 0, 2)); // tank at b2 (L7): 7-2 = 5, stays neutral
  api.arrivalPass(s);
  assert.equal(s.buildings.owner[2], -1);
  assert.equal(s.buildings.level[2], 5);
});

test('covers R-CAP-01: friendly reinforce L = L + defense (soldier and tank), no fwd draw, effect reinforce', () => {
  const s = mk();
  const before = s.fwd.map((f) => f.snapshot().join());
  s.buildings.owner[2] = 0; // friendly source for b0
  put(s, 2, 0, 0, len(s, 2, 0));
  put(s, 2, 0, 1, len(s, 2, 0) + 1);
  api.arrivalPass(s);
  assert.equal(s.buildings.level[0], 22);
  assert.deepEqual(types(s, 'TroopArrived').map((e) => e.effect), ['reinforce', 'reinforce']);
  assert.deepEqual(s.fwd.map((f) => f.snapshot().join()), before);
  assert.equal(s.buildings.stage[0], 2);
  api.assertInvariants(s);
});

test('covers R-CAP-01, R-CAP-03: E-OVERFLOW L=63 +1 no surplus; L=64 surplus forwarded: one fwd draw picks k-th line', () => {
  const run = (level, nLines) => {
    const s = mk((l) => { l.buildings[0].level = level; l.buildings[0].modules.level.maxLevel = 64; });
    s.buildings.owner[2] = 0; // friendly source
    s.buildings.level[2] = 0;
    for (const t of [3, 4].slice(0, 0)) void t;
    if (nLines >= 1) draw(s, 0, 0, 1);
    if (nLines >= 2) draw(s, 0, 0, 3);
    s.buildings.stage[0] = 3; // slots (draw uses stage - lines)
    s.events = [];
    put(s, 2, 0, 1, len(s, 2, 0));
    return s;
  };
  // no surplus at 63
  let s = run(63, 2);
  const f0 = s.fwd[0].snapshot().join();
  api.arrivalPass(s);
  assert.equal(s.buildings.level[0], 64);
  assert.equal(types(s, 'TroopArrived')[0].effect, 'reinforce');
  assert.equal(s.fwd[0].snapshot().join(), f0, 'no draw');
  // surplus with two lines: draw consumed, one new tank
  s = run(64, 2);
  const ref = mk(); // replicate stream state
  const expectK = (() => { const f = require('../src/index.ts').createStreams(3).fork('fwd', 0); return f.below(2); })();
  api.arrivalPass(s);
  void ref;
  const ev = types(s, 'TroopArrived')[0];
  assert.equal(ev.effect, 'overflow');
  const spawned = types(s, 'TroopSpawned');
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cause, 'forward');
  assert.equal(spawned[0].kind, 'tank');
  const targets = [1, 3];
  assert.equal(spawned[0].channel, api.channelKey(s, 0, targets[expectK]));
  const ch = api.getChannel(s, 0, targets[expectK]);
  assert.equal(ch.troops.hp[ch.troops.indexOfSeq(spawned[0].seq)], 2, 'full hp');
  assert.equal(s.buildings.level[0], 64);
  assert.equal(s.buildings.alive[0], 1);
  api.assertInvariants(s);
});

test('covers R-CAP-03: surplus lost with no draw when no outgoing line or at alive cap', () => {
  let s = mk((l) => { l.buildings[0].level = 64; });
  s.buildings.owner[2] = 0;
  put(s, 2, 0, 0, len(s, 2, 0));
  const f0 = s.fwd[0].snapshot().join();
  api.arrivalPass(s);
  assert.equal(types(s, 'TroopSpawned').length, 0);
  assert.equal(s.fwd[0].snapshot().join(), f0);
  assert.equal(types(s, 'TroopArrived')[0].effect, 'overflow');
  // alive cap
  s = mk((l) => { l.buildings[0].level = 64; });
  s.buildings.owner[2] = 0;
  draw(s, 0, 0, 1);
  s.events = [];
  const cap = s.level.rules.aliveCap;
  for (let i = 0; i < cap; i++) put(s, 0, 1, 0, 10);
  put(s, 2, 0, 0, len(s, 2, 0));
  const g0 = s.fwd[0].snapshot().join();
  api.arrivalPass(s);
  assert.equal(types(s, 'TroopSpawned').length, 0);
  assert.equal(s.fwd[0].snapshot().join(), g0);
  api.assertInvariants(s);
});

test('covers R-CPT-01: capture flips owner, cuts outgoing lines (reason captured), kills all troops from source incl. cut lines, resets growth, clears ignoreForWin, keeps incoming lines', () => {
  const s = mk((l) => { l.buildings[1].level = 0; l.buildings[1].ignoreForWin = true; });
  draw(s, 1, 1, 2);
  draw(s, 0, 0, 1); // incoming line persists
  s.events = [];
  s.buildings.col['grows.timer'][1] = 5000;
  s.buildings.alive; // noop
  const t1 = put(s, 1, 2, 0, 1000);
  api.cutLine(s, 1, 2, 'player'); // troop on cut line
  draw(s, 1, 1, 3);
  const t2 = put(s, 1, 3, 0, 1000);
  s.events = [];
  put(s, 0, 1, 0, len(s, 0, 1) + 3);
  api.arrivalPass(s);
  assert.equal(s.buildings.owner[1], 0);
  assert.equal(s.buildings.level[1], 0);
  assert.equal(s.buildings.ignoreForWin[1], 0);
  assert.equal(s.buildings.col['grows.timer'][1], 0);
  assert.equal(s.buildings.lines[1], 0);
  assert.equal(s.buildings.alive[1], 0);
  assert.deepEqual(types(s, 'LineCut'), [{ type: 'LineCut', from: 1, to: 3, reason: 'captured' }]);
  assert.deepEqual(types(s, 'TroopDied').map((e) => [e.seq, e.cause]).sort(), [[t1, 'capture'], [t2, 'capture']].sort());
  assert.equal(api.getChannel(s, 0, 1).drawn, 1, 'incoming line persists');
  api.assertInvariants(s);
});

test('covers R-CPT-01: tower cooldown untouched by capture (no tower column changed)', () => {
  const s = mk();
  const snapshot = JSON.stringify(Object.entries(s.buildings.col).filter(([k]) => k.startsWith('shoots')).map(([k, v]) => [k, Array.from(v)]));
  s.buildings.level[4] = 0;
  put(s, 0, 4, 0, len(s, 0, 4));
  api.arrivalPass(s);
  assert.equal(s.buildings.owner[4], 0);
  assert.equal(JSON.stringify(Object.entries(s.buildings.col).filter(([k]) => k.startsWith('shoots')).map(([k, v]) => [k, Array.from(v)])), snapshot);
});

test('conservation holds across a full run with contacts and arrivals (spawn, head-on, arrive, capture)', () => {
  const s = mk((l) => { l.units[0].speed = 400000; l.buildings[0].level = 30; l.buildings[1].level = 12; });
  s.events = null;
  const sim = [];
  for (let t = 0; t < 400; t++) {
    const cmds = t === 0 ? [{ type: 'DrawLine', player: 0, from: 0, to: 1 }, { type: 'DrawLine', player: 1, from: 1, to: 0 }] : [];
    sim.push(...step(s, cmds, true));
    api.assertInvariants(s);
  }
  assert.ok(sim.some((e) => e.type === 'Clash'));
  assert.ok(sim.some((e) => e.type === 'TroopArrived'));
});
