import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NextLevel } from '@node-arena/content';
import { createEditorMiddleware } from '../../src/dev/editor-middleware.js';

let root: string, origin: string, server: Server, source: NextLevel, onContentWritten: ReturnType<typeof vi.fn<() => void>>;
const post = (path: string, body: unknown) => fetch(`${origin}/__editor/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NA-Editor': '1', Origin: origin }, body: JSON.stringify(body) });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'na-editor-written-'));
  await cp(resolve('../../packages/content/data'), join(root, 'data'), { recursive: true });
  await cp(resolve('../../packages/content/content.json'), join(root, 'content.json'));
  await rm(join(root, 'data/campaigns/custom.json'), { force: true });
  source = JSON.parse(await readFile(join(root, 'data/levels/levelview-1.json'), 'utf8')) as NextLevel;
  onContentWritten = vi.fn<() => void>();
  const middleware = createEditorMiddleware(join(root, 'data/levels'), { onContentWritten });
  server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>(done => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
});

it('save calls onContentWritten exactly once after a successful write', async () => {
  const response = await post('save', { id: 'na-written', level: source, copy: true });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(onContentWritten).toHaveBeenCalledTimes(1);
  expect((await post('save', { id: 'na-written', level: JSON.parse(await readFile(join(root, 'data/levels/na-written.json'), 'utf8')) })).status).toBe(200);
  expect(onContentWritten).toHaveBeenCalledTimes(2);
});

it('save does not call onContentWritten for a failed write (invalid level, bad request, rejected origin)', async () => {
  expect((await post('save', { id: 'na-bad', level: {} })).status).toBe(422);
  expect((await post('save', { id: 'na-bad', level: source, copy: 'yes' })).status).toBe(400);
  expect((await post('save', { id: 'not-writable', level: source })).status).toBe(400);
  expect((await fetch(`${origin}/__editor/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
  expect(onContentWritten).not.toHaveBeenCalled();
});

it('duplicate calls onContentWritten exactly once on success and never on failure', async () => {
  expect((await post('save', { id: 'na-original', level: source, copy: true })).status).toBe(200);
  onContentWritten.mockClear();
  const response = await post('duplicate', { id: 'na-original' });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(onContentWritten).toHaveBeenCalledTimes(1);
  onContentWritten.mockClear();
  expect((await post('duplicate', { id: 'na-missing' })).ok).toBe(false);
  expect((await post('duplicate', {})).status).toBe(400);
  expect((await post('duplicate', { id: '../etc' })).status).toBe(400);
  expect(onContentWritten).not.toHaveBeenCalled();
});
