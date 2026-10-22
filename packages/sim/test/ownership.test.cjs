const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { step } = api;

const { PHASES } = require('@node-arena/defs');
const { compiledGolden } = require('./fixtures.cjs');

// Coverage tests for ids whose only prior tags were non-leading (the checker reads the first id after `covers`).
const TANK = { id: 'tank', visual: 'unit.tank', speed: 5000, hp: 2, attack: 2, defense: 1 };
const mk = (edit, seed = 3) => { const l = compiledGolden(); l.units.push({ ...TANK }); if (edit) edit(l); const s = api.createState(l, seed); s.events = []; return s; };
const draw = (state, p, from, to) => api.runCommands(state, [{ type: 'DrawLine', player: p, from, to }]);
const put = (state, from, to, kind, progress) => {
  const seq = api.spawnTroop(state, from, to, kind);
  const ch = api.getChannel(state, from, to);
  ch.troops.p0[ch.troops.indexOfSeq(seq)] = progress;
  return seq;
};
const len = (s, a, b) => api.getChannel(s, a, b).length;

test('covers R-TCK-01: tickRate 20; one step = one tick; no wall clock; finished match accepts no changes', () => {
  assert.equal(api.TICK_RATE, 20);
  const realNow = Date.now;
  Date.now = () => { throw new Error('wall clock read'); };
  try {
    const a = api.create(compiledGolden(), 5), b = api.create(compiledGolden(), 5);
    for (let i = 0; i < 40; i++) { a.step(i === 0 ? [{ type: 'DrawLine', player: 0, from: 0, to: 2 }] : []); b.step(i === 0 ? [{ type: 'DrawLine', player: 0, from: 0, to: 2 }] : []); }
    assert.equal(a.view.tick, 40);
    assert.equal(a.hash(), b.hash());
  } finally { Date.now = realNow; }
  const l = compiledGolden(); l.timeLimitSec = 1;
  const s = api.createState(l, 1);
  for (let i = 0; i < 20; i++) step(s, [], false);
  assert.equal(s.over.outcome, 'timeout');
  const h = api.hashState(s);
  const ev = step(s, [{ type: 'DrawLine', player: 0, from: 0, to: 2 }], true);
  assert.equal(s.tick, 20);
  assert.equal(api.hashState(s), h);
  assert.deepEqual(ev.map((e) => e.reason), ['gameover']);
});

test('covers R-TCK-05: nine phases in order, outcome last; capture inline, killed troops do not arrive, new owner produces nothing that tick', () => {
  assert.deepEqual([...PHASES], ['commands', 'reserved', 'growth', 'spawn', 'movement', 'contacts', 'towers', 'arrivals', 'outcome']);
  const s = mk((l) => { l.buildings[1].level = 0; });
  put(s, 0, 1, 0, len(s, 0, 1)); // lands on b1 (L0, p1) this tick: captured
  const T = put(s, 1, 2, 0, 20000); // Beyond shared-endpoint contact; killed by the capture
  s.buildings.alive[1] = 1; s.buildings.alive[0] = 1; s.counters.spawned = 2;
  const ev = step(s, [], true);
  assert.equal(s.buildings.owner[1], 0);
  assert.equal(api.getChannel(s, 1, 2).troops.indexOfSeq(T), -1);
  const kinds = ev.map((e) => e.type);
  assert.ok(kinds.indexOf('BuildingCaptured') >= 0);
  assert.ok(!ev.some((e) => e.type === 'TroopArrived' && e.seq === T), 'killed troop never arrives');
  assert.ok(!ev.some((e) => e.type === 'TroopSpawned' && e.channel === 1 * s.buildings.n + 2), 'captured building produces nothing this tick');
  api.assertInvariants(s);
});

test('covers R-ENT-02: troop owner/source/type fixed at departure; hp/attack/defense flat per type from content, not owner or level', () => {
  const s = mk();
  const a = api.spawnTroop(s, 0, 2, 1), b = api.spawnTroop(s, 1, 2, 1);
  s.buildings.level[0] = 3; // source level change after departure
  const ra = api.getChannel(s, 0, 2).troops, rb = api.getChannel(s, 1, 2).troops;
  const ia = ra.indexOfSeq(a), ib = rb.indexOfSeq(b);
  assert.deepEqual([ra.owner[ia], ra.kind[ia], ra.hp[ia]], [0, 1, TANK.hp]);
  assert.deepEqual([rb.owner[ib], rb.kind[ib], rb.hp[ib]], [1, 1, TANK.hp]);
  assert.equal(api.getChannel(s, 0, 2).from, 0);
  assert.equal(s.level.units[1].attack, 2);
  assert.equal(s.level.units[1].defense, 1);
});

test('covers R-ENT-04: each player is its own team; ai vs ai hostile; humans and ai share identical validation', () => {
  const s = mk((l) => { l.players.push({ id: 'p3', kind: 'ai', colorKey: 'green' }); l.buildings[2].owner = 2; });
  assert.equal(s.players.n, 3);
  put(s, 1, 2, 0, len(s, 1, 2) / 2 + 400); // ai p1 troop vs ai p2 troop on a lane between their buildings
  put(s, 2, 1, 0, len(s, 1, 2) / 2 + 400);
  api.headOnPass(s);
  assert.ok(s.events.some((e) => e.type === 'Clash'), 'different ai owners fight');
  const sim = api.create(compiledGolden(), 3);
  assert.equal(sim.canDraw(0, 0, 2), null); // human
  assert.equal(sim.canDraw(1, 1, 2), null); // ai: same validation path, same result
  assert.equal(sim.canDraw(1, 0, 2), 'not-owner');
  assert.equal(sim.canDraw(0, 1, 2), 'not-owner');
});

test('covers R-CPT-02: capture keeps incoming lines; other buildings\' troops unaffected; later arrivals re-evaluate against the new owner', () => {
  const s = mk((l) => { l.buildings[1].level = 0; l.buildings[2].level = 20; });
  s.buildings.owner[2] = 0;
  s.buildings.stage[2] = 2;
  draw(s, 0, 2, 1);
  assert.equal(api.getChannel(s, 2, 1).drawn, 1, 'incoming line 2->1 drawn');
  const other = put(s, 2, 3, 0, 500); // unrelated troop from b2
  const first = put(s, 0, 1, 0, len(s, 0, 1) + 9); // captures b1 (L0)
  const later = put(s, 2, 1, 0, len(s, 2, 1) + 1); // p0 troop arriving after capture: friendly now
  s.buildings.alive[0] = 1; s.buildings.alive[2] = 2; s.counters.spawned = 3;
  s.events = [];
  api.arrivalPass(s);
  assert.equal(s.buildings.owner[1], 0);
  assert.equal(api.getChannel(s, 2, 1).drawn, 1, 'incoming line survives capture');
  assert.ok(api.getChannel(s, 2, 3).troops.indexOfSeq(other) >= 0, 'other building troop unaffected');
  const arr = s.events.filter((e) => e.type === 'TroopArrived').map((e) => [e.seq, e.effect]);
  assert.deepEqual(arr, [[first, 'hit'], [later, 'reinforce']]);
  api.assertInvariants(s);
});

test('covers R-LIN-04: straight centre-to-centre lines, free, no length cap; crossings alone do nothing', () => {
  const sim = api.create(compiledGolden(), 3);
  const s = mk();
  const dx = (a, b) => s.level.buildings[a].x - s.level.buildings[b].x, dz = (a, b) => s.level.buildings[a].z - s.level.buildings[b].z;
  for (const [a, b] of [[0, 1], [0, 3], [1, 3], [0, 2]]) {
    const d = api.isqrt((dx(a, b) * 20) ** 2 + (dz(a, b) * 20) ** 2);
    assert.equal(len(s, a, b), d, `centre-to-centre ${a}->${b}`);
    assert.equal(len(s, a, b), len(s, b, a));
  }
  const far = sim.canDraw(0, 0, 3); // farthest lane is allowed: no cap
  assert.equal(far, null);
  const lv0 = [...sim.view.buildings.level];
  sim.step([{ type: 'DrawLine', player: 0, from: 0, to: 3 }, { type: 'DrawLine', player: 0, from: 0, to: 1 }], { events: true });
  const ev = sim.step([{ type: 'DrawLine', player: 1, from: 1, to: 2 }, { type: 'DrawLine', player: 1, from: 1, to: 0 }], { events: true });
  assert.ok(ev.every((e) => e.type === 'LineDrawn' || e.type === 'CommandRejected'), 'crossing alone emits nothing else');
  assert.deepEqual([...sim.view.buildings.level], lv0, 'drawing is free: no level cost');
});
