import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@node-arena/net';
import { parseConfig } from '../src/config.js';
import { loadServerContent } from '../src/content.js';
import { originAllowed, startServer, type RunningServer } from '../src/main.js';
import { createLogger } from '../src/log.js';

let srv: RunningServer;
const content = loadServerContent(parseConfig({}).contentDir);

before(async () => {
  srv = await startServer(parseConfig({ PORT: '0', HOST: '127.0.0.1', ALLOWED_ORIGINS: 'https://game.example.com' }), {
    content, log: createLogger({ level: 'error' }),
  });
});
after(async () => { await srv.close(); });

test('GET /healthz 200 json; other path 404', async () => {
  const r = await fetch(`http://127.0.0.1:${srv.port}/healthz`);
  assert.equal(r.status, 200);
  const j = await r.json() as Record<string, unknown>;
  for (const k of ['ok', 'rooms', 'conns', 'running', 'lateP99Ms', 'uptimeS', 'versions']) assert.ok(k in j, k);
  assert.equal(j.ok, true);
  assert.equal((await fetch(`http://127.0.0.1:${srv.port}/nope`)).status, 404);
});

function open(origin: string | undefined): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, origin === undefined ? {} : { origin });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_q, res) => reject(new Error(`http ${res.statusCode}`)));
  });
}

test('ws: hello -> welcome, room.create -> room.joined', async () => {
  const ws = await open('https://game.example.com');
  const msgs: ServerMessage[] = [];
  const waiting: Array<() => void> = [];
  ws.on('message', (d) => { msgs.push(JSON.parse(String(d)) as ServerMessage); waiting.splice(0).forEach((f) => f()); });
  const until = async (t: string): Promise<ServerMessage> => {
    for (;;) {
      const m = msgs.find((x) => x.t === t);
      if (m) return m;
      await new Promise<void>((r) => { waiting.push(r); });
    }
  };
  ws.send(JSON.stringify({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick: 'tester', token: 'ab'.repeat(16) }));
  await until('welcome');
  ws.send(JSON.stringify({ t: 'room.create' }));
  const joined = await until('room.joined');
  assert.equal(joined.t, 'room.joined');
  ws.close();
});

test('origin refused / missing refused', async () => {
  await assert.rejects(open('https://evil.example.com'), /403/);
  await assert.rejects(open(undefined), /403/);
});

test('originAllowed exact + single-label wildcard', () => {
  const cfg = { allowedOrigins: ['https://a.com', 'https://*.b.com'], allowNoOrigin: false };
  assert.ok(originAllowed('https://a.com', cfg));
  assert.ok(originAllowed('https://x.b.com', cfg));
  assert.ok(!originAllowed('https://x.y.b.com', cfg));
  assert.ok(!originAllowed('https://b.com', cfg));
  assert.ok(!originAllowed('https://a.com.evil.com', cfg));
  assert.ok(!originAllowed(undefined, cfg));
  assert.ok(originAllowed(undefined, { ...cfg, allowNoOrigin: true }));
});
