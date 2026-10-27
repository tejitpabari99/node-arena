import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { ContentLoadError, type NextLevel } from '@node-arena/content';
import { prepareEditorProxy } from '../src/editor-solvable.js';
import { saveEditorLevel } from '../src/editor-ops.js';

const root = resolve(import.meta.dirname, '../..'), exec = promisify(execFile);
const require = createRequire(import.meta.url);

async function fixture(run: (content: string, level: NextLevel, dir: string) => Promise<void>) {
  const dir = await mkdtemp(resolve(tmpdir(), 'na-player-houses-'));
  const content = resolve(dir, 'packages/content');
  try {
    await cp(resolve(root, 'packages/content/data'), resolve(content, 'data'), { recursive: true });
    await cp(resolve(root, 'packages/content/content.json'), resolve(content, 'content.json'));
    await mkdir(resolve(dir, 'tools'));
    await cp(resolve(root, 'tools/unsolved-by-proxy.json'), resolve(dir, 'tools/unsolved-by-proxy.json'));
    const level = JSON.parse(await readFile(resolve(content, 'data/levels/levelview-1.json'), 'utf8')) as NextLevel;
    level.id = 'na-houses';
    await run(content, level, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('Check reports every player without a starting house, excluding neutral houses and owned towers', async () => {
  await fixture(async (content, level) => {
    level.players.push({ ...structuredClone(level.players[1]!), id: 'extra-ai', colorKey: 'yellow' });
    for (const building of level.buildings) building.owner = null;
    level.buildings.find(building => building.archetype === 'tower')!.owner = 'p2';
    await assert.rejects(prepareEditorProxy(content, level.id, level), error => {
      assert.ok(error instanceof ContentLoadError);
      assert.deepEqual(error.errors, [
        { file: 'data/levels/na-houses.json', pointer: '/players/0', message: 'Human has no starting house' },
        { file: 'data/levels/na-houses.json', pointer: '/players/1', message: 'AI1 has no starting house' },
        { file: 'data/levels/na-houses.json', pointer: '/players/2', message: 'AI2 has no starting house' },
      ]);
      return true;
    });
  });
});

test('Check accepts owned houses regardless of archetype name and rejects a house without drawsLines', async () => {
  await fixture(async (content, level) => {
    const file = resolve(content, 'data/buildings/house-wt1.json');
    const archetype = JSON.parse(await readFile(file, 'utf8'));
    archetype.id = 'custom-house';
    await writeFile(resolve(content, 'data/buildings/custom-house.json'), JSON.stringify(archetype));
    level.buildings.forEach(building => { if (building.archetype === 'house-wt1') building.archetype = 'custom-house'; });
    assert.equal((await prepareEditorProxy(content, level.id, level)).level.id, 'na-houses');
    delete archetype.modules.drawsLines;
    await writeFile(resolve(content, 'data/buildings/custom-house.json'), JSON.stringify(archetype));
    await assert.rejects(prepareEditorProxy(content, level.id, level), error => {
      assert.ok(error instanceof ContentLoadError);
      assert.deepEqual(error.errors.map(issue => issue.message), ['Human has no starting house', 'AI1 has no starting house']);
      return true;
    });
  });
});

test('Save persists missing-house drafts while Finalize fails at validate with the player label', async () => {
  await fixture(async (content, level, dir) => {
    level.players.push({ ...structuredClone(level.players[1]!), id: 'p3', colorKey: 'yellow' });
    level.buildings.find(building => building.archetype === 'tower')!.owner = 'p3';
    const saved = await saveEditorLevel(content, level.id, level, true);
    assert.equal(saved.changed, true);
    assert.equal(JSON.parse(await readFile(resolve(content, 'data/levels/na-houses.json'), 'utf8')).id, 'na-houses');
    await assert.rejects(exec(process.execPath, ['--import', require.resolve('tsx'), resolve(root, 'tools/src/editor-finalize-worker.ts'), 'validate', level.id], { cwd: dir }), error => {
      assert.ok(error instanceof Error && 'stderr' in error);
      assert.match(String(error.stderr), /AI2 has no starting house/);
      return true;
    });
  });
});
