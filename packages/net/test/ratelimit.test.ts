import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RateLimiter } from '../src/ratelimit.js';
import { LockstepServer } from '../src/lockstep-server.js';

const clock = () => { let t = 0; return { now: () => t, adv: (ms: number) => { t += ms; } }; };
const draw = (from = 1, to = 2) => ({ type: 'DrawLine', from, to });

test('cmds per tick cap', () => {
  const c = clock(); const l = new RateLimiter(c.now, { cmdsPerTick: 2, cmdsPerSec: 100 });
  assert.equal(l.hit(0, 'cmd', 5).ok, true); assert.equal(l.hit(0, 'cmd', 5).ok, true);
  assert.deepEqual(l.hit(0, 'cmd', 5), { ok: false, advice: 'error' });
  assert.equal(l.hit(0, 'cmd', 6).ok, true);
  assert.equal(l.hit(1, 'cmd', 5).ok, true);
});

test('per-second windows for cmd, hash, ping, control; reset after 1s', () => {
  for (const [kind, key] of [['cmd', 'cmdsPerSec'], ['hash', 'hashPerSec'], ['ping', 'pingPerSec'], ['control', 'controlPerSec']] as const) {
    const c = clock(); const l = new RateLimiter(c.now, { [key]: 3 });
    for (let i = 0; i < 3; i++) assert.equal(l.hit(0, kind).ok, true, kind);
    assert.equal(l.hit(0, kind).ok, false, kind);
    assert.equal(l.hit(1, kind).ok, true, `${kind} other key`);
    c.adv(1000);
    assert.equal(l.hit(0, kind).ok, true, `${kind} after window`);
  }
});

test('kinds do not share counters but share violation escalation', () => {
  const c = clock(); const l = new RateLimiter(c.now, { hashPerSec: 1, pingPerSec: 1, disconnectAfter: 3 });
  l.hit(0, 'hash'); l.hit(0, 'ping');
  assert.deepEqual(l.hit(0, 'hash'), { ok: false, advice: 'error' });
  assert.deepEqual(l.hit(0, 'ping'), { ok: false, advice: 'error' });
  assert.deepEqual(l.hit(0, 'hash'), { ok: false, advice: 'disconnect' });
});

test('violations decay after quiet period', () => {
  const c = clock(); const l = new RateLimiter(c.now, { hashPerSec: 1, disconnectAfter: 2, violationDecayMs: 5000 });
  l.hit(0, 'hash'); l.hit(0, 'hash');
  c.adv(6000);
  l.hit(0, 'hash');
  assert.deepEqual(l.hit(0, 'hash'), { ok: false, advice: 'error' });
});

const mk = (c: ReturnType<typeof clock>) => new LockstepServer({ seats: ['human', 'human'], buildingCount: 10, log: { timeLimitTicks: 1000 }, now: c.now });

test('LockstepServer.submit -> rate-limited per tick, escalates to disconnect', () => {
  const c = clock(); const s = mk(c);
  for (let i = 0; i < 8; i++) assert.equal(s.submit(0, draw()).accepted, true);
  assert.deepEqual(s.submit(0, draw()), { accepted: false, rejected: 'rate-limited', advice: 'error' });
  assert.equal(s.submit(1, draw()).accepted, true);
  let last: unknown;
  for (let i = 0; i < 40; i++) last = s.submit(0, draw());
  assert.deepEqual(last, { accepted: false, rejected: 'rate-limited', advice: 'disconnect' });
});

test('LockstepServer.submit per-second cap; out-of-range indices count', () => {
  const c = clock(); const s = mk(c);
  let accepted = 0;
  for (let i = 0; i < 30; i++) { if (s.submit(0, draw()).accepted) accepted++; s.closeTick(); }
  assert.equal(accepted, 20);
  const c2 = clock(); const s2 = mk(c2);
  for (let i = 0; i < 8; i++) assert.deepEqual(s2.submit(0, draw(99, 2)), { accepted: false, rejected: 'bad-message' });
  assert.deepEqual(s2.submit(0, draw(99, 2)), { accepted: false, rejected: 'rate-limited', advice: 'error' });
});

test('LockstepServer.onHash rate-limited', () => {
  const c = clock(); const s = mk(c);
  for (let i = 0; i < 4; i++) assert.equal(s.onHash(0, 20, 'a'.repeat(16)).result, 'pending');
  assert.deepEqual(s.onHash(0, 20, 'a'.repeat(16)), { result: 'rate-limited', advice: 'error' });
});

test('normal play stays under limits: 20 min, 1.5 cmds/s each x4 seats, 1 hash/s, 1 ping/s; log within caps', () => {
  const c = clock(); const s = new LockstepServer({ seats: ['human', 'human', 'human', 'human'], buildingCount: 10, log: { timeLimitTicks: 24000 }, now: c.now });
  let limited = 0;
  for (let tick = 0; tick < 24000; tick++) {
    c.adv(50);
    for (let p = 0; p < 4; p++) {
      if (tick % 40 === p * 10 && s.submit(p, draw()).accepted === false) limited++;
      if (tick % 20 === 0 && (s.onHash(p, 0, 'a'.repeat(16)).result === 'rate-limited' || !s.limiter.hit(p, 'ping').ok)) limited++;
    }
    s.closeTick();
  }
  assert.equal(limited, 0);
  assert.ok(s.log.size < 5000, `log size ${s.log.size}`);
});

test('max sustained abuse volume bounded by caps (20/s/seat)', () => {
  const c = clock(); const s = mk(c);
  let accepted = 0;
  for (let tick = 0; tick < 1200; tick++) { c.adv(50); for (let i = 0; i < 10; i++) if (s.submit(0, draw()).accepted) accepted++; s.closeTick(); }
  assert.ok(accepted <= 20 * 60 + 20, `accepted ${accepted}`);
});
