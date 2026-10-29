import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPause, IDLE_CLOSE_MS, type ExpiryEvent, type PauseSeat } from '../src/pause.js';

function harness(seats: PauseSeat[], opts: { onIdle?: boolean } = {}) {
  let t = 1000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const events: ExpiryEvent[] = [];
  let idled = 0;
  const pause = createPause({
    now: () => t + 0.7, // sub-ms must truncate
    setTimeout: (fn, d) => { const id = ++seq; timers.set(id, { at: t + d, fn }); return id; },
    clearTimeout: (id) => void timers.delete(id as number),
    seats,
    onExpire: (e) => void events.push(e),
    ...(opts.onIdle ? { onIdle: () => void idled++ } : {}),
  });
  const advance = (ms: number): void => {
    const until = t + ms;
    for (;;) {
      let best: [number, { at: number; fn: () => void }] | undefined;
      for (const e of timers) if (!best || e[1].at < best[1].at) best = e;
      if (!best || best[1].at > until) break;
      timers.delete(best[0]);
      t = Math.max(t, best[1].at);
      best[1].fn();
    }
    t = until;
  };
  return { pause, events, advance, timers, idled: () => idled, now: () => t };
}

const h = (p: number, team = p): PauseSeat => ({ player: p, kind: 'human', team });
const b = (p: number, team = p): PauseSeat => ({ player: p, kind: 'bot', team });

test('AC2 budget math: 8 s then re-pause leaves ~22 s', () => {
  const x = harness([h(0), h(1)]);
  assert.deepEqual(x.pause.pause(0), { ok: true, repeat: false });
  assert.equal(x.pause.budget(0), 30_000);
  x.advance(8000);
  assert.equal(x.pause.budget(0), 22_000);
  assert.equal(x.pause.resume(0, x.pause.epoch()), 'resumed');
  x.advance(5000); // running: no charge
  assert.equal(x.pause.budget(0), 22_000);
  x.pause.pause(0);
  assert.equal([...x.pause.holds().values()][0]?.deadline, x.now() + 22_000);
  x.advance(21_999);
  assert.equal(x.events.length, 0);
  x.advance(1);
  assert.equal(x.events.length, 1);
  assert.deepEqual(x.events[0]?.forfeits, [0]);
});

test('AC2 zero-balance pause expires immediately; rematch module resets', () => {
  const x = harness([h(0), h(1), h(2)]);
  x.pause.pause(0); x.advance(30_000); // seat 0 forfeits (pending)
  x.pause.pause(1); x.advance(10_000); x.pause.resume(1, x.pause.epoch());
  assert.equal(x.pause.budget(1), 20_000);
  // seat 2 drains to 0 across holds
  x.pause.pause(2); x.advance(30_000);
  assert.equal(x.pause.isTerminal(), true); // only seat 1 left
  assert.deepEqual(x.events.at(-1)?.forfeits, [2]);
  const r = harness([h(0), h(1)]); // new match
  assert.equal(r.pause.budget(0), 30_000);
});

test('0 balance: pause opens deadline = now, timer delay 0', () => {
  const x = harness([h(0), h(1), h(2)]);
  x.pause.pause(0); x.advance(30_000); // forfeits 0
  x.pause.pause(1); x.advance(29_999);
  x.pause.resume(1, x.pause.epoch());
  assert.equal(x.pause.budget(1), 1);
  x.pause.pause(1); x.advance(1);
  assert.deepEqual(x.events.at(-1)?.forfeits, [1]);
  // a fresh match (rematch) resets
  const r = harness([h(0), h(1)]);
  assert.equal(r.pause.budget(0), 30_000);
});

test('zero-balance disconnect hold expires on 0-delay timer', () => {
  const x = harness([h(0), h(1), h(2)]);
  x.pause.pause(0); x.advance(30_000); // 0 forfeits (pending)
  x.pause.pause(1); x.advance(30_000); // seat 1 expires too (2 connected)
  assert.deepEqual(x.pause.effectiveEliminated(), [0, 1]);
});

test('manual pause rules: paused rejection, repeat idempotent, bot/ineligible', () => {
  const x = harness([h(0), h(1), b(2)]);
  assert.deepEqual(x.pause.pause(2), { ok: false, reason: 'not-eligible' });
  assert.deepEqual(x.pause.pause(9), { ok: false, reason: 'not-eligible' });
  x.pause.pause(0);
  const ep = x.pause.epoch();
  assert.deepEqual(x.pause.pause(1), { ok: false, reason: 'paused' });
  assert.deepEqual(x.pause.pause(0), { ok: true, repeat: true });
  assert.equal(x.pause.epoch(), ep);
  assert.equal(x.pause.paused(), true);
});

test('resume: stale epoch ignored, no hold = none, only owner hold ends', () => {
  const x = harness([h(0), h(1)]);
  assert.equal(x.pause.resume(0, 0), 'none');
  x.pause.pause(0);
  const since = x.pause.holds().get(0)!.since;
  assert.equal(x.pause.resume(0, since - 1), 'stale');
  assert.equal(x.pause.paused(), true);
  assert.equal(x.pause.resume(1, since), 'none');
  assert.equal(x.pause.resume(0, since), 'resumed');
  assert.equal(x.pause.paused(), false);
  assert.equal(x.timers.size, 0);
});

test('AC3 manual hold + disconnect charged once; reconnect does not refresh', () => {
  const x = harness([h(0), h(1)]);
  x.pause.pause(0);
  const d = x.pause.holds().get(0)!.deadline;
  x.advance(4000);
  x.pause.disconnect(0);
  const hold = x.pause.holds().get(0)!;
  assert.equal(hold.origin, 'manual');
  assert.equal(hold.connected, false);
  assert.equal(hold.deadline, d);
  x.advance(2000);
  x.pause.reconnect(0);
  assert.equal(x.pause.holds().get(0)!.connected, true);
  assert.equal(x.pause.holds().get(0)!.deadline, d);
  assert.equal(x.pause.resume(0, x.pause.epoch()), 'resumed');
  assert.equal(x.pause.budget(0), 24_000);
});

test('disconnect hold uses remaining balance; return+resume keeps rest; reconnect no refresh', () => {
  const x = harness([h(0), h(1)]);
  x.pause.disconnect(0);
  assert.equal(x.pause.holds().get(0)!.origin, 'disconnect');
  x.advance(10_000);
  x.pause.reconnect(0);
  assert.equal(x.pause.budget(0), 20_000);
  x.pause.resume(0, x.pause.epoch());
  x.pause.disconnect(0);
  assert.equal(x.pause.holds().get(0)!.deadline, x.now() + 20_000);
});

test('AC6 disconnect during another pause opens own hold; match resumes after all', () => {
  const x = harness([h(0), h(1), h(2)]);
  x.pause.pause(0);
  assert.equal(x.pause.disconnect(1).ok, true);
  assert.equal(x.pause.holdCount(), 2);
  x.pause.resume(0, x.pause.epoch());
  assert.equal(x.pause.paused(), true);
  x.pause.reconnect(1);
  x.pause.resume(1, x.pause.epoch());
  assert.equal(x.pause.paused(), false);
});

test('AC5 1v1 earlier deadline: connected opponent wins (terminal, one forfeit)', () => {
  const x = harness([h(0), h(1)]);
  x.pause.pause(0); // connected, will expire
  x.advance(30_000);
  assert.deepEqual(x.events[0], { expired: [0], forfeits: [0], draw: false, terminal: true });
  assert.equal(x.pause.paused(), false);
  assert.equal(x.timers.size, 0);
});

test('AC5 1v1 same-instant expiry: both forfeit together => draw terminal', () => {
  const x = harness([h(0), h(1)]);
  x.pause.disconnect(0);
  x.pause.disconnect(1); // same now => identical deadlines
  x.advance(30_000);
  assert.equal(x.events.length, 1);
  assert.deepEqual(x.events[0]?.expired, [0, 1]);
  assert.deepEqual(x.events[0]?.forfeits, [0, 1]);
  assert.equal(x.events[0]?.terminal, true);
});

test('AC5/AC11 1v1 both disconnected, different deadlines: first expiry => draw (not absent win)', () => {
  const x = harness([h(0), h(1)]);
  x.pause.disconnect(0);
  x.advance(3000);
  x.pause.disconnect(1);
  x.advance(30_000);
  assert.equal(x.events.length, 1);
  assert.deepEqual(x.events[0], { expired: [0], forfeits: [0, 1], draw: true, terminal: true });
});

test('AC5 humans+bots with all humans away => draw includes bot seats', () => {
  const x = harness([h(0), h(1), b(2), b(3)]);
  x.pause.disconnect(0); x.pause.disconnect(1);
  x.advance(30_000);
  assert.deepEqual(x.events[0]?.forfeits, [0, 1, 2, 3]);
  assert.equal(x.events[0]?.draw, true);
  assert.equal(x.events[0]?.terminal, true);
});

test('AC5 expiry with connected human elsewhere forfeits only the expiring seat (FFA continues)', () => {
  const x = harness([h(0), h(1), h(2)]);
  x.pause.disconnect(0);
  x.advance(30_000);
  assert.deepEqual(x.events[0], { expired: [0], forfeits: [0], draw: false, terminal: false });
  assert.deepEqual(x.pause.pendingForfeits(), [0]);
  assert.deepEqual(x.pause.effectiveEliminated(), [0]);
});

test('AC5 2v2: forfeit leaves teammate alive, play continues', () => {
  const x = harness([h(0, 0), h(1, 1), h(2, 0), h(3, 1)]);
  x.pause.pause(0);
  x.advance(30_000);
  assert.equal(x.events[0]?.terminal, false);
  assert.equal(x.pause.isTerminal(), false);
});

test('AC5 2v2 team gone => terminal at quit of last teammate', () => {
  const x = harness([h(0, 0), h(1, 1), h(2, 0), h(3, 1)]);
  assert.equal(x.pause.quit(0).ok, true);
  const r = x.pause.quit(2);
  assert.deepEqual(r, { ok: true, terminal: true });
});

test('AC11 manual-hold owner who then dropped is away (origin irrelevant)', () => {
  const x = harness([h(0), h(1)]);
  x.pause.pause(0);
  x.pause.disconnect(0); // marks connected=false only
  x.advance(3000);
  x.pause.disconnect(1);
  x.advance(30_000); // seat 0 deadline first
  assert.deepEqual(x.events[0], { expired: [0], forfeits: [0, 1], draw: true, terminal: true });
});

test('AC11 manual hold stays connected, other disconnect expires => other forfeits, A wins', () => {
  const x = harness([h(0), h(1)]);
  x.pause.pause(0);
  x.pause.disconnect(1);
  x.advance(30_000); // both deadlines identical? 0 pauses first at same now => same deadline
  // identical deadline: E0={0,1}; seat 0 connected so not draw-by-away, but same instant => both forfeit
  assert.deepEqual(x.events[0]?.expired, [0, 1]);
  const y = harness([h(0), h(1)]);
  y.pause.pause(0);
  y.advance(1000);
  y.pause.disconnect(1);
  y.advance(40_000);
  assert.deepEqual(y.events[0], { expired: [0], forfeits: [0], draw: false, terminal: true });
});

test('AC11 B later disconnects after A dropped; B expires first vs later => draw both ways', () => {
  const x = harness([h(0), h(1)]);
  x.pause.disconnect(1);
  x.advance(1000);
  x.pause.disconnect(0);
  x.advance(40_000);
  assert.equal(x.events[0]?.draw, true);
  assert.deepEqual(x.events[0]?.forfeits, [0, 1]);
});

test('recorded deadline ordering: late timer still resolves earliest deadline first', () => {
  const x = harness([h(0), h(1), h(2)]);
  x.pause.disconnect(0);
  x.advance(1);
  x.pause.disconnect(1);
  x.advance(100_000); // timer fires late for both
  assert.deepEqual(x.events.map((e) => e.expired), [[0], [1]]);
  assert.equal(x.events[1]?.terminal, true); // 2 alone left after both forfeit
});

test('AC12 1v1: A holds, B quits => terminal at once, timers cancelled', () => {
  const x = harness([h(0), h(1)]);
  x.pause.pause(0);
  assert.deepEqual(x.pause.quit(1), { ok: true, terminal: true });
  assert.equal(x.pause.holdCount(), 0);
  assert.equal(x.timers.size, 0);
  assert.equal(x.pause.pause(0).ok, false);
  x.advance(60_000);
  assert.equal(x.events.length, 0);
});

test('AC12 humans+bots: A holds, B quits => A unlimited, deadline cleared, never expires', () => {
  const x = harness([h(0, 0), h(1, 1), b(2, 2)]);
  x.pause.pause(0);
  assert.equal(typeof x.pause.holds().get(0)!.deadline, 'number');
  assert.deepEqual(x.pause.quit(1), { ok: true, terminal: false });
  assert.equal(x.pause.holds().get(0)!.deadline, null);
  const s = x.pause.snapshot(7);
  assert.equal(s.unlimited, true);
  assert.deepEqual(s.budgets, [null, null, null]);
  assert.equal(x.timers.size, 0);
  x.advance(10 * 60_000 - 1);
  assert.equal(x.events.length, 0);
});

test('AC12 3 humans: one quits => remaining two keep limited budgets', () => {
  const x = harness([h(0), h(1), h(2)]);
  x.pause.pause(0);
  x.pause.quit(1);
  assert.notEqual(x.pause.holds().get(0)!.deadline, null);
  assert.deepEqual(x.pause.snapshot(0).budgets, [30_000, null, 30_000]);
  assert.equal(x.pause.snapshot(0).unlimited, false);
});

test('unlimited: human vs bots only never expires; quit still forfeits', () => {
  const x = harness([h(0, 0), b(1, 1)]);
  assert.equal(x.pause.holds().size, 0);
  x.pause.pause(0);
  assert.equal(x.pause.holds().get(0)!.deadline, null);
  assert.deepEqual(x.pause.snapshot(3).budgets, [null, null]);
  x.advance(5 * 60_000);
  assert.equal(x.events.length, 0);
  x.pause.resume(0, x.pause.epoch());
  assert.equal(x.pause.budget(0), null);
  assert.deepEqual(x.pause.quit(0), { ok: true, terminal: true });
});

test('unlimited recompute after sim elimination clears deadline', () => {
  const x = harness([h(0), h(1), b(2)]);
  x.pause.pause(0);
  assert.notEqual(x.pause.holds().get(0)!.deadline, null);
  const e = x.pause.epoch();
  x.pause.syncEliminated([1]);
  assert.equal(x.pause.holds().get(0)!.deadline, null);
  assert.ok(x.pause.epoch() > e);
  assert.equal(x.timers.size, 0);
});

test('syncEliminated clears pending forfeit once stepped', () => {
  const x = harness([h(0), h(1), h(2)]);
  x.pause.quit(1);
  assert.deepEqual(x.pause.pendingForfeits(), [1]);
  x.pause.syncEliminated([1]);
  assert.deepEqual(x.pause.pendingForfeits(), []);
  assert.deepEqual(x.pause.effectiveEliminated(), [1]);
});

test('AC13 terminal flush: timers cancelled, holds cleared, epoch bumped, later inputs no-ops', () => {
  const x = harness([h(0), h(1), h(2), h(3)]);
  x.pause.disconnect(2); // C holds
  const e = x.pause.epoch();
  x.pause.quit(0);
  x.pause.quit(1);
  x.pause.quit(3); // only team 2 alive => terminal, flush
  assert.ok(x.pause.epoch() > e);
  assert.equal(x.pause.holdCount(), 0);
  assert.equal(x.timers.size, 0);
  const s = x.pause.snapshot(9);
  assert.equal(s.paused, false);
  assert.deepEqual(s.holds, []);
  const ep = x.pause.epoch();
  assert.equal(x.pause.resume(2, 99), 'none');
  assert.deepEqual(x.pause.quit(2), { ok: false, reason: 'ended' });
  assert.equal(x.pause.pause(2).ok, false);
  x.advance(120_000);
  assert.equal(x.events.length, 0);
  assert.equal(x.pause.epoch(), ep);
});

test('snapshot: holds, epoch, frozen tick, budgets countdown at send time', () => {
  const x = harness([h(0), h(1), b(2)]);
  x.pause.pause(0);
  x.advance(2500);
  const s = x.pause.snapshot(42);
  assert.equal(s.t, 'pause.state');
  assert.equal(s.paused, true);
  assert.equal(s.tick, 42);
  assert.equal(s.epoch, x.pause.epoch());
  assert.deepEqual(s.holds, [{ player: 0, reason: 'manual', connected: true, since: s.epoch }]);
  assert.deepEqual(s.budgets, [27_500, 30_000, null]);
  assert.equal(s.unlimited, false);
});

test('epoch bumps on open, close, connected change; not on idempotent repeat', () => {
  const x = harness([h(0), h(1)]);
  const e0 = x.pause.epoch();
  x.pause.pause(0);
  const e1 = x.pause.epoch();
  assert.ok(e1 > e0);
  x.pause.pause(0);
  assert.equal(x.pause.epoch(), e1);
  x.pause.disconnect(0);
  const e2 = x.pause.epoch();
  assert.ok(e2 > e1);
  x.pause.disconnect(0);
  assert.equal(x.pause.epoch(), e2);
  x.pause.reconnect(0);
  assert.ok(x.pause.epoch() > e2);
  const e3 = x.pause.epoch();
  x.pause.resume(0, e3);
  assert.ok(x.pause.epoch() > e3);
});

test('D14 idle close after 10 min with no connected human, cancelled by reconnect', () => {
  const x = harness([h(0), b(1)], { onIdle: true });
  x.pause.disconnect(0);
  assert.equal(x.timers.size, 1);
  x.advance(IDLE_CLOSE_MS - 1);
  assert.equal(x.idled(), 0);
  x.advance(1);
  assert.equal(x.idled(), 1);
  assert.equal(x.events.length, 0);

  const y = harness([h(0), b(1)], { onIdle: true });
  y.pause.disconnect(0);
  y.advance(5 * 60_000);
  y.pause.reconnect(0);
  assert.equal(y.timers.size, 0);
  y.advance(IDLE_CLOSE_MS);
  assert.equal(y.idled(), 0);
});

test('idle timer not started while a limited deadline is pending', () => {
  const x = harness([h(0), h(1)], { onIdle: true });
  x.pause.disconnect(0);
  x.pause.disconnect(1);
  assert.equal(x.timers.size, 1); // only the deadline timer
});

test('integer-ms truncation', () => {
  const x = harness([h(0), h(1)]);
  x.pause.pause(0);
  assert.equal(Number.isInteger(x.pause.holds().get(0)!.startedAt), true);
  assert.equal(Number.isInteger(x.pause.snapshot(0).budgets[0]), true);
});
