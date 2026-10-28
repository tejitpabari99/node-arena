import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { create, createReplayRecorder } from '@node-arena/sim';
import type { Command } from '@node-arena/defs';
import { LockstepClient } from '../src/lockstep-client.js';
import type { ServerMessage } from '../src/messages.js';

const draw = (player: number, from: number, to: number): Command => ({ type: 'DrawLine', player, from, to });
const tick = (n: number, c?: Command[]): ServerMessage => (c === undefined ? { t: 'tick', n } : { t: 'tick', n, c });

test('tick N is never released before it arrives; order preserved; empty ticks ok', () => {
  const c = new LockstepClient();
  assert.deepEqual(c.drain(10), []);
  c.push(tick(0)); c.push(tick(1, [draw(0, 0, 1)]));
  assert.equal(c.queued(), 2);
  assert.deepEqual(c.drain(1), [{ n: 0, cmds: [] }]);
  assert.deepEqual(c.drain(10), [{ n: 1, cmds: [draw(0, 0, 1)] }]);
  assert.deepEqual(c.drain(10), []);
  c.push(tick(2));
  assert.deepEqual(c.drain(0), []);
  assert.deepEqual(c.drain(5).map(t => t.n), [2]);
  assert.equal(c.expected, 3);
});

test('gap / duplicate flagged, never throws, blocks drain until reset', () => {
  const c = new LockstepClient();
  c.push(tick(0));
  assert.deepEqual(c.push(tick(2)), { ok: false, reason: 'gap' });
  assert.equal(c.needsResync, true);
  assert.deepEqual(c.drain(10), []);
  c.reset(5);
  assert.equal(c.needsResync, false);
  assert.deepEqual(c.push(tick(5)), { ok: true });
  assert.deepEqual(c.push(tick(5)), { ok: false, reason: 'duplicate' });
  assert.equal(c.error, 'duplicate');
  c.reset(0);
  assert.deepEqual(c.push({ t: 'ticks', from: 0, to: 3, cmds: [] }), { ok: true });
  assert.deepEqual(c.push({ t: 'ticks', from: 2, to: 4, cmds: [] }), { ok: false, reason: 'duplicate' });
  c.reset(0);
  assert.deepEqual(c.push({ t: 'catchup', from: 1, to: 3, cmds: [], done: false }), { ok: false, reason: 'gap' });
  c.reset(0);
  assert.deepEqual(c.push({ t: 'ticks', from: 0, to: 2, cmds: [{ tick: 2, cmd: draw(0, 0, 1) }] }), { ok: false, reason: 'bad-range' });
  c.reset(0);
  assert.deepEqual(c.push({ t: 'ticks', from: 0, to: 99999, cmds: [] }), { ok: false, reason: 'bad-range' });
});

test('ticks/catchup [from,to) expand sparse batches incl. empty ticks, then live tick continues', () => {
  const c = new LockstepClient();
  c.push({ t: 'catchup', from: 0, to: 4, cmds: [{ tick: 1, cmd: draw(0, 0, 1) }, { tick: 1, cmd: draw(1, 1, 0) }, { tick: 3, cmd: draw(0, 0, 2) }], done: false });
  c.push({ t: 'ticks', from: 4, to: 6, cmds: [] });
  c.push(tick(6));
  assert.deepEqual(c.drain(100).map(t => [t.n, t.cmds.length]), [[0, 0], [1, 2], [2, 0], [3, 1], [4, 0], [5, 0], [6, 0]]);
  assert.deepEqual(c.push({ t: 'ticks', from: 7, to: 7, cmds: [] }), { ok: true });
});

test('after(): hash only when (n+1)%20===0, tick=n+1; lazy hash fn; cmd helper has no tick/player', () => {
  const c = new LockstepClient();
  let calls = 0;
  const h = () => { calls++; return 'abc'; };
  const hits: number[] = [];
  for (let n = 0; n < 60; n++) { const m = c.after(n, h); if (m !== null) { hits.push(n); assert.deepEqual(m, { t: 'hash', tick: n + 1, h: 'abc' }); } }
  assert.deepEqual(hits, [19, 39, 59]);
  assert.equal(calls, 3);
  assert.deepEqual(c.cmd({ type: 'DrawLine', from: 0, to: 1 } as never), { t: 'cmd', c: { type: 'DrawLine', from: 0, to: 1 } });
  assert.equal(c.cmd({ type: 'DrawLine', from: 0, to: 1 } as never, 7).cid, 7);
});

test('real sim: hash ticks equal replay checkpoint ticks and hashes', () => {
  const fx = createRequire(import.meta.url)('../../sim/test/fixtures.cjs');
  const level = fx.compiledGolden();
  const rec = createReplayRecorder(level, 9, fx.metadata);
  const sim = create(level, 9);
  const client = new LockstepClient();
  const total = 85;
  for (let n = 0; n < total; n++) client.push(tick(n));
  // reference: recorder produces checkpoints
  for (let n = 0; n < total; n++) rec.step([]);
  const expected = rec.record().checkpoints;
  assert.ok(expected.length >= 4);
  const got: { tick: number; hash: string }[] = [];
  for (const t of client.drain(1000)) {
    assert.equal(sim.view.tick, t.n);
    sim.step(t.cmds);
    const m = client.after(t.n, () => sim.hash());
    if (m !== null) { assert.equal(m.tick, sim.view.tick); got.push({ tick: m.tick, hash: m.h }); }
  }
  assert.deepEqual(got, expected);
  assert.equal(client.queued(), 0);
});

test('drain(Infinity) drains all; NaN/negative/0 are no-ops; later pushes still work', () => {
  const c = new LockstepClient();
  for (let n = 0; n < 5; n++) c.push(tick(n));
  assert.deepEqual(c.drain(NaN), []);
  assert.deepEqual(c.drain(-1), []);
  assert.deepEqual(c.drain(0), []);
  assert.equal(c.queued(), 5);
  assert.deepEqual(c.drain(Infinity).map((t) => t.n), [0, 1, 2, 3, 4]);
  assert.equal(c.queued(), 0);
  c.push(tick(5)); c.push(tick(6));
  assert.equal(c.queued(), 2);
  assert.deepEqual(c.drain(Infinity).map((t) => t.n), [5, 6]);
  assert.equal(c.needsResync, false);
});
