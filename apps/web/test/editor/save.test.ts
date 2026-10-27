import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { cp, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NextLevel, SeatBot } from '@node-arena/content';
import { createEditorMiddleware } from '../../src/dev/editor-middleware.js';
import { isDirty } from '../../src/editor/save-core.js';

const race = vi.hoisted(() => ({ run: undefined as undefined | (() => Promise<void>) }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, readFile: async (...args: Parameters<typeof fs.readFile>) => {
    const result = await fs.readFile(...args);
    if (String(args[0]).endsWith('/assets/manifest.json') && race.run) {
      const run = race.run; race.run = undefined; await run();
    }
    return result;
  } };
});

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
    expected.editorVersion = '0.0.1';
    expect(actual).toEqual(expected);
    const unversioned = { ...actual }; delete unversioned.editorVersion;
    const sourceContent = structuredClone(source); sourceContent.id = id; delete sourceContent.source;
    expect(JSON.stringify(unversioned, null, 2) + '\n').toBe(JSON.stringify(sourceContent, null, 2) + '\n');
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

type SaveBody = { level: NextLevel; warnings: unknown[]; changed: boolean };
async function saved(id: string, level: unknown): Promise<SaveBody> {
  const response = await save(id, level);
  expect(response.status, await response.clone().text()).toBe(200);
  return await response.json() as SaveBody;
}
async function snapshot(id: string) {
  const path = join(dir, `data/levels/${id}.json`);
  // A known old mtime makes accidental rewrites observable without sleeps.
  await utimes(path, new Date(1000000), new Date(1000000));
  return { bytes: await disk(id), mtime: (await stat(path)).mtimeMs };
}
async function expectUntouched(id: string, before: { bytes: string; mtime: number }) {
  expect(await disk(id)).toBe(before.bytes);
  expect((await stat(join(dir, `data/levels/${id}.json`))).mtimeMs).toBe(before.mtime);
}

it('stamps first saves and increments only real edits, ignoring even malformed client versions', async () => {
  const first = await saved('na-version', { ...original, editorVersion: { forged: true } });
  expect(first).toMatchObject({ changed: true, level: { editorVersion: '0.0.1' }, warnings: [] });
  const next = await saved('na-version', { ...first.level, name: 'Edited', editorVersion: '999.999.999' });
  expect(next).toMatchObject({ changed: true, level: { name: 'Edited', editorVersion: '0.0.2' } });
});

it('leaves identical and canonical net-zero saves untouched and returns the disk document', async () => {
  const first = await saved('na-no-op', original);
  const before = await snapshot('na-no-op');
  expect(await saved('na-no-op', first.level)).toMatchObject({ changed: false, level: first.level });
  await expectUntouched('na-no-op', before);
  const candidate = structuredClone(first.level);
  candidate.editorVersion = '999.999.999'; candidate.requires = [];
  candidate.buildings[0]!.pos.x += 0.001;
  const body = await saved('na-no-op', Object.fromEntries(Object.entries(candidate).reverse()));
  expect(body).toMatchObject({ changed: false, level: first.level });
  await expectUntouched('na-no-op', before);
});

it('keeps unchanged legacy files unversioned and starts at 0.0.1 on their first edit', async () => {
  const first = await saved('na-legacy', original);
  delete first.level.editorVersion;
  await writeFile(join(dir, 'data/levels/na-legacy.json'), JSON.stringify(first.level));
  const before = await snapshot('na-legacy');
  const unchanged = await saved('na-legacy', { ...first.level, editorVersion: 'invalid' });
  expect(unchanged.changed).toBe(false); expect(unchanged.level).not.toHaveProperty('editorVersion');
  await expectUntouched('na-legacy', before);
  expect(await saved('na-legacy', { ...first.level, name: 'Legacy edit' })).toMatchObject({ changed: true, level: { editorVersion: '0.0.1' } });
});

it('increments the disk patch component while preserving major and minor', async () => {
  const first = await saved('na-patch', original);
  first.level.editorVersion = '2.3.99999999999999999999';
  await writeFile(join(dir, 'data/levels/na-patch.json'), JSON.stringify(first.level));
  expect(await saved('na-patch', { ...first.level, name: 'Patch edit' })).toMatchObject({ changed: true, level: { editorVersion: '2.3.100000000000000000000' } });
});

it('repairs a missing campaign entry without rewriting or versioning the level', async () => {
  const first = await saved('na-repair', original);
  const custom = JSON.parse(await campaign()) as { entries: { level: string; position: number }[] };
  custom.entries = custom.entries.filter(entry => entry.level !== 'na-repair');
  await writeFile(join(dir, 'data/campaigns/custom.json'), JSON.stringify(custom));
  const before = await snapshot('na-repair');
  expect(await saved('na-repair', first.level)).toMatchObject({ changed: false, level: first.level });
  await expectUntouched('na-repair', before);
  expect(JSON.parse(await campaign()).entries.filter((entry: { level: string }) => entry.level === 'na-repair')).toHaveLength(1);
});

it('assigns monotonic non-skipping versions to parallel real saves of one level', async () => {
  const first = await saved('na-version-race', original);
  const results = await Promise.all(['First edit', 'Second edit', 'Third edit'].map(name => saved('na-version-race', { ...first.level, name })));
  // Concurrent HTTP requests may reach the server in a different order than they were started.
  expect(results.map(result => result.level.editorVersion).sort()).toEqual(['0.0.2', '0.0.3', '0.0.4']);
  expect(results.map(result => result.changed)).toEqual([true, true, true]);
  expect(JSON.parse(await disk('na-version-race'))).toEqual(results.find(result => result.level.editorVersion === '0.0.4')!.level);
});

it.each([{ repair: false, file: 'level' }, { repair: true, file: 'level' }, { repair: false, file: 'campaign' }, { repair: true, file: 'campaign' }])('detects external $file writes during unchanged saves (campaign repair: $repair)', async ({ repair, file }) => {
  const id = repair ? 'na-repair-race' : 'na-noop-race';
  const first = await saved(id, original);
  const goodCampaign = await campaign();
  if (repair) {
    const custom = JSON.parse(goodCampaign) as { entries: { level: string }[] };
    custom.entries = custom.entries.filter(entry => entry.level !== id);
    await writeFile(join(dir, 'data/campaigns/custom.json'), JSON.stringify(custom));
  }
  const path = file === 'level' ? join(dir, `data/levels/${id}.json`) : join(dir, 'data/campaigns/custom.json');
  const external = file === 'level' ? JSON.stringify({ ...first.level, name: 'External writer' }) : goodCampaign + '\n';
  race.run = async () => { await writeFile(path, external); };
  const response = await save(id, first.level);
  expect(response.status).toBe(409);
  expect(await readFile(path, 'utf8')).toBe(external);
  await writeFile(join(dir, 'data/campaigns/custom.json'), goodCampaign);
});

it('a changed:false response clears dirty when an undo snapshot carries an older server version', async () => {
  const id = 'na-client-baseline';
  const initial = await save(id, original, true);
  expect(initial.status).toBe(200);
  const first = await initial.json() as { level: NextLevel };
  const changed = await save(id, { ...first.level, name: 'Saved baseline' });
  expect(changed.status).toBe(200);
  const second = await changed.json() as { level: NextLevel };
  const undoSnapshot = { ...second.level, editorVersion: '0.0.1' };
  const response = await save(id, undoSnapshot);
  expect(response.status).toBe(200);
  const result = await response.json() as { level: NextLevel; changed: boolean };
  expect(result.changed).toBe(false);
  expect(result.level.editorVersion).toBe('0.0.2');
  expect(isDirty(undoSnapshot, result.level)).toBe(false);
  expect(isDirty({ ...undoSnapshot, name: 'Edit during request' }, result.level)).toBe(true);
});
