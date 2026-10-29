import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command } from '@node-arena/defs';
import { LockstepServer } from '../src/lockstep-server.js';

const mk = (inputDelay?: number) =>
  new LockstepServer({ seats: ['human', 'human', 'bot', 'empty'], buildingCount: 10, log: { timeLimitTicks: 1000 }, ...(inputDelay === undefined ? {} : { inputDelay }) });
const draw = (from: number, to: number) => ({ type: 'DrawLine', from, to });

test('stamps next+3 by default and respects configured delay', () => {
  const s = mk();
  assert.deepEqual(s.submit(0, draw(1, 2)), { accepted: true, tick: 3 });
  s.closeTick(); s.closeTick();
  assert.equal(s.nextTick, 2);
  assert.deepEqual(s.submit(0, draw(1, 2)), { accepted: true, tick: 5 });
  assert.deepEqual(mk(1).submit(0, draw(1, 2)), { accepted: true, tick: 1 });
});

test('rejects out-of-range inputDelay at construction', () => {
  assert.throws(() => mk(0), RangeError);
  assert.throws(() => mk(11), RangeError);
  assert.throws(() => mk(1.5), RangeError);
  mk(10);
});

test('injected player rejected; logged cmd carries sender player', () => {
  const s = mk();
  assert.deepEqual(s.submit(0, { ...draw(1, 2), player: 1 }), { accepted: false, rejected: 'bad-message' });
  assert.deepEqual(s.submit(1, draw(3, 4)), { accepted: true, tick: 3 });
  for (let i = 0; i < 3; i++) assert.deepEqual(s.closeTick().cmds, []);
  const r = s.closeTick();
  assert.equal(r.n, 3);
  assert.deepEqual(r.cmds, [{ type: 'DrawLine', player: 1, from: 3, to: 4 }]);
  assert.deepEqual(s.log.commands, [{ tick: 3, cmd: { type: 'DrawLine', player: 1, from: 3, to: 4 } }]);
});

test('bot cmds land on current tick, after humans', () => {
  const s = mk(1);
  s.submit(0, draw(1, 2));
  s.closeTick();
  const bot: Command = { type: 'CutLine', player: 2, from: 5, to: 6 };
  const r = s.closeTick([bot]);
  assert.equal(r.n, 1);
  assert.deepEqual(r.cmds.map((c) => c.player), [0, 2]);
  assert.deepEqual(s.log.commands.map((e) => e.tick), [1, 1]);
});

test('arrival order within a tick', () => {
  const s = mk(1);
  s.submit(1, draw(1, 2)); s.submit(0, draw(3, 4)); s.submit(1, draw(5, 6));
  s.closeTick();
  assert.deepEqual(s.closeTick().cmds.map((c) => [c.player, c.from]), [[1, 1], [0, 3], [1, 5]]);
});

test('non-human seats cannot submit', () => {
  const s = mk();
  for (const p of [2, 3, 4, -1, null]) assert.deepEqual(s.submit(p, draw(1, 2)), { accepted: false, rejected: 'not-your-seat' });
});

test('building index bound and malformed cmds rejected', () => {
  const s = mk();
  for (const c of [draw(10, 1), draw(1, 10), draw(-1, 1), draw(1.5, 2), { type: 'Nope', from: 1, to: 2 }, null, [], 'x', { type: 'DrawLine', from: 1 }, { ...draw(1, 2), extra: 1 }]) {
    assert.deepEqual(s.submit(0, c), { accepted: false, rejected: 'bad-message' });
  }
  assert.deepEqual(s.submit(0, draw(9, 0)), { accepted: true, tick: 3 });
});

test('cmd cap rejects and bounds the buffer', () => {
  const s = new LockstepServer({ seats: ['human'], buildingCount: 4, log: { timeLimitTicks: 100, cmdCap: 2 } });
  assert.equal(s.submit(0, draw(1, 2)).accepted, true);
  assert.equal(s.submit(0, draw(1, 2)).accepted, true);
  assert.deepEqual(s.submit(0, draw(1, 2)), { accepted: false, rejected: 'rate-limited' });
});

test('hash: ok, desync, pending', () => {
  const s = mk();
  assert.deepEqual(s.onHash(0, 20, 'a'.repeat(16)), { result: 'pending' });
  s.recordCheckpoint(20, 'a'.repeat(16));
  assert.deepEqual(s.onHash(0, 20, 'a'.repeat(16)), { result: 'ok' });
  assert.deepEqual(s.onHash(1, 20, 'b'.repeat(16)), { result: 'desync', msg: { t: 'desync', tick: 20, serverHash: 'a'.repeat(16) } });
});

test('closeTick reports dropped bot cmds when the log refuses them', () => {
  const s = new LockstepServer({ seats: ['human', 'bot'], buildingCount: 4, log: { timeLimitTicks: 100, cmdCap: 2 } });
  const bot = (): Command => ({ type: 'DrawLine', player: 1, from: 0, to: 1 });
  const r = s.closeTick([bot(), bot(), bot(), bot()]);
  assert.equal(r.cmds.length, 2);
  assert.equal(r.dropped, 2);
  assert.equal(r.firstDrop, 'cmd-cap');
  assert.equal(s.log.size, 2);
  const ok = mk().closeTick([bot()]);
  assert.equal(ok.dropped, 0);
  assert.equal('firstDrop' in ok, false);
});
