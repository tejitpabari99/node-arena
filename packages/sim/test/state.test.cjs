const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/index.ts');
const { compiledGolden } = require('./fixtures.cjs');

const fresh = (seed = 7) => api.createState(compiledGolden(), seed);

test('covers R-TCK-02: Sfc32.below is in range, unbiased-shaped and rejects bad n', () => {
  const s = new api.Sfc32(5);
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 6000; i++) { const v = s.below(6); assert.ok(v >= 0 && v < 6); counts[v]++; }
  for (const c of counts) assert.ok(c > 800 && c < 1200, String(counts));
  assert.equal(new api.Sfc32(5).below(1), 0);
  for (const bad of [0, -1, 1.5, 4294967297, NaN]) assert.throws(() => s.below(bad), RangeError);
  // Same seed, same sequence of below() draws.
  const a = new api.Sfc32(9), b = new api.Sfc32(9);
  for (let i = 0; i < 50; i++) assert.equal(a.below(7), b.below(7));
});

test('fnv1a32 matches published vectors', () => {
  assert.equal(api.fnv1a32(''), 0x811c9dc5);
  assert.equal(api.fnv1a32('a'), 0xe40c292c);
  assert.equal(api.fnv1a32('foobar'), 0xbf9cf968);
});

test('streams: entity-keyed, order-independent, purpose ids distinct for fwd and bot.tw', () => {
  assert.notEqual(api.purposeId('fwd'), api.purposeId('bot.tw'));
  const a = api.createStreams(11), b = api.createStreams(11);
  const a0 = a.fork('fwd', 0), a1 = a.fork('fwd', 1);
  const b1 = b.fork('fwd', 1), b0 = b.fork('fwd', 0); // forked in the opposite order
  assert.deepEqual([a0.below(100), a0.below(100), a0.next()], [b0.below(100), b0.below(100), b0.next()]);
  a0.next(); // draws on one entity do not shift another
  assert.deepEqual(a1.snapshot(), b1.snapshot());
  assert.notDeepEqual(api.createStreams(11).fork('fwd', 0).snapshot(), api.createStreams(11).fork('fwd', 1).snapshot());
  assert.notDeepEqual(api.createStreams(11).fork('fwd', 0).snapshot(), api.createStreams(11).fork('bot.tw', 0).snapshot());
  assert.notDeepEqual(api.createStreams(11).fork('fwd', 0).snapshot(), api.createStreams(12).fork('fwd', 0).snapshot());
  assert.equal(api.createStreams(11).fork('fwd', 3).snapshot().length, 4);
});

test('state: fwd stream per building, shoots.cooldown zeroed, seat columns, no channels yet', () => {
  const s = fresh();
  assert.equal(s.fwd.length, s.buildings.n);
  assert.ok(s.buildings.col['shoots.cooldown'].every((v) => v === 0));
  assert.equal(s.buildings.col['shoots.cooldown'].length, s.buildings.n);
  assert.deepEqual(Array.from(s.players.kind), s.level.players.map((p) => (p.kind === 'human' ? 0 : 1)));
  assert.equal(s.channels.size, 0);
  assert.deepEqual(s.counters, { spawned: 0, arrived: 0, died: 0, killed: 0 });
  api.assertInvariants(s);
});

test('ring: push, FIFO order, removeAt shifts and zeroes tail, capacity, hp column', () => {
  const r = new api.TroopRing(3);
  r.push(10, 1, 0, 0, 100, 2); r.push(20, 2, 0, 0, 101, 1); r.push(30, 3, 0, 1, 102, 1);
  assert.throws(() => r.push(0, 0, 0, 0, 0, 0), RangeError);
  assert.equal(r.indexOfSeq(101), 1);
  r.removeAt(0);
  assert.equal(r.len, 2);
  assert.deepEqual([r.seq[0], r.seq[1], r.seq[2]], [101, 102, 0]);
  assert.deepEqual([r.p0[0], r.hp[0], r.kind[1], r.t0[2]], [20, 1, 1, 0]);
  r.removeAt(1);
  assert.deepEqual([r.len, r.seq[0], r.seq[1]], [1, 101, 0]);
  assert.throws(() => r.removeAt(1), RangeError);
  assert.throws(() => r.removeAt(-1), RangeError);
  r.push(5, 5, 0, 0, 7, 1); // reuses vacated slot
  assert.deepEqual([r.len, r.seq[1]], [2, 7]);
  r.clear();
  assert.equal(r.len, 0);
});

test('covers R-TCK-04: channel length is symmetric isqrt in progress units; key = from*n+to; lazy', () => {
  const s = fresh();
  const a = api.getChannel(s, 0, 1), b = api.getChannel(s, 1, 0);
  assert.equal(a.key, 0 * s.buildings.n + 1);
  assert.equal(b.key, 1 * s.buildings.n + 0);
  assert.equal(a.length, b.length);
  const p = s.level.buildings[0], q = s.level.buildings[1];
  const dx = (p.x - q.x) * 20, dz = (p.z - q.z) * 20;
  const len = Number(BigInt(Math.floor(Math.sqrt(dx * dx + dz * dz))));
  assert.ok(a.length * a.length <= dx * dx + dz * dz && (a.length + 1) ** 2 > dx * dx + dz * dz);
  assert.ok(Math.abs(a.length - len) <= 1);
  assert.equal(api.getChannel(s, 0, 1), a);
  assert.equal(s.channels.size, 2);
  assert.equal(api.laneLength(s.level, 0, 0), 0);
});

test('hash ignores lazily created idle channels and is sensitive to channel/ring/stream/module state', () => {
  const s = fresh(), h0 = api.hashState(s);
  api.getChannel(s, 0, 1); api.getChannel(s, 2, 3);
  assert.equal(api.hashState(s), h0, 'idle channel is not part of the hash');
  const ch = api.getChannel(s, 0, 1);
  const seen = new Set([h0]);
  const mutate = (fn) => { fn(); const h = api.hashState(s); assert.ok(!seen.has(h), 'hash must change'); seen.add(h); };
  mutate(() => { ch.drawn = 1; s.buildings.lines[0] = 1; });
  mutate(() => { ch.drawSeq = 4; });
  mutate(() => { ch.timer = 500; });
  mutate(() => { api.spawnTroop(s, 0, 1, 0); });
  mutate(() => { ch.troops.hp[0] = 5; });
  mutate(() => { ch.troops.p0[0] = 9; });
  mutate(() => { s.fwd[3].below(5); });
  mutate(() => { s.buildings.col['shoots.cooldown'][2] = 1; });
  mutate(() => { s.buildings.col['grows.timer'][1] = 300; });
  mutate(() => { s.troopSeq += 1; });
  mutate(() => { s.over = { outcome: 'won', winner: 0 }; });
  assert.match(api.hashState(s), /^[0-9a-f]{16}$/);
});

test('covers R-TCK-03: liveChannels iterate by ascending channelKey; hash is independent of channel creation order and of the seed-less history', () => {
  const a = fresh(), b = fresh();
  for (const s of [a, b]) { s.buildings.lines[0] = 1; s.buildings.lines[1] = 1; }
  api.getChannel(a, 0, 2).drawn = 1; api.getChannel(a, 1, 2).drawn = 1;
  api.getChannel(b, 1, 2).drawn = 1; api.getChannel(b, 0, 2).drawn = 1;
  assert.equal(api.hashState(a), api.hashState(b));
  assert.deepEqual(api.liveChannels(b).map((c) => c.key), [0 * 5 + 2, 1 * 5 + 2]);
  assert.notEqual(api.hashState(fresh(7)), api.hashState(fresh(8)), 'seed changes stream states');
});

test('killTroop is canonical removal: shifts ring, alive--, ledger, TroopDied event', () => {
  const s = fresh();
  s.tick = 3;
  const ch = api.getChannel(s, 0, 1);
  ch.drawn = 1; s.buildings.lines[0] = 1;
  const seqs = [api.spawnTroop(s, 0, 1, 0), api.spawnTroop(s, 0, 1, 0), api.spawnTroop(s, 0, 1, 0)];
  assert.deepEqual(seqs, [0, 1, 2]);
  assert.equal(s.buildings.alive[0], 3);
  api.assertInvariants(s);
  s.events = [];
  assert.equal(api.killTroop(s, ch.key, 1, 'clash'), true);
  assert.equal(api.killTroop(s, ch.key, 1, 'clash'), false, 'already gone');
  assert.equal(api.killTroop(s, 999, 0, 'clash'), false);
  assert.equal(s.events.length, 1);
  const ev = s.events[0];
  assert.deepEqual([ev.type, ev.channel, ev.seq, ev.cause, ev.kind, ev.owner], ['TroopDied', ch.key, 1, 'clash', 'soldier', s.buildings.owner[0]]);
  assert.equal(ev.x, s.level.buildings[0].x); assert.equal(ev.z, s.level.buildings[0].z);
  assert.deepEqual([ch.troops.len, ch.troops.seq[0], ch.troops.seq[1]], [2, 0, 2]);
  assert.equal(s.buildings.alive[0], 2);
  s.events = null;
  api.killTroop(s, ch.key, 0, 'capture'); // no event buffer: still removes
  assert.deepEqual(s.counters, { spawned: 3, arrived: 0, died: 1, killed: 1 });
  api.assertInvariants(s);
});

test('troopPosition interpolates along the lane and clamps at the target', () => {
  const s = fresh(), ch = api.getChannel(s, 0, 1);
  api.spawnTroop(s, 0, 1, 0);
  const a = s.level.buildings[0], b = s.level.buildings[1];
  s.tick = 0; assert.deepEqual(api.troopPosition(s, ch, 0), { x: a.x, z: a.z });
  s.tick = 10000; assert.deepEqual(api.troopPosition(s, ch, 0), { x: b.x, z: b.z });
});

test('assertInvariants rejects each broken invariant', () => {
  const breakers = {
    'lines recount': (s) => { s.buildings.lines[0] = 2; },
    'alive recount': (s) => { s.buildings.alive[0] = 1; },
    'level range': (s) => { s.buildings.level[0] = s.buildings.maxLevel[0] + 1; },
    'drawn from neutral': (s) => { const n = s.buildings.owner.indexOf(-1); s.buildings.owner[n] = -1; api.getChannel(s, n, 0).drawn = 1; s.buildings.lines[n] = 1; },
    'conservation': (s) => { s.counters.spawned = 5; },
    'int32': (s) => { s.buildings.col['grows.timer'] = new Float64Array(s.buildings.n).fill(0.5); },
    'ring over cap': (s) => { const c = api.getChannel(s, 0, 1); c.troops.len = 31; },
    'FIFO': (s) => { const c = api.getChannel(s, 0, 1); api.spawnTroop(s, 0, 1, 0); s.tick = 5; api.spawnTroop(s, 0, 1, 0); c.troops.t0[0] = 5; c.troops.t0[1] = 0; },
    'mixed owners': (s) => { const c = api.getChannel(s, 0, 1); api.spawnTroop(s, 0, 1, 0); api.spawnTroop(s, 0, 1, 0); c.troops.owner[1] = 1; },
  };
  for (const [name, fn] of Object.entries(breakers)) {
    const s = fresh();
    if (name === 'ring over cap') { s.buildings.alive[0] = 0; }
    fn(s);
    assert.throws(() => api.assertInvariants(s), /invariant/, name);
  }
});

test('createState rejects hostile level numbers and unknown spawn troop ids at create', () => {
  const bad = (edit, re) => { const l = compiledGolden(); edit(l); assert.throws(() => api.createState(l, 1), re); };
  for (const field of ['attack', 'hp', 'speed']) {
    for (const v of [0, -1, 1.5, NaN, Infinity, 2 ** 40]) bad((l) => { l.units[0][field] = v; }, new RegExp(`units\\[0\\]\\.${field}`));
  }
  for (const v of [0, -5, 1001, 1e9, 2.5, NaN]) bad((l) => { l.rules.aliveCap = v; }, /aliveCap/);
  bad((l) => { const b = l.buildings.find((x) => x.modules.spawns); b.modules.spawns.troop = 'nope'; }, /unknown troop "nope"/);
  const ok = compiledGolden(); ok.rules.aliveCap = 1000; assert.doesNotThrow(() => api.createState(ok, 1));
  const one = compiledGolden(); one.rules.aliveCap = 1; assert.doesNotThrow(() => api.createState(one, 1));
});
