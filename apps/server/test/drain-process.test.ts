import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@node-arena/net';
import { parseConfig } from '../src/config.js';
import { loadServerContent } from '../src/content.js';

// SP09 AC8: real process, real sockets, real SIGTERM. Runs dist/main.js when built, else src/main.ts through tsx.
const content = loadServerContent(parseConfig({}).contentDir);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dist = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const src = fileURLToPath(new URL('../src/main.ts', import.meta.url));

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});

test('SIGTERM on the real process: notice -> abort at the deadline -> exit 0 within window + 3 s', async () => {
  const port = await freePort(), windowMs = 4000;
  const args = existsSync(dist) ? [dist] : ['--import', 'tsx', src];
  const child = spawn(process.execPath, args, {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ALLOW_NO_ORIGIN: '1', DRAIN_MS: String(windowMs), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => child.once('exit', (code, signal) => r({ code, signal })));
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
      assert.ok(i < 300, 'server did not come up');
      await sleep(100);
    }
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msgs: Array<{ m: ServerMessage; at: number }> = [];
    ws.on('message', (d) => msgs.push({ m: JSON.parse(String(d)) as ServerMessage, at: Date.now() }));
    const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
    await new Promise<void>((r) => ws.once('open', () => r()));
    const say = (m: object): void => { ws.send(JSON.stringify(m)); };
    const until = async (t: string): Promise<{ m: ServerMessage; at: number }> => {
      for (let i = 0; i < 1500; i++) { const f = msgs.find((x) => x.m.t === t); if (f) return f; await sleep(10); }
      throw new Error(`timeout waiting for ${t}; got ${msgs.map((x) => x.m.t).join(',')}`);
    };
    say({ t: 'hello', pv: PROTOCOL_VERSION, versions: content.versions, nick: 'Ann', token: 'a'.repeat(32) });
    await until('welcome');
    say({ t: 'room.create' });
    await until('room.joined');
    const ls = (await until('lobby.state')).m as Extract<ServerMessage, { t: 'lobby.state' }>;
    say({ t: 'lobby.update', levelId: ls.levelId, seats: [{ kind: 'human', team: 0 }, { kind: 'bot', team: 1, difficulty: 'easy' }] });
    say({ t: 'lobby.start' });
    await until('start');
    await sleep(3400); // past the 3-2-1 countdown so the match is running

    const t0 = Date.now();
    assert.ok(child.kill('SIGTERM'));
    const notice = await until('server.draining');
    const nm = notice.m as Extract<ServerMessage, { t: 'server.draining' }>;
    assert.ok(notice.at - t0 < 1000, `notice took ${notice.at - t0} ms`);
    assert.ok(nm.deadlineMs > windowMs - 1000 && nm.deadlineMs <= windowMs, String(nm.deadlineMs));
    const hz = await (await fetch(`${base}/healthz`)).json() as Record<string, unknown>;
    assert.equal(hz.draining, true);

    const closedMsg = await until('room.closed');
    assert.deepEqual(closedMsg.m, { t: 'room.closed', reason: 'server-restart' });
    assert.ok(closedMsg.at - t0 >= windowMs - 300, `aborted early: ${closedMsg.at - t0} ms`);
    assert.equal(msgs.some((x) => x.m.t === 'end'), false, 'aborted match must not send end');
    assert.equal(await closed, 1001);
    const res = await exited;
    const dt = Date.now() - t0;
    assert.deepEqual(res, { code: 0, signal: null });
    assert.ok(dt <= windowMs + 3000, `exit took ${dt} ms`);
  } finally { child.kill('SIGKILL'); }
});
