const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pkg = path.resolve(__dirname, '..');
const golden = () => import('../scripts/golden.mjs');

test('bots:golden check verifies the committed goldens against a fresh run', () => {
  const result = spawnSync('node', ['scripts/golden.mjs'], { cwd: pkg, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Verified 3 bot match goldens/);
});

test('covers R6: committed goldens cover pos 4, 6, 11 with commands and a final hash', () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(pkg, 'test/golden/bots.json'), 'utf8'));
  assert.deepEqual(bundle.scenarios.map(s => s.position), [4, 6, 11]);
  for (const r of bundle.results) {
    assert.ok(r.commandCount > 0 && r.commandCount === r.replay.commands.length);
    assert.match(r.finalHash, /^[0-9a-f]+$/);
    assert.equal(r.finalHash, r.replay.finalHash);
  }
  assert.match(bundle.botVersion, /^\d+\.\d+\.\d+$/);
});

test('covers R6: assertUpdate requires a strictly increased BOT_VERSION (semver, not string)', async () => {
  const { assertUpdate } = await golden();
  assert.doesNotThrow(() => assertUpdate(undefined, '2.0.0'));
  assert.throws(() => assertUpdate('2.0.0', '2.0.0'), /must increase/);
  assert.throws(() => assertUpdate('2.1.0', '2.0.9'), /must increase/);
  assert.throws(() => assertUpdate('2.0.0', 'abc'), /semver/);
  assert.doesNotThrow(() => assertUpdate('2.0.0', '2.0.1'));
  assert.doesNotThrow(() => assertUpdate('2.9.0', '2.10.0'));
});

test('covers R6: updateFile rejects an update without a BOT_VERSION bump and leaves the file untouched', async () => {
  const { updateFile } = await golden();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bots-golden-'));
  const file = path.join(dir, 'bots.json');
  try {
    fs.writeFileSync(file, '{"botVersion":"2.0.0"}\n');
    await assert.rejects(updateFile(file, { botVersion: '2.0.0', results: [] }, ['2.0.0']), /must increase/);
    await assert.rejects(updateFile(file, { botVersion: '2.0.1', results: [] }, ['2.0.1', '2.0.0']), /must increase/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"botVersion":"2.0.0"}\n');
    await updateFile(file, { botVersion: '2.0.1', results: [] }, ['2.0.0', undefined]);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).botVersion, '2.0.1');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('covers R6: CLI --update without a BOT_VERSION bump is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bots-golden-'));
  const file = path.join(dir, 'bots.json');
  try {
    const current = JSON.parse(fs.readFileSync(path.join(pkg, 'test/golden/bots.json'), 'utf8'));
    fs.writeFileSync(file, JSON.stringify(current));
    const result = spawnSync('node', ['scripts/golden.mjs', '--update', '--file', file], { cwd: pkg, encoding: 'utf8', env: { ...process.env, VERSION_GUARD_BASE: '' } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /BOT_VERSION must increase/);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).botVersion, current.botVersion);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
