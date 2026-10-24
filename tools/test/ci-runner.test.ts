import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');

// Keep the CI runner and extract-dependent CLIs real. Replace expensive build/test
// subprocesses at the pnpm boundary so failure propagation needs no full CI run.
function runCi(overrides: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-runner-'));
  try {
    const log = join(dir, 'calls');
    const pnpm = join(dir, 'pnpm');
    writeFileSync(pnpm, `#!/usr/bin/env bash
set -eu
printf '%s|base=%s\\n' "$*" "\${VERSION_GUARD_BASE-unset}" >> "$TEST_CALLS"
if [[ "$1" == "\${TEST_FAIL_GATE:-}" ]]; then exit 37; fi
if [[ -n "\${TW_EXTRACT:-}" && "$1" != "\${TEST_EXTRACT_GATE:-}" ]]; then exit 0; fi
case "$1" in
  check:import) exec "$TEST_NODE" --import tsx "$TEST_REPO/tools/src/cli.ts" check:import ;;
  assets:tw:check) exec "$TEST_NODE" --import tsx "$TEST_REPO/tools/src/assets-tw/cli.ts" --check ;;
esac
`);
    chmodSync(pnpm, 0o755);
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env['PATH']}`, TEST_CALLS: log, TEST_NODE: process.execPath, TEST_REPO: root, CONTENT_BASE: 'HEAD', ...overrides };
    delete env['TW_EXTRACT'];
    delete env['VERSION_GUARD_BASE'];
    Object.assign(env, overrides);
    const result = spawnSync('bash', ['scripts/ci.sh'], { cwd: root, env, encoding: 'utf8' });
    return { ...result, calls: readFileSync(log, 'utf8') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('CI without the source extract runs both optional checks and surfaces two skip notices', () => {
  const r = runCi({ CI_RELEASE: '0' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /::notice::check:import skipped \(TW_EXTRACT unset\)/);
  assert.match(r.stdout, /::notice::assets:tw:check skipped \(TW_EXTRACT unset\)/);
  assert.match(r.calls, /^check:import\|/m);
  assert.match(r.calls, /^assets:tw:check\|/m);
  assert.match(r.calls, /^check:manifest\|/m);
});

for (const gate of ['check:import', 'assets:tw:check']) {
  test(`CI propagates a real ${gate} failure when an extract path is supplied`, () => {
    const r = runCi({ TW_EXTRACT: root, TEST_EXTRACT_GATE: gate });
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.calls, new RegExp(`^${gate}\\|`, 'm'));
    assert.match(r.stderr, /ENOENT|not found|does not exist/);
    assert.doesNotMatch(r.stdout, new RegExp(`::notice::${gate} skipped`));
    assert.doesNotMatch(r.calls, /^validate:levels /m);
  });
}

test('CI propagates a failing committed-manifest gate even without an extract', () => {
  const r = runCi({ TEST_FAIL_GATE: 'check:manifest' });
  assert.equal(r.status, 37, r.stdout + r.stderr);
  assert.doesNotMatch(r.calls, /^check:import\|/m);
});

test('release CI clears the branch version override and enforces strict parked closure', () => {
  const r = runCi({ CI_RELEASE: '1', VERSION_GUARD_BASE: 'HEAD' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.calls, /^sim:golden\|base=unset$/m);
  assert.match(r.calls, /^bots:golden\|base=unset$/m);
  assert.match(r.calls, /^check:content --base HEAD\|base=unset$/m);
  assert.match(r.calls, /^check:parked --strict\|base=unset$/m);
});
