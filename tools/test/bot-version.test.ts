import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateHashes, loadContent } from '@node-arena/content';
import { dataOnly, hashFixture } from '../../packages/content/test/hash-fixture.js';
import { checkLock } from '../src/content.js';

test('validate-content adapter catches regenerated bot locks and locates the required BOT_VERSION bump', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tools-bot-version-'));
  const dir = join(root, 'packages/content'); const source = join(root, 'packages/bots/src/version.ts');
  try {
    await mkdir(dir, { recursive: true }); await mkdir(join(root, 'docs')); await mkdir(join(source, '..'), { recursive: true });
    await writeFile(join(root, 'docs/GAME_RULES.md'), 'RULES_VERSION: 2.0.0\n');
    await writeFile(source, "export const BOT_VERSION = '1.0.0';\n");
    const files = hashFixture();
    await writeFile(join(dir, 'content.json'), JSON.stringify(files['content.json']));
    await writeFile(join(dir, 'hashes.lock.json'), JSON.stringify(generateHashes(loadContent(dataOnly(files)))));
    execFileSync('git', ['init', '-q', root]); execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline']);
    const seat = files['data/levels/levelview-1.json'].players.find((p: { bot?: unknown }) => p.bot); seat.bot.behavior = seat.bot.behavior === 'full' ? 'attackOnly' : 'full';
    await writeFile(join(dir, 'hashes.lock.json'), JSON.stringify(generateHashes(loadContent(dataOnly(files)))));
    await assert.rejects(checkLock(files, dir, root, 'HEAD'), error => {
      assert.match((error as Error).message, /BOT_VERSION.*increase/);
      assert.equal((error as { file: string }).file, 'packages/bots/src/version.ts'); return true;
    });
    await writeFile(source, "export const BOT_VERSION = '1.0.1';\n");
    assert.match(await checkLock(files, dir, root, 'HEAD'), /BOT_VERSION gates agree/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
