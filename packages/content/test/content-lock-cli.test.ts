import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { hashFixture } from './hash-fixture.js';
import type { Content, Troop } from '../src/index.js';
const script = fileURLToPath(new URL('../scripts/content-lock.ts', import.meta.url));
const cli = (dir: string, ...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', script, '--dir', join(dir, 'packages/content'), '--rules', join(dir, 'docs/GAME_RULES.md'), ...args], { encoding: 'utf8' });
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'content-lock-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs/GAME_RULES.md'), 'RULES_VERSION: 1.0.0\n');
  mkdirSync(join(dir, 'packages/content'), { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}
function writeFixture(dir: string, files = hashFixture()) {
  for (const [path, value] of Object.entries(files)) {
    const location = join(dir, 'packages/content', path);
    mkdirSync(join(location, '..'), { recursive: true });
    writeFileSync(location, JSON.stringify(value));
  }
}
function baseline(dir: string) {
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
}

test('CLI writes lock, detects stale output and rejects regenerated unversioned changes against git baseline', () => {
  const dir = workspace();
  try {
    writeFixture(dir);
    let result = cli(dir); assert.equal(result.status, 0, result.stderr);
    const lock = JSON.parse(readFileSync(join(dir, 'packages/content/hashes.lock.json'), 'utf8'));
    assert.match(lock.levels.sample, /^[a-f0-9]{64}$/); assert.match(lock.bots.base, /^[a-f0-9]{64}$/);
    baseline(dir);
    result = cli(dir, '--check', '--base', 'HEAD'); assert.equal(result.status, 0, result.stderr);
    const files = hashFixture(); (files['data/troops/regular.json'] as Troop).speed = 12; writeFixture(dir, files);
    result = cli(dir, '--check', '--base', 'HEAD'); assert.notEqual(result.status, 0); assert.match(result.stderr, /stale/);
    result = cli(dir); assert.equal(result.status, 0, result.stderr);
    result = cli(dir, '--check', '--base', 'HEAD'); assert.notEqual(result.status, 0); assert.match(result.stderr, /contentVersion/);
    (files['content.json'] as Content).contentVersion = '1.0.1'; writeFixture(dir, files);
    result = cli(dir, '--check', '--base', 'HEAD'); assert.equal(result.status, 0, result.stderr);
    result = cli(dir, '--check', '--base', 'missing-ref'); assert.notEqual(result.status, 0);
    writeFileSync(join(dir, 'docs/GAME_RULES.md'), 'RULES_VERSION: 2.0.0\n');
    result = cli(dir, '--check', '--base', 'HEAD'); assert.notEqual(result.status, 0); assert.match(result.stderr, /RULES_VERSION/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('precontent baseline bootstraps a first dataset; absent dataset needs explicit bootstrap and cannot erase baseline', () => {
  const dir = workspace();
  try {
    baseline(dir);
    let result = cli(dir, '--allow-bootstrap'); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /No production dataset/);
    result = cli(dir); assert.notEqual(result.status, 0); assert.match(result.stderr, /content.json/);
    writeFixture(dir);
    result = cli(dir); assert.equal(result.status, 0, result.stderr);
    result = cli(dir, '--check', '--base', 'HEAD'); assert.equal(result.status, 0, result.stderr);
    baseline(dir);
    rmSync(join(dir, 'packages/content/content.json'));
    result = cli(dir, '--check', '--base', 'HEAD', '--allow-bootstrap'); assert.notEqual(result.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
