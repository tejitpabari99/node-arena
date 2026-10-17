import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
function run(command: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', command, '--format', 'json', ...args], { cwd: root, encoding: 'utf8' });
  let report;
  try { report = JSON.parse(result.stdout); } catch { report = { errors: [{ message: result.stderr }], ok: false }; }
  return { status: result.status, report, stdout: result.stdout };
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), 'arena-tools-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(join(root, 'packages/content'), dir, { recursive: true, filter: path => !/(node_modules|dist|test)/.test(path) });
  return dir;
}
test('repo content and manifest pass with JSON reports', () => {
  for (const command of ['validate:content', 'check:manifest']) {
    const result = run(command, '--base', 'HEAD');
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.report.ok, true);
    assert.equal(result.report.command, command);
  }
});
test('stale sim and bot locks fail without modifying files', async t => {
  for (const section of ['levels', 'bots']) {
    const dir = await fixture(t);
    const path = join(dir, 'hashes.lock.json');
    const lock = JSON.parse(await readFile(path, 'utf8'));
    lock[section][Object.keys(lock[section])[0]!] = '0'.repeat(64);
    const before = JSON.stringify(lock); await writeFile(path, before);
    const result = run('validate:content', '--dir', dir, '--base', 'HEAD');
    assert.equal(result.status, 1);
    assert.match(result.report.errors[0].message, /stale/);
    assert.equal(result.report.errors[0].file, 'hashes.lock.json');
    assert.equal(await readFile(path, 'utf8'), before);
  }
});
test('missing visual key fails with source and JSON pointer', async t => {
  const dir = await fixture(t);
  const path = join(dir, 'data/troops/regular.json');
  const troop = JSON.parse(await readFile(path, 'utf8')); troop.visual = 'missing.visual';
  await writeFile(path, JSON.stringify(troop));
  const result = run('check:manifest', '--dir', dir);
  assert.equal(result.status, 1);
  assert.ok(result.report.errors.some((e: {file: string; pointer: string}) => e.file === 'data/troops/regular.json' && e.pointer === '/visual'));
});
test('manifest file and credits validation runs the Node adapter', async t => {
  const dir = await fixture(t);
  // Primitive-only fixture: the shipped manifest references real GLBs that this temp assets dir lacks.
  const manifest = JSON.parse(await readFile(join(root, 'apps/web/test/fixtures/greybox-manifest.json'), 'utf8'));
  manifest.visuals['tower.standard'].sfx = 'missing.wav';
  const path = join(dir, 'manifest.json'); await writeFile(path, JSON.stringify(manifest));
  let result = run('check:manifest', '--manifest', path, '--assets-dir', dir);
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /Missing.*asset/);
  assert.equal(result.report.errors[0].file, path);
  await writeFile(join(dir, 'missing.wav'), 'sound');
  result = run('check:manifest', '--manifest', path, '--assets-dir', dir);
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /CREDITS/);
  await writeFile(join(dir, 'CREDITS.md'), 'missing.wav');
  result = run('check:manifest', '--manifest', path, '--assets-dir', dir, '--credits', join(dir, 'CREDITS.md'));
  assert.equal(result.status, 0, result.stdout);
});
test('check:manifest flags shipped audio/model files on disk that lack a CREDITS row', async t => {
  const dir = await fixture(t);
  const manifest = JSON.parse(await readFile(join(root, 'apps/web/test/fixtures/greybox-manifest.json'), 'utf8'));
  const path = join(dir, 'manifest.json'); await writeFile(path, JSON.stringify(manifest));
  await mkdir(join(dir, 'audio'), { recursive: true }); await writeFile(join(dir, 'audio/orphan.ogg'), 'sound');
  await writeFile(join(dir, 'CREDITS.md'), '| models/other.glb |');
  let result = run('check:manifest', '--manifest', path, '--assets-dir', dir, '--credits', join(dir, 'CREDITS.md'));
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /audio\/orphan\.ogg.*CREDITS/);
  await writeFile(join(dir, 'CREDITS.md'), '| audio/orphan.ogg |');
  result = run('check:manifest', '--manifest', path, '--assets-dir', dir, '--credits', join(dir, 'CREDITS.md'));
  assert.equal(result.status, 0, result.stdout);
});
test('shipped manifest passes check:manifest with its audio and docs/CREDITS.md', () => {
  const result = run('check:manifest');
  assert.equal(result.status, 0, result.stdout);
});
test('malformed content and invalid baseline emit JSON diagnostics and exit one', async t => {
  const dir = await fixture(t); await writeFile(join(dir, 'data/troops/regular.json'), '{');
  let result = run('validate:content', '--dir', dir);
  assert.equal(result.status, 1); assert.equal(result.report.errors[0].file, 'data/troops/regular.json');
  result = run('validate:content', '--base', 'invalid-ref-no-such');
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /baseline/i);
});
test('default human output reports a failed gate and rejects unknown options', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', 'validate:content', '--bad-option'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stdout, /FAIL/); assert.match(result.stdout, /Unknown option/);
});
test('regenerated sim lock still requires a contentVersion increase over explicit baseline', async t => {
  const dir = await fixture(t);
  const path = join(dir, 'data/troops/regular.json');
  const troop = JSON.parse(await readFile(path, 'utf8')); troop.speed += 1;
  await writeFile(path, JSON.stringify(troop));
  const regenerate = spawnSync(process.execPath, ['--import', 'tsx', 'packages/content/scripts/content-lock.ts', '--dir', dir], { cwd: root, encoding: 'utf8' });
  assert.equal(regenerate.status, 0, regenerate.stderr);
  let result = run('validate:content', '--dir', dir, '--base', 'HEAD');
  assert.equal(result.status, 1); assert.equal(result.report.errors[0].pointer, '/contentVersion');
  const metadataPath = join(dir, 'content.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')); metadata.contentVersion = metadata.contentVersion.replace(/(\d+)$/, (_m: string, n: string) => String(Number(n) + 1));
  await writeFile(metadataPath, JSON.stringify(metadata));
  result = run('validate:content', '--dir', dir, '--base', 'HEAD');
  assert.equal(result.status, 0, result.stdout);
});
test('rulesVersion mismatch fails with metadata location', async t => {
  const dir = await fixture(t); const path = join(dir, 'content.json');
  const metadata = JSON.parse(await readFile(path, 'utf8')); metadata.rulesVersion = '2.0.0';
  await writeFile(path, JSON.stringify(metadata));
  const result = run('validate:content', '--dir', dir);
  assert.equal(result.status, 1); assert.equal(result.report.errors[0].pointer, '/rulesVersion');
});
test('content symlinks cannot silently skip validation', async t => {
  const { symlink } = await import('node:fs/promises');
  const dir = await fixture(t); await symlink('/etc/passwd', join(dir, 'data/hidden.json'));
  const result = run('validate:content', '--dir', dir);
  assert.equal(result.status, 1); assert.equal(result.report.errors[0].file, 'data/hidden.json');
});
