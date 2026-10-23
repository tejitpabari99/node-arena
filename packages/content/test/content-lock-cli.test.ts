import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { hashFixture } from './hash-fixture.js';
const script = fileURLToPath(new URL('../scripts/content-lock.ts', import.meta.url));
const cli = (dir: string, ...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', script, '--dir', join(dir, 'packages/content'), '--rules', join(dir, 'docs/GAME_RULES.md'), ...args], { encoding: 'utf8' });
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'content-lock-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs/GAME_RULES.md'), 'RULES_VERSION: 3.0.0\n');
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
    const files = hashFixture();
    files['content.json'].contentVersion = '2.0.0';
    writeFixture(dir, files);
    let result = cli(dir); assert.equal(result.status, 0, result.stderr);
    const lock = JSON.parse(readFileSync(join(dir, 'packages/content/hashes.lock.json'), 'utf8'));
    assert.match(lock.levels['levelview-1'], /^[a-f0-9]{64}$/); assert.match(Object.keys(lock.bots)[0]!, /^levelview-1#/); assert.match(Object.values(lock.bots)[0] as string, /^[a-f0-9]{64}$/);
    baseline(dir);
    result = cli(dir, '--check', '--base', 'HEAD'); assert.equal(result.status, 0, result.stderr);
    files['data/units/soldier.json'].speed = 7; writeFixture(dir, files);
    result = cli(dir, '--check', '--base', 'HEAD'); assert.notEqual(result.status, 0); assert.match(result.stderr, /stale/);
    result = cli(dir); assert.equal(result.status, 0, result.stderr);
    result = cli(dir, '--check', '--base', 'HEAD'); assert.notEqual(result.status, 0); assert.match(result.stderr, /contentVersion/);
    files['content.json'].contentVersion = '2.0.1'; writeFixture(dir, files);
    result = cli(dir, '--check', '--base', 'HEAD'); assert.equal(result.status, 0, result.stderr);
    result = cli(dir, '--check', '--base', 'missing-ref'); assert.notEqual(result.status, 0);
    writeFileSync(join(dir, 'docs/GAME_RULES.md'), 'RULES_VERSION: 1.0.0\n');
    result = cli(dir, '--check', '--base', 'HEAD'); assert.notEqual(result.status, 0); assert.match(result.stderr, /RULES_VERSION/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing content.json is refused and a baseline without a dataset cannot be erased', () => {
  const dir = workspace();
  try {
    baseline(dir);
    let result = cli(dir); assert.notEqual(result.status, 0); assert.match(result.stderr, /content.json/);
    writeFixture(dir);
    result = cli(dir); assert.equal(result.status, 0, result.stderr);
    result = cli(dir, '--check', '--base', 'HEAD'); assert.equal(result.status, 0, result.stderr);
    baseline(dir);
    rmSync(join(dir, 'packages/content/content.json'));
    result = cli(dir, '--check', '--base', 'HEAD'); assert.notEqual(result.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI refuses regenerated bot hashes without a committed BOT_VERSION bump', () => {
  const dir = workspace();
  try {
    const source = join(dir, 'packages/bots/src/version.ts');
    mkdirSync(join(source, '..'), { recursive: true });
    writeFileSync(source, "export const BOT_VERSION = '1.0.0';\n");
    const files = hashFixture(); writeFixture(dir, files);
    assert.equal(cli(dir).status, 0); baseline(dir);
    const seat = files['data/levels/levelview-1.json'].players.find((p: any) => p.bot); seat.bot.behavior = seat.bot.behavior === 'full' ? 'attackOnly' : 'full';
    writeFixture(dir, files); assert.equal(cli(dir).status, 0);
    let result = cli(dir, '--check', '--base', 'HEAD');
    assert.notEqual(result.status, 0); assert.match(result.stderr, /BOT_VERSION.*increase/);
    writeFileSync(source, "export const BOT_VERSION = '1.0.1';\n");
    result = cli(dir, '--check', '--base', 'HEAD'); assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readBaseline passes --end-of-options before every caller-supplied revision', () => {
  const source = readFileSync(script, 'utf8');
  const calls = source.split('\n').filter((l) => /\bgit\('(rev-parse|ls-tree|show)'/.test(l) && /\bref\b/.test(l));
  assert.equal(calls.length, 5);
  for (const line of calls) assert.match(line, /'--end-of-options'/, line);
});
test('a dash-leading base revision is rejected, never parsed as a git option', () => {
  const dir = workspace();
  try {
    writeFixture(dir); cli(dir); baseline(dir);
    const result = cli(dir, '--check', '--base', '-q');
    assert.notEqual(result.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
