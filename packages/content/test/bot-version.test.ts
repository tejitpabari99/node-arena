import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkBotVersion, readBotVersion, botVersionFromSource } from '../scripts/bot-version.js';

test('changed bot hashes require a strictly increasing semver even after locks regenerate', () => {
  assert.throws(() => checkBotVersion({ a: 'new' }, { a: 'old' }, '1.0.0', '1.0.0'), /BOT_VERSION.*increase/);
  assert.throws(() => checkBotVersion({ a: 'new' }, { a: 'old' }, '0.9.9', '1.0.0'), /decrease/);
  assert.doesNotThrow(() => checkBotVersion({ a: 'new' }, { a: 'old' }, '1.0.1', '1.0.0'));
  assert.doesNotThrow(() => checkBotVersion({ a: 'new' }, { a: 'old' }, '1.0.0', undefined));
  assert.doesNotThrow(() => checkBotVersion({ a: 'same' }, { a: 'same' }, '1.0.0', '1.0.0'));
  assert.throws(() => checkBotVersion({}, {}, '1.0.0', '1.0.1'), /decrease/);
  assert.throws(() => checkBotVersion({}, {}, '1.0.01', undefined), /semver/);
});
test('Node adapter reads literal current and committed versions without executing source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-version-'));
  const path = join(dir, 'packages/bots/src/version.ts');
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, "export const BOT_VERSION = '1.0.0';\n");
    execFileSync('git', ['init', '-q', dir]); execFileSync('git', ['-C', dir, 'add', '.']);
    execFileSync('git', ['-C', dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
    writeFileSync(path, "export const BOT_VERSION = '1.0.1';\n");
    assert.equal(readBotVersion(dir), '1.0.1'); assert.equal(readBotVersion(dir, 'HEAD'), '1.0.0');
    assert.throws(() => botVersionFromSource("export const BOT_VERSION = process.env.VERSION;"), /literal/);
    assert.throws(() => botVersionFromSource("throw new Error('executed'); export const BOT_VERSION = '1.0.0';"), /literal/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
