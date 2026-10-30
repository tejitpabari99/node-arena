import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@node-arena/net';
import { parseConfig } from '../src/config.js';
import { loadServerContent } from '../src/content.js';
import { hardExitMs, startServer } from '../src/main.js';
import { createLogger } from '../src/log.js';

const content = loadServerContent(parseConfig({}).contentDir);
const boot = () => startServer(parseConfig({ PORT: '0', HOST: '127.0.0.1', ALLOW_NO_ORIGIN: '1' }), { content, log: createLogger({ level: 'error' }) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client { ws: WebSocket; msgs: ServerMessage[]; say(m: object): void; until(t: string, pred?: (m: ServerMessage) => boolean): Promise<ServerMessage>; closed: Promise<number> }
async function connect(port: number, nick: string, tok: string): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const msgs: ServerMessage[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d)) as ServerMessage));
  const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
  await new Promise<void>((r) => ws.once('open', () => r()));
  const say = (m: object): void => { ws.send(JSON.stringify(m)); };
  const until = async (t: string, pred: (m: ServerMessage) => boolean = () => true): Promise<ServerMessage> => {
    for (let i = 0; i < 1500; i++) { const m = msgs.find((x) => x.t === t && pred(x)); if (m) return m; await sleep(10); }
    throw new Error(`timeout waiting for ${t}; got ${msgs.map((m) => m.t).join(',')}`);
  };
  say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick, token: tok.repeat(32).slice(0, 32) });
  await until('welcome');
  return { ws, msgs, say, until, closed };
}
const errs = (c: Client) => c.msgs.filter((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error').map((m) => m.code);

async function soloMatch(c: Client): Promise<string> {
  c.say({ t: 'room.create' });
  const joined = await c.until('room.joined') as Extract<ServerMessage, { t: 'room.joined' }>;
  const ls = await c.until('lobby.state') as Extract<ServerMessage, { t: 'lobby.state' }>;
  c.say({ t: 'lobby.update', levelId: ls.levelId, seats: [{ kind: 'human', team: 0 }, { kind: 'bot', team: 1, difficulty: 'easy' }] });
  c.say({ t: 'lobby.start' });
  await c.until('start');
  await sleep(3400); // 3-2-1 countdown: disconnect/quit before tick 0 would cancel the start
  return joined.code;
}

test('DRAIN_MS config: default 30000, range 0-120000', () => {
  assert.equal(parseConfig({}).drainMs, 30000);
  assert.equal(parseConfig({ DRAIN_MS: '0' }).drainMs, 0);
  assert.equal(parseConfig({ DRAIN_MS: '120000' }).drainMs, 120000);
  assert.throws(() => parseConfig({ DRAIN_MS: '120001' }));
  assert.throws(() => parseConfig({ DRAIN_MS: 'x' }));
  assert.equal(hardExitMs(30000), 33000);
  assert.equal(hardExitMs(0), 8000);
});

test('drain: refuses create/join/start/rematch, serves token reattach, healthz draining stays 200', async () => {
  const srv = await boot();
  const a = await connect(srv.port, 'Ann', 'a'), b = await connect(srv.port, 'Bob', 'b');
  const code = await soloMatch(a);
  const idle = await connect(srv.port, 'Cy', 'c');
  const lobbyHost = await connect(srv.port, 'Di', 'd');
  lobbyHost.say({ t: 'room.create' }); await lobbyHost.until('room.joined');
  try {
    const done = srv.drain({ windowMs: 10_000, minMs: 10_000 });
    assert.equal(srv.phase(), 'draining');
    b.say({ t: 'room.create' });
    b.say({ t: 'room.join', code, role: 'watch' });
    b.say({ t: 'room.join', code, role: 'play' });
    idle.say({ t: 'rematch' });
    lobbyHost.say({ t: 'lobby.start' });
    await sleep(300);
    assert.deepEqual(errs(b), ['draining', 'draining', 'draining']);
    assert.deepEqual(errs(idle), ['draining']);
    assert.deepEqual(errs(lobbyHost), ['draining']);
    const res = await fetch(`http://127.0.0.1:${srv.port}/healthz`);
    assert.equal(res.status, 200);
    const j = await res.json() as Record<string, unknown>;
    assert.equal(j.ok, true); assert.equal(j.draining, true);
    // Token reattach into the running match is not refused.
    a.ws.close(); await a.closed;
    const a2 = await connect(srv.port, 'Ann', 'a');
    await a2.until('start'); await a2.until('catchup');
    assert.deepEqual(errs(a2), []);
    void done;
  } finally { await srv.close(); }
});

test('healthz draining is false while serving', async () => {
  const srv = await boot();
  try {
    const j = await (await fetch(`http://127.0.0.1:${srv.port}/healthz`)).json() as Record<string, unknown>;
    assert.equal(j.draining, false);
  } finally { await srv.close(); }
});

test('drain with no active match completes at the minimum (~3 s) and closes with server-restart', async () => {
  const srv = await boot();
  const a = await connect(srv.port, 'Ann', 'a');
  a.say({ t: 'room.create' }); await a.until('room.joined');
  const t0 = Date.now();
  await srv.drain({ windowMs: 30_000 });
  const dt = Date.now() - t0;
  assert.ok(dt >= 2800 && dt < 6000, `drain took ${dt}`);
  assert.equal(await a.closed, 1001);
  assert.deepEqual(a.msgs.find((m) => m.t === 'room.closed'), { t: 'room.closed', reason: 'server-restart' });
  assert.equal(srv.phase(), 'exited');
});

test('a match ending naturally mid-window delivers end; drain then finishes before the window', async () => {
  const srv = await boot();
  const a = await connect(srv.port, 'Ann', 'a');
  await soloMatch(a);
  const t0 = Date.now();
  const done = srv.drain({ windowMs: 20_000, minMs: 500 });
  await sleep(1000);
  a.say({ t: 'quit' });
  const end = await a.until('end') as Extract<ServerMessage, { t: 'end' }>;
  assert.ok(end.finalTick >= 0);
  await done;
  assert.ok(Date.now() - t0 < 12_000, `took ${Date.now() - t0}`);
  assert.ok(a.msgs.findIndex((m) => m.t === 'end') < a.msgs.findIndex((m) => m.t === 'room.closed'));
});

test('drain({windowMs:0}) is the legacy immediate shutdown', async () => {
  const srv = await boot();
  const a = await connect(srv.port, 'Ann', 'a');
  a.say({ t: 'room.create' }); await a.until('room.joined');
  await srv.drain({ windowMs: 0 });
  assert.deepEqual(a.msgs.find((m) => m.t === 'room.closed'), { t: 'room.closed', reason: 'shutdown' });
});
