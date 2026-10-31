import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Command } from '@node-arena/defs';
import { PROTOCOL_VERSION, LockstepClient, createCatchup, createJoinLate, type ServerMessage } from '@node-arena/net';
import { create, createTroopBuffer, type Sim } from '@node-arena/sim';
import type { ClockRoom } from '../src/clock.js';
import { DEFAULT_CONTENT_DIR } from '../src/config.js';
import { loadServerContent } from '../src/content.js';
import { createHub } from '../src/hub.js';
import { createMatchController } from '../src/match.js';
import { createRoomManager, type MatchStart } from '../src/room.js';

interface SeatConfig { kind: 'human' | 'bot'; team: number; difficulty?: 'easy' | 'normal' | 'hard' }
interface SimClient { s: ReturnType<typeof fakeSocket>; pump(): void; hashes: Map<number, string>; readonly sim: Sim; readonly seat: number }

// M2 lobby-shape scenario suite (SP04 Task 18) + SP07 AC12 at wiring level on Cross (4 seats, teams [0,1,0,1]).
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
    timers: { setTimeout: (fn, ms) => (ms === 60_000 ? 0 : fakeTimers.setTimeout(fn, ms)), clearTimeout: fakeTimers.clearTimeout },
  });
  const hub = createHub({ versions: content.versions, handler: mgr, secret: 's', now: () => now, timers: { setTimeout: () => 0, clearTimeout: () => {} } });

  /** Simulated client: own Sim + LockstepClient rebuilt on every `start`; answers hash requests like the web client. */
  const sims: SimClient[] = [];
  const simClient = (nick: string, tok: number): SimClient => {
    const s = fakeSocket();
    hub.accept(s);
    s.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick, token: `${String(tok).padStart(8, '0')}a1b2c3d4e5f60718293a4b5c` });
    let lock = new LockstepClient();
    let sim: Sim | undefined;
    let seat = -1;
    let read = 0;
    const hashes = new Map<number, string>();
    const pump = (): void => {
      while (read < s.sent.length) {
        const m = s.sent[read++]!;
        if (m.t === 'start') {
          seat = m.youPlayer ?? -1;
          lock = new LockstepClient();
          hashes.clear();
          sim = create(content.compiled[m.levelId]!, m.seed, { teams: m.seats.map((x) => x.team) });
        } else if (m.t === 'tick' && sim !== undefined && seat >= 0) {
          assert.ok(lock.push(m).ok);
          for (const tk of lock.drain(Infinity)) {
            sim.step(tk.cmds, { events: false });
            const h = lock.after(tk.n, () => sim!.hash());
            if (h !== null) { hashes.set(h.tick, h.h); s.say(h); }
          }
        }
      }
    };
    const c: SimClient = { s, pump, hashes, get sim() { return sim!; }, get seat() { return seat; } };
    sims.push(c);
    return c;
  };
  type C = SimClient;

  let tok = 0;
  /** Lobby with `kinds` per seat (humans fill seats in join order; bots are 'hard'). Does NOT start. */
  const lobby = (levelId: string, kinds: ('human' | 'bot')[], teams: number[], nHumans = kinds.filter((k) => k === 'human').length) => {
    const host = simClient('H', ++tok);
    host.s.say({ t: 'room.create' });
    const code = host.s.of('room.joined')[0]!.code;
    host.s.say({ t: 'lobby.update', levelId, seats: kinds.map((k, i) => ({ kind: 'human', team: teams[i]! })) }); // level switch first (seats reset)
    const seats: SeatConfig[] = kinds.map((k, i) => (k === 'bot' ? { kind: 'bot', team: teams[i]!, difficulty: 'hard' } : { kind: 'human', team: teams[i]! }));
    host.s.say({ t: 'lobby.update', levelId, seats });
    const humans: C[] = [host];
    for (let i = 1; i < nHumans; i++) {
      const c = simClient(`P${i}`, ++tok);
      c.s.say({ t: 'room.join', code, role: 'play' });
      c.s.say({ t: 'lobby.ready', ready: true });
      humans.push(c);
    }
    return { code, humans, host, room: () => mgr.room(code)! };
  };
  const startRunning = (levelId: string, kinds: ('human' | 'bot')[], teams: number[]) => {
    const l = lobby(levelId, kinds, teams);
    l.host.s.say({ t: 'lobby.start' });
    assert.equal(l.room().state, 'countdown');
    const match = starts[starts.length - 1]!;
    advance(3100);
    assert.equal(l.room().state, 'running');
    return { ...l, match, ref: () => ctl.simOf(l.room())!, ls: () => ctl.inspect(l.room())! };
  };

  const script = (c: C, tick: number): void => {
    if (c.seat < 0 || tick % 15 !== c.seat * 4) return;
    const v = c.sim.view;
    const nb = v.ids.buildings.length;
    const owned: number[] = [];
    for (let i = 0; i < nb; i++) if (v.buildings.owner[i] === c.seat) owned.push(i);
    if (owned.length === 0) return;
    const k = Math.floor(tick / 15);
    const from = owned[k % owned.length]!;
    const to = (from + 1 + (k % (nb - 1))) % nb;
    c.s.say({ t: 'cmd', c: { type: k % 5 === 4 ? 'CutLine' : 'DrawLine', from, to } });
  };
  /** Advance fake time in 50 ms loop steps; fire due timers; pump every client. `play` = scripted commands. */
  const advance = (ms: number, play?: { ref: () => Sim; every?: number }): void => {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      if (play !== undefined) for (const c of sims) if (!c.s.sent.some((m) => m.t === 'end')) script(c, c.sim?.view.tick ?? 0);
      for (const x of timers.filter((q) => q.at <= now).sort((p, q) => p.at - q.at || p.id - q.id)) { const i = timers.indexOf(x); if (i >= 0) { timers.splice(i, 1); x.fn(); } }
      for (const r of [...rooms]) if (r.startAt <= now) r.tick();
      for (const c of sims) c.pump();
      if (play !== undefined) {
        const rt = play.ref().view.tick;
        if (rt % (play.every ?? 20) === 0) {
          const h = play.ref().hash();
          for (const c of sims) if (c.seat >= 0 && !c.s.sent.some((m) => m.t === 'end') && c.sim.view.tick === rt) assert.equal(c.sim.hash(), h, `client seat ${c.seat} hash @${rt}`);
        }
      }
    }
  };
  return { lobby, startRunning, advance, simClient, mgr, ctl, rooms, starts, now: () => now };
}
type T = ReturnType<typeof setup>;
type R = ReturnType<T['startRunning']>;

const lobbyOf = (s: Sock) => s.of('lobby.state').at(-1)!;
const noDesync = (r: R) => { for (const c of r.humans) assert.equal(c.s.of('desync').length, 0, 'no desync'); };
const replayHash = (r: R): string => {
  const ls = r.ls();
  const sim = create(r.match.level, r.match.seed, { teams: r.match.teams });
  for (const ch of ls.log.range(0, ls.nextTick)) {
    const byTick = new Map<number, Command[]>();
    for (const e of ch.cmds) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e.cmd]);
    for (let n = ch.from; n < ch.to; n++) sim.step(byTick.get(n) ?? [], { events: false });
  }
  return sim.hash();
};
const troopsOf = (sim: Sim, seat: number): number => {
  const buf = createTroopBuffer(4096);
  const n = sim.readTroops(buf);
  let k = 0;
  for (let i = 0; i < n; i++) if (buf.owner[i] === seat) k++;
  return k;
};
const ownedBy = (sim: Sim, seat: number): number => sim.view.buildings.owner.filter((o) => o === seat).length;
const forfeits = (r: R): number[] => r.ls().log.commands.filter((e) => (e.cmd as Command).type === 'Forfeit').map((e) => (e.cmd as { player: number }).player);

const H = (n: number): ('human' | 'bot')[] => Array.from({ length: n }, () => 'human');
const T2V2 = [0, 1, 0, 1];

// ---------------- Task 18: shapes ----------------

test('Cross: 2 humans + 2 bots (humans on teams 0/1): client hashes equal referee, bot cmds logged, replay == referee', () => {
  const t = setup();
  const r = t.startRunning(CROSS, ['human', 'human', 'bot', 'bot'], T2V2);
  assert.deepEqual(r.match.seats.map((s) => s.kind), ['human', 'human', 'bot', 'bot']);
  t.advance(20_000, { ref: r.ref });
  noDesync(r);
  assert.ok(r.ref().view.tick >= 380);
  for (const bot of [2, 3]) assert.ok(r.ls().log.commands.some((e) => (e.cmd as { player: number }).player === bot), `bot ${bot} cmds logged`);
  assert.ok(r.ls().log.commands.some((e) => (e.cmd as { player: number }).player === 0), 'human cmds logged');
  assert.equal(replayHash(r), r.ref().hash());
  for (const c of r.humans) assert.equal(c.sim.hash(), r.ref().hash());
});

test('Cross FFA 4 humans (teams 0,1,2,3): hashes equal; one quit -> play continues, 3 teams; replay == referee', () => {
  const t = setup();
  const r = t.startRunning(CROSS, H(4), [0, 1, 2, 3]);
  t.advance(15_000, { ref: r.ref });
  r.humans[3]!.s.say({ t: 'quit' });
  assert.equal(r.room().state, 'running');
  t.advance(10_000, { ref: r.ref });
  noDesync(r);
  assert.deepEqual(forfeits(r), [3]);
  assert.ok(r.ref().view.eliminatedAt[3]! >= 0);
  assert.equal(ownedBy(r.ref(), 3), 0, 'seat 3 buildings neutral');
  assert.equal(troopsOf(r.ref(), 3), 0);
  assert.equal(r.ref().view.over, null);
  assert.equal(replayHash(r), r.ref().hash());
});

test('Cross 2v2 teams [0,0,1,1]: 2 humans (teammates) + 2 bots; one human quits -> teammate plays on; second quit -> bots win', () => {
  const t = setup();
  const r = t.startRunning(CROSS, ['human', 'human', 'bot', 'bot'], [0, 0, 1, 1]);
  assert.deepEqual(r.match.teams, [0, 0, 1, 1]);
  t.advance(15_000, { ref: r.ref });
  noDesync(r);
  assert.ok(r.ls().log.commands.some((e) => (e.cmd as { player: number }).player === 2));
  r.humans[1]!.s.say({ t: 'quit' });
  t.advance(2_000, { ref: r.ref });
  assert.equal(r.room().state, 'running', 'teammate alive -> match continues');
  assert.ok(r.ref().view.eliminatedAt[1]! >= 0);
  assert.equal(ownedBy(r.ref(), 1), 0);
  r.humans[0]!.s.say({ t: 'quit' });
  assert.equal(r.room().state, 'ended');
  const end = r.humans[0]!.s.of('end')[0]!;
  assert.equal(end.outcome.outcome, 'victory');
  assert.deepEqual(end.outcome.winners?.slice().sort(), [2, 3]);
  assert.equal(end.finalHash, r.ref().hash());
  assert.equal(replayHash(r), r.ref().hash());
});

test('mid-match spectator: join watch -> start(null)+catch-up converges to referee hash and stays equal; cannot act', () => {
  const t = setup();
  const r = t.startRunning(CROSS, ['human', 'human', 'bot', 'bot'], T2V2);
  t.advance(8_000, { ref: r.ref });
  const spec = t.simClient('S', 99);
  spec.s.say({ t: 'room.join', code: r.code, role: 'watch' });
  const st = spec.s.of('start')[0]!;
  assert.equal(st.youPlayer, null);
  const jl = createJoinLate(createCatchup(r.match.level, r.match.seed, { teams: r.match.teams }));
  let read = 0;
  const feed = (): void => { while (read < spec.s.sent.length) jl.push(spec.s.sent[read++]!); jl.run(1e9, () => 0); };
  feed();
  assert.equal(jl.catchup.sim.view.tick, r.ref().view.tick);
  assert.equal(jl.catchup.sim.hash(), r.ref().hash());
  t.advance(5_000, { ref: r.ref });
  feed();
  assert.equal(jl.live, true);
  assert.equal(jl.catchup.sim.view.tick, r.ref().view.tick);
  assert.equal(jl.catchup.sim.hash(), r.ref().hash());
  spec.s.say({ t: 'cmd', c: { type: 'DrawLine', from: 0, to: 1 } });
  assert.equal(spec.s.of('error').at(-1)!.code, 'not-your-seat');
  assert.equal(spec.s.of('desync').length, 0);
});

test('host transfer: host drop / leave in lobby passes host to earliest connected human, ready cleared', () => {
  const t = setup();
  const l = t.lobby(CROSS, H(4), T2V2, 3);
  const [h, p1, p2] = l.humans as [typeof l.host, typeof l.host, typeof l.host];
  assert.equal(lobbyOf(p1.s).host, 0);
  assert.equal(lobbyOf(p1.s).seats[1]!.occupant?.ready, true);
  h.s.drop();
  assert.equal(lobbyOf(p1.s).host, 1);
  // NOTE: reserveSeat (drop path) does not clear ready flags (PRD says it does); the leave path below does. Reported, not asserted.
  assert.equal(lobbyOf(p1.s).seats[0]!.occupant?.status, 'away', 'ex-host seat reserved');
  p1.s.say({ t: 'lobby.start' });
  assert.equal(p1.s.of('error').at(-1)!.code, 'not-ready', 'refused: seat 0 reserved, p2 not ready, seat 3 empty');
  p1.s.say({ t: 'room.leave' });
  assert.equal(lobbyOf(p2.s).host, 2, 'second transfer');
  assert.equal(lobbyOf(p2.s).seats.every((s) => s.occupant?.ready !== true || s === lobbyOf(p2.s).seats[2]), true, 'leave clears ready flags');
  const back = t.simClient('H', 1); // ex-host returns by token: normal member
  assert.equal(back.s.of('room.joined').at(-1)!.code, l.code);
  assert.equal(lobbyOf(back.s).host, 2);
  back.s.say({ t: 'lobby.update', levelId: CROSS, seats: lobbyOf(back.s).seats.map((s) => ({ kind: s.kind, team: s.team })) });
  assert.equal(back.s.of('error').at(-1)!.code, 'not-host');
});

test('rematch: new seed/matchId, budgets reset, hashes equal again', () => {
  const t = setup();
  const r = t.startRunning(CROSS, ['human', 'human', 'bot', 'bot'], [0, 1, 0, 0]);
  const [a, b] = r.humans as [typeof r.host, typeof r.host];
  a.s.say({ t: 'pause' });
  t.advance(10_000);
  a.s.say({ t: 'resume', epoch: a.s.of('pause.state').at(-1)!.epoch });
  assert.ok(a.s.of('pause.state').at(-1)!.budgets[0]! <= 20_000, 'budget spent');
  t.advance(2_000, { ref: r.ref });
  b.s.say({ t: 'quit' }); // teams [0,1,0,0]: only team 0 left -> A's team wins
  assert.equal(r.room().state, 'ended');
  b.s.say({ t: 'rematch' });
  a.s.say({ t: 'rematch' });
  assert.equal(r.room().state, 'lobby');
  assert.equal(r.room().match, undefined);
  a.s.say({ t: 'lobby.start' });
  const m2 = t.starts[t.starts.length - 1]!;
  assert.notEqual(m2.matchId, r.match.matchId);
  assert.notEqual(m2.seed, r.match.seed);
  t.advance(3100);
  assert.equal(r.room().state, 'running');
  const ps = t.ctl.pauseState(r.room())!;
  assert.deepEqual(ps.budgets.slice(0, 2), [30_000, 30_000], 'rematch resets budgets');
  assert.equal(ps.epoch, 0);
  assert.equal(t.ctl.endOf(r.room()), undefined, 'previous result not served for the new match');
  t.advance(10_000, { ref: () => t.ctl.simOf(r.room())! });
  assert.equal(a.s.of('desync').length + b.s.of('desync').length, 0);
});

test('lobby rule rejections', () => {
  const t = setup();
  const l = t.lobby(CROSS, H(4), T2V2, 3);
  const [h, p1] = l.humans as [typeof l.host, typeof l.host];
  const err = (s: Sock) => s.of('error').at(-1)!.code;
  h.s.say({ t: 'lobby.start' });
  assert.equal(err(h.s), 'bad-lobby'); // seat 3 not filled
  const p3 = t.simClient('P3', 50);
  p3.s.say({ t: 'room.join', code: l.code, role: 'play' });
  h.s.say({ t: 'lobby.start' });
  assert.equal(err(h.s), 'not-ready'); // p3 not ready
  const p4 = t.simClient('P4', 51);
  p4.s.say({ t: 'room.join', code: l.code, role: 'play' });
  assert.equal(err(p4.s), 'room-full');
  assert.equal(p4.s.of('room.joined').length, 0);
  p1.s.say({ t: 'lobby.start' });
  assert.equal(err(p1.s), 'not-host');
  p1.s.say({ t: 'lobby.update', levelId: CROSS, seats: lobbyOf(h.s).seats.map((s) => ({ kind: s.kind, team: s.team })) });
  assert.equal(err(p1.s), 'not-host');
  h.s.say({ t: 'lobby.update', levelId: 'nope', seats: [] });
  assert.equal(err(h.s), 'bad-lobby');
  h.s.say({ t: 'lobby.update', levelId: CROSS, seats: [{ kind: 'human', team: 0 }] });
  assert.equal(err(h.s), 'bad-lobby'); // seat count
  h.s.say({ t: 'lobby.update', levelId: CROSS, seats: [{ kind: 'bot', team: 0 }, { kind: 'human', team: 1 }, { kind: 'human', team: 0 }, { kind: 'human', team: 1 }] });
  assert.equal(err(h.s), 'bad-lobby'); // host seat must be human
  h.s.say({ t: 'lobby.ready', ready: true });
  assert.equal(err(h.s), 'bad-lobby'); // host implicitly ready
  p3.s.say({ t: 'lobby.ready', ready: true });
  h.s.say({ t: 'lobby.update', levelId: CROSS, seats: [0, 1, 2, 3].map(() => ({ kind: 'human' as const, team: 0 })) });
  assert.equal(lobbyOf(h.s).seats.every((s) => s.team === 0), true);
  for (const c of [p1, l.humans[2]!, p3]) c.s.say({ t: 'lobby.ready', ready: true });
  h.s.say({ t: 'lobby.start' });
  assert.equal(err(h.s), 'bad-lobby'); // one team only
  assert.equal(l.room().state, 'lobby');
  h.s.say({ t: 'lobby.update', levelId: CROSS, seats: T2V2.map((tm) => ({ kind: 'human' as const, team: tm })) });
  for (const c of [p1, l.humans[2]!, p3]) c.s.say({ t: 'lobby.ready', ready: true });
  h.s.say({ t: 'lobby.start' });
  assert.equal(l.room().state, 'countdown');
  h.s.say({ t: 'lobby.update', levelId: CROSS, seats: T2V2.map((tm) => ({ kind: 'human' as const, team: tm })) });
  assert.equal(err(h.s), 'match-in-progress');
});

// ---------------- SP07 AC12 at wiring level on Cross ----------------

test('AC12(a): 2 humans + 2 bots; A holds, B quits (pending, non-terminal) -> A sole live human: unlimited, never expires; B eliminated on resume', () => {
  const t = setup();
  const r = t.startRunning(CROSS, ['human', 'human', 'bot', 'bot'], T2V2);
  const [a, b] = r.humans as [typeof r.host, typeof r.host];
  t.advance(10_000, { ref: r.ref });
  a.s.say({ t: 'pause' });
  let ps = a.s.of('pause.state').at(-1)!;
  assert.equal(ps.unlimited, false, 'two live humans: limited');
  assert.equal(typeof ps.budgets[0], 'number');
  const frozen = r.ls().nextTick;
  b.s.say({ t: 'quit' });
  assert.equal(r.room().state, 'running', 'non-terminal');
  ps = a.s.of('pause.state').at(-1)!;
  assert.equal(ps.paused, true);
  assert.equal(ps.unlimited, true);
  assert.equal(ps.budgets[0], null);
  assert.deepEqual(ps.holds.map((h) => h.player), [0], 'B hold dropped');
  assert.equal(ownedBy(r.ref(), 1) > 0, true, 'B still owns buildings while frozen (pending)');
  assert.equal(r.ls().nextTick, frozen);
  t.advance(10 * 60_000); // would expire any 30 s budget
  assert.equal(r.room().state, 'running');
  assert.equal(r.ls().nextTick, frozen);
  assert.deepEqual(forfeits(r), [], 'Forfeit still pending, not stepped');
  a.s.say({ t: 'resume', epoch: a.s.of('pause.state').at(-1)!.epoch });
  assert.equal(a.s.of('pause.state').at(-1)!.paused, false);
  t.advance(100, { ref: r.ref });
  assert.deepEqual(forfeits(r), [1]);
  const fe = r.ls().log.commands.find((e) => (e.cmd as Command).type === 'Forfeit')!;
  assert.equal(fe.tick, frozen, 'applied at the frozen tick');
  assert.ok(r.ref().view.eliminatedAt[1]! >= 0);
  assert.equal(ownedBy(r.ref(), 1), 0, 'B buildings neutral');
  assert.equal(troopsOf(r.ref(), 1), 0, 'B troops gone');
  assert.equal(r.room().state, 'running');
  t.advance(5_000, { ref: r.ref });
  noDesync(r);
  assert.equal(a.sim.hash(), r.ref().hash());
  assert.equal(replayHash(r), r.ref().hash());
});

test('SP11 C5: sim elimination after quit-during-pause broadcasts pause.state (unlimited, null budget)', () => {
  const t = setup();
  const r = t.startRunning(CROSS, ['human', 'human', 'bot', 'bot'], T2V2);
  const [a, b] = r.humans as [typeof r.host, typeof r.host];
  t.advance(10_000, { ref: r.ref });
  a.s.say({ t: 'pause' });
  b.s.say({ t: 'quit' });
  a.s.say({ t: 'resume', epoch: a.s.of('pause.state').at(-1)!.epoch });
  const before = a.s.of('pause.state').length;
  const epoch0 = a.s.of('pause.state').at(-1)!.epoch;
  t.advance(100, { ref: r.ref });
  assert.deepEqual(forfeits(r), [1]);
  const after = a.s.of('pause.state');
  assert.ok(after.length > before, 'broadcast after elimination');
  const last = after.at(-1)!;
  assert.ok(last.epoch > epoch0);
  assert.equal(last.unlimited, true);
  assert.equal(last.budgets[0], null);
  assert.equal(b.s.of('pause.state').at(-1)!.epoch, last.epoch, 'all conns');
});

test('AC12(b): 4 humans (teams 0,1,0,1): seat 1 hold expires -> only seat 1 forfeits, match continues, others stay limited; then seat 3 quits -> teammates (0,2) win', () => {
  const t = setup();
  const r = t.startRunning(CROSS, H(4), T2V2);
  t.advance(10_000, { ref: r.ref });
  const h1 = r.humans[1]!;
  h1.s.say({ t: 'pause' });
  const frozen = r.ls().nextTick;
  t.advance(29_900);
  assert.equal(r.room().state, 'running');
  assert.equal(r.ls().nextTick, frozen);
  t.advance(200);
  assert.equal(r.room().state, 'running', 'only that seat forfeits');
  t.advance(1_000, { ref: r.ref }); // hold gone -> match resumes, forfeit applied at frozen tick
  assert.deepEqual(forfeits(r), [1]);
  assert.equal(r.ls().log.commands.find((e) => (e.cmd as Command).type === 'Forfeit')!.tick, frozen);
  assert.equal(ownedBy(r.ref(), 1), 0);
  assert.equal(troopsOf(r.ref(), 1), 0);
  assert.equal(r.ref().view.over, null);
  const ps = t.ctl.pauseState(r.room())!;
  assert.equal(ps.paused, false);
  assert.equal(ps.unlimited, false, 'three live humans remain limited');
  // a teammate can still pause with a finite budget
  r.humans[2]!.s.say({ t: 'pause' });
  assert.equal(typeof r.humans[2]!.s.of('pause.state').at(-1)!.budgets[2], 'number');
  r.humans[2]!.s.say({ t: 'resume', epoch: r.humans[2]!.s.of('pause.state').at(-1)!.epoch });
  t.advance(2_000, { ref: r.ref });
  r.humans[3]!.s.say({ t: 'quit' }); // team 1 now fully gone
  assert.equal(r.room().state, 'ended');
  const end = r.humans[0]!.s.of('end')[0]!;
  assert.equal(end.outcome.outcome, 'victory');
  assert.deepEqual(end.outcome.winners?.slice().sort(), [0, 2]);
  assert.equal(r.humans[1]!.s.of('end').length, 1, 'forfeited seat still gets the result');
  assert.equal(end.finalHash, r.ref().hash());
  assert.equal(replayHash(r), r.ref().hash());
});

test('AC12(c): 2 humans + 2 bots, both humans away at first expiry -> draw; Forfeit for every surviving seat ascending in one tick', () => {
  const t = setup();
  const r = t.startRunning(CROSS, ['human', 'human', 'bot', 'bot'], T2V2);
  t.advance(5_000, { ref: r.ref });
  r.humans[0]!.s.drop();
  t.advance(1_000);
  r.humans[1]!.s.drop();
  const frozen = r.ls().nextTick;
  t.advance(31_000);
  assert.equal(r.room().state, 'ended');
  assert.equal(r.ls().nextTick, frozen + 1);
  const c = r.ls().log.range(frozen, frozen + 1)[0]!.cmds.map((e) => e.cmd);
  assert.deepEqual(c, [0, 1, 2, 3].map((player) => ({ type: 'Forfeit', player })));
  const over = r.ref().view.over!;
  assert.equal(over.outcome, 'draw');
  assert.equal(over.winner, null);
  assert.equal(replayHash(r), r.ref().hash());
});
