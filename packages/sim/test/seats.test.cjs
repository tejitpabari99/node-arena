const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { compiledGolden, metadata } = require('./fixtures.cjs');
const { createView, refreshView, snapshotState } = require('../src/read.ts');

const level3 = (teams) => {
  const l = structuredClone(compiledGolden());
  l.players.push({ id: 'p3', kind: 'ai', colorKey: 'green' });
  if (teams) l.players.forEach((p, i) => { p.team = teams[i]; });
  return l;
};

test('covers R-TEM-01: no setup means identity teams; hostility equals !== for every owner pair incl. neutral', () => {
  const s = api.createState(level3(), 1);
  assert.deepEqual(Array.from(s.team), [0, 1, 2]);
  for (let a = -1; a < 3; a++) for (let b = -1; b < 3; b++) assert.equal(api.hostile(s, a, b), a !== b, `${a},${b}`);
  assert.deepEqual(api.create(level3(), 1).view.players.map((p) => p.team), [0, 1, 2]);
  assert.equal(api.create(level3(), 1).view.eliminatedAt.length, 3);
  assert.ok(Array.from(api.create(level3(), 1).view.eliminatedAt).every((v) => v === -1));
});

test('covers R-TEM-01: level default teams applied; setup overrides; allies not hostile; neutral always hostile', () => {
  const pv = (t) => { const l = level3(t); l.objective = 'pvp'; return l; };
  const s = api.createState(pv([0, 1, 1]), 1);
  assert.deepEqual(Array.from(s.team), [0, 1, 1]);
  assert.equal(api.hostile(s, 1, 2), false);
  assert.equal(api.hostile(s, 0, 1), true);
  assert.equal(api.hostile(s, 1, -1), true);
  assert.equal(api.hostile(s, -1, -1), false);
  const o = api.createState(pv([0, 1, 1]), 1, { teams: [0, 0, 2] });
  assert.deepEqual(Array.from(o.team), [0, 0, 2]);
  assert.equal(api.hostile(o, 0, 1), false);
  assert.equal(api.hostile(o.team, 1, 2), true);
});

test('covers R-SEA-01: SeatSetup validation rejects too long/short length, out-of-range, non-integer and single team', () => {
  const l = level3(); l.objective = 'pvp';
  for (const teams of [[0], [], [0, 1, 1, 0], [0, 1, 3], [0, 1, -1], [0, 1, 0.5], [0, 0, 0], [0, 1, '1'], [0, 1, NaN]]) {
    assert.throws(() => api.create(l, 1, { teams }), /SeatSetup/, JSON.stringify(teams));
  }
  assert.throws(() => api.create(l, 1, {}), /SeatSetup/);
  assert.doesNotThrow(() => api.create(l, 1, { teams: [0, 1, 2] }));
  assert.equal(api.create(l, 1, { teams: [0, 1] }).view.players.length, 2); // Prefix of slots
});

test('covers R-SEA-01: SeatSetup on a captureAll level throws; crafted campaign replay with header teams is rejected', () => {
  const c = compiledGolden();
  assert.notEqual(c.objective, 'pvp');
  assert.throws(() => api.create(c, 3, { teams: [0, 1] }), /SeatSetup/);
  assert.throws(() => api.createReplayRecorder(c, 3, metadata, { teams: [0, 1] }));
  const rec = api.createReplayRecorder(c, 3, metadata);
  rec.step([]);
  const r = rec.record();
  r.header.teams = [0, 1];
  assert.throws(() => api.playReplay({ metadata, level: c }, r), /Invalid/i);
});

test('covers R-SEA-01: replay header carries teams only when given and playback honors them', () => {
  const l = compiledGolden(); l.objective = 'pvp';
  const plain = api.createReplayRecorder(l, 3, metadata);
  assert.equal('teams' in plain.record().header, false);
  const rec = api.createReplayRecorder(l, 3, metadata, { teams: [0, 1] });
  rec.step([]);
  const r = rec.record();
  assert.deepEqual(r.header.teams, [0, 1]);
  const res = api.playReplay({ metadata, level: l }, r);
  assert.equal(res.ok, true);
  assert.deepEqual(res.sim.view.players.map((p) => p.team), [0, 1]);
  r.header.teams = [0, 0];
  assert.throws(() => api.playReplay({ metadata, level: l }, r), /Invalid|SeatSetup/);
});

const pvp3 = () => {
  const l = level3();
  l.objective = 'pvp';
  l.buildings[2].owner = 2;
  return l;
};
const elim = (s) => { s.events = []; api.winPass(s); const e = s.events; s.events = null; return e; };

test('covers R-ELM-01: seat eliminated at phase 9 when last building lost; final; ascending; event emitted', () => {
  const s = api.createState(pvp3(), 1);
  assert.deepEqual(elim(s), []);
  assert.deepEqual(Array.from(s.players.eliminatedAt), [-1, -1, -1]);
  s.tick = 7; s.buildings.owner[2] = 0; s.buildings.owner[1] = 0; // seats 1 and 2 lose everything
  const ev = elim(s);
  assert.deepEqual(ev.filter((e) => e.type === 'SeatEliminated').map((e) => e.player), [1, 2]);
  assert.deepEqual(Array.from(s.players.eliminatedAt), [-1, 7, 7]);
  s.tick = 9; s.buildings.owner[2] = 2; // would-be revival: final, no change, no event
  assert.deepEqual(elim(s), []);
  assert.deepEqual(Array.from(s.players.eliminatedAt), [-1, 7, 7]);
});

test('covers R-ELM-01: troops in transit keep a building-less seat alive (defensive branch)', () => {
  const s = api.createState(pvp3(), 1);
  s.buildings.owner[2] = 0;
  api.getChannel(s, 0, 1).troops.push(0, 0, 2, 0, 1, 1); // not constructible via rules (R-CPT-01); injected
  assert.deepEqual(elim(s), []);
  assert.equal(s.players.eliminatedAt[2], -1);
  api.getChannel(s, 0, 1).troops.len = 0;
  assert.equal(elim(s).length, 1);
  assert.equal(s.players.eliminatedAt[2], s.tick);
});

test('covers R-ELM-01: view exposes eliminatedAt; captureAll never eliminates', () => {
  const sim = api.create(pvp3(), 1);
  assert.deepEqual(Array.from(sim.view.eliminatedAt), [-1, -1, -1]);
  const c = api.createState(level3(), 1);
  c.buildings.owner[1] = 0;
  assert.deepEqual(elim(c), []);
  assert.deepEqual(Array.from(c.players.eliminatedAt), [-1, -1, -1]);
});

test('covers R-ELM-01: pvp hash tail reacts to eliminatedAt and winners; captureAll hash ignores them', () => {
  const p = api.createState(pvp3(), 1), h0 = api.hashState(p);
  p.players.eliminatedAt[2] = 5;
  const h1 = api.hashState(p);
  assert.notEqual(h1, h0);
  p.over = { outcome: 'won', winner: 0, winners: [0] };
  const h2 = api.hashState(p);
  p.over = { outcome: 'won', winner: 0, winners: [0, 1] };
  assert.notEqual(api.hashState(p), h2);
  const c = api.createState(level3(), 1), hc = api.hashState(c);
  c.players.eliminatedAt[2] = 5; c.over = { outcome: 'won', winner: 0, winners: [0, 1] };
  const hc2 = api.hashState(c);
  c.over = { outcome: 'won', winner: 0 };
  assert.equal(api.hashState(c), hc2);
  assert.notEqual(hc, hc2); // over block itself differs; tail words absent
});

// --- pvp outcome (R-WIN-04..06) ---
const pvpN = (owners, teams, limit = 10) => {
  const l = structuredClone(compiledGolden());
  while (l.players.length < teams.length) l.players.push({ id: `p${l.players.length + 1}`, kind: 'ai', colorKey: 'green' });
  l.players.forEach((p, i) => { p.team = teams[i]; });
  l.objective = 'pvp';
  l.timeLimitSec = limit;
  owners.forEach((o, i) => { l.buildings[i].owner = o; });
  return api.createState(l, 1);
};
const win = (s) => { s.events = []; api.winPass(s); const e = s.events; s.events = null; return e; };
const limitTick = (s) => s.level.timeLimitSec * 20;
const outcomeOnly = ({ outcome, winner, winners }) => ({ outcome, winner, ...(winners ? { winners } : {}) });

test('covers R-WIN-04: 1v1 last team standing is victory; event + view carry winners', () => {
  const s = pvpN([0, 0, 1], [0, 1]);
  assert.equal(s.over, null);
  s.buildings.owner[2] = 0;
  const ev = win(s);
  assert.deepEqual(outcomeOnly(s.over), { outcome: 'victory', winner: 0, winners: [0] });
  assert.deepEqual(ev.find((e) => e.type === 'MatchOver'), { type: 'MatchOver', outcome: 'victory', winner: 0, winners: [0] });
});

test('covers R-WIN-04: 2v2 eliminated teammate still a winner; victory beats time limit on final tick', () => {
  const s = pvpN([0, 1, 2, 3], [0, 0, 1, 1]);
  s.tick = 5; s.buildings.owner[3] = 1; s.buildings.owner[2] = 1; // team 1 gone; seat 0,1 keep one each
  const ev = win(s);
  assert.deepEqual(s.players.eliminatedAt.slice(0), Int32Array.from([-1, -1, 5, 5]));
  assert.deepEqual(outcomeOnly(s.over), { outcome: 'victory', winner: 0, winners: [0, 1] });
  assert.equal(ev.find((e) => e.type === 'MatchOver').winners.length, 2);
  const t = pvpN([0, 0, 1], [0, 1]); t.tick = limitTick(t); t.buildings.owner[2] = 0;
  win(t); assert.equal(t.over.outcome, 'victory');
});

test('covers R-WIN-05: timeout unique leader by buildings; no outcome before the limit', () => {
  const s = pvpN([0, 0, 1], [0, 1]);
  s.tick = limitTick(s) - 1; win(s); assert.equal(s.over, null);
  s.tick = limitTick(s); win(s);
  assert.deepEqual(outcomeOnly(s.over), { outcome: 'timeLimit', winner: 0, winners: [0] });
});

test('covers R-WIN-05: building tie broken by garrison (levels) plus troops in transit', () => {
  const s = pvpN([0, 1], [0, 1]);
  s.buildings.level[0] = 2; s.buildings.level[1] = 2;
  s.tick = limitTick(s);
  api.getChannel(s, 1, 0).troops.push(0, 0, 1, 0, 1, 1); // seat 1 troop in transit
  win(s);
  assert.deepEqual(outcomeOnly(s.over), { outcome: 'timeLimit', winner: 1, winners: [1] });
  const g = pvpN([0, 1], [0, 1]); g.buildings.level[0] = 3; g.buildings.level[1] = 1; g.tick = limitTick(g);
  win(g); assert.deepEqual(outcomeOnly(g.over), { outcome: 'timeLimit', winner: 0, winners: [0] });
});

test('covers R-WIN-06: exact tie at limit is draw with both teams as winners', () => {
  const s = pvpN([0, 1], [0, 1]);
  s.buildings.level[0] = 2; s.buildings.level[1] = 2; s.tick = limitTick(s);
  const ev = win(s);
  assert.deepEqual(outcomeOnly(s.over), { outcome: 'draw', winner: null, winners: [0, 1] });
  assert.equal(ev.find((e) => e.type === 'MatchOver').outcome, 'draw');
});

test('covers R-WIN-06: 3 teams, top two tie, third excluded', () => {
  const t = pvpN([0, 1, 2], [0, 1, 2]);
  for (let i = 0; i < 3; i++) t.buildings.level[i] = 3;
  t.buildings.level[2] = 1; t.tick = limitTick(t); win(t);
  assert.deepEqual(outcomeOnly(t.over), { outcome: 'draw', winner: null, winners: [0, 1] });
});

test('covers R-WIN-06: zero teams alive is draw with empty winners and null winner', () => {
  const s = pvpN([0, 1], [0, 1]);
  s.tick = 3; s.buildings.owner[0] = -1; s.buildings.owner[1] = -1;
  win(s);
  assert.deepEqual(outcomeOnly(s.over), { outcome: 'draw', winner: null, winners: [] });
});

test('covers R-WIN-01: captureAll outcomes unchanged and carry no winners', () => {
  const s = api.createState(level3(), 1);
  s.buildings.owner.fill(0);
  const ev = win(s);
  assert.deepEqual(s.over, { outcome: 'won', winner: 0 });
  assert.deepEqual(ev.find((e) => e.type === 'MatchOver'), { type: 'MatchOver', outcome: 'won', winner: 0 });
});

// Literal expectations catch wrong live/eliminated ordering, team aggregation, ties and hash leakage.
test('covers R-WIN-07: live teams rank by buildings then total troops; ties share competition rank', () => {
  const s = pvpN([0, 1, 2, 3], [0, 1, 2, 3]);
  s.buildings.level.set([3, 4, 3, 2]);
  api.getChannel(s, 0, 1).troops.push(0, 0, 0, 0, 1, 1);
  s.tick = limitTick(s); win(s);
  assert.deepEqual(s.over.ranking, [
    { team: 0, seats: [0], rank: 1, buildings: 1, troops: 4, eliminatedAt: null },
    { team: 1, seats: [1], rank: 1, buildings: 1, troops: 4, eliminatedAt: null },
    { team: 2, seats: [2], rank: 3, buildings: 1, troops: 3, eliminatedAt: null },
    { team: 3, seats: [3], rank: 4, buildings: 1, troops: 2, eliminatedAt: null },
  ]);
});

test('covers R-WIN-07: placement uses all allied seats and the last eliminated seat tick', () => {
  const s = pvpN([0, 1, 2, 3], [2, 0, 0, 1]);
  s.tick = 5; s.buildings.owner[1] = 0; win(s);
  assert.equal(s.over, null);
  s.tick = 9; s.buildings.owner[2] = 0; win(s);
  assert.equal(s.over, null);
  s.tick = 12; s.buildings.owner[3] = 0; win(s);
  assert.deepEqual(s.over.ranking, [
    { team: 2, seats: [0], rank: 1, buildings: 4, troops: 39, eliminatedAt: null },
    { team: 1, seats: [3], rank: 2, buildings: 0, troops: 0, eliminatedAt: 12 },
    { team: 0, seats: [1, 2], rank: 3, buildings: 0, troops: 0, eliminatedAt: 9 },
  ]);
});

test('covers R-WIN-07: simultaneously eliminated teams tie below live teams; zero survivors still rank', () => {
  const s = pvpN([0, 1, 2], [0, 1, 2]);
  s.tick = 7; s.buildings.owner.fill(0); win(s);
  assert.deepEqual(s.over.ranking.map(({ team, rank, eliminatedAt }) => ({ team, rank, eliminatedAt })), [
    { team: 0, rank: 1, eliminatedAt: null }, { team: 1, rank: 2, eliminatedAt: 7 }, { team: 2, rank: 2, eliminatedAt: 7 },
  ]);
  const empty = pvpN([0, 1], [0, 1]); empty.tick = 3; empty.buildings.owner.fill(-1); win(empty);
  assert.deepEqual(empty.over.ranking, [
    { team: 0, seats: [0], rank: 1, buildings: 0, troops: 0, eliminatedAt: 3 },
    { team: 1, seats: [1], rank: 1, buildings: 0, troops: 0, eliminatedAt: 3 },
  ]);
});

test('covers R-WIN-07: ranking is final metadata, absent during play and campaign; snapshots own nested copies; hashes exclude it', () => {
  const s = pvpN([0, 1], [0, 1]);
  win(s); assert.equal(s.over, null);
  s.tick = limitTick(s); win(s);
  const view = createView(s); refreshView(view, s);
  assert.deepEqual(view.over.ranking, s.over.ranking);
  const snap = snapshotState(s), hash = api.hashState(s);
  snap.over.ranking[0].seats.push(99); snap.over.ranking[0].troops = 999;
  assert.deepEqual(s.over.ranking[0].seats, [0]);
  assert.notEqual(s.over.ranking[0].troops, 999);
  s.over.ranking[0].rank = 99;
  assert.equal(api.hashState(s), hash);
  const c = api.createState(level3(), 1); c.buildings.owner.fill(0); win(c);
  assert.equal('ranking' in c.over, false);
});

test('covers R-WIN-07: building count beats troop count and surviving allied team includes eliminated seats', () => {
  const s = pvpN([0, 0, 2, 3], [0, 0, 1, 2]);
  s.buildings.level.set([1, 1, 50, 20]); s.tick = limitTick(s); win(s);
  assert.deepEqual(s.over.ranking, [
    { team: 0, seats: [0, 1], rank: 1, buildings: 2, troops: 2, eliminatedAt: null },
    { team: 1, seats: [2], rank: 2, buildings: 1, troops: 50, eliminatedAt: null },
    { team: 2, seats: [3], rank: 3, buildings: 1, troops: 20, eliminatedAt: null },
  ]);
});

// --- dynamic seats (R-SEA-01): n of N slots; unused slots' buildings neutral ---
const { content } = require('./fixtures.cjs');
const { dataFiles } = require('./fixtures.cjs');
const loadedLevels = () => content.loadContent(dataFiles()).compiled;
const identity = (n) => Array.from({ length: n }, (_, i) => i);
const teamsFor = (n) => (n === 2 ? [0, 1] : n === 3 ? [0, 1, 2] : [0, 1, 0, 1]);

test('covers R-SEA-01: forSeats keeps first n slots, neutralizes unused slots buildings at authored level, same id/simHash', () => {
  const cross = loadedLevels()['na-pvp-cross'];
  assert.equal(cross.players.length, 4);
  for (const n of [2, 3]) {
    const r = api.forSeats(cross, n);
    assert.deepEqual(r.players.map((p) => p.id), cross.players.slice(0, n).map((p) => p.id));
    assert.equal(r.id, cross.id);
    assert.equal(r.simHash, cross.simHash);
    assert.equal(r.buildings.length, cross.buildings.length);
    cross.buildings.forEach((b, i) => {
      assert.equal(r.buildings[i].owner, b.owner >= n ? -1 : b.owner, `n=${n} b${i}`);
      assert.equal(r.buildings[i].level, b.level);
      assert.equal(r.buildings[i].id, b.id);
    });
    assert.ok(cross.buildings.some((b) => b.owner >= n), 'fixture has unused-slot buildings');
  }
  assert.equal(api.forSeats(cross, 4), cross);
  const before = JSON.stringify(cross);
  api.forSeats(cross, 2);
  assert.equal(JSON.stringify(cross), before, 'pure: input not mutated');
});

test('covers R-SEA-01: create with n < N on cross; unused homes neutral in sim.view; players indexed 0..n-1', () => {
  const cross = loadedLevels()['na-pvp-cross'];
  for (const n of [2, 3, 4]) {
    const sim = api.create(cross, 7, { teams: teamsFor(n) });
    assert.equal(sim.view.players.length, n, `players n=${n}`);
    assert.equal(sim.view.eliminatedAt.length, n);
    cross.buildings.forEach((b, i) => {
      const want = b.owner >= n ? -1 : b.owner;
      assert.equal(sim.view.buildings.owner[i], want, `n=${n} b${i}`);
    });
  }
  const sim = api.create(cross, 7, { teams: [0, 1] });
  assert.ok(Array.from(sim.view.buildings.owner).some((o) => o === -1));
  assert.ok(Array.from(sim.view.buildings.owner).every((o) => o >= -1 && o < 2));
  const none = (() => { const s = api.createState(cross, 7, { teams: [0, 1] }); return Array.from(s.players.eliminatedAt); })();
  assert.deepEqual(none, [-1, -1]);
});

test('covers R-SEA-01: duel maps run with n = 2 (full N) unchanged; pvp levels reject n outside 2..N', () => {
  const all = loadedLevels();
  for (const id of ['na-pvp-duel-s', 'na-pvp-duel-m']) {
    const l = all[id];
    assert.equal(l.players.length, 2);
    assert.equal(api.forSeats(l, 2), l);
    assert.doesNotThrow(() => api.create(l, 3, { teams: [0, 1] }));
    assert.throws(() => api.create(l, 3, { teams: [0, 1, 2] }), /SeatSetup/);
    assert.throws(() => api.create(l, 3, { teams: [0] }), /SeatSetup/);
  }
  const cross = all['na-pvp-cross'];
  assert.throws(() => api.create(cross, 3, { teams: [0, 1, 0, 1, 0] }), /SeatSetup/);
  assert.throws(() => api.create(cross, 3, { teams: [0] }), /SeatSetup/);
  assert.throws(() => api.create(cross, 3, { teams: [0, 0] }), /SeatSetup/);
  assert.throws(() => api.create(cross, 3, { teams: [0, 2] }), /SeatSetup/);
});

test('covers R-SEA-01: full-N hash unchanged by seat reduction path; n < N hash differs', () => {
  const cross = loadedLevels()['na-pvp-cross'];
  const defaults = cross.players.map((p) => p.team);
  const h = (setup) => api.hashState(api.createState(cross, 5, setup));
  assert.equal(h({ teams: defaults }), h(undefined), 'explicit full-N setup equals authored default');
  assert.equal(h({ teams: defaults }), api.hashState(api.createState(api.forSeats(cross, 4), 5, { teams: defaults })));
  assert.notEqual(h({ teams: [0, 1] }), h({ teams: defaults }));
  assert.notEqual(h({ teams: [0, 1] }), h({ teams: [0, 1, 2] }));
  const d = loadedLevels()['na-pvp-duel-s'];
  assert.equal(api.hashState(api.createState(d, 5, { teams: [0, 1] })), api.hashState(api.createState(d, 5)));
});

test('covers R-SEA-01: unused-slot neutral buildings behave as neutral (no growth for owner, capturable count as neutral); deterministic run to a step', () => {
  const cross = loadedLevels()['na-pvp-cross'];
  const a = api.create(cross, 9, { teams: [0, 1] }), b = api.create(cross, 9, { teams: [0, 1] });
  for (let i = 0; i < 200; i++) { a.step([]); b.step([]); }
  assert.equal(a.hash(), b.hash());
  const neutrals = Array.from(a.view.buildings.owner).map((o, i) => (o === -1 ? i : -1)).filter((i) => i >= 0);
  assert.ok(neutrals.length > 0);
  for (const i of neutrals) assert.equal(a.view.buildings.owner[i], -1);
});

test('covers R-SEA-01: replay with n < N records teams, plays back ok and detects tamper', () => {
  const cross = loadedLevels()['na-pvp-cross'];
  for (const n of [2, 3]) {
    const setup = { teams: teamsFor(n) };
    const rec = api.createReplayRecorder(cross, 4, metadata, setup);
    for (let i = 0; i < 30; i++) rec.step([]);
    const r = rec.record();
    assert.deepEqual(r.header.teams, setup.teams);
    const res = api.playReplay({ metadata, level: cross }, r);
    assert.equal(res.ok, true, `n=${n}`);
    assert.equal(res.sim.view.players.length, n);
    r.header.teams = [...setup.teams, 0, 1, 0, 1];
    assert.throws(() => api.playReplay({ metadata, level: cross }, r), /Invalid|SeatSetup/);
  }
});

// --- n < N: neutral dead-slot buildings in outcome logic ---
const crossN = (n, teams) => api.createState(loadedLevels()['na-pvp-cross'], 3, { teams: teams ?? teamsFor(n) });
const unusedIdx = (n) => loadedLevels()['na-pvp-cross'].buildings.map((b, i) => (b.owner >= n ? i : -1)).filter((i) => i >= 0);
const ownedIdx = (s, seat) => Array.from(s.buildings.owner).map((o, i) => (o === seat ? i : -1)).filter((i) => i >= 0);

test('covers R-SEA-01: a captured unused-slot building counts for its captor (keeps seat alive, ranks as a building)', () => {
  const s = crossN(2);
  const dead = unusedIdx(2);
  assert.ok(dead.length > 0);
  assert.ok(dead.every((i) => s.buildings.owner[i] === -1));
  for (const i of ownedIdx(s, 1)) s.buildings.owner[i] = 0; // seat 1 loses every authored building ...
  s.buildings.owner[dead[0]] = 1; // ... but holds one captured neutral from the dead slot
  s.tick = 5;
  const ev = win(s);
  assert.equal(s.players.eliminatedAt[1], -1, 'captured building keeps seat 1 alive');
  assert.deepEqual(ev.filter((e) => e.type === 'SeatEliminated'), []);
  assert.equal(s.over, null);
  // timeout ranking counts it as a building
  s.tick = limitTick(s);
  win(s);
  const row = s.over.ranking.find((r) => r.seats.includes(1));
  assert.equal(row.buildings, 1);
  assert.ok(s.over.ranking.find((r) => r.seats.includes(0)).buildings > 1);
});

test('covers R-SEA-01: victory and elimination ignore the dead slot; remaining neutral buildings are not an enemy team', () => {
  const s = crossN(3);
  const dead = unusedIdx(3);
  assert.ok(dead.length > 0);
  s.tick = 9;
  for (const i of [...ownedIdx(s, 1), ...ownedIdx(s, 2)]) s.buildings.owner[i] = 0; // seats 1,2 lose everything
  const ev = win(s);
  assert.deepEqual(ev.filter((e) => e.type === 'SeatEliminated').map((e) => e.player), [1, 2]);
  assert.equal(s.players.eliminatedAt.length, 3, 'no phantom seat 3');
  assert.deepEqual(outcomeOnly(s.over), { outcome: 'victory', winner: 0, winners: [0] });
  assert.ok(dead.every((i) => s.buildings.owner[i] === -1), 'dead-slot buildings stay neutral at victory');
  // draw / zero survivors path also ignores the dead slot
  const z = crossN(2);
  for (const i of [...ownedIdx(z, 0), ...ownedIdx(z, 1)]) z.buildings.owner[i] = -1;
  win(z);
  assert.deepEqual(Array.from(z.players.eliminatedAt), [0, 0]);
  assert.equal(z.over.outcome, 'draw');
});

test('covers R-SEA-01: forSeats edge inputs: n >= N returns the same level, invalid n throws, n < 2 is reduced but unplayable', () => {
  const cross = loadedLevels()['na-pvp-cross'];
  const N = cross.players.length;
  assert.equal(api.forSeats(cross, N), cross);
  assert.equal(api.forSeats(cross, N + 1), cross);
  assert.equal(api.forSeats(cross, 99), cross);
  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, '3', null, undefined]) assert.throws(() => api.forSeats(cross, bad), /invalid seat count/, String(bad));
  assert.equal(api.forSeats(cross, 0).players.length, 0);
  const one = api.forSeats(cross, 1);
  assert.equal(one.players.length, 1);
  assert.ok(one.buildings.every((b) => b.owner <= 0));
  assert.throws(() => api.create(cross, 1, { teams: [0] }), /SeatSetup/, 'create still requires 2 seats');
  // idempotent: reducing an already reduced level again is a no-op by value
  const two = api.forSeats(cross, 2);
  assert.deepEqual(api.forSeats(two, 2), two);
  assert.equal(api.forSeats(two, 3), two);
});

test('covers R-SEA-01: non-pvp objective is unaffected by seat reduction (all players and owners kept)', () => {
  const c = compiledGolden();
  assert.notEqual(c.objective, 'pvp');
  const sim = api.create(c, 3);
  assert.equal(sim.view.players.length, c.players.length);
  c.buildings.forEach((b, i) => assert.equal(sim.view.buildings.owner[i], b.owner));
  assert.throws(() => api.create(c, 3, { teams: [0, 1].slice(0, c.players.length - 1) }), /SeatSetup/);
  assert.equal(api.createState(c, 3).level, c, 'no reduction path for captureAll');
});
