import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Command } from '@node-arena/defs';
import { create } from '@node-arena/sim';
import { PROTOCOL_VERSION, SYSTEM_CMD_RESERVE, type ServerMessage } from '@node-arena/net';
import type { ClockRoom } from '../src/clock.js';
import { DEFAULT_CONTENT_DIR } from '../src/config.js';
import { loadServerContent } from '../src/content.js';
import { createHub } from '../src/hub.js';
import { createMatchController } from '../src/match.js';
import { createRoomManager, type MatchStart } from '../src/room.js';

const fixture = readFileSync(new URL('./fixtures/na-pvp-fixture.json', import.meta.url), 'utf8');
const content = loadServerContent(DEFAULT_CONTENT_DIR, { extraLevels: { 'na-pvp-fixture': fixture } });

function fakeSocket() {
  let msgCb: (d: string | Uint8Array) => void = () => {};
  let closeCb: () => void = () => {};
  const sent: ServerMessage[] = [];
  return {
    sent, bufferedAmount: 0,
    send: (d: string) => void sent.push(JSON.parse(d) as ServerMessage),
    close() {},
    onMessage: (cb: (d: string | Uint8Array) => void) => void (msgCb = cb),
    onClose: (cb: () => void) => void (closeCb = cb),
    drop: () => closeCb(),
    say: (m: object) => msgCb(JSON.stringify(m)),
    of: <T extends ServerMessage['t']>(t: T) => sent.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[],
  };
}

/** Fake time: 50 ms loop steps tick every ClockRoom whose startAt has passed; fake timers fire in order. */
function setup() {
  let now = 1000;
  const rooms = new Set<ClockRoom>();
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let tid = 0;
  const clock = {
    add: (r: ClockRoom) => void rooms.add(r), remove: (r: ClockRoom) => void rooms.delete(r),
    boundary: (t: number) => Math.ceil(t / 50) * 50,
  };
  const fakeTimers = {
    setTimeout: (fn: () => void, ms: number) => { timers.push({ at: now + ms, fn, id: ++tid }); return tid; },
    clearTimeout: (h: unknown) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
  };
  const ctl = createMatchController({ clock, now: () => now, timers: fakeTimers, onAbort: (r) => mgr.drop(r) });
  const starts: MatchStart[] = [];
  let n = 0;
  const mgr = createRoomManager({
    content, clock, now: () => now, inputDelay: 3,
    randomInt: () => (n++ % 31),
    onStart: (r, m) => { starts.push(m); ctl.onStart(r, m); },
    onMatchMessage: ctl.onMessage, onCatchUp: ctl.catchUp,
    onSeatDisconnect: ctl.onSeatDisconnect, onSeatReconnect: ctl.onSeatReconnect, pauseStateOf: ctl.pauseState, hasPendingDeadline: ctl.hasPendingDeadline,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  const hub = createHub({ versions: content.versions, handler: mgr, secret: 's', timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  let c = 0;
  const client = (nick: string, tok?: number) => {
    const s = fakeSocket();
    hub.accept(s);
    s.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick, token: `${String(tok ?? ++c).padStart(8, '0')}a1b2c3d4e5f60718293a4b5c` });
    return s;
  };
  const room = () => {
    const a = client(`A${c}`), b = client(`B${c}`);
    a.say({ t: 'room.create' });
    b.say({ t: 'room.join', code: a.of('room.joined')[0]!.code, role: 'play' });
    b.say({ t: 'lobby.ready', ready: true });
    a.say({ t: 'lobby.start' });
    return { a, b, match: starts[starts.length - 1]! };
  };
  /** Advance fake time by `ms` in 50 ms loop steps. */
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      for (const x of timers.filter((q) => q.at <= now).sort((p, q) => p.at - q.at || p.id - q.id)) { const i = timers.indexOf(x); if (i >= 0) { timers.splice(i, 1); x.fn(); } }
      for (const r of [...rooms]) if (r.startAt <= now) r.tick();
    }
  };
  return { room, client, advance, rooms, mgr, ctl, now: () => now };
}

const startRunning = (t: ReturnType<typeof setup>) => {
  const r = t.room();
  t.advance(3100); // countdown + a few ticks
  const room = t.mgr.room(r.match.code)!;
  assert.equal(room.state, 'running');
  return { ...r, room, hash: () => t.ctl.simOf(room)!.hash(), next: () => t.ctl.inspect(room)!.nextTick };
};

test('AC1: pause freezes 10 s (no ticks, hash frozen), resume continues at frozen tick with no burst; other rooms tick', () => {
  const t = setup();
  const r1 = startRunning(t);
  const r2 = startRunning(t);
  const frozen = r1.next();
  const h = r1.hash();
  const nTicks = r1.a.of('tick').length;
  r1.a.say({ t: 'pause' });
  const s = r1.a.of('pause.state').at(-1)!;
  assert.equal(s.paused, true);
  assert.equal(s.tick, frozen);
  assert.deepEqual(r1.b.of('pause.state').at(-1), s);
  assert.equal(s.holds[0]!.player, 0);
  assert.equal(s.holds[0]!.reason, 'manual');
  const other = r2.a.of('tick').length;
  t.advance(10_000);
  assert.equal(r1.a.of('tick').length, nTicks, 'no frames while paused');
  assert.equal(r1.b.of('tick').length, nTicks);
  assert.equal(r1.hash(), h);
  assert.equal(r1.next(), frozen);
  assert.equal(r2.a.of('tick').length - other, 200, 'other room unaffected');
  r1.a.say({ t: 'resume', epoch: r1.a.of('pause.state').at(-1)!.epoch });
  assert.equal(r1.a.of('pause.state').at(-1)!.paused, false);
  assert.equal(t.rooms.size, 2);
  t.advance(50);
  const ticks = r1.a.of('tick');
  assert.equal(ticks.length, nTicks + 1, 'exactly one tick per loop step after resume (no burst)');
  assert.equal(ticks.at(-1)!.n, frozen, 'next tick n = frozen tick');
  t.advance(500);
  assert.equal(r1.a.of('tick').length, nTicks + 11);
});

test('AC6: second Pause is `paused`, owner repeat idempotent, concurrent holds, resume only after all, forged/spectator rejected', () => {
  const t = setup();
  const r = startRunning(t);
  const spec = t.client('S');
  spec.say({ t: 'room.join', code: r.match.code, role: 'watch' });
  spec.say({ t: 'pause' });
  assert.equal(spec.of('error').at(-1)!.code, 'not-your-seat');
  spec.say({ t: 'resume', epoch: 99 });
  assert.equal(spec.of('error').at(-1)!.code, 'not-your-seat');
  spec.say({ t: 'quit' });
  assert.equal(spec.of('error').at(-1)!.code, 'not-your-seat');
  r.a.say({ t: 'pause' });
  const e1 = r.a.of('pause.state').at(-1)!.epoch;
  assert.equal(spec.of('pause.state').at(-1)!.paused, true, 'spectator sees the pause');
  r.b.say({ t: 'pause' });
  assert.equal(r.b.of('error').at(-1)!.code, 'paused');
  const nA = r.a.of('pause.state').length;
  r.a.say({ t: 'pause' });
  assert.equal(r.a.of('pause.state').length, nA + 1, 'repeat replies with snapshot to owner only');
  assert.equal(r.a.of('pause.state').at(-1)!.holds.length, 1);
  r.b.say({ t: 'resume', epoch: e1 }); // b has no hold: forged
  assert.equal(r.b.of('error').at(-1)!.code, 'not-your-seat');
  r.b.drop(); // disconnect while a is paused -> second hold
  const snap = r.a.of('pause.state').at(-1)!;
  assert.deepEqual(snap.holds.map((h) => [h.player, h.reason]), [[0, 'manual'], [1, 'disconnect']]);
  r.a.say({ t: 'resume', epoch: 0 }); // stale
  assert.equal(r.a.of('pause.state').at(-1)!.holds.length, 2, 'stale resume ignored');
  r.a.say({ t: 'resume', epoch: snap.epoch });
  assert.equal(r.a.of('pause.state').at(-1)!.paused, true, 'still paused: b hold remains');
  assert.equal(t.rooms.size, 0);
  const b2 = t.client('B', 2); // token of the second client
  const rejoin = b2.of('pause.state').at(-1)!;
  assert.equal(rejoin.paused, true, 'reauthed seat gets the snapshot');
  assert.equal(rejoin.holds[0]!.connected, true);
  b2.say({ t: 'resume', epoch: rejoin.epoch });
  assert.equal(b2.of('pause.state').at(-1)!.paused, false);
  assert.equal(t.rooms.size, 1);
});

test('AC6: buffered pre-pause cmds land at original ticks; cmd while paused rejected', () => {
  const t = setup();
  const r = startRunning(t);
  const n = r.next();
  r.a.say({ t: 'cmd', c: { type: 'DrawLine', from: 0, to: 1 } }); // lands at n + 3
  r.a.say({ t: 'pause' });
  r.b.say({ t: 'cmd', c: { type: 'DrawLine', from: 1, to: 0 } });
  assert.equal(r.b.of('error').at(-1)!.code, 'paused');
  t.advance(5000);
  r.a.say({ t: 'resume', epoch: r.a.of('pause.state').at(-1)!.epoch });
  t.advance(50 * 6);
  const withCmd = r.a.of('tick').filter((x) => x.c !== undefined);
  assert.equal(withCmd.length, 1);
  assert.equal(withCmd[0]!.n, n + 3);
});

test('pause in countdown -> no-match; control msgs share the rate-limit bucket', () => {
  const t = setup();
  const r = t.room();
  r.a.say({ t: 'pause' });
  assert.equal(r.a.of('error').at(-1)!.code, 'no-match');
  t.advance(3100);
  const room = t.mgr.room(r.match.code)!;
  assert.equal(room.state, 'running');
  for (let i = 0; i < 12; i++) r.b.say({ t: 'pause' });
  assert.ok(r.b.of('error').some((e) => e.code === 'rate-limited'));
});

test('heartbeat timeout opens a disconnect hold', () => {
  const t = setup();
  const r = startRunning(t);
  const conn = r.room.seats[0]!.occupant!.conn;
  t.mgr.onHeartbeatTimeout!(conn);
  const s = r.b.of('pause.state').at(-1)!;
  assert.deepEqual(s.holds.map((h) => [h.player, h.reason, h.connected]), [[0, 'disconnect', false]]);
  assert.equal(t.rooms.size, 0);
});

// ---- SP07 Task 7: forfeit emission, terminal flush, reserve ----

const replayHash = (t: ReturnType<typeof setup>, r: ReturnType<typeof startRunning>): string => {
  const ls = t.ctl.inspect(r.room)!;
  const sim = create(r.match.level, r.match.seed, { teams: r.match.teams });
  for (const ch of ls.log.range(0, ls.nextTick)) {
    const byTick = new Map<number, Command[]>();
    for (const e of ch.cmds) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e.cmd]);
    for (let n = ch.from; n < ch.to; n++) sim.step(byTick.get(n) ?? [], { events: false });
  }
  return sim.hash();
};

test('AC4: quit -> opponent victory exactly once, frozen-tick Forfeit, final pause.state before end, late input no-op, hash == replay', () => {
  const t = setup();
  const r = startRunning(t);
  const frozen = r.next();
  r.a.say({ t: 'quit' });
  assert.equal(r.room.state, 'ended');
  assert.equal(r.next(), frozen + 1, 'closed exactly the frozen tick');
  const ticks = r.b.of('tick');
  assert.deepEqual(ticks.at(-1)!.c, [{ type: 'Forfeit', player: 0 }]);
  assert.equal(r.b.of('end').length, 1);
  assert.equal(r.a.of('end').length, 1);
  const e = r.b.of('end')[0]!;
  assert.equal(e.outcome.outcome, 'victory');
  const idx = r.b.sent.findIndex((m) => m.t === 'end');
  const last = r.b.sent.slice(0, idx).filter((m) => m.t === 'pause.state').at(-1)!;
  assert.equal((last as { paused: boolean }).paused, false);
  assert.equal(t.rooms.size, 0);
  const sentA = r.a.sent.length, sentB = r.b.sent.length, next = r.next();
  r.a.say({ t: 'quit' }); r.b.say({ t: 'resume', epoch: 0 }); r.b.say({ t: 'pause' }); r.b.say({ t: 'cmd', c: { type: 'DrawLine', from: 1, to: 0 } });
  r.a.drop();
  t.advance(2000);
  assert.equal(r.a.sent.length, sentA); assert.equal(r.b.sent.length, sentB);
  assert.equal(r.next(), next);
  assert.equal(r.b.of('end').length, 1);
  assert.equal(r.hash(), replayHash(t, r));
});

test('AC4/AC13: quit while paused with other hold -> terminal immediately, holds cleared, log unchanged afterwards', () => {
  const t = setup();
  const r = startRunning(t);
  r.b.say({ t: 'pause' });
  const frozen = r.next();
  r.a.say({ t: 'quit' });
  assert.equal(r.room.state, 'ended');
  assert.equal(r.next(), frozen + 1);
  assert.equal(r.b.of('pause.state').at(-1)!.paused, false);
  assert.equal(r.b.of('end').length, 1);
  const size = t.ctl.inspect(r.room)!.log.size;
  t.advance(60_000);
  r.b.say({ t: 'resume', epoch: 99 });
  assert.equal(t.ctl.inspect(r.room)!.log.size, size);
  assert.equal(r.hash(), replayHash(t, r));
});

test('AC5: pause budget expiry forfeits the holder at the frozen tick; opponent wins; no timers left', () => {
  const t = setup();
  const r = startRunning(t);
  r.a.say({ t: 'pause' });
  const frozen = r.next();
  t.advance(29_900);
  assert.equal(r.room.state, 'running');
  t.advance(200);
  assert.equal(r.room.state, 'ended');
  assert.equal(r.next(), frozen + 1);
  assert.deepEqual(r.b.of('tick').at(-1)!.c, [{ type: 'Forfeit', player: 0 }]);
  assert.equal(r.b.of('end').length, 1);
  assert.equal(r.hash(), replayHash(t, r));
});

test('AC5: both humans away -> draw (Forfeit for all surviving seats ascending in one tick)', () => {
  const t = setup();
  const r = startRunning(t);
  r.a.drop();
  t.advance(1000);
  r.b.drop();
  const frozen = r.next();
  t.advance(31_000);
  assert.equal(r.room.state, 'ended');
  assert.equal(r.next(), frozen + 1);
  const c = t.ctl.inspect(r.room)!.log.range(frozen, frozen + 1)[0]!.cmds.map((e) => e.cmd);
  assert.deepEqual(c, [{ type: 'Forfeit', player: 0 }, { type: 'Forfeit', player: 1 }]);
  assert.equal(r.hash(), replayHash(t, r));
});

test('AC14: log saturated to cap-reserve still forfeits (system reserve)', () => {
  const t = setup();
  const r = startRunning(t);
  const ls = t.ctl.inspect(r.room)!;
  const tick = ls.nextTick;
  while (ls.log.size < ls.log.cmdCap - SYSTEM_CMD_RESERVE) ls.log.append(tick, { type: 'DrawLine', player: 1, from: 0, to: 1 } as never);
  r.a.say({ t: 'quit' });
  assert.equal(r.room.state, 'ended', 'forfeit appended despite saturation');
  assert.equal(r.b.of('end').length, 1);
});
