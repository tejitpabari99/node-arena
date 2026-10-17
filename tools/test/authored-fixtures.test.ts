import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { generateHashes, loadContent } from '@node-arena/content';
import { loadFiles } from '../src/files.js';
import type { GateReport } from '../src/output.js';

const root = resolve(import.meta.dirname, '../..');
const patchBump = (version: string) => { const [a, b, c] = version.split('.').map(Number); return `${a}.${b}.${c! + 1}`; };
async function fixture(t: TestContext, kind: 'win' | 'lose' | 'idle-win') {
  const dir = await mkdtemp(join(tmpdir(), 'arena-authored-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = await loadFiles(join(root, 'packages/content'));
  const corpus = JSON.parse(await readFile(join(root, 'tools/test/fixtures/levels/corpus.json'), 'utf8'));
  const scenario = corpus.scenarios[kind];
  corpus.level.timeLimitSec = scenario.timeLimitSec;
  corpus.level.towers[1].pos.x = scenario.targetX;
  for (const name of Object.keys(files)) if (name.startsWith('data/levels/')) delete files[name]; // isolate from shipped campaign levels
  files['data/levels/gate-fixture.json'] = JSON.stringify(corpus.level);
  files['data/archetypes/gate-source.json'] = JSON.stringify(corpus.source);
  files['data/archetypes/gate-target.json'] = JSON.stringify(corpus.target);
  const metadata = JSON.parse(files['content.json'] as string);
  metadata.contentVersion = patchBump(metadata.contentVersion); // Fixture simulation differs from committed HEAD.
  files['content.json'] = JSON.stringify(metadata);
  for (const [name, data] of Object.entries(files)) {
    const path = join(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof data === 'string' ? data : JSON.stringify(data));
  }
  await writeFile(join(dir, 'hashes.lock.json'), JSON.stringify(generateHashes(loadContent(files))));
  if (scenario.allTowersHuman) {
    corpus.level.towers[1].owner = 'p1';
    await writeFile(join(dir, 'data/levels/gate-fixture.json'), JSON.stringify(corpus.level));
  }
  return dir;
}
function cli(command: string, dir: string) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', command,
    '--dir', dir, '--format', 'json', ...(command === 'validate:levels' ? ['--levels', 'gate-fixture', '--seeds', '4'] : [])],
  { cwd: root, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout) as GateReport;
  assert.equal(report.command, command);
  return { status: result.status, report, stdout: result.stdout };
}

// Catches a CLI that bypasses matches, drops per-level failures, or loses JSON on exit 1.
test('authored winning and unwinnable corpora reach the CLI match gate with fresh locks', async t => {
  for (const [kind, wins, status] of [['win', 4, 0], ['lose', 0, 1]] as const) {
    const result = cli('validate:levels', await fixture(t, kind));
    assert.equal(result.status, status, result.stdout);
    assert.equal(result.report.ok, status === 0);
    assert.equal(result.report.levels?.length, 1);
    const level = result.report.levels![0]!;
    assert.equal(level.id, 'gate-fixture');
    assert.equal(level.referenceWins, wins);
    assert.equal(level.idleWins, 0);
    assert.equal(level.deterministic, true);
    assert.equal(level.reference.length, 4);
    assert.equal(level.idle.length, 4);
    assert.ok([...level.reference, ...level.idle].every(run => run.rejected === 0));
    if (status === 1) assert.ok(result.report.errors.some(error =>
      error.file === 'data/levels/gate-fixture.json' && /Reference/.test(error.message)));
    else assert.deepEqual(result.report.errors, []);
  }
});

// The authored boundary must reject this before any compiled-ownership runtime test.
test('authored automatic idle win is rejected with the missing bot ownership location', async t => {
  const result = cli('validate:levels', await fixture(t, 'idle-win'));
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.levels, undefined);
  assert.ok(result.report.errors.some(error => error.file === 'data/levels/gate-fixture.json' &&
    error.pointer === '/players/1/id' && /own a tower/.test(error.message)));
});

// Catches tools failing to expose SP01's skill-only inheritance validation.
test('CLI rejects a complete personality copied into an inherited tier before checking locks', async t => {
  const dir = await fixture(t, 'win');
  assert.equal(cli('validate:content', dir).status, 0);
  const name = 'data/bots/fixture-invalid-tier.json';
  await writeFile(join(dir, name), await readFile(join(root, 'tools/test/fixtures/profiles/invalid-tier.json')));
  const result = cli('validate:content', dir);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.ok, false);
  assert.ok(result.report.errors.some(error => error.file === name && error.pointer.startsWith('/params')));
  assert.ok(result.report.errors.every(error => error.file !== 'hashes.lock.json'));
});
