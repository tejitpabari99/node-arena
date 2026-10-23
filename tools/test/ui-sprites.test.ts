import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', join(root, 'tools/assets/ui-sprites.mjs'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, TW_EXTRACT: '' } });
test('committed UI assets verify without private extract', () => {
  const r = run('--check');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /UI assets OK/);
});
test('check detects changed font, sprite, stale output and manifest drift without rewriting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-sprites-'));
  try {
    cpSync(join(root, 'apps/web/assets'), dir, { recursive: true });
    const lock = join(root, 'tools/assets/ui-sprites.lock.json');
    writeFileSync(join(dir, 'ui/back.png'), 'changed');
    writeFileSync(join(dir, 'fonts/Coiny-Regular.ttf'), 'changed');
    writeFileSync(join(dir, 'ui/stale.png'), 'stale');
    writeFileSync(join(dir, 'ui/manifest.json'), '{}\n');
    const r = run('--check', '--assets', dir, '--lock', lock);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /ui\/back.png/);
    assert.match(r.stderr, /fonts\/Coiny-Regular.ttf/);
    assert.match(r.stderr, /ui\/stale.png/);
    assert.match(r.stderr, /ui\/manifest.json/);
    assert.equal(readFileSync(join(dir, 'ui/back.png'), 'utf8'), 'changed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('shared merge preserves SP07 assets while restoring UI manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-merge-'));
  try {
    cpSync(join(root, 'apps/web/assets'), dir, { recursive: true });
    const world = readFileSync(join(dir, 'manifest.tw.json'), 'utf8');
    writeFileSync(join(dir, 'ui/manifest.json'), '{}\n');
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import {main} from './tools/src/assets-tw/merge-cli.ts'; process.exitCode=main([],process.argv[1]);`, dir], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(join(dir, 'manifest.tw.json'), 'utf8'), world);
    const ui = JSON.parse(readFileSync(join(dir, 'ui/manifest.json'), 'utf8'));
    assert.equal(ui.sprites.back.path, 'ui/back.png');
    assert.equal(ui.font.path, 'fonts/Coiny-Regular.ttf');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
