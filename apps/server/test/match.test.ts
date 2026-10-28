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

function setup() {
  let now = 1000;
  const added = new Set<ClockRoom>();
  const clock = { add: (r: ClockRoom) => void added.add(r), remove: (r: ClockRoom) => void added.delete(r), boundary: (t: number) => t };
  const logs: Array<{ level: string; ev: string; f?: Record<string, unknown> }> = [];
  const mk = (level: string) => (ev: string, f?: Record<string, unknown>) => void logs.push({ level, ev, ...(f ? { f } : {}) });
  const log = { log: () => {}, debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') };
  const ctl = createMatchController({ clock, now: () => now, log });
  const starts: MatchStart[] = [];
  let n = 0;
  const mgr = createRoomManager({
    content, clock, now: () => now, inputDelay: 3, log,
    randomInt: () => (n++ % 31),
    onStart: (r, m) => { starts.push(m); ctl.onStart(r, m); },
    onMatchMessage: ctl.onMessage,
  });
  const hub = createHub({ versions: content.versions, handler: mgr, secret: 's', timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  let c = 0;
  const client = (nick: string) => {
    const s = fakeSocket();
    hub.accept({ ...s, onClose: () => {} } as never);
    s.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick, token: `${String(++c).padStart(8, '0')}a1b2c3d4e5f60718293a4b5c` });
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
  return { room, tickAll, added, logs, setNow: (t: number) => { now = t; }, mgr };
}

test('contiguous n, empty ticks sent, cmd lands at n+delay, end once and clock stops', () => {
  const { room, tickAll, added, mgr } = setup();
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
  assert.equal(end.finalHash, match.sim.hash());
  assert.equal(end.finalTick, match.sim.view.tick);
  const nBefore = a.sent.length;
  tickAll();
  assert.equal(a.sent.length, nBefore);
});

test('bad hash -> desync to that socket only + log; rate-limited per seat', () => {
  const { room, tickAll, logs, setNow } = setup();
  const { a, b, match } = room();
  for (let i = 0; i < 20; i++) tickAll();
  assert.equal(match.sim.view.tick, 20);
  a.say({ t: 'hash', tick: 20, h: '0000000000000000' });
  const d = a.of('desync');
  assert.equal(d.length, 1);
  assert.equal(d[0]!.tick, 20);
  assert.equal(d[0]!.serverHash, match.sim.hash());
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
  a.say({ t: 'hash', tick: 20, h: match.sim.hash() });
  assert.equal(a.of('desync').length, 2);
});

test('throwing room is isolated: error internal + room.closed; other room continues', () => {
  const { room, tickAll, added, mgr } = setup();
  const r1 = room(), r2 = room();
  assert.equal(added.size, 2);
  (r1.match.sim as { step: unknown }).step = () => { throw new Error('boom'); };
  tickAll();
  assert.equal(r1.a.of('error').at(-1)!.code, 'internal');
  assert.equal(r1.a.of('room.closed')[0]!.reason, 'internal');
  assert.equal(r1.b.of('room.closed').length, 1);
  assert.equal(mgr.room(r1.match.code)!.state, 'closed');
  assert.equal(added.size, 1);
  tickAll();
  assert.equal(r2.a.of('tick').length, 2);
  assert.equal(r2.a.of('room.closed').length, 0);
});

test('rejected cmd replies with error code', () => {
  const { room, tickAll } = setup();
  const { a } = room();
  tickAll();
  a.say({ t: 'cmd', c: { type: 'DrawLine', from: 0, to: 9999 } });
  assert.equal(a.of('error').at(-1)!.code, 'bad-message');
});
