const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/index.ts');
const { step } = require('../src/tick.ts');
const { compiledGolden } = require('./fixtures.cjs');

// levelview-1: b0 human(p0), b1 ai(p1), rest neutral (-1).
const mk = (edit, seed = 3) => { const l = compiledGolden(); if (edit) edit(l); const s = api.createState(l, seed); s.events = []; return s; };
const N = () => compiledGolden().buildings.length;
const humanOwnsAllNonIgnored = (s) => { for (let i = 0; i < s.buildings.n; i++) if (!s.buildings.ignoreForWin[i]) s.buildings.owner[i] = 0; };
const run = (s, ticks = 1, events = true) => { let ev = []; for (let i = 0; i < ticks; i++) ev = ev.concat(step(s, [], events)); return ev; };

test('covers R-WIN-01: human owning every non-ignored building wins in phase 9; ignored buildings flip', () => {
  const s = mk((l) => { l.buildings[2].ignoreForWin = true; l.buildings[3].ignoreForWin = true; });
  humanOwnsAllNonIgnored(s);
  assert.equal(s.buildings.owner[2], -1);
  const ev = run(s);
  assert.deepEqual(s.over, { outcome: 'won', winner: 0 });
  assert.equal(s.buildings.owner[2], 0);
  assert.equal(s.buildings.owner[3], 0);
  assert.deepEqual(ev.filter((e) => e.type === 'MatchOver'), [{ type: 'MatchOver', outcome: 'won', winner: 0 }]);
});

test('covers R-WIN-01: one non-ignored hostile or neutral building prevents the win; ignored ones do not count', () => {
  const s = mk((l) => { l.buildings[2].ignoreForWin = true; });
  humanOwnsAllNonIgnored(s);
  s.buildings.owner[4] = -1;
  run(s);
  assert.equal(s.over, null);
  s.buildings.owner[4] = 0;
  run(s);
  assert.equal(s.over.outcome, 'won');
});

test('covers R-WIN-02: human with no non-ignored building loses, winner null; troops in transit do not count; ignored owned does not save', () => {
  const s = mk((l) => { l.buildings[2].ignoreForWin = true; });
  s.buildings.owner[2] = 0;
  s.buildings.owner[0] = 1; // human lost its only non-ignored building
  api.spawnTroop(s, 2, 1, 0); // human troop still in flight
  const ev = run(s);
  assert.deepEqual(s.over, { outcome: 'lost', winner: null });
  assert.deepEqual(ev.filter((e) => e.type === 'MatchOver'), [{ type: 'MatchOver', outcome: 'lost', winner: null }]);
  assert.equal(s.buildings.owner[2], 0, 'no flip on loss');
});

test('covers R-WIN-03: timeLimitTicks = timeLimitSec * 20; timeout at tick >= limit; null/absent means none', () => {
  const s = mk((l) => { l.timeLimitSec = 1; });
  assert.equal(api.create(s.level, 1).view.timeLimitTicks, 20);
  run(s, 19);
  assert.equal(s.over, null);
  const ev = run(s);
  assert.equal(s.tick, 20);
  assert.deepEqual(s.over, { outcome: 'timeout', winner: null });
  assert.deepEqual(ev.filter((e) => e.type === 'MatchOver'), [{ type: 'MatchOver', outcome: 'timeout', winner: null }]);
  const none = mk((l) => { l.timeLimitSec = null; });
  run(none, 200, false);
  assert.equal(none.over, null);
  assert.equal(api.create(none.level, 1).view.timeLimitTicks, 0);
});

test('covers R-WIN-01, R-WIN-03: order win -> loss -> timeout (last-tick win counts, Decision 6)', () => {
  const s = mk((l) => { l.timeLimitSec = 1; });
  run(s, 19);
  humanOwnsAllNonIgnored(s);
  run(s);
  assert.deepEqual(s.over, { outcome: 'won', winner: 0 });
  assert.equal(s.tick, 20);
});

test('covers R-WIN-03: outcome is final; later steps do not tick, change state, or re-emit; commands are gameover-rejected', () => {
  const s = mk();
  humanOwnsAllNonIgnored(s);
  run(s);
  const t = s.tick, over = { ...s.over };
  const ev = step(s, [{ type: 'DrawLine', player: 0, from: 0, to: 1 }], true);
  assert.equal(s.tick, t);
  assert.deepEqual(s.over, over);
  assert.deepEqual(ev, [{ type: 'CommandRejected', player: 0, command: 'DrawLine', reason: 'gameover' }]);
  assert.equal(api.create(s.level, 1).canDraw(0, 0, 1) === null, true);
});

test('covers R-WIN-01: view.over mirrors outcome through sim.step', () => {
  const sim = api.create(compiledGolden(), 5);
  assert.equal(sim.view.over, null);
  const l = compiledGolden();
  l.buildings.forEach((b) => { b.owner = 0; });
  const w = api.create(l, 5);
  w.step([]);
  assert.deepEqual(w.view.over, { outcome: 'won', winner: 0 });
  assert.equal(w.snapshot().over.outcome, 'won');
});

// ---- read API (R7) ----
test('R7 view: every field present and typed; columns borrowed (live), static data, units, ids', () => {
  const l = compiledGolden();
  const sim = api.create(l, 9);
  const v = sim.view;
  for (const k of ['tick', 'over', 'timeLimitSec' in l ? 'timeLimitTicks' : 'timeLimitTicks', 'bounds', 'ids', 'players', 'buildings', 'buildingStatic', 'elements', 'lines', 'units', 'freeSlots']) assert.ok(k in v, k);
  assert.deepEqual(v.ids.players, l.players.map((p) => p.id));
  assert.deepEqual(v.ids.elements, l.elements.map((e) => e.id));
  assert.deepEqual(v.players, l.players.map((p) => ({ kind: p.kind, colorKey: p.colorKey })));
  for (const k of ['owner', 'level', 'maxLevel', 'stage', 'lines', 'alive', 'ignoreForWin']) assert.equal(v.buildings[k].length, N(), k);
  assert.ok(Object.keys(v.buildings.col).length > 0);
  const st = v.buildingStatic[0];
  for (const k of ['x', 'z', 'kind', 'archetype', 'visual', 'footprint', 'special', 'drawsLines', 'initialOwner', 'modules']) assert.ok(k in st, k);
  assert.deepEqual(v.units.map((u) => Object.keys(u).sort()), l.units.map(() => ['attack', 'defense', 'hp', 'id', 'speed', 'visual']));
  assert.equal(v.elements, l.elements);
  sim.step([{ type: 'DrawLine', player: 0, from: 0, to: 1 }]);
  assert.equal(v.tick, 1);
  assert.equal(v.buildings.lines[0], 1);
});

test('R7 view.lines refreshed per tick in ascending channel key; freeSlots = stage - lines (0 for non-drawers)', () => {
  const l = compiledGolden();
  const sim = api.create(l, 9);
  const v = sim.view;
  const before = v.freeSlots(0);
  assert.equal(before, v.buildings.stage[0]);
  sim.step([{ type: 'DrawLine', player: 0, from: 0, to: 2 }, { type: 'DrawLine', player: 1, from: 1, to: 3 }]);
  assert.equal(v.lines.length, 2);
  assert.deepEqual(v.lines.map((x) => x.channel), v.lines.map((x) => x.channel).slice().sort((a, b) => a - b));
  assert.deepEqual(Object.keys(v.lines[0]).sort(), ['channel', 'drawSeq', 'from', 'length', 'owner', 'to']);
  assert.equal(v.freeSlots(0), before - 1);
  sim.step([{ type: 'CutLine', player: 0, from: 0, to: 2 }]);
  assert.equal(v.lines.length, 1);
  const nonDrawer = v.buildingStatic.findIndex((b) => !b.drawsLines);
  if (nonDrawer >= 0) assert.ok(v.freeSlots(nonDrawer) <= 0);
});

test('R7 readTroops: columns, constant speed, progress at tick, capped by buffer, order by channel key', () => {
  const l = compiledGolden();
  const sim = api.create(l, 9);
  sim.step([{ type: 'DrawLine', player: 0, from: 0, to: 2 }, { type: 'DrawLine', player: 1, from: 1, to: 3 }]);
  for (let i = 0; i < 80; i++) sim.step([]);
  const buf = api.createTroopBuffer(256);
  const n = sim.readTroops(buf);
  assert.ok(n > 0);
  const speedOf = (kind) => l.units[kind].speed;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    assert.equal(buf.speed[i], speedOf(buf.kind[i]));
    assert.ok(buf.progress[i] >= 0 && buf.hp[i] > 0);
    assert.ok(buf.channel[i] >= prev); prev = buf.channel[i];
    assert.ok([0, 1].includes(buf.owner[i]));
  }
  assert.equal(sim.readTroops(api.createTroopBuffer(1)), 1);
  const a = sim.readTroops(buf);
  sim.step([]);
  assert.ok(a === n);
});

test('R7 snapshot: plain JSON, hash matches sim.hash(), round-trips; recorder forwards read API', () => {
  const sim = api.create(compiledGolden(), 9);
  sim.step([{ type: 'DrawLine', player: 0, from: 0, to: 2 }]);
  for (let i = 0; i < 60; i++) sim.step([]);
  const snap = sim.snapshot();
  assert.equal(snap.hash, sim.hash());
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  assert.equal(snap.tick, 61);
  assert.equal(snap.fwd.length, N());
  const { metadata } = require('./fixtures.cjs');
  const rec = api.createReplayRecorder(compiledGolden(), 9, metadata);
  rec.step([]);
  assert.equal(typeof rec.readTroops, 'function');
  assert.equal(rec.snapshot().hash, rec.hash());
});

// ---- events ----
function busy(events, seed) {
  const l = compiledGolden();
  const sim = api.create(l, seed);
  const all = [];
  for (let t = 0; t < 600; t++) {
    const cmds = [];
    if (t % 25 === 1) cmds.push({ type: 'DrawLine', player: 0, from: 0, to: 1 + (Math.floor(t / 25) % 4) }, { type: 'DrawLine', player: 1, from: 1, to: 0 });
    if (t % 90 === 80) cmds.push({ type: 'CutLine', player: 0, from: 0, to: 1 }, { type: 'Bogus' });
    all.push(...sim.step(cmds, { events }));
  }
  return { hash: sim.hash(), events: all, sim };
}

test('R7 events: on/off hash parity across 10 seeds over a busy scenario; stream is deterministic', () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 10; seed++) {
    const on = busy(true, seed), off = busy(false, seed), on2 = busy(true, seed);
    assert.equal(on.hash, off.hash, `seed ${seed}`);
    assert.deepEqual(off.events, []);
    assert.deepEqual(on.events, on2.events);
    for (const e of on.events) kinds.add(e.type);
  }
  for (const k of ['LineDrawn', 'LineCut', 'TroopSpawned', 'TroopArrived', 'CommandRejected', 'BuildingCaptured']) assert.ok(kinds.has(k), `emitted ${k}`);
});
