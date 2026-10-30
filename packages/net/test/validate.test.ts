import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeClient, encodeServer, encodeTick } from '../src/codec.js';
import type { ClientMessage, ServerMessage } from '../src/messages.js';
import { MAX_CLIENT_BYTES, parseClientMessage, parseServerMessage } from '../src/validate.js';

const versions = { rules: '2.0.0', schema: '1', content: 'abc', bot: '1' };
const H = 'abcdef0123456789';
const client: ClientMessage[] = [
  { t: 'hello', pv: 1, versions, nick: 'Ann', token: '0123456789abcdef0123456789abcdef', auth: 'x'.repeat(2048) },
  { t: 'hello', pv: 1, versions, nick: 'Bob', token: 'f'.repeat(32) },
  { t: 'room.create' }, { t: 'room.join', code: 'AB12', role: 'play' }, { t: 'room.join', code: 'ZZZZ', role: 'watch' },
  { t: 'room.leave' },
  { t: 'lobby.update', levelId: 'l1', seats: [{ kind: 'human', team: 0 }, { kind: 'bot', difficulty: 'easy', team: 1 }, { kind: 'empty', team: 2 }] },
  { t: 'lobby.ready', ready: false }, { t: 'lobby.start' }, { t: 'rematch' },
  { t: 'cmd', c: { type: 'DrawLine', from: 1, to: 2147483647 }, cid: 4 }, { t: 'cmd', c: { type: 'CutLine', from: 0, to: 2 } },
  { t: 'hash', tick: 40, h: H }, { t: 'resync' }, { t: 'ping', id: 9 },
];
const cmds = [{ tick: 3, cmd: { type: 'DrawLine' as const, player: 1, from: 2, to: 3 } }];
const server: ServerMessage[] = [
  { t: 'welcome', pv: 1, playerId: 'p1', serverVersions: versions, resume: { code: 'ABCD', seat: 1 } },
  { t: 'welcome', pv: 1, playerId: 'p1', serverVersions: versions },
  { t: 'room.joined', code: 'ABCD', you: { seat: null, host: false } }, { t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } },
  { t: 'lobby.state', levelId: 'l', timeLimitSec: 300, host: null, spectators: 2,
    seats: [{ kind: 'human', team: 0, occupant: { nick: 'a', ready: true, status: 'connected' } }, { kind: 'bot', difficulty: 'hard', team: 1 }] },
  { t: 'room.closed', reason: 'idle' },
  { t: 'start', matchId: 'm', levelId: 'l', simHash: H, seed: 77, youPlayer: 0, inputDelay: 3, countdownMs: 3000,
    timeLimitTicks: 6000, hashInterval: 20, seats: [{ player: 0, kind: 'human', team: 0, nick: 'a' }, { player: 1, kind: 'bot', team: 1, nick: '', difficulty: 'easy' }] },
  { t: 'tick', n: 5 }, { t: 'tick', n: 6, c: [{ type: 'CutLine', player: 0, from: 1, to: 2 }] },
  { t: 'catchup', from: 0, to: 9, cmds, done: false }, { t: 'ticks', from: 10, to: 12, cmds: [] },
  { t: 'desync', tick: 20, serverHash: H }, { t: 'seat.status', player: 1, status: 'grace', graceMs: 5000 },
  { t: 'seat.status', player: 1, status: 'bot' },
  { t: 'end', outcome: { outcome: 'victory', winners: [0, 2], winner: 0 }, finalTick: 100, finalHash: H },
  { t: 'end', outcome: { outcome: 'draw', winners: [], winner: null }, finalTick: 100, finalHash: H },
  { t: 'pong', id: 3, tick: 7 }, { t: 'error', code: 'rate-limited', detail: 'slow' }, { t: 'error', code: 'internal' },
];

test('every client message round-trips', () => {
  for (const m of client) assert.deepEqual(parseClientMessage(encodeClient(m)), { ok: true, msg: m });
});
test('every server message round-trips', () => {
  for (const m of server) assert.deepEqual(parseServerMessage(encodeServer(m)), { ok: true, msg: m });
  assert.deepEqual(parseServerMessage(encodeTick(5)), { ok: true, msg: { t: 'tick', n: 5 } });
});

const code = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code);
const hello = (patch: object) => JSON.stringify({ ...client[0], auth: undefined, ...patch });

test('client: json / size / shape codes', () => {
  assert.equal(code(parseClientMessage('{nope')), 'bad-json');
  assert.equal(code(parseClientMessage('')), 'bad-json');
  assert.equal(code(parseClientMessage(5)), 'bad-json');
  assert.equal(code(parseClientMessage(undefined)), 'bad-json');
  for (const s of ['null', '[]', '1', '"x"', 'true']) assert.equal(code(parseClientMessage(s)), 'bad-message', s);
  assert.equal(code(parseClientMessage('{}')), 'unknown-type');
  assert.equal(code(parseClientMessage('{"t":5}')), 'unknown-type');
  assert.equal(code(parseClientMessage('{"t":"nope"}')), 'unknown-type');
  assert.equal(code(parseClientMessage('{"t":"toString"}')), 'unknown-type');
  assert.equal(code(parseClientMessage('{"t":"ping","id":1,"pad":"' + 'x'.repeat(MAX_CLIENT_BYTES) + '"}')), 'too-large');
  assert.equal(code(parseClientMessage('{"t":"ping","id":"' + '€'.repeat(1400) + '"}')), 'too-large');
});

test('client: unknown fields, injected player, proto pollution', () => {
  assert.equal(code(parseClientMessage('{"t":"ping","id":1,"x":1}')), 'bad-message');
  assert.equal(code(parseClientMessage('{"t":"cmd","c":{"type":"DrawLine","from":1,"to":2,"player":3}}')), 'bad-message');
  assert.equal(code(parseClientMessage('{"t":"cmd","player":1,"c":{"type":"DrawLine","from":1,"to":2}}')), 'bad-message');
  assert.equal(code(parseClientMessage('{"t":"ping","id":1,"__proto__":{"admin":true}}')), 'bad-message');
  assert.equal(code(parseClientMessage('{"__proto__":{"t":"ping"},"t":"ping","id":1}')), 'bad-message');
  assert.equal(code(parseClientMessage('{"t":"ping","id":1,"constructor":{"prototype":{"x":1}}}')), 'bad-message');
  assert.equal(({} as Record<string, unknown>).admin, undefined);
  assert.equal(code(parseClientMessage('{"t":"cmd","c":{"type":"Hack","from":1,"to":2}}')), 'bad-message');
  // output is a fresh plain object
  const r = parseClientMessage('{"t":"ping","id":1}');
  assert.ok(r.ok && Object.getPrototypeOf(r.msg) === Object.prototype);
});

test('client: field validation', () => {
  const ok = (r: ReturnType<typeof parseClientMessage>) => r.ok;
  assert.equal(ok(parseClientMessage(hello({}))), true);
  assert.equal(ok(parseClientMessage(hello({ nick: '  pad  ' }))), true);
  const trimmed = parseClientMessage(hello({ nick: '  pad  ' }));
  assert.ok(trimmed.ok && trimmed.msg.t === 'hello' && trimmed.msg.nick === 'pad');
  for (const nick of ['', '   ', 'x'.repeat(21), 'a\nb', 'a\u0000b', 5]) assert.equal(ok(parseClientMessage(hello({ nick }))), false, String(nick));
  for (const token of ['', 'g'.repeat(32), 'A'.repeat(32), '0'.repeat(31), '0'.repeat(33), 1]) assert.equal(ok(parseClientMessage(hello({ token }))), false, String(token));
  assert.equal(ok(parseClientMessage(hello({ auth: 'x'.repeat(2049) }))), false);
  assert.equal(ok(parseClientMessage(hello({ pv: -1 }))), false);
  assert.equal(ok(parseClientMessage(hello({ pv: 1.5 }))), false);
  assert.equal(ok(parseClientMessage(hello({ versions: { ...versions, extra: 1 } }))), false);
  for (const c of ['abcd', 'ABC', 'ABCDE', 'AB-D', '']) assert.equal(ok(parseClientMessage(JSON.stringify({ t: 'room.join', code: c, role: 'play' }))), false, c);
  assert.equal(ok(parseClientMessage('{"t":"room.join","code":"ABCD","role":"boss"}')), false);
  for (const h of ['ABCDEF0123456789', 'abc', H + '0', 'g'.repeat(16)]) assert.equal(ok(parseClientMessage(JSON.stringify({ t: 'hash', tick: 20, h }))), false, h);
  for (const tick of [19, 21, -20, 1.5, 2 ** 31 + 19]) assert.equal(ok(parseClientMessage(JSON.stringify({ t: 'hash', tick, h: H }))), false, String(tick));
  for (const v of [2 ** 31, -1, 1.5, '1', null, 1e400]) {
    assert.equal(ok(parseClientMessage(`{"t":"cmd","c":{"type":"DrawLine","from":${JSON.stringify(v)},"to":1}}`)), false, String(v));
  }
  assert.equal(ok(parseClientMessage('{"t":"lobby.update","levelId":"l","seats":' + JSON.stringify(Array(9).fill({ kind: 'bot', team: 0 })) + '}')), false);
  assert.equal(ok(parseClientMessage('{"t":"lobby.update","levelId":"l","seats":[{"kind":"alien","team":0}]}')), false);
  assert.equal(ok(parseClientMessage('{"t":"lobby.update","levelId":"l","seats":[{"kind":"bot","team":0,"x":1}]}')), false);
  assert.equal(ok(parseClientMessage('{"t":"lobby.ready","ready":"yes"}')), false);
});

test('server: tolerant of unknown fields, ignorable unknown t, still validates', () => {
  const r = parseServerMessage('{"t":"pong","id":1,"tick":2,"future":{"a":1}}');
  assert.deepEqual(r, { ok: true, msg: { t: 'pong', id: 1, tick: 2 } });
  assert.deepEqual(parseServerMessage('{"t":"future.thing","x":1}'), { ok: false, code: 'unknown-type', ignorable: true });
  assert.deepEqual(parseServerMessage('{"t":"welcome","pv":1,"playerId":"p","serverVersions":{"rules":"1","schema":"1","content":"c","bot":"1","extra":"z"},"zzz":1}').ok, true);
  assert.equal(code(parseServerMessage('{"t":"pong","id":-1,"tick":2}')), 'bad-message');
  assert.equal(code(parseServerMessage('{"t":"desync","tick":20,"serverHash":"nothex"}')), 'bad-message');
  assert.equal(code(parseServerMessage('{"t":"error","code":"made-up"}')), 'bad-message');
  assert.deepEqual(parseServerMessage('{"t":"server.draining","deadlineMs":30000}'), { ok: true, msg: { t: 'server.draining', deadlineMs: 30000 } });
  assert.deepEqual(parseServerMessage('{"t":"error","code":"draining"}'), { ok: true, msg: { t: 'error', code: 'draining' } });
  for (const bad of ['{"t":"server.draining"}', '{"t":"server.draining","deadlineMs":-1}', '{"t":"server.draining","deadlineMs":1.5}', '{"t":"server.draining","deadlineMs":"30"}'])
    assert.equal(code(parseServerMessage(bad)), 'bad-message', bad);
  assert.equal(code(parseServerMessage('nope')), 'bad-json');
  assert.equal(code(parseServerMessage('[1]')), 'bad-message');
  assert.equal(code(parseServerMessage(' '.repeat(2 ** 20 + 1))), 'too-large');
  const p = parseServerMessage('{"t":"pong","id":1,"tick":2,"__proto__":{"evil":1}}');
  assert.ok(p.ok && Object.getPrototypeOf(p.msg) === Object.prototype && !('evil' in p.msg));
});

// Deterministic mutation fuzz (seeded LCG; tests only).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const JUNK: unknown[] = [null, -1, 2 ** 31, 1.5, 'x', '', [], {}, true, '__proto__', 1e308, [[]], { __proto__: null }, 'A'.repeat(5000)];
function mutate(v: unknown, rnd: () => number, depth = 0): unknown {
  if (Array.isArray(v)) {
    const a = v.map((x) => (rnd() < 0.3 ? mutate(x, rnd, depth + 1) : x));
    if (rnd() < 0.2) a.push(JUNK[Math.floor(rnd() * JUNK.length)]);
    return a;
  }
  if (typeof v === 'object' && v !== null) {
    const o: Record<string, unknown> = { ...(v as object) };
    const keys = Object.keys(o);
    const r = rnd();
    if (keys.length && r < 0.4) o[keys[Math.floor(rnd() * keys.length)]!] = JUNK[Math.floor(rnd() * JUNK.length)];
    else if (keys.length && r < 0.6) delete o[keys[Math.floor(rnd() * keys.length)]!];
    else if (r < 0.8) o[['__proto__', 'constructor', 'player', 'x'][Math.floor(rnd() * 4)]!] = JUNK[Math.floor(rnd() * JUNK.length)];
    for (const k of Object.keys(o)) if (depth < 3 && rnd() < 0.3) o[k] = mutate(o[k], rnd, depth + 1);
    return o;
  }
  return JUNK[Math.floor(rnd() * JUNK.length)];
}

test('fuzz: never throws, always well-formed result', () => {
  const rnd = lcg(12345);
  const validCodes = new Set(['bad-json', 'too-large', 'bad-message', 'unknown-type']);
  const check = (r: ReturnType<typeof parseClientMessage>) => {
    if (r.ok) assert.equal(typeof r.msg.t, 'string');
    else assert.ok(validCodes.has(r.code));
  };
  for (let i = 0; i < 4000; i++) {
    const src = i % 2 ? client[Math.floor(rnd() * client.length)]! : server[Math.floor(rnd() * server.length)]!;
    const m = mutate(src, rnd);
    let text: string;
    try { text = JSON.stringify(m); } catch { continue; }
    check(parseClientMessage(text));
    check(parseServerMessage(text) as ReturnType<typeof parseClientMessage>);
    // byte-level corruption
    const cut = Math.floor(rnd() * text.length);
    check(parseClientMessage(text.slice(0, cut)));
    check(parseServerMessage((text.slice(0, cut) + String.fromCharCode(Math.floor(rnd() * 65536)) + text.slice(cut)) ) as ReturnType<typeof parseClientMessage>);
  }
  for (const raw of [undefined, null, 0, {}, [], Symbol('x'), () => 1, 10n]) {
    check(parseClientMessage(raw)); check(parseServerMessage(raw) as ReturnType<typeof parseClientMessage>);
  }
});

test('server: start.hashInterval must be 20; client hash tick % 20', () => {
  const start = { t: 'start', matchId: 'm', levelId: 'l', simHash: '0123456789abcdef', seed: 1, youPlayer: 0, inputDelay: 3, countdownMs: 3000, timeLimitTicks: 6000, hashInterval: 20, seats: [] };
  assert.equal(parseServerMessage(JSON.stringify(start)).ok, true);
  for (const v of [10, 0, 40, '20', null]) assert.equal(code(parseServerMessage(JSON.stringify({ ...start, hashInterval: v }))), 'bad-message');
});
