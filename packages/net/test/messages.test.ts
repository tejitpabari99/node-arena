import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byteSize, encode, encodeClient, encodeServer, encodeTick } from '../src/codec.js';
import { ERROR_CODES, type ClientMessage, type ServerMessage, type WireCommand } from '../src/messages.js';
import { PROTOCOL_VERSION } from '../src/version.js';

const versions = { rules: '2.0.0', schema: '1', content: 'abc', bot: '1' };
const cmd: WireCommand = { type: 'DrawLine', from: 1, to: 2 };

// @ts-expect-error client cmd has no player field
const bad: WireCommand = { type: 'CutLine', from: 1, to: 2, player: 0 };
void bad;

const client: ClientMessage[] = [
  { t: 'hello', pv: PROTOCOL_VERSION, versions, nick: 'a', token: '0'.repeat(32) },
  { t: 'room.create' }, { t: 'room.join', code: 'ABCD', role: 'watch' }, { t: 'room.leave' },
  { t: 'lobby.update', levelId: 'l', seats: [{ kind: 'human', team: 0 }, { kind: 'bot', difficulty: 'easy', team: 1 }] },
  { t: 'lobby.ready', ready: true }, { t: 'lobby.start' }, { t: 'rematch' },
  { t: 'cmd', c: cmd, cid: 1 }, { t: 'hash', tick: 19, h: '0'.repeat(16) }, { t: 'resync' }, { t: 'ping', id: 3 },
];
const server: ServerMessage[] = [
  { t: 'welcome', pv: 2, playerId: 'p', serverVersions: versions },
  { t: 'room.joined', code: 'ABCD', you: { seat: null, host: false } },
  { t: 'lobby.state', levelId: 'l', timeLimitSec: 300, host: 0, spectators: 0,
    seats: [{ kind: 'human', team: 0, occupant: { nick: 'a', ready: false, status: 'grace' } }] },
  { t: 'room.closed', reason: 'idle' },
  { t: 'start', matchId: 'm', levelId: 'l', simHash: '0'.repeat(16), seed: 1, youPlayer: null, inputDelay: 3,
    countdownMs: 3000, timeLimitTicks: 6000, hashInterval: 20, seats: [{ player: 0, kind: 'human', team: 0, nick: 'a' }] },
  { t: 'tick', n: 5, c: [{ type: 'CutLine', player: 0, from: 1, to: 2 }] },
  { t: 'catchup', from: 0, to: 9, cmds: [], done: true }, { t: 'ticks', from: 10, to: 12, cmds: [] },
  { t: 'desync', tick: 19, serverHash: '0'.repeat(16) },
  { t: 'seat.status', player: 1, status: 'grace', graceMs: 5000 },
  { t: 'end', outcome: { outcome: 'draw', winners: [], winner: null }, finalTick: 100, finalHash: '0'.repeat(16) },
  { t: 'pong', id: 3, tick: 7 }, { t: 'error', code: 'bad-json', detail: 'x' },
];

test('every message type round-trips through JSON', () => {
  for (const m of client) assert.deepEqual(JSON.parse(encodeClient(m)), m);
  for (const m of server) assert.deepEqual(JSON.parse(encodeServer(m)), m);
  assert.equal(new Set(client.map((m) => m.t)).size, 12);
  assert.equal(new Set(server.map((m) => m.t)).size, 13);
});

test('empty tick is compact; non-empty carries c', () => {
  assert.equal(encodeTick(123), '{"t":"tick","n":123}');
  assert.equal(encodeTick(1, []), '{"t":"tick","n":1}');
  assert.equal(encodeTick(2, [{ type: 'CutLine', player: 0, from: 1, to: 2 }]), '{"t":"tick","n":2,"c":[{"type":"CutLine","player":0,"from":1,"to":2}]}');
  assert.equal(encodeTick(7), encode({ t: 'tick', n: 7 }));
});

test('byteSize counts utf-8 bytes', () => {
  assert.equal(byteSize('abc'), 3);
  assert.equal(byteSize('é'), 2);
  assert.equal(byteSize('€'), 3);
  assert.equal(byteSize('😀'), 4);
  assert.equal(byteSize(encodeTick(123)), 20);
});

test('error codes complete', () => {
  assert.equal(ERROR_CODES.length, 20);
  assert.ok(ERROR_CODES.includes('version-mismatch'));
  assert.equal(PROTOCOL_VERSION, 2);
});
