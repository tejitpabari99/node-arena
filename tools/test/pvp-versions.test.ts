import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = resolve(import.meta.dirname, '../../scripts/pvp-versions.mjs');
const mod = (await import(script)) as {
  expectedVersions(): Promise<Record<string, unknown>>;
  diffVersions(a: unknown, e: Record<string, unknown>): string[];
};

test('diffVersions: equal, changed, missing and extra keys', () => {
  const e = { rules: '3.2.0', protocol: 2 };
  assert.deepEqual(mod.diffVersions({ rules: '3.2.0', protocol: 2 }, e), []);
  assert.equal(mod.diffVersions({ rules: '3.1.0', protocol: 2 }, e).length, 1);
  assert.equal(mod.diffVersions({ rules: '3.2.0' }, e).length, 1);
  assert.equal(mod.diffVersions({ rules: '3.2.0', protocol: 2, x: 1 }, e).length, 1);
  assert.equal(mod.diffVersions(null, e).length, 2);
});

test('expectedVersions reads the built constants', async () => {
  const v = await mod.expectedVersions();
  assert.deepEqual(Object.keys(v).sort(), ['bot', 'content', 'protocol', 'rules', 'schema']);
  assert.equal(typeof v.protocol, 'number');
});

async function withServer(body: unknown, status: number, fn: (url: string) => Promise<void>) {
  const srv = createServer((_q, r) => { r.writeHead(status, { 'content-type': 'application/json' }); r.end(JSON.stringify(body)); });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  try { await fn(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/healthz`); } finally { srv.close(); }
}
// Async spawn: the stub server lives in this process, so the event loop must stay free.
const run = (url: string) => new Promise<{ status: number | null; stderr: string }>((ok) => {
  const c = spawn(process.execPath, [script, url, '--attempts', '1']);
  let stderr = '';
  c.stderr.on('data', (d) => { stderr += d; });
  c.on('close', (status) => ok({ status, stderr }));
});

test('CLI: exit 0 on match, 1 on mismatch / bad status', async () => {
  const expected = await mod.expectedVersions();
  await withServer({ ok: true, versions: expected }, 200, async (u) => assert.equal((await run(u)).status, 0));
  await withServer({ ok: true, versions: { ...expected, protocol: 999 } }, 200, async (u) => {
    const r = await run(u);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /protocol/);
  });
  await withServer({ ok: true, versions: expected }, 503, async (u) => assert.equal((await run(u)).status, 1));
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 2);
});
