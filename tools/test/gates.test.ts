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
test('repo content passes with a JSON report (check:manifest is parked until SP07 ships a v2 manifest)', () => {
  const result = run('validate:content', '--base', process.env.VERSION_GUARD_BASE || 'HEAD');
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.ok, true);
  assert.equal(result.report.command, 'validate:content');
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
test('malformed content and invalid baseline emit JSON diagnostics and exit one', async t => {
  const dir = await fixture(t); await writeFile(join(dir, 'data/units/soldier.json'), '{');
  let result = run('validate:content', '--dir', dir);
  assert.equal(result.status, 1); assert.equal(result.report.errors[0].file, 'data/units/soldier.json');
  result = run('validate:content', '--base', 'invalid-ref-no-such');
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /baseline/i);
});
test('default human output reports a failed gate and rejects unknown options', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', 'validate:content', '--bad-option'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stdout, /FAIL/); assert.match(result.stdout, /Unknown option/);
});
test('regenerated sim lock still requires a contentVersion increase over explicit baseline', async t => {
  // Hermetic: fixture is the committed HEAD content, so it matches the --base HEAD baseline regardless of working-tree state.
  const dir = await mkdtemp(join(tmpdir(), 'arena-tools-head-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = spawnSync('git', ['archive', 'HEAD', 'packages/content', '--format=tar'], { cwd: root, maxBuffer: 1 << 28 });
  assert.equal(archive.status, 0, String(archive.stderr));
  const untar = spawnSync('tar', ['-x', '-C', dir, '--strip-components=2'], { input: archive.stdout });
  assert.equal(untar.status, 0, String(untar.stderr));
  const path = join(dir, 'data/units/soldier.json');
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
  const metadata = JSON.parse(await readFile(path, 'utf8')); metadata.rulesVersion = '1.0.0';
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
