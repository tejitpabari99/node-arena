const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const bots = require('../src/index.ts');

/** Mutable SimView stub; `owner` / `init` / `lines` may be changed between ticks. */
function mk(spec) {
  const v = {
    over: null,
    ids: { buildings: spec.owner.map((_, i) => `b${i}`), players: ['p0', 'p1'], elements: [] },
    buildings: { owner: spec.owner.slice(), level: spec.owner.map(() => 5), lines: [] },
    buildingStatic: spec.owner.map((o, i) => ({ x: i * 1000, z: 0, special: false, drawsLines: true, initialOwner: spec.init ? spec.init[i] : o })),
    lines: spec.lines ?? [],
    used: {},
    freeSlots: i => (spec.slots?.[i] ?? 3) - (v.used[i] ?? 0),
  };
  return v;
}
const noRng = { below() { throw new Error('script used RNG'); } };
const allow = () => null;
/** Runs ticks 0..n-1; returns draws by tick and the first tick runner returned null. */
function drive(script, view, n, canDraw = allow, hook) {
  const run = bots.createScriptRunner(script);
  const draws = {}; let nullAt = null;
  for (let t = 0; t < n; t++) {
    if (hook) hook(t, view);
    const out = run({ view, canDraw }, t, 0, noRng);
    if (out === null) { if (nullAt === null) nullAt = t; continue; }
    if (out.length) draws[t] = out.map(c => `${c.from}>${c.to}`);
  }
  return { draws, nullAt };
}
const base = () => mk({ owner: [0, 0, 1, -1] });

test('covers R4 (pin): delay 8000 done T+161; head op T=-1 -> done tick 160, handoff call tick 161', () => {
  assert.equal(drive([{ op: 'delay', ms: 8000 }], base(), 200).nullAt, 161);
  assert.equal(drive([{ op: 'delay', ms: 0 }], base(), 10).nullAt, 1);
  assert.equal(drive([{ op: 'delay', ms: 1 }], base(), 10).nullAt, 2);
});

test('covers R4 (pin): delay then line: line starts on delay-done tick, draws 121 later', () => {
  const r = drive([{ op: 'delay', ms: 8000 }, { op: 'line', own: 'b0', target: 'b2', afterMs: 6000 }], base(), 400);
  assert.deepEqual(Object.keys(r.draws), ['281']); // delay done 160, line T=160, draw + done at 281
  assert.equal(r.nullAt, 282);
  assert.deepEqual(r.draws[281], ['0>2']);
});

test('covers R4: line afterMs 0 draws at first update', () => {
  const r = drive([{ op: 'line', own: 'b0', target: 'b2', afterMs: 0 }], base(), 5);
  assert.deepEqual(r.draws, { 0: ['0>2'] });
});

test('covers R4: line skipped when own initial owner != me; uses no tick; consecutive skips start same T', () => {
  const v = mk({ owner: [0, 0, 1, -1], init: [1, 0, 1, -1] });
  const script = [
    { op: 'line', own: 'b0', target: 'b2', afterMs: 5000 },  // skipped (init owner 1)
    { op: 'line', own: 'b0', target: 'b3', afterMs: 5000 },  // skipped
    { op: 'delay', ms: 100 },                               // starts at head T=-1: done 2 (updates 1:t0 ..)
  ];
  const r = drive(script, v, 20);
  assert.equal(r.nullAt, 3);
  assert.deepEqual(r.draws, {});
  // same chain with a leading real delay: skips start on the delay-done tick T, next op still T
  const r2 = drive([{ op: 'delay', ms: 100 }, ...script.slice(0, 2), { op: 'line', own: 'b1', target: 'b2', afterMs: 100 }], v, 30);
  // delay 100 done at update #3 (tick 2); skips start at 2; line b1 starts at 2, draws at update #3 -> tick 5
  assert.deepEqual(r2.draws, { 5: ['1>2'] });
});

test('covers R4: skip is by INITIAL owner, not current owner', () => {
  const v = mk({ owner: [1, 0, 0, -1], init: [0, 0, 1, -1] }); // lost b0 since start; initial mine
  const r = drive([{ op: 'line', own: 'b0', target: 'b3', afterMs: 0 }], v, 5);
  // not skipped; own not mine -> fallback: first own free tower not own/target = b1 -> b3
  assert.deepEqual(r.draws, { 0: ['1>3'] });
});

test('covers R4: scriptLine fallback; <2 towers stop; target null; null own', () => {
  // own mine but canDraw rejects -> fallback to b1
  const v = base();
  const cd = (_p, from) => (from === 0 ? 'blocked-obstacle' : null);
  assert.deepEqual(drive([{ op: 'line', own: 'b0', target: 'b2', afterMs: 0 }], v, 3, cd).draws, { 0: ['1>2'] });
  // only one tower -> no fallback
  const one = mk({ owner: [0, 1, 1, -1] });
  assert.deepEqual(drive([{ op: 'line', own: 'b1', target: 'b3', afterMs: 0 }], one, 3).draws, {});
  // target null -> nothing; own null -> fallback
  assert.deepEqual(drive([{ op: 'line', own: 'b0', target: null, afterMs: 0 }], base(), 3).draws, {});
  assert.deepEqual(drive([{ op: 'line', own: null, target: 'b2', afterMs: 0 }], base(), 3).draws, { 0: ['0>2'] });
  // fallback excludes the target itself
  const t = mk({ owner: [0, 0, 1, -1], init: [0, 0, 0, -1] });
  assert.deepEqual(drive([{ op: 'line', own: 'b2', target: 'b0', afterMs: 0 }], t, 3).draws, { 0: ['1>0'] });
});

test('covers R4: fallback respects noLineBetween (any owner/direction) and free slots', () => {
  const v = mk({ owner: [0, 0, 1, -1], lines: [{ from: 2, to: 1 }], slots: [3, 3, 3, 3] });
  const cd = (_p, from) => (from === 0 ? 'blocked-obstacle' : null);
  // b0 blocked, b1 has a hostile line to b2 -> nothing
  assert.deepEqual(drive([{ op: 'line', own: 'b0', target: 'b2', afterMs: 0 }], v, 3, cd).draws, {});
  const full = mk({ owner: [0, 0, 1, -1], slots: [3, 0, 3, 3] });
  assert.deepEqual(drive([{ op: 'line', own: 'b0', target: 'b2', afterMs: 0 }], full, 3, cd).draws, {});
});

const node = (goal, own, target, delayMs, then) => ({ goal, own, target, delayMs, ...(then ? { then } : {}) });

test('covers R4 (pin): steps root starts T+1 (tick 0 from head), fire = start+max(1,ceil(d/50))', () => {
  const a = drive([{ op: 'steps', root: node('line', 'b0', 'b2', 0) }], base(), 10);
  assert.deepEqual(a.draws, { 1: ['0>2'] }); // head T=-1: root starts tick 0, fires 0+max(1,0)=1
});

test('covers R4 (pin): steps timing from head (T=-1): root start tick 0, fire tick 0+1+..', () => {
  // head op T=-1 => first update tick 0 => root start 0 => d=5000 fires 0+100 = 100
  const a = drive([{ op: 'steps', root: node('line', 'b0', 'b2', 5000) }], base(), 200);
  assert.deepEqual(a.draws, { 100: ['0>2'] });
  assert.equal(a.nullAt, 102); // node finished by tween at 100, seen by op at 101, handoff call at 102
});

test('covers R4: steps skip-if-lost at start: node done, children still start (same tick)', () => {
  const v = mk({ owner: [1, 0, 1, -1] });
  const root = node('line', 'b0', 'b2', 100, [node('line', 'b1', 'b3', 100), node('line', 'b1', 'b2', 200)]);
  const r = drive([{ op: 'steps', root }], v, 30);
  // root skipped at tick 0; children start tick 0, fire at 2 and 4
  assert.deepEqual(r.draws, { 2: ['1>3'], 4: ['1>2'] });
});

test('covers R4: steps re-checks ownership at fire (lost between start and fire -> no action, children start)', () => {
  const v = base();
  const root = node('line', 'b0', 'b2', 500, [node('line', 'b1', 'b3', 0)]);
  const r = drive([{ op: 'steps', root }], v, 40, allow, (t, view) => { if (t === 5) view.buildings.owner[0] = 1; });
  // root start 0 fire 10 (own lost) -> done; child starts 10, fires 11
  assert.deepEqual(r.draws, { 11: ['1>3'] });
});

test('covers R4: parallel children start in same call as parent finishing, in list order', () => {
  const root = node('none', null, null, 100, [node('line', 'b0', 'b2', 100), node('line', 'b1', 'b3', 100)]);
  // root start 0 fire 2 (none); children start 2 fire 4 both
  const r = drive([{ op: 'steps', root }], base(), 20);
  assert.deepEqual(r.draws, { 4: ['0>2', '1>3'] });
});

test('covers R4: ledger prevents double-use of slots/pairs within a tick', () => {
  // two children on same own with one free slot: 2nd falls back to b1 -> b2? same pair no; b1>b3
  const v = mk({ owner: [0, 0, 1, -1], slots: [1, 3, 3, 3] });
  const root = node('none', null, null, 0, [node('line', 'b0', 'b2', 0), node('line', 'b0', 'b3', 0)]);
  const r = drive([{ op: 'steps', root }], v, 10);
  // root fires 1; children start 1 fire 2: b0>b2 uses b0's only slot; second falls back to b1>b3
  assert.deepEqual(r.draws, { 2: ['0>2', '1>3'] });
  // identical pair twice in a tick: second cannot repeat the pair (either direction)
  const dup = mk({ owner: [0, 0, 1, -1] });
  const root2 = node('none', null, null, 0, [node('line', 'b0', 'b2', 0), node('line', 'b0', 'b2', 0)]);
  const r2 = drive([{ op: 'steps', root: root2 }], dup, 10);
  assert.deepEqual(r2.draws, { 2: ['0>2', '1>2'] });
});

test('covers R4 (pin): capture polls F+20, F+40; done when target.owner == me', () => {
  const v = base();
  const root = node('capture', 'b0', 'b2', 0);
  // root start 0, fire F=1 (draw), polls 21, 41; target captured before 41 -> done at 41; op sees 42; handoff 43
  const r = drive([{ op: 'steps', root }], v, 100, allow, (t, view) => { if (t === 30) view.buildings.owner[2] = 0; });
  assert.deepEqual(r.draws, { 1: ['0>2'] });
  assert.equal(r.nullAt, 43);
  // captured exactly at tick 41 start (before poll) -> same; captured at 42 -> poll 61
  const r2 = drive([{ op: 'steps', root }], base(), 100, allow, (t, view) => { if (t === 42) view.buildings.owner[2] = 0; });
  assert.equal(r2.nullAt, 63);
});

test('covers R4: capture done when own lost at a poll', () => {
  const root = node('capture', 'b0', 'b2', 0);
  const r = drive([{ op: 'steps', root }], base(), 100, allow, (t, view) => { if (t === 22) view.buildings.owner[0] = 1; });
  assert.equal(r.nullAt, 43); // poll 21 ok, poll 41 sees lost -> done 41 -> op 42 -> null 43
});

test('covers R4 (pin): capture null target completes at fire tick F, no poll', () => {
  const root = node('capture', 'b0', null, 0);
  const r = drive([{ op: 'steps', root }], base(), 20);
  assert.deepEqual(r.draws, {});
  assert.equal(r.nullAt, 3); // fire 1, op sees 2, null 3
});

test('covers R4 (pin): capture null own is not skipped; first poll finishes it', () => {
  const root = node('capture', null, 'b2', 0);
  const r = drive([{ op: 'steps', root }], base(), 60);
  assert.deepEqual(r.draws, { 1: ['0>2'] }); // fallback line fires
  assert.equal(r.nullAt, 23); // poll 21 -> own null => done; op 22; null 23
});

test('covers R4: steps with all nodes skipped at start completes in the first update', () => {
  const v = mk({ owner: [1, 0, 1, -1] });
  const r = drive([{ op: 'steps', root: node('line', 'b0', 'b2', 100) }, { op: 'delay', ms: 0 }], v, 10);
  // root skipped tick 0, op done 0, delay starts 0 first update 1 done, null at 2
  assert.equal(r.nullAt, 2);
});

test('covers R2/R4: no script-op tick runs default logic; zero towers freezes script timers', () => {
  const v = mk({ owner: [1, 1, 1, -1] });
  const r = drive([{ op: 'delay', ms: 100 }], v, 50);
  assert.equal(r.nullAt, null);
  v.buildings.owner[0] = 0;
  const run = bots.createScriptRunner([{ op: 'delay', ms: 100 }]);
  const ctx = { view: v, canDraw: allow };
  assert.deepEqual(run(ctx, 0, 0, noRng), []);
});

test('covers R4: unresolved ids behave as null', () => {
  const r = drive([{ op: 'line', own: 'zzz', target: 'b2', afterMs: 0 }], base(), 3);
  assert.deepEqual(r.draws, { 0: ['0>2'] });
});

test('covers R2/R4: script -> default handoff with timer 0 through createSeatBot; scripts use no RNG', () => {
  const v = mk({ owner: [0, 1, -1, -1] });
  // single-tower seat, script = delay 100 (done tick 2, runner null at 3 -> seat default first update tick 3)
  const params = { kind: 'tw', actionDelayMs: 100, behavior: 'attackOnly', script: [{ op: 'delay', ms: 100 }] };
  const bot = bots.createSeatBot({}, 5, 0, params);
  const acts = [];
  for (let t = 0; t < 12; t++) if (bot.decide({ view: v, canDraw: allow }, t).length) acts.push(t);
  // default timer 0 at tick 3: update #1 (3) add 50, #2 (4) add 50 -> 100, #3 (5) act
  assert.deepEqual(acts, [5, 8, 11]);
});

test('covers R5: seat with empty/absent script goes straight to default', () => {
  const v = mk({ owner: [0, 1], init: [0, 1] });
  const bot = bots.createSeatBot({}, 5, 0, { kind: 'tw', actionDelayMs: 100, behavior: 'attackOnly', script: [] });
  const acts = [];
  for (let t = 0; t < 8; t++) if (bot.decide({ view: v, canDraw: allow }, t).length) acts.push(t);
  assert.deepEqual(acts, [2, 5]);
});
