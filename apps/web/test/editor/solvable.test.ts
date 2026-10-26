import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NextLevel } from '@node-arena/content';
import { prepareEditorProxy, runEditorProxy, type EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';
import { createEditorMiddleware } from '../../src/dev/editor-middleware.js';

let dir: string, base: string, server: Server, source: NextLevel;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'na-editor-proxy-'));
  await cp(resolve('../../packages/content/data'), join(dir, 'data'), { recursive: true });
  await cp(resolve('../../packages/content/content.json'), join(dir, 'content.json'));
  source = JSON.parse(await readFile(join(dir, 'data/levels/levelview-1.json'), 'utf8')) as NextLevel;
  const middleware = createEditorMiddleware(join(dir, 'data/levels'));
  server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(done => server.close(() => done())); await rm(dir, { recursive: true, force: true }); });
function check(level: unknown, id = 'na-proxy', headers: Record<string, string> = { 'X-NA-Editor': '1', Origin: base }) {
  return fetch(`${base}/__editor/solvable`, { method: 'POST', headers, body: JSON.stringify({ id, level }) });
}
const events = (text: string) => text.trim().split('\n').map(line => JSON.parse(line));
it('runs real proxies on the unsaved working copy, streams runs and preserves disk', async () => {
  const files = await readdir(join(dir, 'data/levels'));
  const campaign = await readFile(join(dir, 'data/campaigns/custom.json'), 'utf8');
  const response = await check(source);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/x-ndjson');
  const stream = events(await response.text());
  expect(stream[0]).toMatchObject({ type: 'started', id: 'na-proxy' });
  expect(stream.filter(event => event.type === 'progress')).toHaveLength(17);
  const report = stream.at(-1).report;
  expect(report).toMatchObject({ id: 'na-proxy', solvable: true, ok: true, deterministic: true, runs: 12 });
  expect(report.totalWins).toBeGreaterThan(0);
  const lose = structuredClone(source); lose.buildings.forEach(building => { building.owner = 'p2'; });
  const losing = events(await (await check(lose)).text()).at(-1).report;
  expect(losing).toMatchObject({ solvable: false, totalWins: 0, ok: false });
  expect(losing.errors.join(' ')).toContain('Unsolvable by proxy');
  expect(await readdir(join(dir, 'data/levels'))).toEqual(files);
  expect(await readFile(join(dir, 'data/campaigns/custom.json'), 'utf8')).toBe(campaign);
}, 30000);
it('guards proxy requests before execution', async () => {
  expect((await check(source, 'levelview-1')).status).toBe(400);
  expect((await check(source, '../escape')).status).toBe(400);
  expect((await check(source, 'na-proxy', {})).status).toBe(403);
  const rebinding = await new Promise<number | undefined>((done, reject) => {
    const req = request(`${base}/__editor/solvable`, { method: 'POST', setHost: false, headers: { Host: 'attacker.example', 'X-NA-Editor': '1', Origin: base } }, response => { response.resume(); done(response.statusCode); });
    req.on('error', reject); req.end(JSON.stringify({ id: 'na-proxy', level: source }));
  });
  expect(rebinding).toBe(403);
  expect((await check(source, 'na-proxy', { 'X-NA-Editor': '1', Origin: 'http://localhost' })).status).toBe(403);
  expect((await check({})).status).toBe(422);
  const oversized = await fetch(`${base}/__editor/solvable`, { method: 'POST', headers: { 'X-NA-Editor': '1', Origin: base }, body: 'x'.repeat(1024 * 1024 + 1) });
  expect(oversized.status).toBe(413);
});

it('rejects concurrent jobs, streams failure, and releases the gate for retry', async () => {
  let finish!: () => void;
  const held = new Promise<void>(done => { finish = done; });
  const middleware = createEditorMiddleware(join(dir, 'data/levels'), { runProxy: async (_input, _emit, signal) => {
    await Promise.race([held, new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }))]);
    throw new Error('private/internal/path');
  } });
  const local = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>(done => local.listen(0, '127.0.0.1', done));
  const address = local.address(); if (!address || typeof address === 'string') throw new Error('No server');
  const url = `http://127.0.0.1:${address.port}`;
  const send = (signal?: AbortSignal) => fetch(`${url}/__editor/solvable`, { method: 'POST', headers: { 'X-NA-Editor': '1', Origin: url }, body: JSON.stringify({ id: 'na-held', level: source }), signal: signal ?? null });
  try {
    const first = await send();
    const reader = first.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('started');
    expect((await send()).status).toBe(409);
    // Listing remains responsive while a job holds the gate.
    expect((await fetch(`${url}/__editor/levels`)).status).toBe(200);
    finish();
    let rest = ''; for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
    expect(events(rest)).toEqual([{ type: 'error', error: 'private/internal/path' }]);
    const retry = await send(); expect(retry.status).toBe(200); await retry.text();
  } finally { finish(); await new Promise<void>(done => local.close(() => done())); }
});

it('disconnect cancels the job before permitting a replacement', async () => {
  let cancelled!: () => void;
  const aborted = new Promise<void>(done => { cancelled = done; });
  const middleware = createEditorMiddleware(join(dir, 'data/levels'), { runProxy: async (_input, _emit, signal) => {
    await new Promise<void>(done => signal.addEventListener('abort', () => { cancelled(); done(); }, { once: true }));
  } });
  const local = createServer((req, res) => middleware(req, res, () => res.end()));
  await new Promise<void>(done => local.listen(0, '127.0.0.1', done));
  const address = local.address(); if (!address || typeof address === 'string') throw new Error('No server');
  const url = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController();
  try {
    const response = await fetch(`${url}/__editor/solvable`, { method: 'POST', headers: { 'X-NA-Editor': '1', Origin: url }, body: JSON.stringify({ id: 'na-abort', level: source }), signal: controller.signal });
    expect(response.status).toBe(200);
    controller.abort(); await aborted;
    const replacement = await check(source); expect(replacement.status).toBe(200); await replacement.text();
  } finally { controller.abort(); await new Promise<void>(done => local.close(() => done())); }
});

it('preserves unsolved allowlist semantics without presenting validation-ok as a proxy win', async () => {
  const lose = structuredClone(source); lose.buildings.forEach(building => { building.owner = 'p2'; });
  const input = await prepareEditorProxy(dir, 'na-proxy-listed', lose);
  input.unsolved = { id: 'na-proxy-listed', reason: 'Owner manual fixture', ownerSignOff: null };
  const output: EditorProxyEvent[] = [];
  await runEditorProxy(input, event => output.push(event), new AbortController().signal);
  const last = output.at(-1);
  expect(last?.type).toBe('result');
  if (last?.type !== 'result') throw new Error('No report');
  expect(last.report).toMatchObject({ ok: true, solvable: false, totalWins: 0 });
  expect(last.report.warnings.join(' ')).toContain('Unsolved by proxy (allowlisted');
});
it('aborting a real running proxy process settles cancellation before returning', async () => {
  const input = await prepareEditorProxy(dir, 'na-proxy-cancel', source);
  const controller = new AbortController(); let progress = 0;
  await expect(runEditorProxy(input, event => {
    if (event.type === 'progress') { progress++; controller.abort(); }
  }, controller.signal)).rejects.toThrow('cancelled');
  expect(progress).toBe(1);
});

it('surfaces the real worker error instead of a generic failure', async () => {
  const seen: EditorProxyEvent[] = [];
  await expect(runEditorProxy({ level: null, unsolved: null } as never, event => seen.push(event), new AbortController().signal)).rejects.toThrow(/TypeError|Cannot|undefined|null/);
  expect(seen.some(event => event.type === 'error' && event.error !== 'Proxy check failed' && event.error.length > 0)).toBe(true);
}, 60_000);
