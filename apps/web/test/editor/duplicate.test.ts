import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NextLevel } from '@node-arena/content';
import { createEditorJobGate, createEditorMiddleware } from '../../src/dev/editor-middleware.js';

let root: string, origin: string, server: Server, source: NextLevel;
let jobs: ReturnType<typeof createEditorJobGate>;
const disk = (id: string) => readFile(join(root, `data/levels/${id}.json`), 'utf8');
const campaign = async () => JSON.parse(await readFile(join(root, 'data/campaigns/custom.json'), 'utf8')) as { entries: { level: string; position: number }[] };
const post = (path: string, body: unknown, headers: Record<string, string> = { 'X-NA-Editor': '1', Origin: origin }) => fetch(`${origin}/__editor/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
async function duplicate(id: string) {
  const response = await post('duplicate', { id });
  expect(response.status, await response.clone().text()).toBe(200);
  return await response.json() as { level: NextLevel; warnings: unknown[] };
}
async function seed(id: string) {
  const response = await post('save', { id, level: source, copy: true });
  expect(response.status).toBe(200);
  return (await response.json() as { level: NextLevel }).level;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'na-editor-duplicate-'));
  await cp(resolve('../../packages/content/data'), join(root, 'data'), { recursive: true });
  await cp(resolve('../../packages/content/content.json'), join(root, 'content.json'));
  await rm(join(root, 'data/campaigns/custom.json'), { force: true });
  source = JSON.parse(await disk('levelview-1')) as NextLevel;
  jobs = createEditorJobGate();
  const middleware = createEditorMiddleware(join(root, 'data/levels'), { jobs });
  server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test server');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>(done => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
});

it('duplicates saved disk content, retaining name, dropping source and resetting version', async () => {
  const saved = await seed('na-original');
  saved.name = 'Saved name'; saved.editorVersion = '9.8.7'; saved.source = source.source!;
  await writeFile(join(root, 'data/levels/na-original.json'), JSON.stringify(saved));
  const before = await disk('na-original');
  const result = await duplicate('na-original');
  const expected = { ...saved, id: 'na-original-copy', editorVersion: '0.0.1' }; delete expected.source;
  expect(result).toEqual({ level: expected, warnings: [] });
  expect(JSON.parse(await disk('na-original-copy'))).toEqual(expected);
  expect(await disk('na-original')).toBe(before);
  expect((await campaign()).entries.map(entry => entry.level)).toEqual(['na-original', 'na-original-copy']);
});
it('uses first free suffix and preserves existing files, including campaign identities', async () => {
  await seed('na-original');
  const first = await duplicate('na-original');
  const before = await disk(first.level.id);
  // A level file outside any campaign must also reserve its identity.
  await writeFile(join(root, 'data/levels/na-original-copy-2.json'), JSON.stringify({ ...source, id: 'na-original-copy-2' }));
  expect((await duplicate('na-original')).level.id).toBe('na-original-copy-3');
  expect(await disk(first.level.id)).toBe(before);
  await rm(join(root, 'data/levels/na-original-copy.json'));
  const custom = await campaign(); custom.entries = custom.entries.filter(e => e.level !== 'na-original-copy');
  await writeFile(join(root, 'data/campaigns/custom.json'), JSON.stringify(custom));
  expect((await duplicate('na-original')).level.id).toBe('na-original-copy');
});
it('does not reuse a campaign-only reservation or repair it by silently creating the reserved level', async () => {
  await seed('na-reserved');
  const path = join(root, 'data/campaigns/custom.json');
  const custom = await campaign();
  custom.entries.push({ level: 'na-reserved-copy', position: 2 });
  await writeFile(path, JSON.stringify(custom));
  const before = await readFile(path, 'utf8');
  // The missing campaign reference makes the staged dataset invalid. Allocation must skip
  // it, then fail validation without creating either the reserved id or its next suffix.
  expect((await post('duplicate', { id: 'na-reserved' })).status).toBe(422);
  await expect(disk('na-reserved-copy')).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(disk('na-reserved-copy-2')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(path, 'utf8')).toBe(before);
});
it('serializes simultaneous duplicates and saves without losing registrations or overwriting copies', async () => {
  await seed('na-race');
  const results = await Promise.all([duplicate('na-race'), duplicate('na-race'), seed('na-sibling')]);
  expect(results.slice(0, 2).map(result => (result as { level: NextLevel }).level.id).sort()).toEqual(['na-race-copy', 'na-race-copy-2']);
  expect((await campaign()).entries.map(e => e.level).sort()).toEqual(['na-race', 'na-race-copy', 'na-race-copy-2', 'na-sibling']);
});
it.each([
  [`na-${'a'.repeat(40)}`, `na-${'a'.repeat(35)}-copy`, `na-${'a'.repeat(33)}-copy-2`],
  [`na-${'a'.repeat(34)}-${'b'.repeat(5)}`, `na-${'a'.repeat(34)}-copy`, `na-${'a'.repeat(33)}-copy-2`],
])('reserves suffix space and trims trailing hyphens for %s', async (id, first, second) => {
  await seed(id);
  for (const expected of [first, second]) {
    const { level } = await duplicate(id);
    expect(level.id).toBe(expected); expect(level.id).toMatch(/^na-[a-z0-9-]{1,40}$/);
    expect((await campaign()).entries.some(e => e.level === level.id)).toBe(true);
  }
});
it('copies imported sources with na- prefix without modifying the imported file', async () => {
  const before = await disk('levelview-1');
  const { level } = await duplicate('levelview-1');
  expect(level).toMatchObject({ id: 'na-levelview-1-copy', name: source.name, editorVersion: '0.0.1' });
  expect(level).not.toHaveProperty('source'); expect(await disk('levelview-1')).toBe(before);
});
it('rejects unsafe identities, missing sources, malformed bodies and escaping symlinks without writes', async () => {
  const before = await readdir(join(root, 'data/levels'));
  for (const id of ['../private', 'na-UPPER', 'other', `na-${'a'.repeat(41)}`]) expect((await post('duplicate', { id })).status).toBe(400);
  expect((await post('duplicate', {})).status).toBe(400);
  expect((await post('duplicate', null)).status).toBe(400);
  expect((await post('duplicate', { id: 'na-missing' })).status).toBe(404);
  await writeFile(join(root, 'private.json'), JSON.stringify(source));
  await symlink(join(root, 'private.json'), join(root, 'data/levels/na-escape.json'));
  expect((await post('duplicate', { id: 'na-escape' })).status).toBe(403);
  await rm(join(root, 'data/levels/na-escape.json'));
  expect(await readdir(join(root, 'data/levels'))).toEqual(before);
});
it('requires CSRF protections and blocks duplicate while a job is running, releasing gate after errors', async () => {
  for (const headers of [{ Origin: origin }, { 'X-NA-Editor': '1', Origin: 'http://evil.test' }]) {
    expect((await post('duplicate', { id: 'levelview-1' }, headers)).status).toBe(403);
  }
  const release = jobs.acquire();
  try { expect((await post('duplicate', { id: 'levelview-1' })).status).toBe(409); }
  finally { release(); }
  expect((await post('duplicate', { id: 'na-missing' })).status).toBe(404);
  await duplicate('levelview-1'); expect(jobs.snapshot().busy).toBe(false);
});
it('exposes changed, duplicate and version display through the client API against real HTTP', async () => {
  const api = await import('../../src/editor/api.js');
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => nativeFetch(new URL(path, origin), { ...init, headers: { ...init?.headers, Origin: origin } }));
  const saved = await api.saveLevel({ ...source, id: 'na-client' });
  expect(saved.changed).toBe(true); expect(api.versionOf(saved.level)).toBe('0.0.1');
  expect((await api.saveLevel(saved.level)).changed).toBe(false);
  expect(api.versionOf(source)).toBe('0.0.0');
  expect((await api.duplicateLevel(saved.level.id)).level.id).toBe('na-client-copy');
  await expect(api.duplicateLevel('na-missing')).rejects.toMatchObject({ status: 404 });
});
