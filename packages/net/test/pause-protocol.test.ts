import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createReplayRecorder } from '@node-arena/sim';
import {
  ERROR_CODES, LockstepServer, PROTOCOL_VERSION, SYSTEM_CMD_RESERVE, checkHello, createCatchup, encodeClient, encodeServer,
  parseClientMessage, parseServerMessage, type ClientMessage, type ServerMessage,
} from '../src/index.js';

const { pvpLevel } = createRequire(import.meta.url)('./pvp-fixture.cjs');
const metadata = { rulesVersion: '2.0.0', schemaVersion: '9.0.0', contentVersion: '9.0.0' };
const lv = () => pvpLevel([0, 1], [0, 1], { limit: 60, levels: [30, 2] });
const forfeit = (player: number) => ({ type: 'Forfeit' as const, player });

const state = (over: Record<string, unknown> = {}) => ({
  t: 'pause.state', epoch: 3, paused: true, tick: 40, unlimited: false,
  holds: [{ player: 1, reason: 'manual', connected: true, since: 2 }, { player: 0, reason: 'disconnect', connected: false, since: 3 }],
  budgets: [12000, 30000, null, null], ...over,
});

test('protocol version is 3 and handshake gates it', () => {
  assert.equal(PROTOCOL_VERSION, 3);
  const versions = { rules: '2.0.0', schema: '1', content: 'abc', bot: '1' };
  const hello = (pv: number) => ({ t: 'hello' as const, pv, versions, nick: 'a', token: 'f'.repeat(32) });
  assert.equal(checkHello(hello(2), versions, { playerId: 'p' }).ok, false);
  assert.equal(checkHello(hello(3), versions, { playerId: 'p' }).ok, true);
});

test('error codes include paused and no-match', () => {
  assert.ok(ERROR_CODES.includes('paused') && ERROR_CODES.includes('no-match'));
});

test('client pause/resume/quit parse strictly', () => {
  const ok: ClientMessage[] = [{ t: 'pause' }, { t: 'resume', epoch: 0 }, { t: 'resume', epoch: 5 }, { t: 'quit' }];
  for (const m of ok) assert.deepEqual(parseClientMessage(encodeClient(m)), { ok: true, msg: m });
  for (const raw of [
    '{"t":"pause","x":1}', '{"t":"quit","player":0}', '{"t":"resume"}', '{"t":"resume","epoch":-1}', '{"t":"resume","epoch":1.5}',
    '{"t":"resume","epoch":"1"}', '{"t":"resume","epoch":1,"extra":1}', '{"t":"pause","__proto__":{}}',
  ]) {
    const r = parseClientMessage(raw);
    assert.equal(r.ok, false, raw);
  }
});

test('pause.state valid shapes parse and round-trip', () => {
  const msgs = [state(), state({ paused: false, holds: [], unlimited: true, budgets: [null, null] }), state({ holds: [], budgets: [] })] as unknown as ServerMessage[];
  for (const m of msgs) assert.deepEqual(parseServerMessage(encodeServer(m)), { ok: true, msg: m });
});

test('pause.state invalid shapes rejected', () => {
  const cases: Record<string, unknown>[] = [
    state({ epoch: -1 }), state({ epoch: 1.5 }), state({ paused: 1 }), state({ tick: '4' }), state({ unlimited: null }),
    state({ holds: [{ player: 1, reason: 'bogus', connected: true, since: 0 }] }),
    state({ holds: [{ player: 1, reason: 'manual', connected: 1, since: 0 }] }),
    state({ holds: [{ player: -1, reason: 'manual', connected: true, since: 0 }] }),
    state({ holds: [{ player: 1, reason: 'manual', connected: true }] }),
    state({ holds: Array.from({ length: 5 }, (_, i) => ({ player: i, reason: 'manual', connected: true, since: 0 })) }),
    state({ budgets: [1, 2, 3, 4, 5] }), state({ budgets: [30001] }), state({ budgets: [-1] }), state({ budgets: ['x'] }),
    state({ budgets: undefined }), state({ holds: undefined }),
  ];
  for (const c of cases) assert.equal(parseServerMessage(JSON.stringify(c)).ok, false, JSON.stringify(c));
});

test('start.cancel parses; matchId required', () => {
  const m: ServerMessage = { t: 'start.cancel', matchId: 'm1' };
  assert.deepEqual(parseServerMessage(encodeServer(m)), { ok: true, msg: m });
  assert.equal(parseServerMessage('{"t":"start.cancel"}').ok, false);
  assert.equal(parseServerMessage('{"t":"start.cancel","matchId":""}').ok, false);
});

test('server messages accept Forfeit in tick.c and catchup.cmds', () => {
  const tick: ServerMessage = { t: 'tick', n: 4, c: [forfeit(1), { type: 'DrawLine', player: 0, from: 1, to: 2 }] };
  assert.deepEqual(parseServerMessage(encodeServer(tick)), { ok: true, msg: tick });
  const cu: ServerMessage = { t: 'catchup', from: 0, to: 5, cmds: [{ tick: 4, cmd: forfeit(0) }], done: true };
  assert.deepEqual(parseServerMessage(encodeServer(cu)), { ok: true, msg: cu });
  assert.equal(parseServerMessage('{"t":"tick","n":1,"c":[{"type":"Forfeit"}]}').ok, false);
  assert.equal(parseServerMessage('{"t":"tick","n":1,"c":[{"type":"Forfeit","player":-1}]}').ok, false);
});

test('client cannot forge Forfeit', () => {
  for (const c of [{ type: 'Forfeit' }, { type: 'Forfeit', player: 0 }, { type: 'Forfeit', from: 0, to: 1 }]) {
    assert.equal(parseClientMessage(JSON.stringify({ t: 'cmd', c })).ok, false, JSON.stringify(c));
  }
  const s = new LockstepServer({ seats: ['human', 'human'], buildingCount: 4, log: { timeLimitTicks: 100 } });
  assert.deepEqual(s.submit(0, { type: 'Forfeit', from: 0, to: 1 }), { accepted: false, rejected: 'bad-message' });
  assert.deepEqual(s.submit(0, { type: 'Forfeit', player: 1 }), { accepted: false, rejected: 'bad-message' });
  assert.equal(s.log.size, 0);
});

test('closeTick prepends system Forfeits in ascending seat order via the log', () => {
  const s = new LockstepServer({ seats: ['human', 'human', 'bot'], buildingCount: 4, log: { timeLimitTicks: 100 }, inputDelay: 1 });
  s.submit(0, { type: 'DrawLine', from: 1, to: 2 });
  s.closeTick();
  const bot = { type: 'CutLine' as const, player: 2, from: 0, to: 1 };
  const r = s.closeTick([bot], [forfeit(2), forfeit(0)]);
  assert.deepEqual(r.cmds, [forfeit(0), forfeit(2), { type: 'DrawLine', player: 0, from: 1, to: 2 }, bot]);
  assert.equal(r.dropped, 0);
  assert.deepEqual(s.log.commands.map((e) => e.cmd.type), ['Forfeit', 'Forfeit', 'DrawLine', 'CutLine']);
  assert.deepEqual(s.closeTick().cmds, []);
});

test('system appends fit under cmdCap reserve; refused one is counted as dropped', () => {
  assert.equal(SYSTEM_CMD_RESERVE, 8);
  const s = new LockstepServer({ seats: ['human', 'human'], buildingCount: 4, log: { timeLimitTicks: 100, cmdCap: 1 } });
  const r = s.closeTick([], [forfeit(0), forfeit(1)]);
  assert.equal(r.cmds.length, 1);
  assert.equal(r.dropped, 1);
});

test('Forfeit round-trips tick -> catchup -> CommandLog with equal hash', () => {
  const server = new LockstepServer({ seats: ['human', 'human'], buildingCount: 2, log: { timeLimitTicks: 1200 }, inputDelay: 1 });
  const referee = createReplayRecorder(lv(), 7, metadata, { teams: [0, 1] });
  for (let n = 0; n < 12; n++) {
    if (n === 2) server.submit(0, { type: 'DrawLine', from: 0, to: 1 });
    const t = server.closeTick([], n === 8 ? [forfeit(1)] : []);
    const wire = parseServerMessage(encodeServer({ t: 'tick', n: t.n, ...(t.cmds.length ? { c: t.cmds } : {}) }));
    assert.ok(wire.ok && wire.msg.t === 'tick');
    referee.step(wire.ok && wire.msg.t === 'tick' ? wire.msg.c ?? [] : []);
  }
  assert.ok(server.log.commands.some((e) => e.cmd.type === 'Forfeit' && e.tick === 8));
  const c = createCatchup(lv(), 7, { teams: [0, 1] });
  for (const ch of server.log.range(0, 12)) {
    const p = parseServerMessage(encodeServer({ t: 'catchup', ...ch, done: false } as ServerMessage));
    assert.ok(p.ok && p.msg.t === 'catchup');
    if (p.ok && p.msg.t === 'catchup') c.feed(p.msg);
  }
  c.run(1e9, () => 0);
  assert.equal(c.sim.hash(), referee.hash());
});
