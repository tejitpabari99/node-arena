const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { shoots } = require('../src/modules/shoots.ts');
const { compiledGolden } = require('./fixtures.cjs');

const withP3 = (l) => { l.players.push({ id: 'p3', kind: 'ai', colorKey: 'green' }); return l; };
const put = (s, from, to, progress, kind = 0) => {
  const seq = api.spawnTroop(s, from, to, kind);
  const r = api.getChannel(s, from, to).troops;
  r.p0[r.indexOfSeq(seq)] = progress;
  return seq;
};
const clashes = (s) => s.events.filter((e) => e.type === 'Clash');
const mk = (teams, edit) => { const l = withP3(compiledGolden()); if (edit) edit(l); const s = api.createState(l, 3, { teams }); s.events = []; return s; };

// head-on: buildings 0 (p0) and 1 (p1), troops mid-road meeting
test('covers R-TEM-02: allied head-on troops pass without clash; enemies still clash', () => {
  for (const [teams, expected] of [[[0, 0, 1], 0], [[0, 1, 1], 1], [[0, 1, 2], 1]]) {
    const s = mk(teams);
    const h = Math.ceil(api.getChannel(s, 0, 1).length / 2); put(s, 0, 1, h); put(s, 1, 0, h);
    api.headOnPass(s);
    assert.equal(clashes(s).length, expected, JSON.stringify(teams));
    assert.equal(api.getChannel(s, 0, 1).troops.len, expected ? 0 : 1);
    api.assertInvariants(s);
  }
});

test('covers R-TEM-02: allied exchange is a no-op; enemy exchange resolves', () => {
  const s = mk([0, 0, 1]);
  const a = put(s, 0, 1, 500), b = put(s, 1, 0, 500);
  assert.deepEqual(api.exchange(s, api.channelKey(s, 0, 1), a, api.channelKey(s, 1, 0), b), { aAlive: true, bAlive: true });
  assert.equal(clashes(s).length, 0);
  const e = mk([0, 1, 1]);
  const c = put(e, 0, 1, 500), d = put(e, 1, 0, 500);
  assert.deepEqual(api.exchange(e, api.channelKey(e, 0, 1), c, api.channelKey(e, 1, 0), d), { aAlive: false, bAlive: false });
});

function crossLevel() {
  const points = [[-2000, 0], [0, -2000], [2000, 0], [0, 2000], [3000, 3000]];
  const l = withP3(compiledGolden());
  l.elements = [];
  l.buildings.forEach((b, i) => { [b.x, b.z] = points[i]; b.owner = i === 1 ? 1 : 0; b.modules = { level: { maxLevel: 64 }, drawsLines: {} }; b.level = 30; });
  l.units = [{ id: 'soldier', visual: 'unit.soldier', speed: 5000, hp: 1, attack: 1, defense: 1 }];
  return l;
}
test('covers R-TEM-02: allied crossing lines never clash; hostile crossing does; mixed-team channel pair respects teams', () => {
  for (const [teams, expected] of [[[0, 0, 1], 0], [[0, 1, 1], 1], [[0, 1, 2], 1]]) {
    const s = api.createState(crossLevel(), 3, { teams }); s.events = [];
    put(s, 0, 2, 40000); put(s, 1, 3, 40000);
    api.crossingPass(s);
    assert.equal(clashes(s).length, expected, JSON.stringify(teams));
    api.assertInvariants(s);
  }
  // per-troop check: channel owner uniform differs but troops allied via owner overwrite
  const s = api.createState(crossLevel(), 3, { teams: [0, 1, 1] }); s.events = [];
  put(s, 0, 2, 40000); put(s, 1, 3, 40000);
  api.getChannel(s, 0, 2).troops.owner[0] = 1;
  api.crossingPass(s);
  assert.equal(clashes(s).length, 0);
});

function towerLevel() {
  const l = withP3(compiledGolden());
  const positions = [[-10000, 2000], [10000, 2000], [-10000, -2000], [10000, -2000], [0, 0]];
  l.buildings.forEach((b, i) => { [b.x, b.z] = positions[i]; b.level = i === 4 ? 1 : 0; if (i !== 4) delete b.modules.grows; });
  l.buildings[2].owner = 0; l.buildings[3].owner = 1; l.buildings[4].owner = 0;
  return l;
}
test('covers R-TEM-02: tower skips allied troops, shoots enemy troops', () => {
  for (const [teams, expected] of [[[0, 0, 1], 0], [[0, 1, 1], 1], [[0, 1, 2], 1]]) {
    const s = api.createState(towerLevel(), 9, { teams }); s.events = [];
    put(s, 1, 0, 200000);
    s.buildings.col['shoots.cooldown'][4] = 0;
    shoots.phases?.towers(s, s.carriers.shoots);
    assert.equal(s.events.filter((e) => e.type === 'TowerShot').length, expected, JSON.stringify(teams));
  }
});

test('covers R-TEM-02: neutral stays hostile to everyone (towers still target neutral-owned troops)', () => {
  const s = api.createState(towerLevel(), 9, { teams: [0, 0, 1] });
  assert.equal(api.hostile(s, -1, 0), true);
  assert.equal(api.hostile(s, 1, -1), true);
});
