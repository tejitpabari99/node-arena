import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createReplayRecorder, playReplay } from '@node-arena/sim';
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
  const sent: ServerMessage[] = [];
  return {
    sent, bufferedAmount: 0,
    send: (d: string) => void sent.push(JSON.parse(d) as ServerMessage),
    close() {},
    onMessage: (cb: (d: string | Uint8Array) => void) => void (msgCb = cb),
    onClose: () => {},
    say: (m: object) => msgCb(JSON.stringify(m)),
    of: <T extends ServerMessage['t']>(t: T) => sent.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[],
  };
}

function setup(levelId: string) {
  let now = 1000;
  const rooms = new Set<ClockRoom>();
  const clock = { add: (r: ClockRoom) => void rooms.add(r), remove: (r: ClockRoom) => void rooms.delete(r), boundary: (t: number) => Math.ceil(t / 50) * 50 };
  const timers = { setTimeout: () => 0, clearTimeout: () => {} };
  const ctl = createMatchController({ clock, now: () => now, timers, onAbort: (r) => mgr.drop(r) });
  const starts: MatchStart[] = [];
  let n = 0;
  const mgr = createRoomManager({
    content, clock, now: () => now, inputDelay: 3, randomInt: () => (n++ % 31),
    onStart: (r, m) => { starts.push(m); ctl.onStart(r, m); },
    onMatchMessage: ctl.onMessage, onCatchUp: ctl.catchUp, onStartCancel: ctl.cancel,
    onSeatDisconnect: ctl.onSeatDisconnect, onSeatReconnect: ctl.onSeatReconnect, pauseStateOf: ctl.pauseState, endOf: ctl.endOf, hasPendingDeadline: ctl.hasPendingDeadline,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  const hub = createHub({ versions: content.versions, handler: mgr, secret: 's', timers });
  const a = fakeSocket();
  hub.accept(a);
  a.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick: 'Ann', token: '00000001a1b2c3d4e5f60718293a4b5c' });
  a.say({ t: 'room.create' });
  const ls = a.of('lobby.state').at(-1)!;
  a.say({ t: 'lobby.update', levelId, seats: ls.seats.map((s, i) => (i === 0 ? { kind: s.kind, team: s.team } : { kind: 'bot', team: s.team, difficulty: 'hard' })) });
  a.say({ t: 'lobby.start' });
  const match = starts[starts.length - 1]!;
  const advance = (ms: number) => { for (let t = 0; t < ms; t += 50) { now += 50; for (const r of [...rooms]) if (r.startAt <= now) r.tick(); } };
  return { a, match, ctl, mgr, rooms, advance, now: () => now };
}

const roomOf = (x: ReturnType<typeof setup>) => x.mgr.room(x.match.code)!;

test('human vs bot: bot cmds logged (player 1), within budget, hash == replay', () => {
  const x = setup('na-pvp-duel-s');
  assert.deepEqual(x.match.seats.map((s) => s.kind), ['human', 'bot']);
  x.advance(60_000);
  const room = roomOf(x);
  const lockstep = x.ctl.inspect(room)!;
  const bot = lockstep.log.commands.filter((e) => (e.cmd as { player: number }).player === 1);
  assert.ok(bot.length > 0, 'bot commands were logged');
  const budget = Math.floor((lockstep.log.cmdCap - SYSTEM_CMD_RESERVE) / 2);
  assert.ok(bot.length <= budget);
  const referee = x.ctl.simOf(room)!;
  const level = content.compiled['na-pvp-duel-s']!;
  const metadata = { rulesVersion: content.versions.rules, schemaVersion: content.versions.schema, contentVersion: content.versions.content };
  const base = createReplayRecorder(level, x.match.seed, metadata, { teams: x.match.teams }).record();
  const checkpoints: { tick: number; hash: string }[] = [];
  for (let t = 20; t <= referee.view.tick; t += 20) checkpoints.push({ tick: t, hash: lockstep.log.checkpoint(t)! });
  const res = playReplay({ metadata, level }, {
    ...base, commands: lockstep.log.commands.map((e) => ({ tick: e.tick, cmd: e.cmd as never })), checkpoints, finalTick: referee.view.tick, finalHash: referee.hash(), outcome: referee.view.over,
  });
  assert.equal(res.ok, true);
  assert.equal(res.sim.hash(), referee.hash());
});

test('pause freezes bot work; resume continues without burst', () => {
  const x = setup('na-pvp-duel-s');
  x.advance(20_000);
  const room = roomOf(x);
  const ls = x.ctl.inspect(room)!;
  x.a.say({ t: 'pause' });
  assert.equal(x.rooms.size, 0, 'paused room is off the clock');
  const before = ls.log.commands.length, tick = ls.nextTick;
  x.advance(20_000);
  assert.equal(ls.log.commands.length, before);
  assert.equal(ls.nextTick, tick);
  x.a.say({ t: 'resume', epoch: x.ctl.pauseState(room)!.epoch });
  x.advance(20_000);
  assert.ok(ls.nextTick > tick);
});

test('1v1 human quit vs bot -> bot wins; unlimited pause mode with one human + bot', () => {
  const x = setup('na-pvp-duel-s');
  x.advance(5_000);
  x.a.say({ t: 'pause' });
  const ps = x.ctl.pauseState(roomOf(x))!;
  assert.equal(ps.paused, true);
  x.advance(10 * 60_000); // would blow any limited budget
  assert.equal(roomOf(x).state, 'running');
  assert.equal(x.ctl.endOf(roomOf(x)), undefined);
  x.a.say({ t: 'quit' });
  const end = x.ctl.endOf(roomOf(x))!;
  assert.ok(end, 'match ended');
  assert.deepEqual(end.outcome, { outcome: 'victory', winners: [1], winner: 1 });
  assert.equal(x.a.of('end').length, 1);
});
