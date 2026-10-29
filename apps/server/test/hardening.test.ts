import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PROTOCOL_VERSION, type ServerMessage } from '@node-arena/net';
import type { ClockRoom } from '../src/clock.js';
import { DEFAULT_CONTENT_DIR } from '../src/config.js';
import { loadServerContent } from '../src/content.js';
import { createHub } from '../src/hub.js';
import { createMatchController, MAX_CMDS_PER_SEAT_PER_TICK } from '../src/match.js';
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
    raw: (s: string | Uint8Array) => msgCb(s),
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
  const room = (start = true) => {
    const a = client(`A${c}`), b = client(`B${c}`);
    a.say({ t: 'room.create' });
    b.say({ t: 'room.join', code: a.of('room.joined')[0]!.code, role: 'play' });
    b.say({ t: 'lobby.ready', ready: true });
    if (start) a.say({ t: 'lobby.start' });
    return { a, b, match: starts[starts.length - 1]!, code: a.of('room.joined')[0]!.code };
  };
  const tickAll = () => { for (const r of [...added]) r.tick(); };
  return { room, client, tickAll, added, logs, ctl, mgr };
}

const MAX_FRAME = 4096;
const DRAW = { type: 'DrawLine', from: 0, to: 1 } as const;
type T = ReturnType<typeof setup>;
type R = ReturnType<T['room']>;
const code = (s: { of: (t: 'error') => { code: string }[] }) => s.of('error').at(-1)?.code;

/** Same legit traffic every run; `bad` injects abuse at tick 2. Returns referee hash at tick 40. */
function run(bad?: (r: R, t: T) => void) {
  const t = setup();
  const r = t.room();
  for (let i = 0; i < 40; i++) {
    if (i === 2) {
      r.a.say({ t: 'cmd', c: DRAW });
      bad?.(r, t);
      r.b.say({ t: 'cmd', c: { type: 'DrawLine', from: 1, to: 0 } });
    }
    t.tickAll();
  }
  assert.equal(t.ctl.simOf(t.mgr.room(r.match.code)!)!.view.tick, 40);
  return { r, t, hash: t.ctl.simOf(t.mgr.room(r.match.code)!)!.hash() };
}
const control = run();

test('non-member and hello-only conns: cmd -> not-your-seat, hash == control', () => {
  const { hash } = run((_r, t) => {
    const lone = t.client('Lone'); // hello'd, in no room (stands in for a spectator; none in M1)
    lone.say({ t: 'cmd', c: DRAW });
    assert.equal(code(lone), 'not-your-seat');
    const other = t.room(false); // seated in another lobby room
    other.a.say({ t: 'cmd', c: DRAW });
    assert.equal(code(other.a), 'not-your-seat');
  });
  assert.equal(hash, control.hash);
});

test('cmd in lobby and countdown -> not-your-seat, nothing queued', () => {
  const t = setup();
  const lobby = t.room(false);
  lobby.a.say({ t: 'cmd', c: DRAW });
  assert.equal(code(lobby.a), 'not-your-seat');
  const cd = t.room(); // started, clock not ticked yet => countdown
  cd.a.say({ t: 'cmd', c: DRAW });
  assert.equal(code(cd.a), 'not-your-seat');
  for (let i = 0; i < 10; i++) t.tickAll();
  assert.equal(cd.a.of('tick').flatMap((m) => m.c ?? []).length, 0);
});

test('cmd from a bot seat is rejected (seat-kind guard)', () => {
  const { hash } = run((r, t) => {
    const room = t.mgr.room(r.code)!;
    room.seats[1]!.kind = 'bot';
    r.b.say({ t: 'cmd', c: DRAW });
    assert.equal(code(r.b), 'not-your-seat');
    room.seats[1]!.kind = 'human';
  });
  // b's later legit cmd lands, so hash differs from control only if the bad one landed: compare tick logs instead
  assert.equal(hash, control.hash);
});

test('injected player / unknown fields rejected, hash == control', () => {
  const { hash, r } = run((r) => {
    r.b.say({ t: 'cmd', c: { type: 'DrawLine', player: 0, from: 0, to: 1 } });
    assert.equal(code(r.b), 'bad-message');
    r.b.say({ t: 'cmd', c: { ...DRAW, extra: 1 } });
    assert.equal(code(r.b), 'bad-message');
  });
  assert.equal(hash, control.hash);
  assert.equal(r.b.of('room.closed').length, 0);
});

test('oversize frame, bad JSON, binary junk: errors, no crash, hash == control', () => {
  const { hash, r } = run((r) => {
    r.a.raw('x'.repeat(MAX_FRAME + 1));
    assert.equal(code(r.a), 'too-large');
    r.a.raw('{not json');
    assert.equal(code(r.a), 'bad-json');
    r.a.raw(new Uint8Array([0xff, 0xfe, 0x00]));
    assert.ok(['bad-json', 'bad-message'].includes(code(r.a)!));
    r.a.raw(JSON.stringify({ t: 'cmd', c: 5 }));
    assert.equal(code(r.a), 'bad-message');
  });
  assert.equal(hash, control.hash);
  assert.equal(r.a.of('room.closed').length, 0);
});

test('spamming seat is rate-limited per tick, cannot abort room; other seat still lands', () => {
  const t = setup();
  const r = t.room();
  t.tickAll();
  for (let i = 0; i < 50; i++) r.a.say({ t: 'cmd', c: DRAW });
  r.b.say({ t: 'cmd', c: { type: 'DrawLine', from: 1, to: 0 } });
  assert.equal(r.a.of('error').filter((e) => e.code === 'rate-limited').length, 50 - MAX_CMDS_PER_SEAT_PER_TICK);
  assert.equal(r.b.of('error').length, 0);
  for (let i = 0; i < 6; i++) t.tickAll();
  const landed = r.b.of('tick').flatMap((m) => m.c ?? []);
  assert.equal(landed.filter((c) => c.player === 0).length, MAX_CMDS_PER_SEAT_PER_TICK);
  assert.equal(landed.filter((c) => c.player === 1).length, 1);
  assert.equal(t.mgr.room(r.code)!.state, 'running');
  assert.equal(r.a.of('room.closed').length, 0);
});

test('sustained spam: per-seat lifetime budget keeps the shared log open for the other seat', () => {
  const t = setup();
  const r = t.room();
  t.tickAll();
  for (let i = 0; i < 4000; i++) { // 4000 ticks * 8 = 32000 > cmd cap 20000
    for (let k = 0; k < 10; k++) r.a.say({ t: 'cmd', c: DRAW });
    t.tickAll();
    if (t.mgr.room(r.code)!.state !== 'running') break;
  }
  assert.equal(t.mgr.room(r.code)!.state, 'running');
  r.b.say({ t: 'cmd', c: { type: 'DrawLine', from: 1, to: 0 } });
  assert.equal(r.b.of('error').length, 0);
});
