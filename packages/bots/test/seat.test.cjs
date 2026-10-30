const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const bots = require('../src/index.ts');
const sim = require('../../sim/src/index.ts');
const fx = require('../../sim/test/fixtures.cjs');

/** Hand-built SimView stub: just the fields the AI reads. */
function fakeView(spec) {
  const n = spec.owner.length;
  const lines = spec.lines ?? [];
  const lineCount = spec.owner.map((_, i) => lines.filter(l => l.from === i).length);
  return {
    over: null,
    ...(spec.teams ? { players: spec.teams.map(team => ({ team })) } : {}),
    ids: { buildings: spec.owner.map((_, i) => `b${i}`), players: ['p0', 'p1'], elements: [] },
    buildings: { owner: spec.owner, level: spec.level, lines: lineCount },
    buildingStatic: spec.owner.map((_, i) => ({
      x: spec.xz?.[i]?.[0] ?? i * 1000, z: spec.xz?.[i]?.[1] ?? 0,
      special: spec.special?.includes(i) ?? false, drawsLines: !(spec.noDraw?.includes(i)),
    })),
    lines: lines.map(l => ({ ...l, owner: spec.owner[l.from] })),
    freeSlots: i => (spec.slots?.[i] ?? 2) - lineCount[i],
  };
}
const seq = values => { let k = 0; return { below: n => { const v = values[k++ % values.length] % n; return v; } }; };
const allow = () => null;
const P = { actionDelayMs: 1700, behavior: 'full' };
const run = (view, canDraw, rng, st, params = P) => bots.decideDefault(view, canDraw, rng, 0, st, params);

test('covers R3: timer check-then-add with carry acts at ticks 34, 69, 104 (AD 1700)', () => {
  const view = fakeView({ owner: [0, 1], level: [5, 5] });
  const st = { timer: 0 };
  const acted = [];
  for (let t = 0; t < 110; t++) if (run(view, allow, seq([0]), st).length) acted.push(t);
  assert.deepEqual(acted, [34, 69, 104]);
});

test('covers R3: AD 1720 acts 35, 70, 106 (carry 30 then 10)', () => {
  const view = fakeView({ owner: [0, 1], level: [5, 5] });
  const st = { timer: 0 };
  const acted = [];
  for (let t = 0; t < 110; t++) if (run(view, allow, seq([0]), st, { ...P, actionDelayMs: 1720 }).length) acted.push(t);
  assert.deepEqual(acted, [35, 70, 106]);
});

test('covers R3: sort key is L, or idiv(2L+1,3) for special; tie by index', () => {
  const view = fakeView({ owner: [0, 1, 1, 1, -1], level: [9, 7, 9, 7, 7], special: [2] });
  assert.equal(bots.targetKey(view, 1), 7);
  assert.equal(bots.targetKey(view, 2), 6); // idiv(19,3)
  assert.equal(bots.targetKey(view, 2), Math.round(9 / 1.5));
  for (const l of [0, 1, 2, 3, 4, 5, 10, 11, 20, 21]) {
    const v = fakeView({ owner: [1], level: [l], special: [0] });
    assert.equal(bots.targetKey(v, 0), Math.round(l / 1.5) , `L=${l}`);
  }
  // key: b1=7, b2=6(special), b3=7, b4=7 -> 2, then 1,3,4 by index
  assert.deepEqual(bots.sortedTargets(view, 0), [2, 1, 3, 4]);
});

test('covers R3: targets include neutrals, towers and all non-own owners, never own', () => {
  const view = fakeView({ owner: [0, 0, 1, -1], level: [1, 1, 50, 50] });
  assert.deepEqual(bots.sortedTargets(view, 0), [2, 3]);
});

test('covers R3: noLineBetween covers either direction and any owner', () => {
  const view = fakeView({ owner: [0, 1, -1], level: [5, 5, 5], lines: [{ from: 1, to: 0 }] });
  assert.equal(bots.noLineBetween(view, 0, 1), false); // reverse hostile line
  assert.equal(bots.noLineBetween(view, 1, 0), false);
  assert.equal(bots.noLineBetween(view, 0, 2), true);
  // attack skips the pair with the hostile reverse line, so it targets b2
  const st = { timer: 1700 };
  const out = run(view, allow, seq([0]), st, { ...P, behavior: 'attackOnly' });
  assert.deepEqual(out, [{ type: 'DrawLine', player: 0, from: 0, to: 2 }]);
});

test('covers R3: canDraw failure removes the candidate and tries the next', () => {
  const view = fakeView({ owner: [0, 0, 1], level: [5, 5, 5] });
  const canDraw = (_p, from) => (from === 0 ? 'blocked-obstacle' : null);
  const out = run(view, canDraw, seq([0]), { timer: 1700 });
  assert.deepEqual(out, [{ type: 'DrawLine', player: 0, from: 1, to: 2 }]);
});

test('covers R3: one rng.below(n) per candidate source tested', () => {
  const view = fakeView({ owner: [0, 0, 0, 1], level: [5, 5, 5, 5] });
  const draws = [];
  const rng = { below: n => { draws.push(n); return 0; } };
  const canDraw = (_p, from) => (from === 2 ? null : 'blocked-obstacle');
  const out = run(view, canDraw, rng, { timer: 1700 });
  assert.deepEqual(draws, [3, 2, 1]);
  assert.deepEqual(out, [{ type: 'DrawLine', player: 0, from: 2, to: 3 }]);
});

test('covers R3: defense picks nearest own, index tie-break; full only', () => {
  // b0 free; no enemy reachable (canDraw rejects non-own targets); own b1 and b2 equidistant, b3 farther
  const xz = [[0, 0], [1000, 0], [-1000, 0], [5000, 0], [9000, 0]];
  const view = fakeView({ owner: [0, 0, 0, 0, 1], level: [5, 5, 5, 5, 5], xz, slots: [2, 0, 0, 0, 2] });
  const canDraw = (_p, _f, to) => (to === 4 ? 'blocked-obstacle' : null);
  assert.deepEqual(run(view, canDraw, seq([0]), { timer: 1700 }), [{ type: 'DrawLine', player: 0, from: 0, to: 1 }]);
  // nearest already linked -> next nearest (b2)
  const linked = fakeView({ owner: [0, 0, 0, 0, 1], level: [5, 5, 5, 5, 5], xz, slots: [3, 0, 0, 0, 2], lines: [{ from: 1, to: 0 }] });
  assert.deepEqual(run(linked, canDraw, seq([0]), { timer: 1700 }), [{ type: 'DrawLine', player: 0, from: 0, to: 2 }]);
  // attackOnly never defends
  assert.deepEqual(run(view, canDraw, seq([0]), { timer: 1700 }, { ...P, behavior: 'attackOnly' }), []);
});

test('covers R3: attack preferred over defense; non-drawers and full seats excluded from sources', () => {
  const view = fakeView({ owner: [0, 0, 1], level: [5, 5, 5], noDraw: [0], slots: [2, 2, 2] });
  const out = run(view, allow, seq([0]), { timer: 1700 });
  assert.deepEqual(out, [{ type: 'DrawLine', player: 0, from: 1, to: 2 }]);
  const none = fakeView({ owner: [0, 1], level: [5, 5], slots: [0, 2] });
  assert.deepEqual(run(none, allow, seq([0]), { timer: 1700 }), []);
});

test('covers R2: zero-tower seat freezes timer and decides nothing', () => {
  const view = fakeView({ owner: [1, -1], level: [5, 5] });
  const st = { timer: 123 };
  for (let t = 0; t < 100; t++) assert.deepEqual(run(view, allow, seq([0]), st), []);
  assert.equal(st.timer, 123);
});

test('covers R2: emits only DrawLine, never CutLine', () => {
  const view = fakeView({ owner: [0, 0, 1], level: [5, 5, 5] });
  const st = { timer: 0 };
  for (let t = 0; t < 400; t++) for (const c of run(view, allow, seq([0, 1]), st)) assert.equal(c.type, 'DrawLine');
});

test('covers R2: seat with empty script hands to default with timer 0; script hook then default', () => {
  const level = fx.compiledGolden();
  const s = sim.create(level, 7);
  const ctx = bots.guardBotContext(s);
  const calls = [];
  const bot = bots.createSeatBot(level, 7, 1, { kind: 'tw', actionDelayMs: 1700, behavior: 'full' }, (c, tick) => { calls.push(tick); return tick < 3 ? [] : null; });
  const ticks = [];
  for (let t = 0; t < 40; t++) { if (bot.decide(ctx, t).length) ticks.push(t); }
  assert.deepEqual(calls, [0, 1, 2, 3]);
  // handoff at tick 3 (timer 0, never advanced there): first update is tick 3 itself -> acts 34 ticks after
  assert.deepEqual(ticks, [37]);
});

test('covers R2: fixed-seed decision sequence on fixture level (levelview-1, AD 1700)', () => {
  const level = fx.compiledGolden();
  const params = { kind: 'tw', actionDelayMs: 1700, behavior: 'full' };
  const play = seed => {
    const s = sim.create(level, seed);
    const bot = bots.createSeatBot(level, seed, 1, params);
    const log = [];
    for (let t = 0; t < 300; t++) {
      const cmds = bot.decide(bots.guardBotContext(s), s.view.tick);
      for (const c of cmds) assert.equal(s.canDraw(c.player, c.from, c.to), null);
      for (const c of cmds) log.push([t, c.from, c.to]);
      s.step(cmds);
    }
    return { log, hash: s.hash() };
  };
  const a = play(11);
  assert.deepEqual(play(11), a, 'same seed => identical log + sim hash');
  // b1 (ai, L10) picks weakest non-own first (b3 neutral house), then b4; later b1's capture b3 reinforces/attacks b2.
  assert.deepEqual(a.log, [[34, 1, 3], [69, 1, 4], [279, 3, 2]]);
});

test('covers R2: no sim RNG touched by the bot (sim snapshot streams equal with/without bot reads)', () => {
  const level = fx.compiledGolden();
  const a = sim.create(level, 5), b = sim.create(level, 5);
  const bot = bots.createSeatBot(level, 5, 1, { kind: 'tw', actionDelayMs: 50, behavior: 'full' });
  for (let t = 0; t < 60; t++) { bot.decide(bots.guardBotContext(a), t); a.step([]); b.step([]); }
  assert.equal(a.hash(), b.hash());
});

test('covers R2: runMatch drives level bots end-to-end with 0 rejected, deterministic', () => {
  const level = fx.compiledGolden();
  const r1 = bots.runMatch({ level, seed: 3, maxTicks: 400 });
  const r2 = bots.runMatch({ level, seed: 3, maxTicks: 400 });
  assert.equal(r1.stats.rejected, 0);
  assert.equal(r1.stats.finalHash, r2.stats.finalHash);
  assert.ok(r1.stats.commandCount >= 1);
});

test('startDelayMs: idles until delay elapsed, then normal cadence; absent = unchanged', () => {
  const view = fakeView({ owner: [0, 1], level: [5, 5] });
  const collect = (params) => {
    const st = { timer: 0 };
    const acted = [];
    for (let t = 0; t < 110; t++) if (run(view, allow, seq([0]), st, params).length) acted.push(t);
    return acted;
  };
  assert.deepEqual(collect({ ...P, startDelayMs: 0 }), collect(P));
  // 1000 ms = 20 ticks idle, then first action 34 ticks later, then every 35
  assert.deepEqual(collect({ ...P, startDelayMs: 1000 }), [54, 89]);
});

test('covers R3: pvp tie-break (key, dist2 to nearest own, index) mirrors targets across seats; default order unchanged', () => {
  // 0 = seat0 home (left), 1 = seat1 home (right), 2/3 = equal neutral houses near-left/near-right (2 listed first).
  const view = fakeView({ owner: [0, 1, -1, -1], level: [5, 5, 3, 3], xz: [[0, 0], [1000, 0], [250, 0], [750, 0]] });
  const first = (me, byDistance) => bots.sortedTargets(view, me, byDistance)[0];
  assert.equal(first(0, true), 2);
  assert.equal(first(1, true), 3);
  assert.equal(first(1, false), 2); // default: index tie only
  const pvp = { ...P, pvpTieBreak: true };
  const cmd = me => bots.decideDefault(view, allow, seq([0]), me, { timer: 1700 }, pvp)[0];
  assert.equal(cmd(0).to, 2);
  assert.equal(cmd(1).to, 3);
});

test('covers R10: bot in a 2v2 never targets or draws to ally buildings; neutrals and enemies stay targets', () => {
  // seats 0,1 = team 0; seats 2,3 = team 1. building owners: 0,1 allies; 2 enemy; 3 enemy; 4 neutral.
  const view = fakeView({ owner: [0, 1, 2, 3, -1], level: [5, 1, 4, 3, 2], teams: [0, 0, 1, 1] });
  assert.deepEqual(bots.sortedTargets(view, 0), [4, 3, 2]);
  assert.deepEqual(bots.sortedTargets(view, 0, true), [4, 3, 2]);
  const seen = [];
  const canDraw = (_p, _f, to) => { seen.push(to); return 'no'; };
  bots.decideDefault(view, canDraw, seq([0]), 0, { timer: 1700 }, P);
  assert.ok(seen.length > 0 && !seen.includes(1));
  // identity teams: ally filter inert
  const ffa = fakeView({ owner: [0, 1, 2, 3, -1], level: [5, 1, 4, 3, 2], teams: [0, 1, 2, 3] });
  assert.deepEqual(bots.sortedTargets(ffa, 0), [1, 4, 3, 2]);
});
