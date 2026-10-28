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
