import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PROTOCOL_VERSION, type ServerMessage } from '@node-arena/net';
import type { ClockRoom } from '../src/clock.js';
import { DEFAULT_CONTENT_DIR } from '../src/config.js';
import { loadServerContent } from '../src/content.js';
import { createHub } from '../src/hub.js';
import { createMatchController, DESYNC_MIN_GAP_MS } from '../src/match.js';
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

function setup(opts: { maxRooms?: number } = {}) {
  let now = 1000;
  const timerFns: Array<() => void> = [];
  const added = new Set<ClockRoom>();
  const clock = { add: (r: ClockRoom) => void added.add(r), remove: (r: ClockRoom) => void added.delete(r), boundary: (t: number) => t };
  const logs: Array<{ level: string; ev: string; f?: Record<string, unknown> }> = [];
  const mk = (level: string) => (ev: string, f?: Record<string, unknown>) => void logs.push({ level, ev, ...(f ? { f } : {}) });
  const log = { log: () => {}, debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') };
  const ctl = createMatchController({ clock, now: () => now, log, onAbort: (r) => mgr.drop(r) });
  const starts: MatchStart[] = [];
  let n = 0;
  const mgr = createRoomManager({
    content, clock, now: () => now, inputDelay: 3, log,
    randomInt: () => (n++ % 31),
    onStart: (r, m) => { starts.push(m); ctl.onStart(r, m); },
    onMatchMessage: ctl.onMessage,
    onCatchUp: ctl.catchUp,
    ...(opts.maxRooms !== undefined ? { maxRooms: opts.maxRooms } : {}),
    timers: { setTimeout: (fn) => { timerFns.push(fn); return timerFns.length; }, clearTimeout: () => {} },
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
  const tickAll = () => { for (const r of [...added]) r.tick(); };
  return { room, client, tickAll, added, logs, setNow: (t: number) => { now = t; }, mgr, ctl, timerFns };
}

test('contiguous n, empty ticks sent, cmd lands at n+delay, end once and clock stops', () => {
  const { room, tickAll, added, mgr, ctl } = setup();
  const { a, b, match } = room();
  const clockCount = (): number => added.size;
  assert.equal(added.size, 1);
  assert.equal(mgr.room(match.code)!.state, 'countdown');
  tickAll();
  assert.equal(mgr.room(match.code)!.state, 'running');
  a.say({ t: 'cmd', c: { type: 'DrawLine', from: 0, to: 1 } });
  for (let i = 0; i < 20 && clockCount() > 0; i++) tickAll();
  const ticks = a.of('tick');
  assert.deepEqual(ticks.map((t) => t.n), ticks.map((_, i) => i));
  assert.equal(ticks[0]!.c, undefined, 'empty tick omits c');
  assert.deepEqual(b.of('tick'), ticks);
  assert.equal(ticks.findIndex((t) => t.c !== undefined), 4, 'cmd after tick 0 closed lands at 1+inputDelay');
  let guard = 0;
  while (clockCount() > 0 && guard++ < 20000) tickAll();
  assert.equal(clockCount(), 0, 'clock removed after end');
  assert.equal(a.of('end').length, 1);
  assert.equal(b.of('end').length, 1);
  assert.equal(mgr.room(match.code)!.state, 'ended');
  const end = a.of('end')[0]!;
  assert.equal(end.finalHash, ctl.simOf(mgr.room(match.code)!)!.hash());
  assert.equal(end.finalTick, ctl.simOf(mgr.room(match.code)!)!.view.tick);
  const nBefore = a.sent.length;
  tickAll();
  assert.equal(a.sent.length, nBefore);
});

test('bad hash -> desync to that socket only + log; rate-limited per seat', () => {
  const { room, tickAll, logs, setNow, mgr, ctl } = setup();
  const { a, b, match } = room();
  for (let i = 0; i < 20; i++) tickAll();
  assert.equal(ctl.simOf(mgr.room(match.code)!)!.view.tick, 20);
  a.say({ t: 'hash', tick: 20, h: '0000000000000000' });
  const d = a.of('desync');
  assert.equal(d.length, 1);
  assert.equal(d[0]!.tick, 20);
  assert.equal(d[0]!.serverHash, ctl.simOf(mgr.room(match.code)!)!.hash());
  assert.equal(b.of('desync').length, 0);
  const l = logs.find((x) => x.ev === 'desync')!;
  assert.equal(l.f!.seat, 0);
  assert.equal(l.f!.tick, 20);
  assert.equal(l.f!.clientHash, '0000000000000000');
  assert.equal(l.f!.serverHash, d[0]!.serverHash);
  assert.ok(l.f!.room);
  a.say({ t: 'hash', tick: 20, h: '1111111111111111' });
  assert.equal(a.of('desync').length, 1, 'rate-limited');
  setNow(1000 + DESYNC_MIN_GAP_MS);
  a.say({ t: 'hash', tick: 20, h: '2222222222222222' });
  assert.equal(a.of('desync').length, 2);
  a.say({ t: 'hash', tick: 20, h: ctl.simOf(mgr.room(match.code)!)!.hash() });
  assert.equal(a.of('desync').length, 2);
});

test('throwing room is isolated: error internal + room.closed; other room continues', () => {
  const { room, tickAll, added, mgr, ctl } = setup();
  const r1 = room(), r2 = room();
  assert.equal(added.size, 2);
  const r1room = mgr.room(r1.match.code)!;
  (ctl.simOf(r1room)! as { step: unknown }).step = () => { throw new Error('boom'); };
  tickAll();
  assert.equal(r1.a.of('error').at(-1)!.code, 'internal');
  assert.equal(r1.a.of('room.closed')[0]!.reason, 'internal');
  assert.equal(r1.b.of('room.closed').length, 1);
  assert.equal(r1room.state, 'closed');
  assert.equal(mgr.room(r1.match.code), undefined);
  assert.equal(mgr.roomCount(), 1);
  assert.equal(added.size, 1);
  tickAll();
  assert.equal(r2.a.of('tick').length, 2);
  assert.equal(r2.a.of('room.closed').length, 0);
});

test('aborted room is dropped: players can create again, reconnect has no replay, leave tolerated', () => {
  const { room, tickAll, mgr, ctl } = setup();
  const r = room();
  (ctl.simOf(mgr.room(r.match.code)!)! as { step: unknown }).step = () => { throw new Error('boom'); };
  tickAll();
  assert.equal(mgr.roomCount(), 0);
  r.a.say({ t: 'room.leave' });
  assert.equal(r.a.of('error').filter((m) => m.code === 'bad-lobby').length, 0);
  r.a.say({ t: 'room.create' });
  r.b.say({ t: 'room.create' });
  assert.equal(r.a.of('error').filter((m) => m.code === 'bad-lobby').length, 0);
  assert.equal(r.b.of('error').filter((m) => m.code === 'bad-lobby').length, 0);
  assert.equal(r.a.of('room.joined').length, 2);
  assert.equal(r.b.of('room.joined').length, 2);
  assert.equal(mgr.roomCount(), 2);
});

test('aborted room: reconnect with same token gets no replay', () => {
  const { room, tickAll, mgr, ctl, client } = setup();
  const r = room();
  (ctl.simOf(mgr.room(r.match.code)!)! as { step: unknown }).step = () => { throw new Error('boom'); };
  tickAll();
  const again = client('A', 1);
  assert.equal(again.of('room.joined').length, 0);
  assert.equal(again.of('lobby.state').length, 0);
});

test('rejected cmd replies with error code', () => {
  const { room, tickAll } = setup();
  const { a } = room();
  tickAll();
  a.say({ t: 'cmd', c: { type: 'DrawLine', from: 0, to: 9999 } });
  assert.equal(a.of('error').at(-1)!.code, 'bad-message');
});

function finish(t: ReturnType<typeof setup>): void {
  let guard = 0;
  while (t.added.size > 0 && guard++ < 20000) t.tickAll();
  assert.equal(t.added.size, 0);
}

test('after end: hash checked vs stored checkpoints (ok silent, wrong -> desync); late cmd dropped silently', () => {
  const t = setup();
  const { a, b, match } = t.room();
  const room = t.mgr.room(match.code)!;
  for (let i = 0; i < 20; i++) t.tickAll();
  const h20 = t.ctl.simOf(room)!.hash();
  finish(t);
  assert.equal(room.state, 'ended');
  const finalTick = t.ctl.simOf(room)!.view.tick;
  const nA = a.sent.length;
  a.say({ t: 'hash', tick: 20, h: h20 });
  a.say({ t: 'cmd', c: { type: 'DrawLine', from: 0, to: 1 } });
  b.say({ t: 'cmd', c: { type: 'DrawLine', from: 1, to: 0 } });
  if (finalTick % 20 === 0) a.say({ t: 'hash', tick: finalTick, h: t.ctl.simOf(room)!.hash() });
  assert.equal(a.sent.length, nA, 'no reply to ok hash / late cmd');
  assert.equal(b.of('error').length, 0);
  a.say({ t: 'hash', tick: 20, h: '0000000000000000' });
  const d = a.of('desync');
  assert.equal(d.length, 1);
  assert.equal(d[0]!.tick, 20);
  assert.equal(a.of('error').length, 0);
});

test('supersede in lobby: new conn gets room.joined + lobby.state and can ready/start', () => {
  const t = setup();
  const a = t.client('Ann'), b = t.client('Bob');
  a.say({ t: 'room.create' });
  const code = a.of('room.joined')[0]!.code;
  b.say({ t: 'room.join', code, role: 'play' });
  const b2 = t.client('Bob', 2); // same token as b
  assert.equal(b2.of('welcome')[0]!.resume?.code, code);
  assert.equal(b2.of('room.joined').at(-1)!.code, code);
  assert.deepEqual(b2.of('room.joined').at(-1)!.you, { seat: 1, host: false });
  assert.equal(b2.of('lobby.state').at(-1)!.seats[1]!.occupant?.nick, 'Bob');
  b.drop(); // old conn late close must not free the seat
  assert.equal(t.mgr.room(code)!.seats[1]!.occupant?.nick, 'Bob');
  b2.say({ t: 'lobby.ready', ready: true });
  assert.equal(b2.of('error').length, 0);
  a.say({ t: 'lobby.start' });
  assert.equal(b2.of('start').at(-1)!.youPlayer, 1);
  assert.equal(b.of('start').length, 0, 'old conn gets nothing');
});

test('supersede mid-match: new conn gets start, cmds accepted, ticks to new conn only', () => {
  const t = setup();
  const { a, b, match } = t.room();
  t.tickAll();
  const b2 = t.client('B', 2);
  assert.equal(b2.of('start').at(-1)!.youPlayer, 1);
  assert.equal(b2.of('start').at(-1)!.matchId, match.matchId);
  const oldTicks = b.of('tick').length;
  const nTicks = b2.of('tick').length;
  b.say({ t: 'cmd', c: { type: 'DrawLine', from: 1, to: 0 } });
  assert.equal(b.of('error').length, 0, 'closed old conn ignored');
  b2.say({ t: 'cmd', c: { type: 'DrawLine', from: 1, to: 0 } });
  assert.equal(b2.of('error').length, 0);
  for (let i = 0; i < 6; i++) t.tickAll();
  assert.equal(b.of('tick').length, oldTicks);
  assert.equal(b2.of('tick').length, nTicks + 6);
  assert.ok(b2.of('tick').some((x) => x.c !== undefined), 'cmd from new conn landed');
  assert.equal(a.of('tick').length, 7);
});

test('after end both leave -> each can create again; room deleted when empty', () => {
  const t = setup();
  const { a, b, match } = t.room();
  finish(t);
  a.say({ t: 'room.leave' });
  assert.ok(t.mgr.room(match.code), 'one member left');
  b.say({ t: 'room.leave' });
  assert.equal(t.mgr.room(match.code), undefined);
  assert.equal(t.mgr.roomCount(), 0);
  a.say({ t: 'room.create' });
  b.say({ t: 'room.create' });
  assert.equal(a.of('error').length, 0);
  assert.equal(b.of('error').length, 0);
  assert.equal(t.mgr.roomCount(), 2);
});

test('disconnect after end frees the player', () => {
  const t = setup();
  const { a, match } = t.room();
  finish(t);
  a.drop();
  const a2 = t.client('A', 1);
  a2.say({ t: 'room.create' });
  assert.equal(a2.of('error').length, 0);
  assert.notEqual(a2.of('room.joined').at(-1)!.code, match.code);
});

test('maxRooms+1 create refused', () => {
  const t = setup({ maxRooms: 1 });
  const a = t.client('A'), b = t.client('B');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.create' });
  assert.equal(a.of('error').length, 0);
  assert.equal(b.of('error').at(-1)!.code, 'room-full');
  assert.equal(t.mgr.roomCount(), 1);
});

test('ended room GC after 10 min clears byPlayer', () => {
  const t = setup();
  const { a, match } = t.room();
  finish(t);
  t.setNow(1000 + 9 * 60_000);
  t.mgr.gc();
  assert.ok(t.mgr.room(match.code));
  t.setNow(1000 + 11 * 60_000);
  t.timerFns.at(-1)!(); // periodic sweep timer
  assert.equal(t.mgr.room(match.code), undefined);
  a.say({ t: 'room.create' });
  assert.equal(a.of('error').length, 0);
});

test('spectator: mid-match watch gets start(null)+catchup, reaches hash equality, read-only, cap 8', async () => {
  const { createCatchup, createJoinLate } = await import('@node-arena/net');
  const { room, client, tickAll, mgr, ctl } = setup();
  const { a, b, match } = room();
  const code = match.code;
  tickAll();
  a.say({ t: 'cmd', c: { type: 'DrawLine', from: 0, to: 1 } });
  for (let i = 0; i < 30; i++) tickAll();
  const sp = client('Spec');
  sp.say({ t: 'room.join', code, role: 'watch' });
  assert.equal(sp.of('room.joined')[0]!.you.seat, null);
  const start = sp.of('start')[0]!;
  assert.equal(start.youPlayer, null);
  const cu = sp.of('catchup');
  assert.ok(cu.length >= 1);
  assert.equal(cu[cu.length - 1]!.done, true);
  assert.equal(cu[0]!.from, 0);
  const lockstep = ctl.inspect(mgr.room(code)!)!;
  assert.equal(cu[cu.length - 1]!.to, lockstep.nextTick);
  for (let i = 0; i < 25; i++) tickAll();
  const jl = createJoinLate(createCatchup(match.level, match.seed, { teams: match.teams }));
  for (const m of sp.sent) jl.push(m);
  jl.run(1e9, () => 0);
  assert.equal(jl.live, true);
  jl.run(1e9, () => 0);
  const ref = ctl.simOf(mgr.room(code)!)!;
  assert.equal(jl.catchup.sim.view.tick, ref.view.tick);
  assert.equal(jl.catchup.sim.hash(), ref.hash());
  // identical tick bytes
  assert.deepEqual(sp.of('tick').map((t) => t.n), a.of('tick').filter((t) => t.n >= cu[cu.length - 1]!.to).map((t) => t.n));
  // read-only
  sp.say({ t: 'cmd', c: { type: 'DrawLine', from: 0, to: 1 } });
  assert.equal(sp.of('error').at(-1)!.code, 'not-your-seat');
  sp.say({ t: 'hash', tick: 20, h: '0000000000000000' });
  assert.equal(sp.of('error').at(-1)!.code, 'not-your-seat');
  // cap
  for (let i = 0; i < 7; i++) { const s = client(`S${i}`); s.say({ t: 'room.join', code, role: 'watch' }); assert.equal(s.of('error').length, 0); }
  const ninth = client('S9');
  ninth.say({ t: 'room.join', code, role: 'watch' });
  assert.equal(ninth.of('error')[0]!.code, 'spectators-full');
  // spectator leaving frees a slot; drop frees too
  sp.drop();
  const again = client('S10');
  again.say({ t: 'room.join', code, role: 'watch' });
  assert.equal(again.of('error').length, 0);
  void b;
});

test('spectator: lobby watcher gets start(null) and live ticks from 0; mid-countdown watcher gets empty done catchup', () => {
  const { client, tickAll } = setup();
  const a = client('A'), w = client('W'), b = client('B');
  a.say({ t: 'room.create' });
  const code = a.of('room.joined')[0]!.code;
  w.say({ t: 'room.join', code, role: 'watch' });
  assert.equal(w.of('error').length, 0);
  assert.equal(a.of('lobby.state').at(-1)!.spectators, 1);
  b.say({ t: 'room.join', code, role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  assert.equal(w.of('start')[0]!.youPlayer, null);
  assert.equal(w.of('catchup').length, 0);
  const late = client('L');
  late.say({ t: 'room.join', code, role: 'watch' });
  assert.deepEqual(late.of('catchup'), [{ t: 'catchup', from: 0, to: 0, cmds: [], done: true }]);
  tickAll(); tickAll();
  assert.deepEqual(w.of('tick').map((t) => t.n), [0, 1]);
  assert.deepEqual(late.of('tick').map((t) => t.n), [0, 1]);
});
