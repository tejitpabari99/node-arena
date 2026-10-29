import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PROTOCOL_VERSION, LockstepClient, toWireOutcome, type ServerMessage, type StartMsg } from '@node-arena/net';
import { create, createReplayRecorder, playReplay, type Sim } from '@node-arena/sim';
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
  };
}

/** Simulated client: own Sim + LockstepClient built from the `start` message; replies with hash msgs. */
function simClient(nick: string, idx: number, hub: ReturnType<typeof createHub>) {
  const s = fakeSocket();
  hub.accept({ ...s, onClose: () => {} } as never);
  s.say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick, token: `${String(idx).padStart(8, '0')}a1b2c3d4e5f60718293a4b5c` });
  const lock = new LockstepClient();
  let sim: Sim | undefined;
  let seat = -1;
  let read = 0;
  const hashes = new Map<number, string>();
  const msgs: ServerMessage[] = [];
  const pump = (): void => {
    while (read < s.sent.length) {
      const m = s.sent[read++]!;
      msgs.push(m);
      if (m.t === 'start') {
        const st: StartMsg = m;
        seat = st.youPlayer ?? -1;
        sim = create(content.compiled[st.levelId]!, st.seed, { teams: st.seats.map((x) => x.team) });
      } else if (m.t === 'tick') {
        assert.ok(lock.push(m).ok);
        for (const t of lock.drain(Infinity)) {
          sim!.step(t.cmds, { events: false });
          const h = lock.after(t.n, () => sim!.hash());
          if (h !== null) { hashes.set(h.tick, h.h); s.say(h); }
        }
      }
    }
  };
  return { s, pump, hashes, msgs, get sim() { return sim!; }, get seat() { return seat; } };
}

function run(levelId: string, maxTicks: number) {
  let now = 1000;
  const added = new Set<ClockRoom>();
  const clock = { add: (r: ClockRoom) => void added.add(r), remove: (r: ClockRoom) => void added.delete(r), boundary: (t: number) => t };
  const ctl = createMatchController({ clock, now: () => now });
  const starts: MatchStart[] = [];
  let rn = 0;
  const mgr = createRoomManager({
    content, clock, now: () => now, inputDelay: 3, randomInt: () => (rn++ % 31),
    onStart: (r, m) => { starts.push(m); ctl.onStart(r, m); },
    onMatchMessage: ctl.onMessage,
  });
  const hub = createHub({ versions: content.versions, handler: mgr, secret: 's', timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  const a = simClient('A', 1, hub), b = simClient('B', 2, hub);
  a.s.say({ t: 'room.create' });
  const code = ((a.s.sent.find((m) => m.t === 'room.joined') as { code: string }).code);
  a.s.say({ t: 'lobby.update', levelId, seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }] });
  b.s.say({ t: 'room.join', code, role: 'play' });
  b.s.say({ t: 'lobby.ready', ready: true });
  a.s.say({ t: 'lobby.start' });
  a.pump(); b.pump();
  const match = starts[0]!;
  assert.equal(match.levelId, levelId);
  const room = mgr.room(code)!;
  const referee = ctl.simOf(room)!;
  const checks: { tick: number; ref: string; a: string | undefined; b: string | undefined }[] = [];

  // Scripted commands: each seat cycles draw/cut from buildings it owns (per client's own sim view), no `player` field.
  const script = (c: ReturnType<typeof simClient>, tick: number): void => {
    if (tick % 15 !== c.seat * 7) return;
    const v = c.sim.view;
    const n = v.ids.buildings.length;
    const owned: number[] = [];
    for (let i = 0; i < n; i++) if (v.buildings.owner[i] === c.seat) owned.push(i);
    if (owned.length === 0) return;
    const k = Math.floor(tick / 15);
    const from = owned[k % owned.length]!;
    const to = (from + 1 + (k % (n - 1))) % n;
    c.s.say({ t: 'cmd', c: { type: k % 5 === 4 ? 'CutLine' : 'DrawLine', from, to } });
  };

  let guard = 0;
  while (added.size > 0 && guard++ < maxTicks) {
    const t = a.sim.view.tick;
    script(a, t); script(b, t);
    for (const r of [...added]) r.tick();
    a.pump(); b.pump();
    if (referee.view.tick % 20 === 0) checks.push({ tick: referee.view.tick, ref: referee.hash(), a: a.hashes.get(referee.view.tick), b: b.hashes.get(referee.view.tick) });
  }
  assert.equal(added.size, 0, 'match ended within tick budget');
  return { a, b, match, room, referee, checks, lockstep: ctl.inspect(room)! };
}

function acceptance(levelId: string, maxTicks: number): void {
  const { a, b, match, referee, checks, lockstep } = run(levelId, maxTicks);
  for (const c of [a, b]) {
    assert.equal(c.msgs.filter((m) => m.t === 'desync').length, 0, 'no desync');
    assert.equal(c.msgs.filter((m) => m.t === 'end').length, 1);
  }
  assert.ok(checks.length >= 2);
  for (const c of checks) {
    assert.equal(c.a, c.ref, `A hash @${c.tick}`);
    assert.equal(c.b, c.ref, `B hash @${c.tick}`);
  }
  const end = a.msgs.find((m) => m.t === 'end')!;
  assert.equal(end.t === 'end' && end.finalHash, referee.hash());
  assert.equal(end.t === 'end' && end.finalHash, a.sim.hash());
  assert.equal(end.t === 'end' && end.finalHash, b.sim.hash());
  assert.deepEqual(end.t === 'end' && end.outcome, toWireOutcome(referee.view.over));
  assert.deepEqual(b.msgs.find((m) => m.t === 'end'), end);

  const level = content.compiled[levelId]!;
  const metadata = { rulesVersion: content.versions.rules, schemaVersion: content.versions.schema, contentVersion: content.versions.content };
  const rec = createReplayRecorder(level, match.seed, { ...metadata, rulesVersion: content.versions.rules }, { teams: match.teams });
  const base = rec.record();
  assert.ok(lockstep.log.commands.length > 0, 'scripted commands were logged');
  const checkpoints: { tick: number; hash: string }[] = [];
  for (let t = 20; t <= referee.view.tick; t += 20) checkpoints.push({ tick: t, hash: lockstep.log.checkpoint(t)! });
  assert.ok(checkpoints.every((c) => c.hash !== undefined));
  const res = playReplay(
    { metadata: { ...metadata, rulesVersion: content.versions.rules }, level },
    { ...base, commands: lockstep.log.commands.map((e) => ({ tick: e.tick, cmd: e.cmd as never })), checkpoints, finalTick: referee.view.tick, finalHash: referee.hash(), outcome: referee.view.over },
  );
  assert.equal(res.ok, true);
  assert.equal(res.sim.hash(), end.t === 'end' ? end.finalHash : '');
}

test('M1 acceptance: two clients on fixture, hashes equal, replay verifies', () => acceptance('na-pvp-fixture', 5000));
test('M1 acceptance: two clients on Duel S', () => acceptance('na-pvp-duel-s', 30000));
