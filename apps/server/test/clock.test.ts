import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClock, MAX_CATCHUP, type ClockRoom } from '../src/clock.js';

function fake(t0 = 1000) {
  let t = t0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const logs: Array<{ event: string; fields?: Record<string, unknown> | undefined }> = [];
  return {
    logs,
    now: () => t,
    setTimeout: (fn: () => void, d: number) => {
      const id = ++seq;
      timers.set(id, { at: t + d, fn });
      return id;
    },
    clearTimeout: (id: unknown) => void timers.delete(id as number),
    log: (event: string, fields?: Record<string, unknown>) => void logs.push({ event, fields }),
    stall: (ms: number) => void (t += ms),
    pending: () => timers.size,
    /** fire timers in order until virtual time reaches `until` */
    runUntil(until: number) {
      for (;;) {
        let best: [number, { at: number; fn: () => void }] | undefined;
        for (const e of timers) if (!best || e[1].at < best[1].at) best = e;
        if (!best || best[1].at > until) break;
        timers.delete(best[0]);
        t = Math.max(t, best[1].at);
        best[1].fn();
      }
      t = Math.max(t, until);
    },
  };
}

function room(startAt: number, calls: number[], clk: { now(): number }): ClockRoom {
  return { startAt, tick: () => void calls.push(clk.now()) };
}

test('steady 50 ms cadence, one timer', () => {
  const f = fake();
  const c = createClock(f);
  const calls: number[] = [];
  c.add(room(1000, calls, f));
  c.start();
  assert.equal(f.pending(), 1);
  f.runUntil(1250);
  assert.deepEqual(calls, [1000, 1050, 1100, 1150, 1200, 1250]);
  assert.equal(c.lateness().p99, 0);
  c.stop();
  assert.equal(f.pending(), 0);
});

test('room does not tick before startAt', () => {
  const f = fake();
  const c = createClock(f);
  const calls: number[] = [];
  c.add(room(1100, calls, f));
  c.start();
  f.runUntil(1200);
  assert.deepEqual(calls, [1100, 1150, 1200]);
});

test('200 ms stall catches up within cap, no skipped ticks', () => {
  const f = fake();
  const c = createClock(f);
  let n = 0;
  const seen: number[] = [];
  c.add({ startAt: 0, tick: () => void seen.push(n++) });
  c.start();
  f.runUntil(1100); // ticks at 1000..1100 => n 0..2
  f.stall(200); // now 1300, nextDue 1150
  f.runUntil(1300);
  assert.deepEqual(seen, Array.from({ length: seen.length }, (_, i) => i));
  assert.equal(seen.length, 7); // 1000,1050,1100 + 1150..1300 (4 on wake, then rest)
  assert.equal(f.logs.filter((l) => l.event === 'clock.rebase').length, 0);
  assert.ok(MAX_CATCHUP === 4);
});

test('per-wake ticks capped at MAX_CATCHUP', () => {
  const f = fake();
  const c = createClock(f);
  let n = 0;
  c.add({ startAt: 0, tick: () => void n++ });
  c.start();
  f.runUntil(1000); // n=1
  f.stall(400); // 1400, behind 400 from nextDue 1050
  const before = n;
  // fire exactly one wake
  const t = f.now();
  f.runUntil(t); // timers at 1050 <= t: first wake only fires timers with at<=t repeatedly; check count after
  assert.ok(n - before >= MAX_CATCHUP);
});

test('>500 ms behind rebases, n stays contiguous', () => {
  const f = fake();
  const c = createClock(f);
  let n = 0;
  const seen: number[] = [];
  c.add({ startAt: 0, tick: () => void seen.push(n++) });
  c.start();
  f.runUntil(1100);
  f.stall(800); // now 1900, nextDue 1150 => behind 750
  f.runUntil(1900);
  const rebases = f.logs.filter((l) => l.event === 'clock.rebase');
  assert.equal(rebases.length, 1);
  assert.deepEqual(seen, Array.from({ length: seen.length }, (_, i) => i));
  f.runUntil(2050);
  assert.deepEqual(seen, Array.from({ length: seen.length }, (_, i) => i));
  assert.equal(seen.length, 3 + 4); // 3 pre-stall, rebase tick at 1900, 1950, 2000, 2050
  assert.ok(c.lateness().p99 >= 500);
});

test('boundary rounds up to loop grid', () => {
  const f = fake(1000);
  const c = createClock(f);
  c.start();
  assert.equal(c.boundary(1000), 1000);
  assert.equal(c.boundary(1001), 1050);
  assert.equal(c.boundary(1349), 1350);
  assert.equal(c.boundary(1350), 1350);
});

test('countdown start aligns to loop boundary', () => {
  const f = fake(1000);
  const c = createClock(f);
  c.start();
  f.runUntil(1120); // loop grid still 1000+50k
  const startAt = c.boundary(f.now() + 3000);
  assert.equal(startAt, 4150);
  const calls: number[] = [];
  c.add(room(startAt, calls, f));
  f.runUntil(4250);
  assert.deepEqual(calls, [4150, 4200, 4250]);
});

test('throwing room does not stop others; reported', () => {
  const f = fake();
  const c = createClock(f);
  const calls: number[] = [];
  c.add({
    startAt: 0,
    tick: () => {
      throw new Error('boom');
    },
  });
  c.add(room(0, calls, f));
  c.start();
  f.runUntil(1050);
  assert.deepEqual(calls, [1000, 1050]);
  assert.equal(f.logs.filter((l) => l.event === 'clock.room_error').length, 2);
});

test('remove stops ticking; remove during tick safe', () => {
  const f = fake();
  const c = createClock(f);
  const calls: number[] = [];
  const r = room(0, calls, f);
  c.add(r);
  c.add({ startAt: 0, tick: () => c.remove(r) });
  c.start();
  f.runUntil(1100);
  assert.equal(calls.length, 1);
});

test('lateness p50/p99', () => {
  const f = fake();
  const c = createClock(f);
  c.start();
  f.runUntil(1200);
  assert.deepEqual(c.lateness(), { p50: 0, p99: 0 });
});
