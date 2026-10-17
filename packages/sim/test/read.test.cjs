const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const { create, createComponentRegistry } = require('../src/index.ts');
function level() {
  return { componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'read', timeLimitSec: 100, visual: 'map', bots: [],
    players: [{ id: 'p0', team: 'red-team', kind: 'human', colorKey: 'red' }, { id: 'p1', team: 'blue-team', kind: 'bot', colorKey: 'blue' }],
    towers: ['a', 'b', 'c'].map((id, i) => ({ id, x: i * 10000, y: 0, owner: i === 1 ? 1 : 0, garrison: 31, archetype: 'tower', visual: id, footprintRadius: 2000,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: 20000 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } })),
    kinds: [{ id: 'regular', value: 2, speedMilli: 3001, visual: 'troop' }] };
}
function buffer(n) { return Object.fromEntries(['channel', 'seq', 'owner', 'kind', 'progress'].map(k => [k, new Int32Array(n)])); }
const draw = (from, to) => ({ type: 'DrawLine', player: 'p0', from, to });
test('view exposes stable zero-copy columns and live original team ids, player stats, drawn channel order', () => {
  const s = create(level(), 42);
  assert.ok(s.view, 'public read view is available');
  const v = s.view, owner = v.tower.owner, count = v.tower.col['garrison.count'], lines = v.lines;
  assert.equal(v.players[0].team, 'red-team');
  assert.equal(v.players[0].kind, 'human');
  assert.equal(v.timeLimitTicks, 2000);
  assert.equal(v.kinds[0].speedPerTick, 3001);
  assert.deepEqual(v.towerStatic[0].components, ['capturable', 'drawsLines', 'garrison', 'generates']);
  assert.equal(v.tower.col['generates.ratePerSec'][0], 20000);
  s.step([draw('c', 'b'), draw('a', 'b')]);
  assert.equal(s.view, v); assert.equal(v.tower.owner, owner); assert.equal(v.tower.col['garrison.count'], count);
  assert.equal(v.tick, 1); assert.equal(v.players[0].stats.generated, 4); assert.equal(v.players[0].transit, 4);
  assert.deepEqual(lines.map(l => l.channel), [1, 7]);
  assert.equal(v.lines, lines);
  s.step([{ type: 'CutLine', player: 'p0', from: 'a', to: 'b' }]);
  assert.deepEqual(v.lines.map(l => l.channel), [7]);
  s.over = { outcome: 'won', winnerTeam: 'red-team' };
  assert.deepEqual(v.over, s.over);
});
test('readTroops reads cut-channel FIFO rings without object traversal, returns required count on overflow and reuses buffers', () => {
  const s = create(level(), 0), out = buffer(2);
  assert.equal(typeof s.readTroops, 'function');
  assert.equal(s.readTroops(out), 0);
  const q = s.ensureChannel(2, 1).troops;
  q.push({ p0: 99, t0: 0, owner: 0, kind: 0, seq: 1, value: 2 }); q.shift();
  for (let i = 0; i < 5; i++) q.push({ p0: i * 10, t0: 1, owner: 0, kind: 0, seq: i + 2, value: 2 });
  q.forEach = () => { throw new Error('allocating traversal used'); };
  s.tick = 3;
  assert.equal(s.readTroops(out), 5);
  assert.deepEqual([...out.progress], [6002, 6012]);
  assert.deepEqual([...out.seq], [2, 3]); assert.deepEqual([...out.channel], [7, 7]);
  assert.equal(s.readTroops(buffer(0)), 5);
  out.kind = new Int32Array(1); assert.equal(s.readTroops(out), 5);
  for (let i = 0; i < 5; i++) q.shift();
  assert.equal(s.readTroops(out), 0); // only the prefix up to min(returned count, capacity) is valid
});
test('hash covers rule state, partial troops and global sequences, excludes reporting and derived caches', () => {
  const s = create(level(), 3);
  assert.equal(typeof s.hash, 'function');
  assert.match(s.hash(), /^[0-9a-f]{16}$/);
  const before = s.hash();
  s.players.stats.generated[0]++; s.rejected++; s.accounting.hits++; s.events = []; s.pendingDepartures[0]++; s.debug = true;
  assert.equal(s.hash(), before);
  for (const mutate of [s => s.tick++, s => s.prng.next(), s => s.players.alive[0] = 0, s => s.players.transit[0]++, s => s.drawSeq++, s => s.troopSeq++, s => s.tower.col['generates.acc'][0]++, s => s.tower.owner[0] = -1, s => s.over = { outcome: 'draw', winnerTeam: null }]) {
    const fresh = create(level(), 3); const h = fresh.hash(); mutate(fresh); assert.notEqual(fresh.hash(), h);
  }
  const ch = s.ensureChannel(0, 1); assert.notEqual(s.hash(), before);
  for (const mutate of [ch => ch.drawn = 1, ch => ch.drawSeq++, ch => ch.owner = 0, ch => ch.troops.push({ p0: 0, t0: 0, owner: 0, kind: 0, seq: 1, value: 2 }), ch => ch.troops.consumeFront(1)]) {
    const h = s.hash(); mutate(ch); assert.notEqual(s.hash(), h);
  }
});
test('new declared component columns are snapshotted and hashed generically with framed column names', () => {
  const registry = createComponentRegistry(); registry.registerComponent({ name: 'shoots', state: { acc: 7, aim: 3 } });
  const input = level(); input.componentNames.push('shoots'); input.towers[0].components.shoots = {};
  const s = create(input, 0, { registry });
  assert.equal(typeof s.snapshot, 'function');
  assert.deepEqual(s.snapshot().tower.col['shoots.acc'], [7, 0, 0]);
  const h = s.hash(); s.tower.col['shoots.acc'][0]++; assert.notEqual(s.hash(), h);
  const a = create(level(), 0), b = create(level(), 0);
  a.tower.col.ab = new Int32Array([1]); a.tower.col.c = new Int32Array([2]);
  b.tower.col.a = new Int32Array([1]); b.tower.col.bc = new Int32Array([2]);
  assert.notEqual(a.hash(), b.hash());
});
test('snapshots detach all nested data and serialize canonical channel/FIFO and column order', () => {
  const s = create(level(), 5);
  assert.equal(typeof s.snapshot, 'function');
  s.step([draw('c', 'b'), draw('a', 'b')]);
  const shot = s.snapshot(), saved = JSON.stringify(shot);
  assert.deepEqual(shot.channels.map(c => c.key), [1, 7]);
  assert.deepEqual(shot.channels[0].troops[0], { p0: 0, t0: 1, owner: 0, kind: 0, seq: 1, value: 2 });
  assert.deepEqual(Object.keys(shot.tower.col), ['drawsLines.cursor', 'garrison.cap', 'garrison.count', 'generates.acc', 'generates.ratePerSec', 'generates.troop']);
  s.step([]); s.towerStatic[0].components.push('future'); s.ids.players[0] = 'changed';
  assert.equal(JSON.stringify(shot), saved);
  shot.tower.col['garrison.count'][0] = 999; shot.kinds[0].visual = 'changed';
  assert.notEqual(s.tower.col['garrison.count'][0], 999); assert.equal(s.kinds[0].visual, 'troop');
});
test('identical seeds and commands produce stable hashes independent of events and ring storage history', () => {
  const a = create(level(), 77), b = create(level(), 77);
  assert.equal(typeof a.hash, 'function');
  for (let i = 0; i < 60; i++) {
    const cmds = i === 0 ? [draw('a', 'b')] : i === 20 ? [{ type: 'CutLine', player: 'p0', from: 'a', to: 'b' }] : [];
    a.step(cmds); b.step(cmds, { events: false }); assert.equal(a.hash(), b.hash());
  }
  const c = create(level(), 1), d = create(level(), 1);
  const troop = { p0: 5, t0: 0, owner: 0, kind: 0, seq: 1, value: 2 };
  c.ensureChannel(0, 1).troops.push(troop);
  const ring = d.ensureChannel(0, 1).troops; ring.push(troop); ring.push(troop); ring.shift();
  assert.equal(c.hash(), d.hash());
});
test('readTroops preserves logical FIFO order across physical wrap and capacity growth', () => {
  const s = create(level(), 0), q = s.ensureChannel(0, 1).troops, out = buffer(12);
  const push = i => q.push({ p0: i, t0: 0, owner: 0, kind: 0, seq: i, value: 2 });
  for (let i = 0; i < 8; i++) push(i);
  for (let i = 0; i < 6; i++) q.shift();
  for (let i = 8; i < 13; i++) push(i);
  assert.equal(s.readTroops(out), 7);
  assert.deepEqual([...out.seq.subarray(0, 7)], [6, 7, 8, 9, 10, 11, 12]);
  for (let i = 13; i < 17; i++) push(i);
  assert.equal(s.readTroops(out), 11);
  assert.deepEqual([...out.progress.subarray(0, 11)], [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});
test('public types reject mutable view columns and hide internal state access', () => {
  const ts = require('typescript'), path = require('node:path');
  const file = path.join(__dirname, '__public-read-check.ts');
  const source = `import { create, type Sim, type SimView, type TroopBuf, type SimSnapshot } from '../src/index.js';
    const s: Sim = create(null as never, 0); const v: SimView = s.view;
    const shot: SimSnapshot = s.snapshot(); const buf: TroopBuf = null as never;
    s.readTroops(buf); shot.tower.col['garrison.count'][0] = 1;
    // @ts-expect-error public state is read only
    s.tick = 1;
    // @ts-expect-error no internal channels through public create
    s.ensureChannel(0, 1);
    // @ts-expect-error no mutable numeric indexing
    v.tower.owner[0] = 1;
    // @ts-expect-error no mutable typed array method
    v.tower.owner.set(new Int32Array(1));
    // @ts-expect-error subarray remains borrowed read only
    v.tower.owner.subarray(0)[0] = 1;
    // @ts-expect-error immutable player metadata
    v.players[0].team = 'other';
    // @ts-expect-error immutable nested stats
    v.players[0].stats.kills = 1;
    // @ts-expect-error immutable line cache
    v.lines.push(null as never);`;
  const opts = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, types: [], skipLibCheck: true, noEmit: true };
  const host = ts.createCompilerHost(opts), original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...args) => name === file ? ts.createSourceFile(file, source, lang, true) : original(name, lang, ...args);
  const errors = ts.getPreEmitDiagnostics(ts.createProgram([file], opts, host));
  assert.deepEqual(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')), []);
});
