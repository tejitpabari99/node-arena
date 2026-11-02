import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PROTOCOL_VERSION, parseServerMessage, type ServerMessage } from '@node-arena/net';
import { create } from '@node-arena/sim';
import { createClock } from '../src/clock.js';
import { DEFAULT_CONTENT_DIR } from '../src/config.js';
import type { Socket } from '../src/conn.js';
import { loadServerContent } from '../src/content.js';
import { createHub } from '../src/hub.js';
import { CODE_ALPHABET, createRoomManager, type MatchStart } from '../src/room.js';

const fixture = readFileSync(new URL('./fixtures/na-pvp-fixture.json', import.meta.url), 'utf8');
const content = loadServerContent(DEFAULT_CONTENT_DIR, { extraLevels: { 'na-pvp-fixture': fixture } });
const FIX = 'na-pvp-fixture';

function fakeSocket() {
  let msgCb: (d: string | Uint8Array) => void = () => {};
  let closeCb: () => void = () => {};
  const sent: ServerMessage[] = [];
  const frames: string[] = [];
  const s = {
    sent, frames, bufferedAmount: 0,
    send: (d: string) => { frames.push(d); sent.push(JSON.parse(d) as ServerMessage); },
    close() { closeCb(); },
    onMessage: (cb: (d: string | Uint8Array) => void) => void (msgCb = cb),
    onClose: (cb: () => void) => void (closeCb = cb),
    say: (m: object) => msgCb(JSON.stringify(m)),
    drop: () => closeCb(),
    last: <T extends ServerMessage['t']>(t: T) => [...sent].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined,
    clear: () => { sent.length = 0; },
  };
  return s satisfies Socket & Record<string, unknown>;
}

function setup(randomInt?: (a: number, b: number) => number) {
  let now = 1000;
  const clock = createClock({ now: () => now, setTimeout: () => 0 });
  const starts: MatchStart[] = [];
  const pending: Array<{ fn: () => void; ms: number }> = [];
  const mgr = createRoomManager({
    content, clock, now: () => now, inputDelay: 3, ...(randomInt ? { randomInt } : {}),
    onStart: (_r, m) => void starts.push(m),
    timers: { setTimeout: (fn, ms) => { pending.push({ fn, ms }); return pending.length; }, clearTimeout: () => {} },
  });
  const hub = createHub({ versions: content.versions, handler: mgr, secret: 's', timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  let n = 0;
  const client = (nick: string) => {
    const s = fakeSocket();
    hub.accept(s);
    s.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick, token: `${String(++n).padStart(8, "0")}a1b2c3d4e5f60718293a4b5c` });
    assert.equal(s.sent[0]?.t, 'welcome');
    s.clear();
    return s;
  };
  return { mgr, hub, client, starts, pending, setNow: (t: number) => { now = t; } };
}

const code = (s: ReturnType<typeof fakeSocket>): string => s.last('room.joined')!.code;

test('alphabet is 31 unambiguous chars matching net code regex', () => {
  assert.equal(CODE_ALPHABET.length, 31);
  assert.equal(new Set(CODE_ALPHABET).size, 31);
  assert.match(CODE_ALPHABET, /^[A-Z0-9]+$/);
  assert.doesNotMatch(CODE_ALPHABET, /[01OIL]/);
});

test('room.create: 4-char code, host seat 0, lobby.state', () => {
  const { client, mgr } = setup();
  const a = client('Ann');
  a.say({ t: 'room.create' });
  const j = a.last('room.joined')!;
  assert.match(j.code, /^[A-Z0-9]{4}$/);
  assert.deepEqual(j.you, { seat: 0, host: true });
  const ls = a.last('lobby.state')!;
  assert.equal(ls.host, 0);
  assert.equal(ls.seats[0]!.occupant?.nick, 'Ann');
  assert.equal(ls.seats[0]!.occupant?.ready, true); // host implicitly ready
  assert.equal(ls.seats[1]!.occupant, undefined);
  assert.equal(ls.timeLimitSec, content.compiled[ls.levelId]!.timeLimitSec);
  assert.equal(mgr.roomCount(), 1);
});

test('code uses injected randomInt', () => {
  const calls: Array<[number, number]> = [];
  const { client } = setup((a, b) => { calls.push([a, b]); return 0; });
  const a = client('Ann');
  a.say({ t: 'room.create' });
  assert.equal(code(a), '2222');
  assert.deepEqual(calls, [[0, 31], [0, 31], [0, 31], [0, 31]]);
});

test('colliding code is redrawn', () => {
  let i = 0;
  const seq = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1];
  const { client } = setup(() => seq[i++ % seq.length]!);
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' }); b.say({ t: 'room.create' });
  assert.equal(code(a), '2222');
  assert.equal(code(b), '3333');
});

test('room.join: second player takes seat 1, both get lobby.state', () => {
  const { client } = setup();
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  assert.deepEqual(b.last('room.joined')!.you, { seat: 1, host: false });
  for (const s of [a, b]) assert.equal(s.last('lobby.state')!.seats[1]!.occupant?.nick, 'Bob');
  assert.equal(b.last('lobby.state')!.seats[1]!.occupant?.ready, false);
});

test('room.join: full -> room-full; unknown -> room-not-found; watch -> spectator', () => {
  const { client } = setup();
  const a = client('Ann'), b = client('Bob'), c = client('Cy');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  c.say({ t: 'room.join', code: code(a), role: 'play' });
  assert.equal(c.last('error')!.code, 'room-full');
  c.say({ t: 'room.join', code: 'ZZZZ', role: 'play' });
  assert.equal(c.last('error')!.code, 'room-not-found');
  c.say({ t: 'room.join', code: code(a), role: 'watch' });
  assert.equal(c.last('room.joined')!.you.seat, null);
  assert.equal(a.last('lobby.state')!.spectators, 1);
});

test('create/join while already in a room refused', () => {
  const { client } = setup();
  const a = client('Ann');
  a.say({ t: 'room.create' });
  a.say({ t: 'room.create' });
  assert.equal(a.last('error')!.code, 'bad-lobby');
});

test('lobby messages outside a room -> not-in-room', () => {
  const { client } = setup();
  const a = client('Ann');
  for (const m of [{ t: 'lobby.start' }, { t: 'lobby.ready', ready: true }, { t: 'lobby.update', levelId: FIX, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }] }]) {
    a.say(m);
    assert.equal(a.last('error')!.code, 'not-in-room');
  }
});

test('host-only edits: non-host update/start -> not-host; host update ok', () => {
  const { client } = setup();
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  const ls = a.last('lobby.state')!;
  const upd = { t: 'lobby.update', levelId: FIX, seats: ls.seats.map((s) => ({ kind: s.kind, team: s.team })) };
  b.say(upd);
  assert.equal(b.last('error')!.code, 'not-host');
  b.say({ t: 'lobby.start' });
  assert.equal(b.last('error')!.code, 'not-host');
  b.clear();
  a.say(upd);
  assert.equal(a.last('lobby.state')!.levelId, FIX);
  assert.equal(b.last('lobby.state')!.levelId, FIX);
});

test('level change applies supplied seats + clears ready; occupants keep seats; unknown level / seat edits refused', () => {
  const { client } = setup();
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  assert.equal(a.last('lobby.state')!.seats[1]!.occupant?.ready, true);
  const other = content.pvpLevelIds.find((id) => id !== a.last('lobby.state')!.levelId && content.compiled[id]!.players.length === 2)!;
  const seats = content.compiled[other]!.players.map((p, i) => ({ kind: 'human', team: p.team ?? i }));
  a.say({ t: 'lobby.update', levelId: other, seats });
  const ls = a.last('lobby.state')!;
  assert.equal(ls.levelId, other);
  assert.equal(ls.seats[0]!.occupant?.nick, 'Ann');
  assert.equal(ls.seats[1]!.occupant?.nick, 'Bob');
  assert.equal(ls.seats[1]!.occupant?.ready, false);
  a.say({ t: 'lobby.update', levelId: 'nope', seats });
  assert.equal(a.last('error')!.code, 'bad-lobby');
  // host seat cannot become a bot
  a.say({ t: 'lobby.update', levelId: other, seats: seats.map((s) => ({ ...s, kind: 'bot' })) });
  assert.equal(a.last('error')!.code, 'bad-lobby');
});

test('host lobby.ready refused (implicit ready)', () => {
  const { client } = setup();
  const a = client('Ann');
  a.say({ t: 'room.create' });
  a.say({ t: 'lobby.ready', ready: true });
  assert.equal(a.last('error')!.code, 'bad-lobby');
});

test('start blocked: open seat -> bad-lobby; unready -> not-ready; then succeeds', () => {
  const { client, starts, mgr } = setup();
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' });
  a.say({ t: 'lobby.start' });
  assert.equal(a.last('error')!.code, 'bad-lobby');
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  a.say({ t: 'lobby.start' });
  assert.equal(a.last('error')!.code, 'not-ready');
  assert.equal(starts.length, 0);
  b.say({ t: 'lobby.ready', ready: true });
  b.say({ t: 'lobby.ready', ready: false });
  a.say({ t: 'lobby.start' });
  assert.equal(a.last('error')!.code, 'not-ready');
  b.say({ t: 'lobby.ready', ready: true });
  a.clear(); b.clear();
  a.say({ t: 'lobby.start' });
  assert.equal(starts.length, 1);
  assert.equal(mgr.room(code2(starts))!.state, 'countdown');
});
const code2 = (starts: MatchStart[]): string => starts[0]!.code;

test('start: seed from injected CSPRNG, start msg per member, countdown 3s on loop boundary', () => {
  const draws: Array<[number, number]> = [];
  let calls = 0;
  const { client, starts, setNow } = setup((a, b) => { draws.push([a, b]); return ++calls <= 4 ? 0 : 123456789; });
  setNow(1000);
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.clear(); b.clear();
  a.say({ t: 'lobby.start' });
  assert.deepEqual(draws[4], [0, 2 ** 31]);
  const sa = a.last('start')!, sb = b.last('start')!;
  assert.equal(sa.seed, 123456789);
  assert.equal(sa.youPlayer, 0); assert.equal(sb.youPlayer, 1);
  assert.equal(sa.countdownMs, 3000); assert.equal(sa.hashInterval, 20); assert.equal(sa.inputDelay, 3);
  assert.equal(sa.matchId, sb.matchId);
  assert.deepEqual(sa.seats.map((s) => [s.player, s.kind, s.nick]), [[0, 'human', 'Ann'], [1, 'human', 'Bob']]);
  const level = content.compiled[sa.levelId]!;
  assert.equal(sa.simHash, level.simHash.slice(0, 16));
  assert.equal(sa.timeLimitTicks, level.timeLimitSec! * 20);
  assert.equal(parseServerMessage(JSON.stringify(sa)).ok, true);
  const m = starts[0]!;
  assert.ok(m.startAt >= 1000 + 3000 && m.startAt < 1000 + 3000 + 50);
  assert.equal(m.seed, sa.seed);
  assert.equal(m.level, level);
  assert.deepEqual(m.teams, level.players.map((p, i) => p.team ?? i));
  assert.equal(m.startMsg(1, 3000).youPlayer, 1);
});

test('largest seed draw produces start frames accepted by the client protocol parser', () => {
  const { client, starts } = setup((_min, max) => max - 1);
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  for (const [seat, socket] of [a, b].entries()) {
    const frame = socket.frames.find((data) => (JSON.parse(data) as ServerMessage).t === 'start');
    assert.ok(frame, 'server sends start to each player');
    const parsed = parseServerMessage(frame);
    assert.equal(parsed.ok, true, 'client must accept the actual encoded start frame at the maximum seed');
    if (!parsed.ok || parsed.msg.t !== 'start') assert.fail('expected parsed start');
    assert.equal(parsed.msg.youPlayer, seat);
    assert.equal(parsed.msg.seed, starts[0]!.seed);
  }
});

test('default randomInt (node:crypto) yields wire-compatible seeds', () => {
  const { client, starts } = setup();
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  const seed = starts[0]!.seed;
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 31);
});

test('after start: lobby edits/join refused; second start refused', () => {
  const { client } = setup();
  const a = client('Ann'), b = client('Bob'), c = client('Cy');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  a.say({ t: 'lobby.start' });
  assert.equal(a.last('error')!.code, 'match-in-progress');
  b.say({ t: 'lobby.ready', ready: false });
  assert.equal(b.last('error')!.code, 'match-in-progress');
  c.say({ t: 'room.join', code: code(a), role: 'play' });
  assert.equal(c.last('error')!.code, 'match-in-progress');
});

test('lobby leave/disconnect frees seat; empty room is removed; host transfers', () => {
  const { client, mgr, pending } = setup();
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' });
  const cd = code(a);
  b.say({ t: 'room.join', code: cd, role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.drop();
  let ls = b.last('lobby.state')!;
  assert.equal(ls.host, 1);
  assert.equal(ls.seats[0]!.occupant?.status, 'away'); // SP07: seat reserved 30 s
  assert.equal(ls.seats[1]!.occupant?.ready, true); // new host implicit
  const reserve = pending.find((p) => p.ms === 30_000)!;
  reserve.fn(); // reserve expires -> seat freed
  ls = b.last('lobby.state')!;
  assert.equal(ls.seats[0]!.occupant, undefined);
  b.say({ t: 'room.leave' });
  assert.equal(mgr.roomCount(), 0);
  assert.equal(mgr.room(cd), undefined);
});

// ---- Task 11: full lobby editing ----
type Sock = ReturnType<typeof fakeSocket>;
const seatsOf = (s: Sock) => s.last('lobby.state')!.seats.map((x) => ({ kind: x.kind, team: x.team, ...(x.difficulty ? { difficulty: x.difficulty } : {}) }));
const lobby2 = () => {
  const env = setup();
  const a = env.client('Ann'), b = env.client('Bob');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  const levelId = a.last('lobby.state')!.levelId;
  return { ...env, a, b, levelId, edit: (seats: object[], s: Sock = a) => s.say({ t: 'lobby.update', levelId, seats }) };
};

test('covers task11: host sets seat kind/difficulty/team; broadcast to all', () => {
  const { a, b, edit } = lobby2();
  const seats = seatsOf(a);
  edit([seats[0]!, { kind: 'bot', team: 1, difficulty: 'hard' }]);
  for (const s of [a, b]) {
    const x = s.last('lobby.state')!.seats[1]!;
    assert.equal(x.kind, 'bot'); assert.equal(x.difficulty, 'hard'); assert.equal(x.team, 1);
  }
});

test('covers task11: bot difficulty defaults to normal; invalid difficulty / team / count / difficulty on human refused', () => {
  const { a, edit } = lobby2();
  const h = seatsOf(a)[0]!;
  edit([h, { kind: 'bot', team: 1 }]);
  assert.equal(a.last('lobby.state')!.seats[1]!.difficulty, 'normal');
  for (const bad of [
    [h, { kind: 'bot', team: 1, difficulty: 'nightmare' }],
    [h, { kind: 'human', team: 1, difficulty: 'easy' }],
    [h, { kind: 'bot', team: 99 }],
  ]) {
    a.clear();
    edit(bad);
    assert.equal(a.last('error')!.code, 'bad-lobby');
  }
  a.clear();
  edit([h]); // length 1: rejected by the wire validator (SP02 T5)
  assert.equal(a.last('error')!.code, 'bad-message');
});

test('covers task11: host seat cannot become bot/empty', () => {
  const { a, edit } = lobby2();
  edit([{ kind: 'empty', team: 0 }, { kind: 'human', team: 1 }]);
  assert.equal(a.last('error')!.code, 'bad-lobby');
});

test('covers task11: occupied human seat -> bot kicks occupant to spectator; spectator count in lobby.state', () => {
  const { a, b, edit } = lobby2();
  edit([seatsOf(a)[0]!, { kind: 'bot', team: 1, difficulty: 'easy' }]);
  const ls = a.last('lobby.state')!;
  assert.equal(ls.seats[1]!.occupant, undefined);
  assert.equal(ls.spectators, 1);
  assert.equal(b.last('lobby.state')!.spectators, 1);
  // spectator is read-only
  b.say({ t: 'lobby.ready', ready: true });
  assert.equal(b.last('error')!.code, 'not-in-room');
  b.say({ t: 'lobby.update', levelId: ls.levelId, seats: seatsOf(a) });
  assert.equal(b.last('error')!.code, 'not-host');
  // spectator leaving updates count
  b.say({ t: 'room.leave' });
  assert.equal(a.last('lobby.state')!.spectators, 0);
});

test('covers task11: seat edits clear non-host ready', () => {
  const { a, b, edit } = lobby2();
  b.say({ t: 'lobby.ready', ready: true });
  edit(seatsOf(a).map((s, i) => (i === 1 ? { ...s, team: 1 } : s))); // no change
  assert.equal(a.last('lobby.state')!.seats[1]!.occupant?.ready, true);
  edit([{ kind: 'human', team: 1 }, { kind: 'human', team: 1 }]);
  assert.equal(a.last('lobby.state')!.seats[1]!.occupant?.ready, false);
});

test('covers task11: level change applies the supplied seats (no reset to defaults)', () => {
  const { a, levelId, mgr } = lobby2();
  const other = content.pvpLevelIds.find((id) => id !== levelId && content.compiled[id]!.players.length === 2)!;
  a.say({ t: 'lobby.update', levelId, seats: [seatsOf(a)[0]!, { kind: 'bot', team: 1, difficulty: 'hard' }] });
  a.say({ t: 'lobby.update', levelId: other, seats: [{ kind: 'human', team: 0 }, { kind: 'bot', team: 1, difficulty: 'hard' }] });
  const ls = a.last('lobby.state')!;
  assert.equal(ls.levelId, other);
  assert.deepEqual(ls.seats.map((x) => x.kind), ['human', 'bot']);
  assert.equal(ls.spectators, 1);
  assert.equal(ls.timeLimitSec, content.compiled[other]!.timeLimitSec ?? 0);
  assert.ok(mgr.roomCount() === 1);
});

test('covers task11: timeLimitSec is read-only (extra field rejected by protocol, value from map)', () => {
  const { a, levelId } = lobby2();
  a.say({ t: 'lobby.update', levelId, seats: seatsOf(a), timeLimitSec: 5 });
  assert.equal(a.last('error')!.code, 'bad-message');
  assert.equal(a.last('lobby.state')!.timeLimitSec, content.compiled[levelId]!.timeLimitSec ?? 0);
});

test('covers task11: start refuses empty seat, <2 teams, disconnected human; allows bot seat', () => {
  const { a, b, edit, starts } = lobby2();
  const h = seatsOf(a);
  b.say({ t: 'lobby.ready', ready: true });
  edit([h[0]!, { kind: 'empty', team: 1 }]);
  a.say({ t: 'lobby.start' });
  assert.equal(a.last('error')!.code, 'bad-lobby');
  edit([h[0]!, { kind: 'bot', team: 0 }]); // same team: invalid
  a.say({ t: 'lobby.start' });
  assert.equal(a.last('error')!.code, 'bad-lobby');
  assert.equal(starts.length, 0);
  edit([h[0]!, { kind: 'bot', team: 1, difficulty: 'easy' }]);
  a.say({ t: 'lobby.start' });
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0]!.seats.map((s) => s.kind), ['human', 'bot']);
  assert.equal(starts[0]!.seats[1]!.difficulty, 'easy');
});

test('covers task11: start blocked when ready human is not connected; lobby.state status reflects it', () => {
  const { a, b, mgr, starts } = lobby2();
  b.say({ t: 'lobby.ready', ready: true });
  const r = mgr.room(code(a))!;
  r.seats[1]!.occupant!.conn.closed = true; // simulates a reserved/away seat (SP07 holds the seat)
  a.say({ t: 'lobby.start' });
  assert.equal(a.last('error')!.code, 'bad-lobby');
  assert.equal(starts.length, 0);
  a.say({ t: 'lobby.update', levelId: a.last('lobby.state')!.levelId, seats: seatsOf(a) }); // no-op edit rebroadcasts
  assert.equal(a.last('lobby.state')!.seats[1]!.occupant?.status, 'away');
  r.seats[1]!.occupant!.conn.closed = false;
  a.say({ t: 'lobby.start' });
  assert.equal(starts.length, 1);
});

test('covers task11: non-host cannot edit seats', () => {
  const { a, b, edit } = lobby2();
  edit([{ kind: 'human', team: 0 }, { kind: 'bot', team: 1 }], b);
  assert.equal(b.last('error')!.code, 'not-host');
  assert.equal(seatsOf(a)[1]!.kind, 'human');
});

test('app ping answers pong (not internal); flood is rate-limited', () => {
  const { client } = setup();
  const a = client('Ann');
  a.say({ t: 'ping', id: 9 });
  assert.deepEqual(a.sent, [{ t: 'pong', id: 9, tick: 0 }]);
  a.clear();
  for (let i = 0; i < 10; i++) a.say({ t: 'ping', id: i });
  assert.equal(a.sent.filter((m) => m.t === 'pong').length, 4); // 5 per s incl. the first
  assert.ok(a.sent.some((m) => m.t === 'error' && m.code === 'rate-limited'));
  assert.ok(!a.sent.some((m) => m.t === 'error' && m.code === 'internal'));
});

// SP02 Task 2/6: dynamic seats (applyConfig, range validation, room.create config).
const humanBot = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? { kind: 'human', team: 0 } : { kind: 'bot', difficulty: 'easy', team: i % 2 }));

test('covers R-SEA-01: lobby.update on cross accepts 2/3/4 seats; 1 or 5 -> bad-lobby', () => {
  const { client } = setup();
  const a = client('Ann');
  a.say({ t: 'room.create' });
  for (const n of [2, 3, 4]) {
    a.say({ t: 'lobby.update', levelId: 'na-pvp-cross', seats: humanBot(n) });
    assert.equal(a.last('lobby.state')!.seats.length, n);
  }
  for (const [n, code_] of [[1, 'bad-message'], [5, 'bad-lobby']] as const) { // 1 seat: wire validator; 5: exceeds map maxPlayers
    a.clear();
    a.say({ t: 'lobby.update', levelId: 'na-pvp-cross', seats: humanBot(n) });
    assert.equal(a.last('error')!.code, code_);
  }
});

test('covers R-SEA-01: duel maps accept exactly 2 seats (3 -> bad-lobby)', () => {
  const { client } = setup();
  const a = client('Ann');
  a.say({ t: 'room.create' });
  a.say({ t: 'lobby.update', levelId: 'na-pvp-duel-s', seats: humanBot(2) });
  assert.equal(a.last('lobby.state')!.seats.length, 2);
  a.clear();
  a.say({ t: 'lobby.update', levelId: 'na-pvp-duel-s', seats: humanBot(3) });
  assert.equal(a.last('error')!.code, 'bad-lobby');
});

test('covers R-SEA-01: level switch applies the new seat array atomically; overflow occupants become spectators', () => {
  const { client } = setup();
  const a = client('Ann'), b = client('Bob'), c = client('Cy');
  a.say({ t: 'room.create' });
  a.say({ t: 'lobby.update', levelId: 'na-pvp-cross', seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }, { kind: 'human', team: 0 }, { kind: 'human', team: 1 }] });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  c.say({ t: 'room.join', code: code(a), role: 'play' });
  a.say({ t: 'lobby.update', levelId: 'na-pvp-duel-s', seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }] });
  const ls = a.last('lobby.state')!;
  assert.equal(ls.levelId, 'na-pvp-duel-s');
  assert.equal(ls.seats.length, 2);
  assert.equal(ls.seats[1]!.occupant?.nick, 'Bob');
  assert.equal(ls.spectators, 1);
});

test('covers R-SEA-01: room.create with levelId+seats installs config; start with 3 seats (2 humans + bot) begins', () => {
  const { client, starts } = setup();
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create', levelId: 'na-pvp-cross', seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }, { kind: 'bot', difficulty: 'easy', team: 2 }] });
  assert.equal(a.last('lobby.state')!.seats.length, 3);
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  assert.equal(a.last('error'), undefined);
  assert.equal(starts.length, 1);
  assert.equal(starts[0]!.seats.length, 3);
});

test('covers review-1: lobby edits send room.joined to occupants whose seat/role/host changed', () => {
  const { a, b, edit } = lobby2();
  // human row flipped to bot: Bob becomes a spectator and is told so
  b.clear();
  edit([seatsOf(a)[0]!, { kind: 'bot', team: 1, difficulty: 'easy' }]);
  assert.deepEqual(b.last('room.joined')!.you, { seat: null, host: false });
  // flip back is a no-op for the (spectator) Bob: still no seat
  b.clear();
  a.clear();
  edit([{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }]);
  assert.equal(b.last('room.joined'), undefined);
  assert.equal(a.sent.some((m) => m.t === 'room.joined'), false);
});

test('covers review-1: host passed to seat 1 then map change moves them to seat 0 and says so', () => {
  const { a, b, levelId, mgr } = lobby2();
  const other = content.pvpLevelIds.find((id) => id !== levelId && content.compiled[id]!.players.length === 2)!;
  a.drop(); // host leaves socket: Bob becomes host at seat 1
  assert.equal(b.last('lobby.state')!.host, 1);
  b.clear();
  b.say({ t: 'lobby.update', levelId: other, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }] });
  assert.deepEqual(b.last('room.joined')!.you, { seat: 0, host: true });
  assert.ok(b.sent.findIndex((m) => m.t === 'room.joined') < b.sent.findIndex((m) => m.t === 'lobby.state'));
  assert.equal(b.last('lobby.state')!.host, 0);
  assert.equal(mgr.roomCount(), 1);
});

test('covers review-1: shrinking map tells displaced occupants they are spectators', () => {
  const env = setup();
  const four = content.pvpLevelIds.find((id) => content.compiled[id]!.players.length >= 3);
  const two = content.pvpLevelIds.find((id) => content.compiled[id]!.players.length === 2)!;
  if (four === undefined) return;
  const n = content.compiled[four]!.players.length;
  const a = env.client('Ann'), b = env.client('Bob'), c = env.client('Cy');
  a.say({ t: 'room.create', levelId: four, seats: Array.from({ length: n }, (_, i) => ({ kind: 'human', team: i % 2 })) });
  const cd = code(a);
  b.say({ t: 'room.join', code: cd, role: 'play' });
  c.say({ t: 'room.join', code: cd, role: 'play' });
  assert.equal(c.last('room.joined')!.you.seat, 2);
  c.clear();
  a.say({ t: 'lobby.update', levelId: two, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }] });
  assert.deepEqual(c.last('room.joined')!.you, { seat: null, host: false });
  assert.equal(b.sent.filter((m) => m.t === 'room.joined').length, 1); // Bob kept seat 1: only the original join
});

test('covers review-2: player moved to spectators while away can reconnect and is not evicted by the reserve timer', () => {
  const env = setup();
  const four = content.pvpLevelIds.find((id) => content.compiled[id]!.players.length >= 3);
  const two = content.pvpLevelIds.find((id) => content.compiled[id]!.players.length === 2)!;
  assert.ok(four);
  const n = content.compiled[four]!.players.length;
  const a = env.client('Ann'), b = env.client('Bob'), c = env.client('Cy');
  a.say({ t: 'room.create', levelId: four, seats: Array.from({ length: n }, (_, i) => ({ kind: 'human', team: i % 2 })) });
  const cd = code(a);
  b.say({ t: 'room.join', code: cd, role: 'play' });
  c.say({ t: 'room.join', code: cd, role: 'play' });
  c.drop(); // away in seat 2, reserve timer armed
  a.say({ t: 'lobby.update', levelId: two, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }] });
  assert.equal(a.last('lobby.state')!.spectators, 1);
  const c2 = fakeSocket();
  env.hub.accept(c2);
  c2.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick: 'Cy', token: `${String(3).padStart(8, '0')}a1b2c3d4e5f60718293a4b5c` });
  assert.deepEqual(c2.last('room.joined')!.you, { seat: null, host: false });
  assert.ok(c2.last('lobby.state'));
  for (const p of env.pending.filter((x) => x.ms === 30_000)) p.fn(); // reserve fires: rebound player stays
  assert.equal(a.last('lobby.state')!.spectators, 1);
});

test('moved spectator reconnecting during countdown is rebound and told seat null (no dead socket)', () => {
  const env = setup();
  const four = content.pvpLevelIds.find((id) => content.compiled[id]!.players.length >= 3)!;
  const two = content.pvpLevelIds.find((id) => content.compiled[id]!.players.length === 2)!;
  const n = content.compiled[four]!.players.length;
  const a = env.client('Ann'), b = env.client('Bob'), c = env.client('Cy');
  a.say({ t: 'room.create', levelId: four, seats: Array.from({ length: n }, (_, i) => ({ kind: 'human', team: i % 2 })) });
  const cd = code(a);
  b.say({ t: 'room.join', code: cd, role: 'play' });
  c.say({ t: 'room.join', code: cd, role: 'play' });
  c.drop();
  a.say({ t: 'lobby.update', levelId: two, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }] });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  assert.equal(env.mgr.room(cd)!.state, 'countdown');
  const c2 = fakeSocket();
  env.hub.accept(c2);
  c2.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick: 'Cy', token: `${String(3).padStart(8, '0')}a1b2c3d4e5f60718293a4b5c` });
  assert.deepEqual(c2.last('room.joined')!.you, { seat: null, host: false });
  assert.equal(c2.last('error'), undefined);
});

test('covers review-5: displaced players become spectators even past MAX_SPECTATORS; new watchers are still refused', () => {
  const { a, b, edit, client, levelId } = lobby2();
  const cd = code(a);
  for (let i = 0; i < 8; i++) client(`W${i}`).say({ t: 'room.join', code: cd, role: 'watch' });
  assert.equal(a.last('lobby.state')!.spectators, 8);
  edit([seatsOf(a)[0]!, { kind: 'bot', team: 1, difficulty: 'easy' }]);
  assert.equal(a.last('lobby.state')!.spectators, 9);
  assert.deepEqual(b.last('room.joined')!.you, { seat: null, host: false });
  const late = client('Late');
  late.say({ t: 'room.join', code: cd, role: 'watch' });
  assert.equal(late.last('error')!.code, 'spectators-full');
  assert.ok(levelId);
});

// ---- Coverage gaps (n<N lobby flows) ----
const CROSS = 'na-pvp-cross';
const H4 = [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }, { kind: 'human', team: 0 }, { kind: 'human', team: 1 }];
const rejoined = (s: Sock) => s.sent.filter((m) => m.t === 'room.joined');

test('covers R-SEA-01: room.create invalid configs -> bad-lobby, no room leaked, creator can retry', () => {
  const { client, mgr } = setup();
  const a = client('Ann');
  const h = { kind: 'human', team: 0 };
  const b = (team: number, difficulty = 'easy') => ({ kind: 'bot', team, difficulty });
  const cases: Array<[string, string, object[]]> = [
    ['unknown level', 'nope', [h, b(1)]],
    ['unknown level (non-pvp id)', 'levelview-1', [h, b(1)]],
    ['seat 0 bot', CROSS, [b(0), { kind: 'human', team: 1 }]],
    ['seat 0 empty', CROSS, [{ kind: 'empty', team: 0 }, b(1)]],
    ['seats > map max (5 on cross)', CROSS, [h, b(1), b(2), b(3), b(0)]],
    ['seats > map max (3 on duel)', 'na-pvp-duel-s', [h, b(1), b(0)]],
    ['team >= n', CROSS, [h, b(2)]],
    ['difficulty on human', CROSS, [{ kind: 'human', team: 0, difficulty: 'easy' }, b(1)]],
    ['invalid bot difficulty', CROSS, [h, b(1, 'nightmare')]],
  ];
  for (const [name, levelId, seats] of cases) {
    a.clear();
    a.say({ t: 'room.create', levelId, seats });
    assert.equal(a.last('error')?.code, 'bad-lobby', `${name}: ${JSON.stringify(a.sent)}`);
    assert.equal(a.last('room.joined'), undefined, name);
    assert.equal(mgr.roomCount(), 0, `${name}: no room leaked`);
  }
  a.clear();
  a.say({ t: 'room.create', levelId: CROSS, seats: [h, b(-1)] }); // negative team: wire validator
  assert.equal(a.last('error')!.code, 'bad-message');
  assert.equal(mgr.roomCount(), 0);
  a.clear();
  a.say({ t: 'room.create', levelId: CROSS, seats: [h, b(1), b(2)] }); // creator can retry with a valid config
  assert.equal(a.last('error'), undefined);
  assert.equal(a.last('lobby.state')!.seats.length, 3);
  assert.deepEqual(a.last('room.joined')!.you, { seat: 0, host: true });
  assert.equal(mgr.roomCount(), 1);
});

test('covers R-SEA-01: lobby.update level-change from a non-host is rejected and changes nothing', () => {
  const { a, b, levelId, mgr } = lobby2();
  const other = content.pvpLevelIds.find((id) => id !== levelId && content.compiled[id]!.players.length === 2)!;
  const cd = code(a);
  b.clear(); a.clear();
  b.say({ t: 'lobby.update', levelId: other, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }] });
  assert.equal(b.last('error')!.code, 'not-host');
  assert.equal(mgr.room(cd)!.levelId, levelId);
  assert.equal(a.last('lobby.state'), undefined, 'no broadcast');
  assert.equal(rejoined(b).length, 0);
  b.say({ t: 'lobby.update', levelId: CROSS, seats: H4 }); // bigger map too
  assert.equal(b.last('error')!.code, 'not-host');
  assert.equal(mgr.room(cd)!.seats.length, 2);
});

test('covers R-SEA-01: lobby.update during countdown/running/ended -> match-in-progress, seats unchanged', () => {
  const { a, b, levelId, mgr } = lobby2();
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  const room = mgr.room(code(a))!;
  assert.equal(room.state, 'countdown');
  const upd = { t: 'lobby.update', levelId: CROSS, seats: H4 };
  for (const state of ['countdown', 'running', 'ended'] as const) {
    room.state = state;
    a.clear();
    a.say(upd);
    assert.equal(a.last('error')!.code, 'match-in-progress', state);
    assert.equal(room.levelId, levelId, state);
    assert.equal(room.seats.length, 2, state);
    assert.equal(a.last('lobby.state'), undefined, state);
    b.clear();
    b.say(upd); // non-host: not-host wins over state
    assert.equal(b.last('error')!.code, 'not-host', state);
  }
});

test('covers R-SEA-01: lobby.start refuses a seat count outside 2..map max (internal state)', () => {
  const { client, mgr, starts } = setup();
  const a = client('Ann');
  a.say({ t: 'room.create', levelId: CROSS, seats: [{ kind: 'human', team: 0 }, { kind: 'bot', team: 1, difficulty: 'easy' }, { kind: 'bot', team: 2, difficulty: 'easy' }] });
  const room = mgr.room(code(a))!;
  const saved = room.seats.slice();
  a.clear();
  a.say({ t: 'lobby.start' });
  assert.equal(a.last('error'), undefined, '3 seats start');
  assert.equal(starts.length, 1);
  room.state = 'lobby'; room.match = undefined; room.startAt = undefined;
  room.seats = saved.slice(0, 1);
  a.say({ t: 'lobby.start' });
  assert.equal(a.last('error')!.code, 'bad-lobby');
  assert.match((a.last('error') as { detail?: string }).detail ?? '', /out of range/);
  room.seats = [...saved, { kind: 'bot', team: 3, difficulty: 'easy' }, { kind: 'bot', team: 0, difficulty: 'easy' }];
  a.say({ t: 'lobby.start' });
  assert.match((a.last('error') as { detail?: string }).detail ?? '', /out of range/);
  assert.equal(starts.length, 1, 'no extra start');
  room.seats = saved.slice(0, 2).map((s, i) => ({ ...s, team: i })); // back in range
  a.say({ t: 'lobby.start' });
  assert.equal(starts.length, 2);
});

test('covers R-SEA-01: same-level shrink 4->3 moves the seat-3 occupant to spectators; others keep seats', () => {
  const env = setup();
  const [a, b, c, d] = ['Ann', 'Bob', 'Cy', 'Di'].map((n) => env.client(n)) as [Sock, Sock, Sock, Sock];
  a.say({ t: 'room.create', levelId: CROSS, seats: H4 });
  const cd = code(a);
  for (const s of [b, c, d]) s.say({ t: 'room.join', code: cd, role: 'play' });
  assert.equal(d.last('room.joined')!.you.seat, 3);
  for (const s of [b, c, d]) s.say({ t: 'lobby.ready', ready: true });
  for (const s of [a, b, c, d]) s.clear();
  a.say({ t: 'lobby.update', levelId: CROSS, seats: H4.slice(0, 3).map((s, i) => ({ ...s, team: i })) });
  const ls = a.last('lobby.state')!;
  assert.equal(ls.seats.length, 3);
  assert.deepEqual(ls.seats.map((s) => s.occupant?.nick), ['Ann', 'Bob', 'Cy']);
  assert.equal(ls.spectators, 1);
  assert.deepEqual(d.last('room.joined')!.you, { seat: null, host: false });
  assert.equal(rejoined(b).length, 0);
  assert.equal(rejoined(c).length, 0);
  assert.ok(ls.seats.slice(1).every((s) => s.occupant?.ready === false), 'config change clears ready');
});

test('covers R-SEA-01: same-level grow 2->4 keeps occupants and adds open seats', () => {
  const env = setup();
  const a = env.client('Ann'), b = env.client('Bob'), c = env.client('Cy');
  a.say({ t: 'room.create', levelId: CROSS, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }] });
  const cd = code(a);
  b.say({ t: 'room.join', code: cd, role: 'play' });
  b.clear();
  a.say({ t: 'lobby.update', levelId: CROSS, seats: H4 });
  const ls = a.last('lobby.state')!;
  assert.equal(ls.seats.length, 4);
  assert.equal(ls.seats[0]!.occupant?.nick, 'Ann');
  assert.equal(ls.seats[1]!.occupant?.nick, 'Bob');
  assert.equal(ls.seats[2]!.occupant, undefined);
  assert.equal(ls.seats[3]!.occupant, undefined);
  assert.equal(ls.spectators, 0);
  assert.equal(rejoined(b).length, 0, 'unmoved occupant is not re-told');
  c.say({ t: 'room.join', code: cd, role: 'play' });
  assert.equal(c.last('room.joined')!.you.seat, 2, 'a joiner takes the new open seat');
});

test('covers R-SEA-01: human->bot flip on an occupied 4-seat row sends the occupant to spectators; bot->human leaves the seat open', () => {
  const env = setup();
  const [a, b, c] = ['Ann', 'Bob', 'Cy'].map((n) => env.client(n)) as [Sock, Sock, Sock];
  a.say({ t: 'room.create', levelId: CROSS, seats: H4 });
  const cd = code(a);
  b.say({ t: 'room.join', code: cd, role: 'play' });
  c.say({ t: 'room.join', code: cd, role: 'play' });
  const flipped = H4.map((s, i) => (i === 2 ? { kind: 'bot', team: s.team, difficulty: 'hard' } : s));
  b.clear(); c.clear(); a.clear();
  a.say({ t: 'lobby.update', levelId: CROSS, seats: flipped });
  assert.deepEqual(c.last('room.joined')!.you, { seat: null, host: false });
  assert.ok(c.sent.findIndex((m) => m.t === 'room.joined') < c.sent.findIndex((m) => m.t === 'lobby.state'), 'room.joined before lobby.state');
  assert.equal(rejoined(b).length, 0);
  let ls = a.last('lobby.state')!;
  assert.equal(ls.seats[2]!.kind, 'bot');
  assert.equal(ls.seats[2]!.occupant, undefined);
  assert.equal(ls.spectators, 1);
  a.clear(); c.clear();
  a.say({ t: 'lobby.update', levelId: CROSS, seats: H4 }); // bot -> human
  ls = a.last('lobby.state')!;
  assert.equal(ls.seats[2]!.kind, 'human');
  assert.equal(ls.seats[2]!.occupant, undefined, 'spectator is not auto-reseated');
  assert.equal(ls.spectators, 1);
  assert.equal(rejoined(c).length, 0, 'spectator is not moved back');
  const d = env.client('Di');
  d.say({ t: 'room.join', code: cd, role: 'play' });
  assert.equal(d.last('room.joined')!.you.seat, 2);
});

test('covers R-SEA-01: difficulty/team-only edits send no room.joined (notifyMoved) but do broadcast lobby.state', () => {
  const env = setup();
  const a = env.client('Ann'), b = env.client('Bob');
  a.say({ t: 'room.create', levelId: CROSS, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }, { kind: 'bot', team: 2, difficulty: 'easy' }] });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  a.clear(); b.clear();
  a.say({ t: 'lobby.update', levelId: CROSS, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }, { kind: 'bot', team: 2, difficulty: 'hard' }] });
  a.say({ t: 'lobby.update', levelId: CROSS, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 0 }, { kind: 'bot', team: 1, difficulty: 'hard' }] });
  for (const s of [a, b]) {
    assert.equal(rejoined(s).length, 0);
    assert.equal(s.sent.filter((m) => m.t === 'lobby.state').length, 2);
  }
  assert.equal(b.last('lobby.state')!.seats[1]!.team, 0);
  assert.equal(b.last('lobby.state')!.seats[2]!.difficulty, 'hard');
});

test('covers R-SEA-01: host leaving with spectators present passes host on; last seated leave closes the room and tells spectators', () => {
  const env = setup();
  const a = env.client('Ann'), b = env.client('Bob'), s = env.client('Sam');
  a.say({ t: 'room.create' });
  const cd = code(a);
  b.say({ t: 'room.join', code: cd, role: 'play' });
  s.say({ t: 'room.join', code: cd, role: 'watch' });
  assert.equal(a.last('lobby.state')!.spectators, 1);
  a.say({ t: 'room.leave' });
  assert.equal(b.last('lobby.state')!.host, 1);
  assert.deepEqual(b.last('lobby.state')!.seats.map((x) => x.occupant?.nick), [undefined, 'Bob']);
  assert.equal(b.last('lobby.state')!.spectators, 1);
  s.clear();
  b.say({ t: 'room.leave' });
  assert.equal(env.mgr.roomCount(), 0);
  assert.equal(s.last('room.closed')?.reason, 'empty', 'orphaned spectator is told the room is gone');
  s.say({ t: 'room.create' }); // and is free to create again
  assert.equal(s.last('error'), undefined);
  assert.equal(env.mgr.roomCount(), 1);
});

test('covers R-SEA-01: spectator cap recovers after displacement over the cap (leave -> join works again)', () => {
  const { a, edit, client } = lobby2();
  const cd = code(a);
  const ws = Array.from({ length: 8 }, (_, i) => client(`W${i}`));
  for (const w of ws) w.say({ t: 'room.join', code: cd, role: 'watch' });
  edit([seatsOf(a)[0]!, { kind: 'bot', team: 1, difficulty: 'easy' }]); // Bob displaced: 9 spectators
  assert.equal(a.last('lobby.state')!.spectators, 9);
  const late = client('Late');
  late.say({ t: 'room.join', code: cd, role: 'watch' });
  assert.equal(late.last('error')!.code, 'spectators-full');
  ws[0]!.say({ t: 'room.leave' });
  assert.equal(a.last('lobby.state')!.spectators, 8);
  late.clear();
  late.say({ t: 'room.join', code: cd, role: 'watch' });
  assert.equal(late.last('error')!.code, 'spectators-full', 'still at cap');
  ws[1]!.say({ t: 'room.leave' });
  late.clear();
  late.say({ t: 'room.join', code: cd, role: 'watch' });
  assert.equal(late.last('error'), undefined);
  assert.deepEqual(late.last('room.joined')!.you, { seat: null, host: false });
  assert.equal(a.last('lobby.state')!.spectators, 8);
});
