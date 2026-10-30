import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROTOCOL_VERSION, type ServerMessage } from '@node-arena/net';
import type { ClockRoom } from '../src/clock.js';
import { DEFAULT_CONTENT_DIR } from '../src/config.js';
import { loadServerContent } from '../src/content.js';
import { Conn } from '../src/conn.js';
import { createHub } from '../src/hub.js';
import { IpLimits, TokenBucket } from '../src/limits.js';
import { createMatchController } from '../src/match.js';
import { originAllowed } from '../src/main.js';
import { createRoomManager, type MatchStart } from '../src/room.js';

const content = loadServerContent(DEFAULT_CONTENT_DIR);
const TOKEN = (i: number): string => `${String(i).padStart(8, '0')}a1b2c3d4e5f60718293a4b5c`;

function fakeSocket(ip: string | undefined) {
  let msgCb: (d: string | Uint8Array) => void = () => {};
  const sent: ServerMessage[] = [];
  const raw: string[] = [];
  const s = {
    sent, raw, bufferedAmount: 0, closed: undefined as number | undefined, ip,
    send: (d: string) => { raw.push(d); sent.push(JSON.parse(d) as ServerMessage); },
    close(code?: number) { s.closed = code; },
    onMessage: (cb: (d: string | Uint8Array) => void) => void (msgCb = cb),
    onClose: () => {},
    say: (m: object) => msgCb(JSON.stringify(m)),
    of: <T extends ServerMessage['t']>(t: T) => sent.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[],
  };
  return s;
}

function setup(opts: { maxRooms?: number; maxConns?: number } = {}) {
  let now = 1000;
  const added = new Set<ClockRoom>();
  const clock = { add: (r: ClockRoom) => void added.add(r), remove: (r: ClockRoom) => void added.delete(r), boundary: (t: number) => t };
  const logs: string[] = [];
  const rec = (ev: string, f?: Record<string, unknown>) => void logs.push(JSON.stringify({ ev, f }));
  const log = { log: (_l: string, ev: string, f?: Record<string, unknown>) => rec(ev, f), debug: rec, info: rec, warn: rec, error: rec };
  const ipLimits = new IpLimits(() => now);
  const ctl = createMatchController({ clock, now: () => now, log });
  const starts: MatchStart[] = [];
  const rooms: Parameters<typeof ctl.catchUp>[0][] = [];
  const mgr = createRoomManager({
    content, clock, now: () => now, inputDelay: 3, log, ipLimits, maxRooms: opts.maxRooms ?? 40,
    onStart: (r, m) => { starts.push(m); rooms.push(r); ctl.onStart(r, m); },
    onMatchMessage: ctl.onMessage, onCatchUp: ctl.catchUp,
  });
  const hub = createHub({
    versions: content.versions, handler: mgr, secret: 's', log, ipLimits, now: () => now, maxConns: opts.maxConns ?? 200,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  let c = 0;
  const client = (ip: string | undefined = '1.2.3.4', hello = true) => {
    const s = fakeSocket(ip);
    hub.accept(s as never);
    if (hello && s.closed === undefined) s.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick: `P${c}`, token: TOKEN(++c) });
    return s;
  };
  const tickAll = () => { for (const r of [...added]) r.tick(); };
  return { ctl, rooms, client, hub, mgr, logs, tickAll, starts, advance: (ms: number) => { now += ms; } };
}

test('41st room refused with room-full; 40 fit (distinct IPs)', () => {
  const t = setup();
  for (let i = 0; i < 40; i++) {
    const s = t.client(`10.0.0.${i}`);
    s.say({ t: 'room.create' });
    assert.equal(s.of('room.joined').length, 1, `room ${i}`);
  }
  const extra = t.client('10.0.1.1');
  extra.say({ t: 'room.create' });
  assert.equal(extra.of('error').at(-1)?.code, 'room-full');
  assert.equal(t.mgr.roomCount(), 40);
});

test('9th connection from one IP refused; other IP unaffected', () => {
  const t = setup();
  const socks = Array.from({ length: 8 }, () => t.client('9.9.9.9'));
  assert.ok(socks.every((s) => s.closed === undefined));
  const ninth = t.client('9.9.9.9', false);
  assert.equal(ninth.closed, 1013);
  assert.equal(t.client('9.9.9.8', false).closed, undefined);
  assert.equal(t.hub.connCount(), 9);
});

test('MAX_CONNS: conn past cap refused', () => {
  const t = setup({ maxConns: 3 });
  for (let i = 0; i < 3; i++) t.client(`1.1.1.${i}`, false);
  assert.equal(t.client('2.2.2.2', false).closed, 1013);
});

test('token bucket: burst 80 passes, refill 40/s', () => {
  let now = 0;
  const b = new TokenBucket(() => now);
  for (let i = 0; i < 80; i++) assert.ok(b.take(), `burst ${i}`);
  assert.equal(b.take(), false);
  now += 250; // 10 tokens
  for (let i = 0; i < 10; i++) assert.ok(b.take());
  assert.equal(b.take(), false);
});

test('conn flood: burst ok, then rate-limited errors, 3rd strike closes', () => {
  const t = setup();
  const s = t.client();
  for (let i = 0; i < 79; i++) s.say({ t: 'room.leave' }); // hello was not counted; 80 tokens
  s.say({ t: 'room.leave' });
  assert.equal(s.of('error').filter((e) => e.code === 'rate-limited').length, 0);
  assert.equal(s.closed, undefined);
  s.say({ t: 'room.leave' });
  s.say({ t: 'room.leave' });
  assert.equal(s.of('error').filter((e) => e.code === 'rate-limited').length, 2);
  assert.equal(s.closed, undefined);
  s.say({ t: 'room.leave' });
  assert.equal(s.closed, 4005);
});

test('conn at steady 40/s never struck', () => {
  const t = setup();
  const s = t.client();
  for (let sec = 0; sec < 5; sec++) {
    for (let i = 0; i < 40; i++) s.say({ t: 'room.leave' });
    t.advance(1000);
  }
  assert.equal(s.of('error').length, 0);
});

test('creates: 6th create/min from one IP refused; window recovers', () => {
  const t = setup();
  const s = t.client();
  for (let i = 0; i < 5; i++) { s.say({ t: 'room.create' }); s.say({ t: 'room.leave' }); }
  assert.equal(s.of('room.joined').length, 5);
  s.say({ t: 'room.create' });
  assert.equal(s.of('error').at(-1)?.code, 'rate-limited');
  t.advance(61_000);
  s.say({ t: 'room.create' });
  assert.equal(s.of('room.joined').length, 6);
});

test('failed joins: 11th bad code/min from one IP rate-limited', () => {
  const t = setup();
  const s = t.client();
  for (let i = 0; i < 10; i++) { s.say({ t: 'room.join', code: 'ZZZZ', role: 'play' }); }
  assert.equal(s.of('error').filter((e) => e.code === 'room-not-found').length, 10);
  s.say({ t: 'room.join', code: 'ZZZZ', role: 'play' });
  assert.equal(s.of('error').at(-1)?.code, 'rate-limited');
  t.advance(61_000);
  s.say({ t: 'room.join', code: 'ZZZZ', role: 'play' });
  assert.equal(s.of('error').at(-1)?.code, 'room-not-found');
});

test('bad / missing Origin refused', () => {
  const cfg = { allowedOrigins: ['https://game.example.com', 'https://*.pages.dev'], allowNoOrigin: false };
  assert.equal(originAllowed('https://evil.com', cfg), false);
  assert.equal(originAllowed(undefined, cfg), false);
  assert.equal(originAllowed('https://a.b.pages.dev', cfg), false);
  assert.equal(originAllowed('https://a.pages.dev', cfg), true);
  assert.equal(originAllowed(undefined, { ...cfg, allowNoOrigin: true }), true);
});

test('lagging socket: skipped writes, batched ticks on drain, others unaffected; >2MB closes; IPs not logged', () => {
  const t = setup();
  const a = t.client('5.5.5.5'), b = t.client('6.6.6.6');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: a.of('room.joined')[0]!.code, role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  for (let i = 0; i < 5; i++) t.tickAll();
  const ticksOf = (s: ReturnType<typeof fakeSocket>) => s.of('tick').length;
  assert.equal(ticksOf(a), 5);
  b.bufferedAmount = 300 * 1024;
  for (let i = 0; i < 10; i++) t.tickAll();
  assert.equal(ticksOf(b), 5, 'no writes while lagging');
  assert.equal(ticksOf(a), 15);
  b.bufferedAmount = 0;
  t.tickAll();
  const batches = b.of('ticks');
  assert.equal(batches[0]!.from, 5);
  assert.equal(batches.at(-1)!.to, 16);
  b.bufferedAmount = 3 * 1024 * 1024;
  t.tickAll();
  assert.equal(b.closed, 4006);
  assert.equal(a.closed, undefined);
  const all = t.logs.join('\n');
  for (const ip of ['5.5.5.5', '6.6.6.6', '1.2.3.4']) assert.ok(!all.includes(ip), ip);
});

test('Conn.send closes (4006) instead of queueing when bufferedAmount over cap', () => {
  const t = setup();
  const s = t.client('7.7.7.7');
  s.say({ t: 'ping', id: 1 });
  assert.equal(s.of('pong').length, 1);
  s.bufferedAmount = 3 * 1024 * 1024;
  s.say({ t: 'ping', id: 2 });
  assert.equal(s.closed, 4006);
  assert.equal(s.of('pong').length, 1, 'nothing queued past the cap');
});

test('ping limiter entry removed on close', () => {
  const t = setup();
  const s = t.client('7.7.7.8');
  s.say({ t: 'ping', id: 1 });
  assert.equal(t.mgr.pingLimiterSize(), 1);
  s.bufferedAmount = 3 * 1024 * 1024;
  s.say({ t: 'ping', id: 2 });
  assert.equal(s.closed, 4006);
  assert.equal(t.mgr.pingLimiterSize(), 0);
});

test('catch-up amplification: watch/leave loop rate-limited; first seated reconnect still gets catch-up', () => {
  const t = setup();
  const a = t.client('5.5.5.5'), b = t.client('6.6.6.6');
  a.say({ t: 'room.create' });
  const code = a.of('room.joined')[0]!.code;
  b.say({ t: 'room.join', code, role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  for (let i = 0; i < 5; i++) t.tickAll();
  const w = t.client('8.8.8.8');
  w.say({ t: 'room.join', code, role: 'watch' });
  assert.equal(w.of('catchup').length > 0, true);
  const n = w.of('catchup').length;
  w.say({ t: 'room.leave' });
  w.say({ t: 'room.join', code, role: 'watch' });
  assert.equal(w.of('error').at(-1)?.code, 'rate-limited');
  assert.equal(w.of('catchup').length, n, 'no second full log');
  t.advance(5001);
  w.say({ t: 'room.join', code, role: 'watch' });
  assert.equal(w.of('catchup').length > n, true);
  // seated reconnect: new socket, same token (b was TOKEN(2))
  const hello = { t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick: 'P1', token: TOKEN(2) };
  const b2 = fakeSocket('6.6.6.6');
  t.hub.accept(b2 as never);
  b2.say(hello);
  assert.equal(b2.of('catchup').length > 0, true, 'first reconnect gets catch-up');
  const b3 = fakeSocket('6.6.6.6');
  t.hub.accept(b3 as never);
  b3.say(hello);
  assert.equal(b3.of('catchup').length, 0);
  assert.equal(b3.closed, 4005);
});

test('IpLimits: 31st new connection/min refused (released slots still count); window recovers', () => {
  let now = 0;
  const l = new IpLimits(() => now);
  for (let i = 0; i < 30; i++) { assert.ok(l.acquireConn('1.1.1.1'), `conn ${i}`); l.releaseConn('1.1.1.1'); }
  assert.equal(l.acquireConn('1.1.1.1'), false);
  assert.ok(l.acquireConn('1.1.1.2'));
  now += 61_000;
  assert.ok(l.acquireConn('1.1.1.1'));
});

function catchUpConn(buffered: number) {
  const s = fakeSocket('9.9.9.9');
  s.bufferedAmount = buffered;
  const hooks = { onHello() {}, onMessage() {}, onClose() {} };
  const c = new Conn(1, s as never, hooks, { setTimeout: () => 0, clearTimeout: () => {} }, () => {});
  return { s, c };
}

function startedMatch() {
  const t = setup();
  const a = t.client('5.5.5.5'), b = t.client('6.6.6.6');
  a.say({ t: 'room.create' });
  const code = a.of('room.joined')[0]!.code;
  b.say({ t: 'room.join', code, role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  const room = t.rooms[0]!;
  const ls = t.ctl.inspect(room)!;
  // 3 chunks of ~1 MB => > 2 MB catch-up in one synchronous turn.
  const pad = 'x'.repeat(1_000_000);
  (ls.log as { range: unknown }).range = () => [0, 1, 2].map((i) => ({ from: i, to: i + 1, cmds: [{ pad }] }));
  return { t, room };
}

test('catch-up > 2 MB to a low-buffer conn completes (no per-chunk 4006)', () => {
  const { t, room } = startedMatch();
  const { s, c } = catchUpConn(0);
  t.ctl.catchUp(room, c);
  assert.equal(s.closed, undefined);
  const chunks = s.of('catchup');
  assert.equal(chunks.length, 3);
  assert.equal(chunks.at(-1)?.done, true);
});

test('catch-up to a conn already over cap closes 4006 before sending', () => {
  const { t, room } = startedMatch();
  const { s, c } = catchUpConn(3 * 1024 * 1024);
  t.ctl.catchUp(room, c);
  assert.equal(s.closed, 4006);
  assert.equal(s.of('catchup').length, 0);
});

// ---- SP08 Task 1: resync ----
function runningRoom(t: ReturnType<typeof setup>) {
  const a = t.client('5.5.5.5'), b = t.client('6.6.6.6');
  a.say({ t: 'room.create' });
  const code = a.of('room.joined')[0]!.code;
  b.say({ t: 'room.join', code, role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  return { a, b, code };
}

test('resync: lobby/countdown/no room -> no-match, conn open, no limiter spent', () => {
  const t = setup();
  const lone = t.client('4.4.4.4');
  lone.say({ t: 'resync' });
  assert.equal(lone.of('error').at(-1)?.code, 'no-match');
  const { a, b } = runningRoom(t); // countdown (no ticks yet)
  a.say({ t: 'resync' });
  assert.equal(a.of('error').at(-1)?.code, 'no-match');
  const n = a.of('start').length;
  for (let i = 0; i < 5; i++) t.tickAll();
  t.advance(6000);
  a.say({ t: 'resync' }); // first real resync still allowed (earlier no-match did not spend tokens)
  assert.equal(a.of('start').length, n + 1);
  assert.equal(b.closed, undefined);
});

test('covers SP08 S3: resync in running room -> start, chunked catchup (done last) in one turn; spectator youPlayer null', () => {
  const t = setup();
  const { a, code } = runningRoom(t);
  for (let i = 0; i < 5; i++) t.tickAll();
  t.advance(6000);
  const before = a.sent.length;
  a.say({ t: 'resync' });
  const got = a.sent.slice(before);
  const types = got.map((m) => m.t);
  assert.equal(types[0], 'start');
  assert.ok(types.slice(1).every((x) => x === 'catchup'), JSON.stringify(types));
  const cu = got.filter((m) => m.t === 'catchup') as Extract<ServerMessage, { t: 'catchup' }>[];
  assert.equal(cu[0]!.from, 0);
  assert.equal(cu.at(-1)!.done, true);
  assert.equal((got[0] as Extract<ServerMessage, { t: 'start' }>).youPlayer, 0);
  const w = t.client('8.8.8.8');
  w.say({ t: 'room.join', code, role: 'watch' });
  t.advance(6000);
  const wb = w.sent.length;
  w.say({ t: 'resync' });
  const ws = w.sent.slice(wb);
  assert.equal(ws[0]!.t, 'start');
  assert.equal((ws[0] as Extract<ServerMessage, { t: 'start' }>).youPlayer, null);
  assert.equal(w.closed, undefined);
});

test('resync: second within 10 s -> rate-limited, conn open, no second attach; allowed after 10 s', () => {
  const t = setup();
  const { a } = runningRoom(t);
  for (let i = 0; i < 5; i++) t.tickAll();
  t.advance(6000);
  a.say({ t: 'resync' });
  const n = a.of('start').length;
  t.advance(6000); // past the 5 s catch-up token, inside 10 s
  a.say({ t: 'resync' });
  assert.equal(a.of('error').at(-1)?.code, 'rate-limited');
  assert.equal(a.of('start').length, n);
  assert.equal(a.closed, undefined);
  t.advance(4001);
  a.say({ t: 'resync' });
  assert.equal(a.of('start').length, n + 1);
});

test('resync right after a reconnect catch-up is refused by the catch-up token; conn stays open', () => {
  const t = setup();
  const { b } = runningRoom(t);
  for (let i = 0; i < 5; i++) t.tickAll();
  t.advance(6000);
  const b2 = fakeSocket('6.6.6.6');
  t.hub.accept(b2 as never);
  b2.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick: 'P1', token: TOKEN(2) });
  assert.ok(b2.of('start').length >= 1);
  const n = b2.of('start').length;
  b2.say({ t: 'resync' });
  assert.equal(b2.of('error').at(-1)?.code, 'rate-limited');
  assert.equal(b2.of('start').length, n);
  assert.equal(b2.closed, undefined);
  void b;
});

test('resyncBlocked peeks without spending; noteResync spends the 10 s window', () => {
  let now = 0;
  const l = new IpLimits(() => now);
  assert.equal(l.resyncBlocked('p'), false);
  assert.equal(l.resyncBlocked('p'), false);
  l.noteResync('p');
  assert.equal(l.resyncBlocked('p'), true);
  now = 10_000;
  assert.equal(l.resyncBlocked('p'), false);
});
