import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PROTOCOL_VERSION, type ServerMessage } from '@node-arena/net';
import type { ClockRoom } from '../src/clock.js';
import { DEFAULT_CONTENT_DIR } from '../src/config.js';
import { loadServerContent } from '../src/content.js';
import { createHub } from '../src/hub.js';
import { createMatchController } from '../src/match.js';
import { createRoomManager, MATCH_CAP_EXTRA_MS, SEAT_RESERVE_MS, type MatchStart } from '../src/room.js';

const fixture = readFileSync(new URL('./fixtures/na-pvp-fixture.json', import.meta.url), 'utf8');
const content = loadServerContent(DEFAULT_CONTENT_DIR, { extraLevels: { 'na-pvp-fixture': fixture } });
const CROSS = 'na-pvp-cross';

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
type Sock = ReturnType<typeof fakeSocket>;

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
    clearTimeout: (h: unknown) => { const i = timers.findIndex((q) => q.id === h); if (i >= 0) timers.splice(i, 1); },
  };
  const ctl = createMatchController({ clock, now: () => now, timers: fakeTimers, onAbort: (r) => mgr.drop(r) });
  const starts: MatchStart[] = [];
  let n = 0;
  const mgr = createRoomManager({
    content, clock, now: () => now, inputDelay: 3, randomInt: () => (n++ % 31) + starts.length * 7,
    onStart: (r, m) => { starts.push(m); ctl.onStart(r, m); },
    onMatchMessage: ctl.onMessage, onCatchUp: ctl.catchUp,
    onStartCancel: ctl.cancel, onSeatDisconnect: ctl.onSeatDisconnect, onSeatReconnect: ctl.onSeatReconnect, pauseStateOf: ctl.pauseState, endOf: ctl.endOf, hasPendingDeadline: ctl.hasPendingDeadline,
    pausedMsOf: ctl.pausedMs, seatOut: ctl.seatOut, onRoomClosed: ctl.cancel,
    timers: { setTimeout: (fn, ms) => (ms === 60_000 ? 0 : fakeTimers.setTimeout(fn, ms)), clearTimeout: fakeTimers.clearTimeout },
  });
  const hub = createHub({ versions: content.versions, handler: mgr, secret: 's', now: () => now, timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  let c = 0;
  const client = (nick: string, tok?: number): Sock => {
    const s = fakeSocket();
    hub.accept(s);
    s.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick, token: `${String(tok ?? ++c).padStart(8, '0')}a1b2c3d4e5f60718293a4b5c` });
    return s;
  };
  const advance = (ms: number): void => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      for (const x of timers.filter((q) => q.at <= now).sort((p, q) => p.at - q.at || p.id - q.id)) { const i = timers.indexOf(x); if (i >= 0) { timers.splice(i, 1); x.fn(); } }
      for (const r of [...rooms]) if (r.startAt <= now) r.tick();
    }
  };
  /** Human (seat 0) vs bot, running. */
  const soloVsBot = () => {
    const a = client('A');
    a.say({ t: 'room.create' });
    const code = a.of('room.joined')[0]!.code;
    a.say({ t: 'lobby.update', levelId: a.of('lobby.state').at(-1)!.levelId, seats: [{ kind: 'human', team: 0 }, { kind: 'bot', team: 1, difficulty: 'easy' }] });
    a.say({ t: 'lobby.start' });
    advance(3100);
    const room = mgr.room(code)!;
    assert.equal(room.state, 'running');
    return { a, room, match: starts[starts.length - 1]! };
  };
  /** CROSS FFA: `humans` humans then bots; all ready, started, running. */
  const ffa = (humans: number) => {
    const socks: Sock[] = [client('H')];
    socks[0]!.say({ t: 'room.create' });
    const code = socks[0]!.of('room.joined')[0]!.code;
    socks[0]!.say({ t: 'lobby.update', levelId: CROSS, seats: [0, 1, 2, 3].map((i) => ({ kind: 'human', team: i })) });
    socks[0]!.say({ t: 'lobby.update', levelId: CROSS, seats: [0, 1, 2, 3].map((i) => (i < humans ? { kind: 'human', team: i } : { kind: 'bot', team: i, difficulty: 'easy' })) });
    for (let i = 1; i < humans; i++) { const p = client(`P${i}`); p.say({ t: 'room.join', code, role: 'play' }); p.say({ t: 'lobby.ready', ready: true }); socks.push(p); }
    socks[0]!.say({ t: 'lobby.start' });
    advance(3100);
    const room = mgr.room(code)!;
    assert.equal(room.state, 'running');
    return { socks, room, code };
  };
  return { client, advance, mgr, ctl, starts, rooms, timers, now: () => now, setNow: (v: number) => { now = v; }, soloVsBot, ffa };
}

test('hard cap: paused room is never capped; cap extends by total paused time', () => {
  const t = setup();
  const { a, room, match } = t.soloVsBot();
  const capAt = match.startAt + (match.timeLimitTicks * 1000) / 20 + MATCH_CAP_EXTRA_MS;
  assert.ok(match.timeLimitTicks > 0);
  a.say({ t: 'pause' });
  const pausedAt = t.now();
  assert.equal(a.of('pause.state').at(-1)!.unlimited, true);
  t.setNow(capAt + 60_000); // far beyond the plain cap, still paused
  t.mgr.gc();
  assert.equal(t.mgr.room(room.code), room, 'paused (off the clock): not capped');
  a.say({ t: 'resume', epoch: a.of('pause.state').at(-1)!.epoch });
  const paused = t.now() - pausedAt;
  assert.equal(t.ctl.pausedMs(room), paused);
  t.setNow(capAt + paused - 1);
  t.mgr.gc();
  assert.ok(t.mgr.room(room.code), 'cap extended by paused ms');
  t.setNow(capAt + paused);
  t.mgr.gc();
  assert.equal(t.mgr.room(room.code), undefined);
  assert.equal(a.of('room.closed').at(-1)!.reason, 'idle');
});

test('eliminated / forfeited seat can leave a continuing FFA match and create a new room; others keep ticking', () => {
  const t = setup();
  const { socks, room } = t.ffa(3);
  const [h, p1, p2] = socks as [Sock, Sock, Sock];
  p1.say({ t: 'quit' });
  assert.equal(p1.of('error').length, 0);
  assert.equal(room.state, 'running');
  p1.say({ t: 'room.leave' });
  assert.equal(p1.of('error').length, 0, 'leave accepted (no not-eligible)');
  t.advance(200);
  const before = p1.of('tick').length;
  const nH = h.of('tick').length;
  t.advance(200);
  assert.equal(p1.of('tick').length, before, 'left conn is out of the fan-out');
  assert.ok(h.of('tick').length > nH && p2.of('tick').length > 0, 'others keep ticking');
  assert.equal(room.state, 'running');
  p1.say({ t: 'room.create' });
  assert.equal(p1.of('error').length, 0, 'create no longer blocked by "already in a room"');
  assert.notEqual(p1.of('room.joined').at(-1)!.code, room.code);
  // a live (not out) seat still cannot leave for free: leave == quit
  p2.say({ t: 'room.leave' });
  assert.equal(room.state, 'running');
});

test('hostless lobby: sole host drops, joiner is promoted; ready flags reset on host pass', () => {
  const t = setup();
  const a = t.client('A');
  a.say({ t: 'room.create' });
  const code = a.of('room.joined')[0]!.code;
  a.drop();
  const b = t.client('B');
  b.say({ t: 'room.join', code, role: 'play' });
  assert.equal(b.of('room.joined').at(-1)!.you.host, true);
  assert.equal(b.of('lobby.state').at(-1)!.host, 1);
  // host pass clears readies
  const h = t.client('H');
  h.say({ t: 'room.create' });
  const c2 = h.of('room.joined')[0]!.code;
  h.say({ t: 'lobby.update', levelId: CROSS, seats: [0, 1, 2, 3].map((i) => ({ kind: 'human', team: i })) });
  const p = t.client('P'), q = t.client('Q');
  for (const s of [p, q]) { s.say({ t: 'room.join', code: c2, role: 'play' }); s.say({ t: 'lobby.ready', ready: true }); }
  assert.equal(q.of('lobby.state').at(-1)!.seats[2]!.occupant!.ready, true);
  h.drop();
  const ls = q.of('lobby.state').at(-1)!;
  assert.equal(ls.host, 1);
  assert.equal(ls.seats[2]!.occupant!.ready, false);
});

test('reserve timer frees a dropped player moved off their seat index (seat flipped to spectator)', () => {
  const t = setup();
  const a = t.client('A'), b = t.client('B');
  a.say({ t: 'room.create' });
  const code = a.of('room.joined')[0]!.code;
  b.say({ t: 'room.join', code, role: 'play' });
  b.drop();
  a.say({ t: 'lobby.update', levelId: a.of('lobby.state').at(-1)!.levelId, seats: [{ kind: 'human', team: 0 }, { kind: 'bot', team: 1, difficulty: 'easy' }] });
  assert.equal(a.of('lobby.state').at(-1)!.spectators, 1, 'b moved to spectators');
  t.advance(SEAT_RESERVE_MS + 100);
  const b2 = t.client('B', 2);
  b2.say({ t: 'room.create' });
  assert.equal(b2.of('error').filter((e) => e.code === 'bad-lobby').length, 0, 'b is no longer bound');
});

test('ended: drop keeps the seat for a token reconnect (stored end), freed after the reserve', () => {
  const t = setup();
  const { a, room } = t.soloVsBot();
  a.say({ t: 'quit' });
  assert.equal(room.state, 'ended');
  a.drop();
  t.advance(1000);
  const a2 = t.client('A', 1);
  assert.equal(a2.of('end').length, 1, 'immutable result replayed on reconnect');
  a2.drop();
  t.advance(SEAT_RESERVE_MS + 100);
  const a3 = t.client('A', 1);
  a3.say({ t: 'room.create' });
  assert.equal(a3.of('error').length, 0, 'seat freed after the reserve');
});

test('lagging client (>256 KB) receives its missed ticks before `end`', () => {
  const t = setup();
  const h = t.client('H'), b = t.client('B');
  h.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: h.of('room.joined')[0]!.code, role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  h.say({ t: 'lobby.start' });
  t.advance(3400);
  b.bufferedAmount = 300 * 1024; // lagging, below the close threshold
  t.advance(500);
  h.say({ t: 'quit' }); // terminal forfeit: closes the frozen tick and ends immediately
  const end = b.of('end')[0];
  assert.ok(end !== undefined, 'match ended');
  let covered = 0;
  let sawEnd = false;
  for (const m of b.sent) {
    if (m.t === 'end') sawEnd = true;
    if (m.t === 'tick' && !sawEnd) covered++;
    if (m.t === 'ticks') { assert.equal(sawEnd, false, 'ticks batch precedes end'); covered += m.to - m.from; }
  }
  assert.ok(b.of('ticks').length > 0, 'missed ticks flushed as a batch');
  assert.ok(covered >= end.finalTick, `client covers all ticks: ${covered} vs ${end.finalTick}`);
});

test('onRoomClosed tears down match timers for a closed/abandoned paused room', () => {
  const t = setup();
  const { a, room } = t.soloVsBot();
  a.say({ t: 'pause' });
  a.drop(); // sole human gone while paused -> idle timer armed
  assert.ok(t.timers.length > 0, 'idle timer armed');
  t.mgr.closeAll('shutdown');
  assert.equal(t.timers.length, 0, 'pause/idle timers torn down');
  assert.equal(t.ctl.hasPendingDeadline(room), false);
  assert.equal(t.ctl.inspect(room), undefined);
});
