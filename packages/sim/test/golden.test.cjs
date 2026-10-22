const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Catches a missing command, missing/stale baseline, or Node hash drift.
test('sim:golden checks committed recorder-based golden replays', { skip: 'baseline re-authored by SP03 (parked)' }, () => {
  const result = spawnSync('pnpm', ['sim:golden'], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /golden replays verified/);
});

const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { assertVersionBump, gitBaseline, updateFile } = require('../scripts/golden.cjs');
// v1 baseline.json died at CUT; SP03 re-authors scenarios/baseline. The version-bump guard is tested on an inline fixture.
const baseline = {
  format: 1,
  metadata: { rulesVersion: '2.0.0', schemaVersion: '2.0.0', contentVersion: '2.0.0' },
  scenarios: [{ name: 'fixture', level: { buildings: [{ x: 0 }] } }],
  results: [{ name: 'fixture', replay: { finalHash: '0'.repeat(16) }, eventLogHash: 'a'.repeat(16) }],
};

// Deleting/weakening version checks, string-comparing semver, or checking only
// the working baseline must fail these tests. Metadata fixtures never edit content.
// Bumps are derived from the committed baseline so content version increases never break this test.
const patchBump = version => { const [a, b, c] = version.split('.').map(Number); return `${a}.${b}.${c + 1}`; };
test('golden updates require appropriate strictly increased versions, including identical output', () => {
  assert.throws(() => assertVersionBump(baseline, baseline), /increased authoritative version/);
  const changed = structuredClone(baseline);
  changed.results[0].eventLogHash = '0'.repeat(16);
  assert.throws(() => assertVersionBump(changed, baseline), /increased authoritative version/);
  changed.metadata.contentVersion = patchBump(baseline.metadata.contentVersion);
  assert.throws(() => assertVersionBump(changed, baseline), /rulesVersion/);
  changed.metadata.rulesVersion = patchBump(baseline.metadata.rulesVersion);
  assert.doesNotThrow(() => assertVersionBump(changed, baseline));
  const inputs = structuredClone(baseline);
  inputs.scenarios[0].level.buildings[0].x++;
  inputs.metadata.rulesVersion = patchBump(baseline.metadata.rulesVersion);
  assert.throws(() => assertVersionBump(inputs, baseline), /contentVersion or schemaVersion/);
  inputs.metadata.contentVersion = patchBump(baseline.metadata.contentVersion);
  assert.doesNotThrow(() => assertVersionBump(inputs, baseline));
  const bumped = structuredClone(baseline); bumped.metadata.contentVersion = '2.0.10';
  const old = structuredClone(baseline); old.metadata.contentVersion = '2.0.9';
  assert.doesNotThrow(() => assertVersionBump(bumped, old));
  bumped.metadata.rulesVersion = '0.9.9';
  assert.throws(() => assertVersionBump(bumped, old), /decrease/);
});

test('git baseline prevents deletion/bootstrap bypass, and refused writes preserve the file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-golden-guard-'));
  const run = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    run(['init']); run(['config', 'user.name', 'Golden Test']); run(['config', 'user.email', 'test@example.invalid']);
    fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
    run(['add', '.']); run(['commit', '-m', 'initial']);
    assert.equal(gitBaseline(root, 'HEAD', 'baseline.json'), null);
    const file = path.join(root, 'baseline.json');
    updateFile(file, baseline, [null, gitBaseline(root, 'HEAD', 'baseline.json')]);
    run(['add', '.']); run(['commit', '-m', 'baseline']);
    const committed = gitBaseline(root, 'HEAD', 'baseline.json');
    assert.deepEqual(committed, baseline);
    fs.unlinkSync(file);
    assert.throws(() => updateFile(file, baseline, [null, committed]), /increased authoritative version/);
    assert.equal(fs.existsSync(file), false);
    fs.writeFileSync(file, 'preserve me');
    assert.throws(() => updateFile(file, baseline, [committed]), /increased authoritative version/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'preserve me');
    const next = structuredClone(baseline); next.metadata.rulesVersion = '2.1.0';
    updateFile(file, next, [committed]);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), next);
    assert.throws(() => gitBaseline(root, 'no-such-ref', 'baseline.json'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('VERSION_GUARD_BASE must be a valid commit (option-like refs are rejected)', () => {
  for (const ref of ['--no-such-ref', 'no-such-branch-xyz']) {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/golden.cjs')], { encoding: 'utf8', env: { ...process.env, VERSION_GUARD_BASE: ref } });
    assert.notEqual(result.status, 0, ref);
    assert.match(result.stderr, /git rev-parse --verify[\s\S]*Needed a single revision/, ref);
    assert.doesNotMatch(result.stdout + result.stderr, /golden replays (verified|updated)/, ref);
  }
});
