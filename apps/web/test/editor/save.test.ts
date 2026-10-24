import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NextLevel, SeatBot } from '@node-arena/content';
import { createEditorMiddleware } from '../../src/dev/editor-middleware.js';

let dir: string, base: string, server: Server;
let original: NextLevel;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'na-editor-save-'));
  await cp(resolve('../../packages/content/data'), join(dir, 'data'), { recursive: true });
  await cp(resolve('../../packages/content/content.json'), join(dir, 'content.json'));
  await rm(join(dir, 'data/campaigns/custom.json'), { force: true });
  original = JSON.parse(await readFile(join(dir, 'data/levels/levelview-1.json'), 'utf8')) as NextLevel;
  const middleware = createEditorMiddleware(join(dir, 'data/levels'));
  server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(done => server.close(() => done())); await rm(dir, { recursive: true, force: true }); });
const save = (id: string, level: unknown, copy = false) => fetch(`${base}/__editor/save`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NA-Editor': '1', Origin: base }, body: JSON.stringify({ id, level, copy }),
});
const disk = (id: string) => readFile(join(dir, `data/levels/${id}.json`), 'utf8');
const campaign = () => readFile(join(dir, 'data/campaigns/custom.json'), 'utf8');

it('opens all 20 campaign levels and saves copies without any content drift; second save is byte-stable', async () => {
  const common = JSON.parse(await readFile(join(dir, 'data/campaigns/common.json'), 'utf8')) as { entries: { level: string }[] };
  expect(common.entries).toHaveLength(20);
  for (const [i, entry] of common.entries.entries()) {
    const source = await (await fetch(`${base}/__editor/level/${entry.level}`)).json() as NextLevel;
    const id = `na-copy-${i}`;
    const result = await save(id, source, true);
    expect(result.status, await result.text()).toBe(200);
    const bytes = await disk(id), actual = JSON.parse(bytes) as NextLevel;
    const expected = structuredClone(source); expected.id = id; delete expected.source;
    expect(actual).toEqual(expected);
    expect(bytes).toBe(JSON.stringify(expected, null, 2) + '\n');
    expect((await save(id, actual)).status).toBe(200);
    expect(await disk(id)).toBe(bytes);
  }
  const custom = JSON.parse(await campaign()) as { entries: { level: string; position: number }[] };
  expect(custom.entries).toHaveLength(20);
  expect(custom.entries.map(e => e.position)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
});

it('rejects item errors without changing either existing file; invalid new levels create nothing', async () => {
  const before = await disk('na-copy-0'), list = await campaign();
  for (const change of [
    (level: NextLevel) => { level.buildings[0]!.pos.x = 499; },
    (level: NextLevel) => { level.players[0]!.colorKey = 'missing'; },
    (level: NextLevel) => { level.buildings[0]!.archetype = 'missing'; },
    (level: NextLevel) => { level.buildings[0]!.level = 999; },
    (level: NextLevel) => { level.buildings[1]!.pos = { ...level.buildings[0]!.pos }; },
    (level: NextLevel) => { (level.players[1]!.bot as SeatBot).script = [{ op: 'line', own: 'missing', target: 'missing', afterMs: 0 }]; },
  ]) {
    const bad = structuredClone(original); change(bad);
    const response = await save('na-copy-0', bad, true);
    expect(response.status).toBe(422);
    const body = await response.json() as { issues: { pointer: string }[] };
    expect(body.issues.some(issue => /^\/(buildings|players)\//.test(issue.pointer))).toBe(true);
    expect(await disk('na-copy-0')).toBe(before); expect(await campaign()).toBe(list);
  }
  expect((await save('na-invalid', {})).status).toBe(422);
  await expect(disk('na-invalid')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('preserves reopened source, recomputes requires, rounds authored positions and reports nonblocking warnings', async () => {
  const level = structuredClone(original); level.requires = [];
  level.buildings[0]!.pos.x = level.buildings[1]!.pos.x + .011;
  level.buildings[0]!.pos.z = level.buildings[1]!.pos.z;
  level.elements = [{ id: 'outside', archetype: 'obstacle', pos: { x: 499, z: 0 }, yawDeg: 15.1234, variant: 'small' }];
  const response = await save('na-warnings', level);
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json() as { warnings: { pointer: string; message: string }[] };
  expect(body.warnings.some(w => w.message.includes('overlaps'))).toBe(true);
  expect(body.warnings.some(w => w.pointer === '/elements/0/pos')).toBe(true);
  const actual = JSON.parse(await disk('na-warnings')) as NextLevel;
  expect(actual.source).toEqual(original.source); expect(actual.requires).toEqual(['blocksLines', ...original.requires]);
  expect(actual.elements[0]!.yawDeg).toBe(15.12);
  expect(actual.buildings[0]!.pos.x).toBe(Math.round(level.buildings[0]!.pos.x * 100) / 100);
});

it('serializes simultaneous saves and keeps externally added campaign entries and positions', async () => {
  const custom = JSON.parse(await campaign()) as { entries: { level: string; position: number }[] };
  custom.entries.find(e => e.level === 'na-copy-0')!.position = 90;
  await writeFile(join(dir, 'data/campaigns/custom.json'), JSON.stringify(custom));
  const results = await Promise.all(['na-parallel-a', 'na-parallel-b'].map(id => save(id, original, true)));
  expect(results.map(r => r.status)).toEqual([200, 200]);
  const entries = (JSON.parse(await campaign()) as typeof custom).entries;
  expect(entries.find(e => e.level === 'na-copy-0')!.position).toBe(90);
  expect(entries.filter(e => e.level.startsWith('na-parallel')).map(e => e.position).sort()).toEqual([91, 92]);
});

it('validates the entire staged campaign before writing either file', async () => {
  const before = await disk('na-copy-0'), good = await campaign();
  const invalid = JSON.parse(good) as { entries: { level: string; position: number }[] };
  invalid.entries.push({ level: 'na-does-not-exist', position: 100 });
  await writeFile(join(dir, 'data/campaigns/custom.json'), JSON.stringify(invalid));
  expect((await save('na-copy-0', original, true)).status).toBe(422);
  expect(await disk('na-copy-0')).toBe(before);
  expect(await campaign()).toBe(JSON.stringify(invalid));
  await writeFile(join(dir, 'data/campaigns/custom.json'), good);
});

it('refuses imported, traversal and arbitrary non-na write identities', async () => {
  const before = await disk('levelview-1');
  for (const id of ['levelview-1', '../escape', 'other', 'na-UPPER']) expect((await save(id, original)).status).toBe(400);
  expect(await disk('levelview-1')).toBe(before);
});

it('saves after deleting a script-referenced building, with undo restoring the script', async () => {
  const { createHistory, historyReducer } = await import('../../src/editor/model.js');
  const doc = structuredClone(original); doc.id = 'na-delete-script';
  (doc.players[1]!.bot as SeatBot).script = [{ op: 'line', own: doc.buildings[0]!.id, target: doc.buildings[1]!.id, afterMs: 0 }];
  const state = historyReducer(createHistory(doc), { type: 'edit', op: { type: 'delete', target: { kind: 'building', id: doc.buildings[0]!.id } } });
  const result = await save(doc.id, state.present);
  expect(result.status, await result.clone().text()).toBe(200);
  expect((JSON.parse(await disk(doc.id)) as NextLevel).players[1]!.bot).not.toHaveProperty('script');
  expect(historyReducer(state, { type: 'undo' }).present).toEqual(doc);
});
