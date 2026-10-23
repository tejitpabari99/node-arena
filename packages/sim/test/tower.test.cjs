const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { shoots, towerRadiusMilli } = require('../src/modules/shoots.ts');
const { compiledGolden } = require('./fixtures.cjs');

// Tower at origin, horizontal hostile lane at z=2000. Houses start outside reach.
function fixture(edit) {
  const l = compiledGolden();
  const positions = [[-10000, 2000], [10000, 2000], [-10000, -2000], [10000, -2000], [0, 0]];
  l.buildings.forEach((b, i) => {
    [b.x, b.z] = positions[i];
    b.level = i === 4 ? 1 : 0;
    if (i !== 4) delete b.modules.grows;
  });
  l.buildings[2].owner = 0;
  l.buildings[3].owner = 1;
  l.buildings[4].owner = 0;
  l.units.push({ ...l.units[0], id: 'tank', hp: 9 });
  if (edit) edit(l);
  const s = api.createState(l, 9);
  s.events = [];
  return s;
}
function put(s, from, to, progress, kind = 0) {
  const seq = api.spawnTroop(s, from, to, kind);
  const r = api.getChannel(s, from, to).troops;
  r.p0[r.indexOfSeq(seq)] = progress;
  return seq;
}
function phase(s) { shoots.phases?.towers(s, s.carriers.shoots); }
function ready(s, i = 4) { s.buildings.col['shoots.cooldown'][i] = 0; }
const shots = s => s.events.filter(e => e.type === 'TowerShot');

test('covers R-TWR-01: initial delay including L0, countdown, exact L1/10/30/64 reload', () => {
  for (const [level, delay] of [[0,35000], [1,33870], [10,26250], [30,17500], [64,11170]]) {
    const s = fixture(l => { l.buildings[4].level = level; });
    const cd = s.buildings.col['shoots.cooldown'];
    assert.equal(cd[4], delay);
    put(s, 1, 0, 200000);
    for (let i = 0; i < Math.ceil(delay / 1000) - 1; i++) phase(s);
    assert.equal(shots(s).length, 0);
    phase(s);
    assert.equal(shots(s).length, level === 0 ? 0 : 1);
    assert.equal(cd[4], level === 0 ? 0 : delay);
  }
});

test('covers R-TWR-01: stage thresholds change public radius and select precomputed range without BigInt', () => {
  const s = fixture();
  const sim = api.create(s.level, 9);
  assert.equal(sim.towerRadiusMilli(sim.view, 4), 3840);
  assert.equal(sim.towerRadiusMilli(sim.view, 0), 0);
  const seq = put(s, 1, 0, 100000); // (-5000,2000), d > stage1 reach
  ready(s); phase(s); assert.equal(shots(s).length, 0);
  api.setLevel(s, 4, 10);
  assert.equal(towerRadiusMilli(s, 4), 6000);
  const original = global.BigInt;
  global.BigInt = () => { throw new Error('hot BigInt forbidden'); };
  try { phase(s); } finally { global.BigInt = original; }
  assert.equal(shots(s)[0].target.seq, seq);
  api.setLevel(s, 4, 30); assert.equal(towerRadiusMilli(s, 4), 8160);
  api.setLevel(s, 4, 9); assert.equal(towerRadiusMilli(s, 4), 3840);
});

test('covers R-TWR-02, covers R-TWR-03: nearest middle-lane tank dies instantly; FIFO, alive and ledger preserved', () => {
  const s = fixture();
  const front = put(s, 1, 0, 240000), middle = put(s, 1, 0, 200000, 1), back = put(s, 1, 0, 160000);
  ready(s); phase(s);
  const ch = api.getChannel(s, 1, 0);
  assert.deepEqual(Array.from(ch.troops.seq.subarray(0, ch.troops.len)), [front, back]);
  assert.equal(s.buildings.alive[1], 2);
  assert.equal(s.counters.killed, 1);
  assert.deepEqual(shots(s), [{ type:'TowerShot', tower:4, target:{kind:'troop',channel:5,seq:middle}, x:0,z:2000 }]);
  assert.deepEqual(s.events.filter(e => e.type === 'TroopDied').map(e => [e.seq,e.kind,e.cause]), [[middle,'tank','tower']]);
  api.assertInvariants(s);
});

test('covers R-TWR-02: troop distance ties use owner then seq, independent of channel order; friendly skipped', () => {
  const s = fixture(l => { l.buildings[4].owner = -1; });
  const first = put(s, 1, 0, 200000); // owner1, smaller channel key
  const preferred = put(s, 2, 3, 200000); // owner0 wins despite later seq
  put(s, 2, 0, 40000); // owner0 outside reach
  ready(s); phase(s); assert.equal(shots(s)[0].target.seq, preferred);
  const s2 = fixture();
  put(s2, 0, 1, 200000); // friendly exactly as close
  const older = put(s2, 3, 2, 200000); // larger key but smaller seq
  put(s2, 1, 0, 200000);
  ready(s2); phase(s2); assert.equal(shots(s2)[0].target.seq, older);
  assert.equal(first, 0);
});

test('covers R-TWR-02: exact annulus excludes minRadius boundary and includes outer boundary; troopPad 0/350', () => {
  for (const [z, pad, fires] of [[1000,350,false],[1001,350,true],[3840,0,true],[3841,0,false],[4190,350,true],[4191,350,false]]) {
    const s = fixture(l => { l.buildings[0].z = l.buildings[1].z = z; l.buildings[4].modules.shoots.troopPad = pad; });
    put(s, 1, 0, 200000); ready(s); phase(s);
    assert.equal(shots(s).length, Number(fires), `z=${z} pad=${pad}`);
  }
});

test('covers R-TWR-02: house footprint reach, level eligibility, nearest centre tie, floor and no capture', () => {
  const s = fixture(l => {
    l.buildings[0].x = 2000; l.buildings[0].z = 0; l.buildings[0].level = 9; // friendly
    l.buildings[1].x = 4500; l.buildings[1].z = 0; l.buildings[1].level = 1;
    l.buildings[2].x = -4500; l.buildings[2].z = 0; l.buildings[2].owner = 1; l.buildings[2].level = 1;
    l.buildings[3].x = 1200; l.buildings[3].z = 0; // hostile L0 skipped
  });
  ready(s); phase(s);
  assert.equal(shots(s)[0].target.building, 1);
  assert.equal(s.buildings.level[1], 0); assert.equal(s.buildings.owner[1], 1);
  ready(s); phase(s); assert.equal(shots(s)[1].target.building, 2);
  ready(s); phase(s); assert.equal(shots(s).length, 2);
  assert.equal(s.events.some(e => e.type === 'BuildingCaptured'), false);
  const corner = fixture(l => { Object.assign(l.buildings[1], {x:4000,z:4000,level:1}); });
  ready(corner); phase(corner); assert.equal(shots(corner).length, 0, 'box corner outside sphere');
  const far = fixture(l => { Object.assign(l.buildings[1], {x:4700,z:0,level:1}); });
  ready(far); phase(far); assert.equal(shots(far).length, 0, 'no troopPad on house');
});

test('covers R-TWR-02: troop priority over closer house; other towers never targets; minRadius only filters troops', () => {
  const s = fixture(l => { Object.assign(l.buildings[1], {x:500,z:0,level:2}); });
  put(s, 3, 2, 200000); ready(s); phase(s);
  assert.equal(shots(s)[0].target.kind, 'troop');
  ready(s); phase(s); assert.equal(shots(s)[1].target.building, 1);
  const s2 = fixture(l => { Object.assign(l.buildings[1], {x:2000,z:0,level:8,kind:'tower'}); });
  ready(s2); phase(s2); assert.equal(shots(s2).length, 0);
});

test('covers R-TWR-02: opponent house preferred over nearer neutral house; neutral shot only when no opponent in reach; troops first', () => {
  const mk = () => fixture(l => {
    Object.assign(l.buildings[0], { x: 1500, z: 0, level: 3, owner: -1 }); // nearer, neutral
    Object.assign(l.buildings[1], { x: 3000, z: 0, level: 3, owner: 1 });  // farther, opponent
  });
  const s = mk();
  ready(s); phase(s);
  assert.equal(shots(s)[0].target.building, 1, 'opponent house before nearer neutral');
  assert.equal(s.buildings.level[0], 3);
  ready(s); phase(s); ready(s); phase(s);
  assert.equal(s.buildings.level[1], 0);
  ready(s); phase(s);
  assert.equal(shots(s)[3].target.building, 0, 'neutral shot once no opponent house is eligible');
  const t = mk();
  put(t, 3, 2, 200000); ready(t); phase(t);
  assert.equal(shots(t)[0].target.kind, 'troop');
  const out = fixture(l => {
    Object.assign(l.buildings[0], { x: 1500, z: 0, level: 3, owner: -1 });
    Object.assign(l.buildings[1], { x: 9000, z: 0, level: 3, owner: 1 });
  });
  ready(out); phase(out); assert.equal(shots(out)[0].target.building, 0, 'out-of-reach opponent does not block neutral');
});

test('covers R-TWR-04: neutralFires and hitsNeutralHouses each support both settings and defaults', () => {
  for (const neutralFires of [true, false, undefined]) {
    const s = fixture(l => {
      l.buildings[4].owner = -1;
      if (neutralFires === undefined) delete l.buildings[4].modules.shoots.neutralFires;
      else l.buildings[4].modules.shoots.neutralFires = neutralFires;
    });
    put(s, 1, 0, 200000); ready(s); phase(s);
    assert.equal(shots(s).length, neutralFires === false ? 0 : 1);
  }
  for (const hitsNeutralHouses of [true, false, undefined]) {
    const s = fixture(l => {
      Object.assign(l.buildings[1], {owner:-1,x:3000,z:0,level:1});
      if (hitsNeutralHouses === undefined) delete l.buildings[4].modules.shoots.hitsNeutralHouses;
      else l.buildings[4].modules.shoots.hitsNeutralHouses = hitsNeutralHouses;
    });
    ready(s); phase(s);
    assert.equal(shots(s).length, hitsNeutralHouses === false ? 0 : 1);
  }
});

test('covers R-TWR-01, covers R-TWR-04: no-target stays ready, level change preserves cooldown, capture preserves cooldown', () => {
  const s = fixture();
  ready(s); phase(s); assert.equal(s.buildings.col['shoots.cooldown'][4], 0);
  put(s, 1, 0, 200000); phase(s); assert.equal(shots(s).length, 1);
  api.setLevel(s, 4, 64); phase(s);
  assert.equal(s.buildings.col['shoots.cooldown'][4], 32870);
  api.setLevel(s, 4, 0);
  put(s, 1, 4, api.getChannel(s, 1, 4).length);
  api.arrivalPass(s);
  assert.equal(s.buildings.owner[4], 1);
  assert.equal(s.buildings.col['shoots.cooldown'][4], 32870);
});

test('covers R-TWR-02: building order prevents shooting an earlier tower victim twice; event parity', () => {
  const level = fixture(l => { Object.assign(l.buildings[1], {x:3000,z:0,level:64}); }).level;
  const s = fixture(l => {
    l.buildings[2] = { ...structuredClone(l.buildings[4]), id:'b2', x:0,z:0 };
  });
  ready(s,2); ready(s,4); put(s,1,0,200000); phase(s);
  assert.deepEqual(shots(s).map(e=>e.tower),[2]);
  assert.equal(s.buildings.col['shoots.cooldown'][4],0);
  const a = api.create(level, 7), b = api.create(level, 7);
  let shotCount = 0;
  for(let i=0;i<80;i++) {
    shotCount += a.step([], {events:true}).filter(e=>e.type==='TowerShot').length;
    b.step([], {events:false});
  }
  assert.equal(shotCount,2);
  assert.equal(a.hash(),b.hash());
});

test('covers R-TWR-02: distance ranking uses exact lane fractions, rather than truncated event positions', () => {
  const s = fixture(l => {
    l.buildings[0].z = 2001; // lane1 midpoint z=2000.5
    l.buildings[3].z = -2000; // lane3 midpoint z=-2000 exactly
  });
  const farther = put(s, 1, 0, 200000);
  const nearer = put(s, 3, 2, 200000);
  // Both event positions truncate to distance 2000. Exact geometry must pick
  // the later seq at 2000 rather than the earlier seq at 2000.5.
  ready(s); phase(s);
  assert.equal(shots(s)[0].target.seq, nearer);
  assert.equal(api.getChannel(s,1,0).troops.indexOfSeq(farther),0);
});

test('covers R-TWR-02: a house hit crossing the stage threshold preserves both outgoing lines', () => {
  const s = fixture(l => {
    Object.assign(l.buildings[1], {x:4500,z:0,level:10});
    Object.assign(l.buildings[2], {x:10000,z:4000});
  });
  api.runCommands(s, [
    {type:'DrawLine',player:1,from:1,to:2},
    {type:'DrawLine',player:1,from:1,to:3},
  ]);
  assert.equal(s.buildings.lines[1],2);
  ready(s); phase(s);
  assert.equal(s.buildings.level[1],9);
  assert.equal(s.buildings.stage[1],1);
  assert.equal(s.buildings.lines[1],2);
  assert.equal(api.freeSlots(s,1),-1);
  assert.equal(s.events.some(e=>e.type==='LineCut'),false);
  api.assertInvariants(s);
});
