import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { create, type Sim } from '@node-arena/sim';
import { LockstepClient, PROTOCOL_VERSION, type ServerMessage } from '@node-arena/net';
import type { ClockRoom } from '../src/clock.js';
import { DEFAULT_CONTENT_DIR } from '../src/config.js';
import { loadServerContent } from '../src/content.js';
import { createHub } from '../src/hub.js';
import { IpLimits } from '../src/limits.js';
import { createMatchController } from '../src/match.js';
import { createRoomManager, type MatchStart } from '../src/room.js';

const fixture = readFileSync(new URL('./fixtures/na-pvp-fixture.json', import.meta.url), 'utf8');
const content = loadServerContent(DEFAULT_CONTENT_DIR, { extraLevels: { 'na-pvp-fixture': fixture } });

function fakeSocket() {
  let msgCb: (d: string | Uint8Array) => void = () => {};
  const sent: ServerMessage[] = [];
  return {
    sent, bufferedAmount: 0, closed: undefined as number | undefined,
    send: (d: string) => void sent.push(JSON.parse(d) as ServerMessage),
    close(code?: number) { this.closed = code; },
    onMessage: (cb: (d: string | Uint8Array) => void) => void (msgCb = cb),
    onClose: () => {},
    say: (m: object) => msgCb(JSON.stringify(m)),
    of: <T extends ServerMessage['t']>(t: T) => sent.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[],
  };
}

function setup() {
  let now = 1000;
  const rooms = new Set<ClockRoom>();
  const clock = { add: (r: ClockRoom) => void rooms.add(r), remove: (r: ClockRoom) => void rooms.delete(r), boundary: (t: number) => Math.ceil(t / 50) * 50 };
  const timers = { setTimeout: () => 0, clearTimeout: () => {} };
  const ctl = createMatchController({ clock, now: () => now, timers, onAbort: (r) => mgr.drop(r) });
  const ipLimits = new IpLimits(() => now);
  const starts: MatchStart[] = [];
  let n = 0;
  const mgr = createRoomManager({
    content, clock, now: () => now, inputDelay: 3, ipLimits, randomInt: () => (n++ % 31),
    onStart: (r, m) => { starts.push(m); ctl.onStart(r, m); },
    onMatchMessage: ctl.onMessage, onCatchUp: ctl.catchUp,
    onStartCancel: ctl.cancel, onSeatDisconnect: ctl.onSeatDisconnect, onSeatReconnect: ctl.onSeatReconnect, pauseStateOf: ctl.pauseState, endOf: ctl.endOf, hasPendingDeadline: ctl.hasPendingDeadline,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  const hub = createHub({ versions: content.versions, handler: mgr, secret: 's', timers });
  let c = 0;
  const client = (nick: string) => {
    const s = fakeSocket();
    hub.accept(s);
    s.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick, token: `${String(++c).padStart(8, '0')}a1b2c3d4e5f60718293a4b5c` });
    return s;
  };
  const advance = (ms: number) => { for (let t = 0; t < ms; t += 50) { now += 50; for (const r of [...rooms]) if (r.startAt <= now) r.tick(); } };
  return { client, advance, mgr, ctl, starts };
}
type Sock = ReturnType<typeof fakeSocket>;

/** Minimal web-controller equivalent over the real LockstepClient + sim: resyncs once on desync/push error, rebuilds on `start`. */
class Player {
  sim!: Sim; lc = new LockstepClient(0);
  cursor = 0; inflight = false; resyncs = 0; rebuilds = 0; desyncs = 0; catchupTarget = 0; frozen: number | null = null;
  dropTicks = new Set<number>();
  constructor(readonly sock: Sock, readonly match: () => MatchStart) {}
  requestResync(): void { if (this.inflight) return; this.inflight = true; this.resyncs++; this.sock.say({ t: 'resync' }); }
  pump(): void {
    while (this.cursor < this.sock.sent.length) {
      const m = this.sock.sent[this.cursor++]!;
      switch (m.t) {
        case 'start': {
          const ms = this.match();
          this.sim = create(ms.level, ms.seed, { teams: ms.teams });
          this.lc = new LockstepClient(0); this.inflight = false; this.rebuilds++; this.catchupTarget = 0; this.frozen = null;
          break;
        }
        case 'tick': if (this.dropTicks.has(m.n)) { this.dropTicks.delete(m.n); break; } /* falls through */
        case 'ticks': case 'catchup': {
          if (m.t === 'catchup') this.catchupTarget = Math.max(this.catchupTarget, m.to);
          if (!this.lc.push(m).ok) this.requestResync();
          break;
        }
        case 'desync': this.desyncs++; this.requestResync(); break;
        case 'pause.state': this.frozen = m.paused ? m.tick : null; break;
        default: break;
      }
    }
  }
  step(): void {
    while (this.lc.queued() > 0 && (this.frozen === null || this.sim.view.tick < this.frozen)) {
      const [tk] = this.lc.drain(1);
      if (!tk) break;
      this.sim.step(tk.cmds, { events: false });
      const h = this.lc.after(tk.n, () => this.sim.hash());
      if (h && tk.n >= this.catchupTarget) this.sock.say(h);
    }
  }
}

function running() {
  const t = setup();
  const a = t.client('A'), b = t.client('B');
  a.say({ t: 'room.create' });
  b.say({ t: 'room.join', code: a.of('room.joined')[0]!.code, role: 'play' });
  b.say({ t: 'lobby.ready', ready: true });
  a.say({ t: 'lobby.start' });
  const match = t.starts[t.starts.length - 1]!;
  const room = t.mgr.room(match.code)!;
  const pa = new Player(a, () => match), pb = new Player(b, () => match);
  const run = (ms: number, each?: () => void) => { for (let i = 0; i < ms / 50; i++) { t.advance(50); pa.pump(); pb.pump(); each?.(); pa.step(); pb.step(); } };
  run(3100);
  assert.equal(room.state, 'running');
  const server = () => t.ctl.simOf(room)!;
  return { t, a, b, pa, pb, run, server, room };
}

test('covers SP08 AC2: corrupted client sim -> one desync, one resync, rebuild, hash equals server at next checkpoint, no gap', () => {
  const r = running();
  r.run(1000);
  r.pa.sim.step([], { events: false }); // test hook: corrupt A's sim (extra tick)
  r.run(2000);
  assert.equal(r.pa.desyncs, 1, 'server flagged exactly one desync');
  assert.equal(r.pa.resyncs, 1, 'exactly one resync sent');
  assert.equal(r.pa.rebuilds, 2, 'rebuilt once after the initial start');
  assert.equal(r.pb.resyncs, 0);
  assert.equal(r.a.of('error').length, 0);
  r.run(1500); // next checkpoints after rebuild
  assert.equal(r.pa.lc.needsResync, false, 'no tick gap after recovery');
  assert.equal(r.a.of('desync').length, 1, 'no further desync');
  assert.equal(r.pa.sim.view.tick, r.server().view.tick - r.pa.lc.queued());
  r.pa.step();
  assert.equal(r.pa.sim.view.tick, r.server().view.tick);
  assert.equal(r.pa.sim.hash(), r.server().hash());
  assert.equal(r.pa.sim.hash(), r.pb.sim.hash());
});

test('covers SP08 AC3: dropped tick frame -> push gap -> one resync, rebuild, converges, no further resync', () => {
  const r = running();
  r.run(500);
  r.pa.dropTicks.add(r.pa.lc.expected + 3);
  r.run(1000);
  assert.equal(r.pa.resyncs, 1);
  assert.equal(r.pa.desyncs, 0, 'recovered via push error, not desync');
  assert.equal(r.pa.rebuilds, 2);
  r.run(1500);
  assert.equal(r.pa.resyncs, 1, 'no loop');
  assert.equal(r.pa.lc.needsResync, false);
  r.pa.step();
  assert.equal(r.pa.sim.view.tick, r.server().view.tick);
  assert.equal(r.pa.sim.hash(), r.server().hash());
  assert.equal(r.a.of('error').length, 0);
});

test('covers SP08 AC5: resync while paused keeps freeze tick and budgets; client freezes at the same tick with a fresh snapshot', () => {
  const r = running();
  r.run(500);
  r.b.say({ t: 'pause' });
  r.pa.pump(); r.pb.pump(); r.pa.step(); r.pb.step();
  const before = r.a.of('pause.state').at(-1)!;
  assert.equal(before.paused, true);
  const frozen = before.tick;
  r.t.advance(6000);
  r.pa.requestResync();
  r.pa.pump(); r.pa.step();
  const snap = r.a.of('pause.state').at(-1)!;
  assert.notEqual(snap, before, 'fresh snapshot sent after start');
  assert.equal(snap.paused, true);
  assert.equal(snap.tick, frozen);
  assert.ok(snap.epoch >= before.epoch);
  assert.ok(snap.budgets.every((x, i) => x === null || x <= (before.budgets[i] ?? Infinity)), 'budgets not refreshed');
  assert.equal(r.pa.rebuilds, 2);
  assert.equal(r.pa.sim.view.tick, frozen, 'client replayed to the freeze tick and holds');
  assert.equal(r.pa.sim.hash(), r.server().hash());
  assert.equal(r.server().view.tick, frozen);
});

test('covers SP08 AC6: rate-limited resync leaves connection and match intact', () => {
  const r = running();
  r.run(500);
  r.pa.requestResync(); r.pa.pump(); r.pa.step();
  assert.equal(r.pa.rebuilds, 2);
  r.t.advance(6000);
  r.pa.inflight = false;
  r.pa.requestResync(); // within 10 s
  r.pa.pump();
  assert.equal(r.a.of('error').at(-1)?.code, 'rate-limited');
  assert.equal(r.a.closed, undefined);
  assert.equal(r.pa.rebuilds, 2, 'no second rebuild');
  const t0 = r.server().view.tick;
  r.run(500);
  assert.ok(r.server().view.tick > t0, 'match keeps ticking');
  assert.equal(r.a.of('tick').length > 0, true);
  assert.equal(r.pa.lc.needsResync, false);
  r.pa.step();
  assert.equal(r.pa.sim.hash(), r.server().hash());
});
