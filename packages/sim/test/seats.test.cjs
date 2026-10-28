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
