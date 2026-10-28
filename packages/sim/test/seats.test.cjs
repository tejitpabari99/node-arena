const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { compiledGolden, metadata } = require('./fixtures.cjs');

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
  const s = api.createState(level3([0, 1, 1]), 1);
  assert.deepEqual(Array.from(s.team), [0, 1, 1]);
  assert.equal(api.hostile(s, 1, 2), false);
  assert.equal(api.hostile(s, 0, 1), true);
  assert.equal(api.hostile(s, 1, -1), true);
  assert.equal(api.hostile(s, -1, -1), false);
  const o = api.createState(level3([0, 1, 1]), 1, { teams: [0, 0, 2] });
  assert.deepEqual(Array.from(o.team), [0, 0, 2]);
  assert.equal(api.hostile(o, 0, 1), false);
  assert.equal(api.hostile(o.team, 1, 2), true);
});

test('covers R-SEA-01: SeatSetup validation rejects bad length, out-of-range, non-integer and single team', () => {
  const l = level3();
  for (const teams of [[0, 1], [0, 1, 1, 0], [0, 1, 3], [0, 1, -1], [0, 1, 0.5], [0, 0, 0], [0, 1, '1'], [0, 1, NaN]]) {
    assert.throws(() => api.create(l, 1, { teams }), /SeatSetup/, JSON.stringify(teams));
  }
  assert.throws(() => api.create(l, 1, {}), /SeatSetup/);
  assert.doesNotThrow(() => api.create(l, 1, { teams: [0, 1, 2] }));
});

test('covers R-SEA-01: setup does not change campaign hash; replay header carries teams only when given and playback honors them', () => {
  const l = compiledGolden();
  assert.equal(api.create(l, 3).hash(), api.create(l, 3, { teams: [0, 1] }).hash());
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

test('covers R-WIN-04: 1v1 last team standing is victory; event + view carry winners', () => {
  const s = pvpN([0, 0, 1], [0, 1]);
  assert.equal(s.over, null);
  s.buildings.owner[2] = 0;
  const ev = win(s);
  assert.deepEqual(s.over, { outcome: 'victory', winner: 0, winners: [0] });
  assert.deepEqual(ev.find((e) => e.type === 'MatchOver'), { type: 'MatchOver', outcome: 'victory', winner: 0, winners: [0] });
});

test('covers R-WIN-04: 2v2 eliminated teammate still a winner; victory beats time limit on final tick', () => {
  const s = pvpN([0, 1, 2, 3], [0, 0, 1, 1]);
  s.tick = 5; s.buildings.owner[3] = 1; s.buildings.owner[2] = 1; // team 1 gone; seat 0,1 keep one each
  const ev = win(s);
  assert.deepEqual(s.players.eliminatedAt.slice(0), Int32Array.from([-1, -1, 5, 5]));
  assert.deepEqual(s.over, { outcome: 'victory', winner: 0, winners: [0, 1] });
  assert.equal(ev.find((e) => e.type === 'MatchOver').winners.length, 2);
  const t = pvpN([0, 0, 1], [0, 1]); t.tick = limitTick(t); t.buildings.owner[2] = 0;
  win(t); assert.equal(t.over.outcome, 'victory');
});

test('covers R-WIN-05: timeout unique leader by buildings; no outcome before the limit', () => {
  const s = pvpN([0, 0, 1], [0, 1]);
  s.tick = limitTick(s) - 1; win(s); assert.equal(s.over, null);
  s.tick = limitTick(s); win(s);
  assert.deepEqual(s.over, { outcome: 'timeLimit', winner: 0, winners: [0] });
});

test('covers R-WIN-05: building tie broken by garrison (levels) plus troops in transit', () => {
  const s = pvpN([0, 1], [0, 1]);
  s.buildings.level[0] = 2; s.buildings.level[1] = 2;
  s.tick = limitTick(s);
  api.getChannel(s, 1, 0).troops.push(0, 0, 1, 0, 1, 1); // seat 1 troop in transit
  win(s);
  assert.deepEqual(s.over, { outcome: 'timeLimit', winner: 1, winners: [1] });
  const g = pvpN([0, 1], [0, 1]); g.buildings.level[0] = 3; g.buildings.level[1] = 1; g.tick = limitTick(g);
  win(g); assert.deepEqual(g.over, { outcome: 'timeLimit', winner: 0, winners: [0] });
});

test('covers R-WIN-06: exact tie at limit is draw with both teams as winners', () => {
  const s = pvpN([0, 1], [0, 1]);
  s.buildings.level[0] = 2; s.buildings.level[1] = 2; s.tick = limitTick(s);
  const ev = win(s);
  assert.deepEqual(s.over, { outcome: 'draw', winner: 0, winners: [0, 1] });
  assert.equal(ev.find((e) => e.type === 'MatchOver').outcome, 'draw');
});

test('covers R-WIN-06: 3 teams, top two tie, third excluded', () => {
  const s = pvpN([0, 1, 2, 2], [0, 1, 2]);
  s.buildings.level[0] = 2; s.buildings.level[1] = 2; s.buildings.level[2] = 0; s.buildings.level[3] = 0;
  s.buildings.owner[3] = 2;
  s.buildings.owner[0] = 0; s.buildings.owner[1] = 1;
  s.tick = limitTick(s); win(s);
  // team 2 owns 2 buildings -> best; make it fewer: reassign
  assert.equal(s.over.outcome, 'timeLimit');
  const t = pvpN([0, 1, 2], [0, 1, 2]);
  for (let i = 0; i < 3; i++) t.buildings.level[i] = 3;
  t.buildings.level[2] = 1; t.tick = limitTick(t); win(t);
  assert.deepEqual(t.over, { outcome: 'draw', winner: 0, winners: [0, 1] });
});

test('covers R-WIN-06: zero teams alive is draw with empty winners and null winner', () => {
  const s = pvpN([0, 1], [0, 1]);
  s.tick = 3; s.buildings.owner[0] = -1; s.buildings.owner[1] = -1;
  win(s);
  assert.deepEqual(s.over, { outcome: 'draw', winner: null, winners: [] });
});

test('covers R-WIN-01: captureAll outcomes unchanged and carry no winners', () => {
  const s = api.createState(level3(), 1);
  s.buildings.owner.fill(0);
  const ev = win(s);
  assert.deepEqual(s.over, { outcome: 'won', winner: 0 });
  assert.deepEqual(ev.find((e) => e.type === 'MatchOver'), { type: 'MatchOver', outcome: 'won', winner: 0 });
});
