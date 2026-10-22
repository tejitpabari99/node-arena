const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('golden comparison catches a command mutation and same-version updates refuse', async () => {
  const { buildBundle, verifyBundle, assertUpdate } = await import('../scripts/golden.mjs');
  const bundle = await buildBundle();
  assert.equal(bundle.scenarios.length, 3);
  assert.ok(bundle.results.every(row => row.commandlog.length > 0));
  assert.doesNotThrow(() => verifyBundle(bundle, bundle));
  const changed = structuredClone(bundle);
  changed.results[0].commandlog[0].cmd.to = 'mutated';
  assert.throws(() => verifyBundle(bundle, changed), /golden.*differ/i);
  assert.throws(() => assertUpdate(bundle.botVersion, bundle.botVersion), /increase/);
  const next = bundle.botVersion.split('.').map(Number); next[2]++;
  assert.doesNotThrow(() => assertUpdate(bundle.botVersion, next.join('.')));
  assert.doesNotThrow(() => assertUpdate(undefined, '1.0.0'));
  assert.throws(() => assertUpdate('1.0.1', '1.0.0'), /increase/);
  assert.throws(() => assertUpdate(undefined, '2.0.0'), /initial/);
  verifyBundle(JSON.parse(readFileSync(join(__dirname, 'golden/bots.json'), 'utf8')), bundle);
  const dir = mkdtempSync(join(tmpdir(), 'bots-golden-'));
  try {
    const file = join(dir, 'bundle.json'); writeFileSync(file, JSON.stringify(bundle));
    const result = spawnSync(process.execPath, [join(__dirname, '../scripts/golden.mjs'), '--update', '--file', file], { encoding: 'utf8', env: { ...process.env, VERSION_GUARD_BASE: '' } });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /increase/);
    writeFileSync(file, JSON.stringify(changed));
    const mutation = spawnSync(process.execPath, [join(__dirname, '../scripts/golden.mjs'), '--file', file], { encoding: 'utf8', env: { ...process.env, VERSION_GUARD_BASE: '' } });
    assert.notEqual(mutation.status, 0); assert.match(mutation.stderr, /golden.*differ/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
