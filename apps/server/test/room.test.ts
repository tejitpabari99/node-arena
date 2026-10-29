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
  const s = {
    sent, bufferedAmount: 0,
    send: (d: string) => void sent.push(JSON.parse(d) as ServerMessage),
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
  const mgr = createRoomManager({
    content, clock, now: () => now, inputDelay: 3, ...(randomInt ? { randomInt } : {}),
    onStart: (_r, m) => void starts.push(m),
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
  return { mgr, hub, client, starts, setNow: (t: number) => { now = t; } };
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

test('room.join: full -> room-full; unknown -> room-not-found; watch -> bad-lobby (M2)', () => {
  const { client } = setup();
  const a = client('Ann'), b = client('Bob'), c = client('Cy');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  c.say({ t: 'room.join', code: code(a), role: 'play' });
  assert.equal(c.last('error')!.code, 'room-full');
  c.say({ t: 'room.join', code: 'ZZZZ', role: 'play' });
  assert.equal(c.last('error')!.code, 'room-not-found');
  c.say({ t: 'room.join', code: code(a), role: 'watch' });
  assert.equal(c.last('error')!.code, 'bad-lobby');
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
  for (const m of [{ t: 'lobby.start' }, { t: 'lobby.ready', ready: true }, { t: 'lobby.update', levelId: FIX, seats: [] }]) {
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

test('level change resets seats + ready; occupants keep seats; unknown level / seat edits refused', () => {
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
  assert.deepEqual(draws[4], [0, 2 ** 32]);
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

test('default randomInt (node:crypto) yields u32 seeds', () => {
  const { client, starts } = setup();
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: code(a), role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  const seed = starts[0]!.seed;
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32);
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
  const { client, mgr } = setup();
  const a = client('Ann'), b = client('Bob');
  a.say({ t: 'room.create' });
  const cd = code(a);
  b.say({ t: 'room.join', code: cd, role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.drop();
  const ls = b.last('lobby.state')!;
  assert.equal(ls.host, 1);
  assert.equal(ls.seats[0]!.occupant, undefined);
  assert.equal(ls.seats[1]!.occupant?.ready, true); // new host implicit
  b.say({ t: 'room.leave' });
  assert.equal(mgr.roomCount(), 0);
  assert.equal(mgr.room(cd), undefined);
});
