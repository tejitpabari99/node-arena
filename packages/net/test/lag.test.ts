import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LagFeed, LockstepClient, LockstepServer, type ServerMessage } from '../src/index.js';

function run(lagWindow: [number, number] | null, total: number) {
  const server = new LockstepServer({ seats: ['human', 'human'], buildingCount: 2, log: { timeLimitTicks: 1200 } });
  const fast = new LagFeed(server.log);
  const slow = new LagFeed(server.log);
  const fastOut: ServerMessage[] = [];
  const slowOut: ServerMessage[] = [];
  for (let n = 0; n < total; n++) {
    if (n % 7 === 0) server.submit(0, { type: 'DrawLine', from: 0, to: 1 } as never);
    const t = server.closeTick();
    fastOut.push(...fast.deliver(t.n, t.cmds, false));
    const lag = lagWindow !== null && n >= lagWindow[0] && n < lagWindow[1];
    slowOut.push(...slow.deliver(t.n, t.cmds, lag));
  }
  return { fastOut, slowOut, server };
}

test('lagging client gets gap-free ticks batch then live ticks; others unchanged', () => {
  const base = run(null, 60);
  const lagged = run([10, 40], 60);
  assert.deepEqual(lagged.fastOut, base.fastOut);
  assert.ok(base.fastOut.every((m) => m.t === 'tick'));
  const s = lagged.slowOut;
  assert.equal(s.filter((m) => m.t === 'tick').length, 10 + 19);
  const batch = s.filter((m) => m.t === 'ticks');
  assert.equal(batch.length, 1);
  assert.deepEqual([batch[0]!.t === 'ticks' && batch[0]!.from, batch[0]!.t === 'ticks' && batch[0]!.to], [10, 41]);
  // client queue is contiguous and identical to a never-lagged client's
  const a = new LockstepClient(); const b = new LockstepClient();
  for (const m of s) assert.deepEqual(a.push(m), { ok: true });
  for (const m of base.fastOut) b.push(m);
  assert.equal(a.needsResync, false);
  assert.deepEqual(a.drain(Infinity), b.drain(Infinity));
  assert.equal(a.expected, 60);
});

test('still lagging at the end: nothing sent; resume sends batch ending at current tick', () => {
  const { slowOut } = run([5, 60], 60);
  assert.equal(slowOut.length, 5);
  const server = new LockstepServer({ seats: ['human', 'human'], buildingCount: 2, log: { timeLimitTicks: 1200 } });
  const f = new LagFeed(server.log);
  for (let n = 0; n < 3; n++) { const t = server.closeTick(); f.deliver(t.n, t.cmds, true); }
  const t = server.closeTick();
  const out = f.deliver(t.n, t.cmds, false);
  assert.deepEqual(out.map((m) => m.t === 'ticks' ? [m.from, m.to] : null), [[0, 4]]);
  assert.equal(f.next, 4);
});
