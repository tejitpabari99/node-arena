import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditorMiddleware, editorLevelPath } from '../../src/dev/editor-middleware.js';

let server: Server;
let dir: string;
let levels: string;
let base: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'na-editor-'));
  levels = join(dir, 'levels'); await mkdir(levels);
  await writeFile(join(levels, 'na-local.json'), JSON.stringify({ id: 'na-local', name: 'Custom' }));
  await writeFile(join(dir, 'private.json'), JSON.stringify({ id: 'na-escape', name: 'Secret' }));
  await symlink(join(dir, 'private.json'), join(levels, 'na-escape.json'));
  await writeFile(join(levels, 'levelview-1.json'), JSON.stringify({ id: 'levelview-1', name: 'Imported' }));
  await symlink(join(levels, 'levelview-1.json'), join(levels, 'na-alias.json'));
  const middleware = createEditorMiddleware(levels);
  server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });

function raw(path: string, options: { host?: string; method?: string; headers?: Record<string, string>; chunks?: string[] } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method: options.method ?? 'GET', setHost: false, headers: { ...(options.host === '' ? {} : { host: options.host ?? new URL(base).host }), ...options.headers } }, res => {
      let body = ''; res.on('data', chunk => { body += String(chunk); });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    for (const chunk of options.chunks ?? []) req.write(chunk);
    req.end();
  });
}

it('refuses symlink escape for reads and future writable paths', async () => {
  expect((await raw('/__editor/level/na-escape')).status).toBe(403);
  await expect(editorLevelPath(levels, 'na-escape', true)).rejects.toMatchObject({ status: 403 });
  expect(await readFile(join(dir, 'private.json'), 'utf8')).toContain('Secret');
});
it('prevents a custom symlink from becoming a writable alias for an imported level', async () => {
  await expect(editorLevelPath(levels, 'na-alias', true)).rejects.toMatchObject({ status: 403 });
});
it('confines future writes to the exact na- id contract', async () => {
  for (const id of ['levelview-1', '../private', 'na-', 'na-UPPER', `na-${'a'.repeat(41)}`]) {
    await expect(editorLevelPath(levels, id, true)).rejects.toMatchObject({ status: 400 });
  }
  expect(await editorLevelPath(levels, `na-${'a'.repeat(40)}`, true)).toBe(join(levels, `na-${'a'.repeat(40)}.json`));
});
it.each(['localhost', '127.0.0.1', 'localhost:1234', '127.0.0.1:1234'])('allows loopback Host %s', async host => {
  expect((await raw('/__editor/level/na-local', { host })).status).toBe(200);
});
it.each(['[::1]', 'localhost.evil', 'localhost:1@evil', '127.0.0.2'])('refuses unsafe Host %s', async host => {
  expect((await raw('/__editor/level/na-local', { host })).status).toBe(403);
});
it('refuses a missing Host at the HTTP boundary', async () => {
  expect((await raw('/__editor/level/na-local', { host: '' })).status).toBe(400);
});
it('requires the exact Origin including port and the header value 1', async () => {
  expect((await raw('/__editor/save', { method: 'POST', headers: { Origin: base } })).status).toBe(403);
  for (const headers of [
    { 'X-NA-Editor': '1', Origin: 'http://localhost' },
    { 'X-NA-Editor': '1', Origin: `${base}:1` },
    { 'X-NA-Editor': '0', Origin: base },
    { 'X-NA-Editor': '1', Origin: 'null' },
  ]) expect((await raw('/__editor/save', { method: 'POST', headers })).status).toBe(403);
});
it('enforces the cap for chunked POST bodies without losing the error response', async () => {
  const response = await raw('/__editor/save', { method: 'POST', headers: { 'X-NA-Editor': '1', Origin: base }, chunks: ['x'.repeat(700000), 'y'.repeat(400000)] });
  expect(response.status).toBe(413);
  expect(JSON.parse(response.body)).toHaveProperty('error');
  const boundary = await raw('/__editor/save', { method: 'POST', headers: { 'X-NA-Editor': '1', Origin: base }, chunks: ['x'.repeat(1024 * 1024)] });
  expect(boundary.status).toBe(405);
});
it('does not perform writes or leak filesystem paths in missing-file errors', async () => {
  expect((await raw('/__editor/level/na-missing')).status).toBe(404);
  expect((await raw('/__editor/level/na-missing')).body).not.toContain(dir);
  const response = await raw('/__editor/save', { method: 'POST', headers: { 'X-NA-Editor': '1', Origin: base }, chunks: ['{}'] });
  expect(response.status).toBe(405);
  expect(await readFile(join(levels, 'na-local.json'), 'utf8')).toBe('{"id":"na-local","name":"Custom"}');
});
