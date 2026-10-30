import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@node-arena/net';
import { parseConfig } from '../src/config.js';
import { loadServerContent } from '../src/content.js';
import { startServer } from '../src/main.js';
import { createLogger } from '../src/log.js';

const content = loadServerContent(parseConfig({}).contentDir);
const boot = () => startServer(parseConfig({ PORT: '0', HOST: '127.0.0.1', ALLOW_NO_ORIGIN: '1' }), { content, log: createLogger({ level: 'error' }) });

test('healthz shape', async () => {
  const srv = await boot();
  try {
    const j = await (await fetch(`http://127.0.0.1:${srv.port}/healthz`)).json() as Record<string, unknown>;
    assert.equal(j.ok, true);
    for (const k of ['rooms', 'conns', 'running', 'lateP99Ms', 'lateP50Ms', 'rss', 'cpuMs', 'uptimeS']) assert.equal(typeof j[k], 'number', k);
    const v = j.versions as Record<string, unknown>;
    assert.equal(v.protocol, PROTOCOL_VERSION);
    for (const k of Object.keys(content.versions)) assert.equal(v[k], (content.versions as Record<string, unknown>)[k], k);
  } finally { await srv.close(); }
});

test('shutdown: room.closed{shutdown}, close 1001, fast, refuses new conns', async () => {
  const srv = await boot();
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
  const msgs: ServerMessage[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d)) as ServerMessage));
  const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
  await new Promise<void>((r) => ws.once('open', () => r()));
  const until = async (t: string): Promise<void> => { for (let i = 0; i < 200 && !msgs.some((m) => m.t === t); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(msgs.some((m) => m.t === t), t); };
  ws.send(JSON.stringify({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick: 'Ann', token: 'ab'.repeat(16) }));
  await until('welcome');
  ws.send(JSON.stringify({ t: 'room.create' }));
  await until('room.joined');
  const t0 = Date.now();
  await srv.shutdown();
  assert.equal(await closed, 1001);
  assert.ok(Date.now() - t0 < 8000);
  assert.deepEqual(msgs.find((m) => m.t === 'room.closed'), { t: 'room.closed', reason: 'shutdown' });
  await assert.rejects(fetch(`http://127.0.0.1:${srv.port}/healthz`));
});
