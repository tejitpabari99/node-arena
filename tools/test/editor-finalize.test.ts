import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { generateHashes, loadContent, type NextLevel, type SeatBot } from '@node-arena/content';
import { loadFiles } from '../src/files.js';
import { readBotVersion } from '../../packages/content/scripts/bot-version.js';
const exec = promisify(execFile), root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

test('Finalize versions use actual AI identity map, preserve pre-bumps, and are byte-idempotent vs HEAD', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'na-finalize-versions-'));
  const content = resolve(dir, 'packages/content'), version = resolve(dir, 'packages/bots/src/version.ts');
  const run = (step: string) => exec(process.execPath, ['--import', require.resolve('tsx'), resolve(root, 'tools/src/editor-finalize-worker.ts'), step, 'na-fixture'], { cwd: dir });
  try {
    await cp(resolve(root, 'packages/content/data'), resolve(content, 'data'), { recursive: true });
    await cp(resolve(root, 'packages/content/content.json'), resolve(content, 'content.json'));
    await cp(resolve(root, 'packages/content/hashes.lock.json'), resolve(content, 'hashes.lock.json'));
    await mkdir(resolve(dir, 'packages/bots/src'), { recursive: true });
    await cp(resolve(root, 'packages/bots/src/version.ts'), version);
    await exec('git', ['init', '-q'], { cwd: dir });
    await exec('git', ['add', 'packages'], { cwd: dir });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture baseline'], { cwd: dir });
    const before = readBotVersion(dir)!;
    const levelPath = resolve(content, 'data/levels/levelview-1.json');
    const originalLevel = await readFile(levelPath, 'utf8');
    const level = JSON.parse(originalLevel) as NextLevel;
    const data = async () => { const { 'content.json': _meta, ...files } = await loadFiles(content); return files; };
    const old = generateHashes(loadContent(await data()));
    const bot = level.players.find(player => player.bot)?.bot as SeatBot;
    bot.actionDelayMs = (bot.actionDelayMs ?? 1000) + 100;
    await writeFile(levelPath, JSON.stringify(level));
    const next = generateHashes(loadContent(await data()));
    assert.deepEqual(Object.keys(next.bots), Object.keys(old.bots), 'seat count unchanged');
    assert.notDeepEqual(next.bots, old.bots, 'resolved identity changed');
    await run('BOT_VERSION');
    assert.notEqual(readBotVersion(dir), before, 'same-seat identity changes require bump');
    const bumped = await readFile(version, 'utf8');
    await run('BOT_VERSION'); assert.equal(await readFile(version, 'utf8'), bumped);
    // An owner-provided higher version is retained, not bumped again.
    const higher = bumped.replace(readBotVersion(dir)!, '99.0.0');
    await writeFile(version, higher); await run('BOT_VERSION'); assert.equal(await readFile(version, 'utf8'), higher);
    // Geometry does not change AI identities before its content envelope is versioned.
    const moved = JSON.parse(originalLevel) as NextLevel; moved.buildings[0]!.pos.x += .01;
    await writeFile(levelPath, JSON.stringify(moved));
    await cp(resolve(root, 'packages/bots/src/version.ts'), version);
    await run('BOT_VERSION'); assert.equal(readBotVersion(dir), before);
    const oldMetadata = await readFile(resolve(content, 'content.json'), 'utf8');
    await run('contentVersion'); const metadata = await readFile(resolve(content, 'content.json'), 'utf8');
    assert.notEqual(JSON.parse(metadata).contentVersion, JSON.parse(oldMetadata).contentVersion);
    await run('contentVersion'); assert.equal(await readFile(resolve(content, 'content.json'), 'utf8'), metadata);
    // Every bot replay embeds contentVersion: even geometry-only edits need a guarded envelope refresh.
    await run('BOT_VERSION'); assert.notEqual(readBotVersion(dir), before);
    const envelopeVersion = await readFile(version, 'utf8');
    await run('BOT_VERSION'); assert.equal(await readFile(version, 'utf8'), envelopeVersion);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
