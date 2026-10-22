import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compileLevel, loadContent } from '@node-arena/content';
import { createReplayRecorder } from '../../../packages/sim/src/index.js';
import { loadFiles } from '../../src/files.js';

const root = resolve(import.meta.dirname, '../../..');
function run(command: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', command, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, report: args.includes('json') ? JSON.parse(result.stdout) : undefined };
}
async function directory(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), 'arena-rules-replay-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function replayFixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await directory(t);
  const files = await loadFiles(join(root, 'packages/content')); const loaded = loadContent(files);
  const level = compileLevel(loaded, 'sample');
  const metadata = JSON.parse(files['content.json'] as string);
  const recorder = createReplayRecorder(level, 1, metadata);
  for (let tick = 0; tick < 40; tick++) recorder.step([]);
  const replay = recorder.record(); const file = join(dir, 'sample.replay.json');
  await writeFile(file, JSON.stringify(replay)); return {dir, file, replay};
}
test('standalone file and recursive directory resolve levels from content without bots', async t => {
  const {dir, file} = await replayFixture(t);
  const one = run('replay:verify', file, '--format', 'json'); assert.equal(one.status, 0, one.stdout); assert.match(one.report.summary, /1 replay/);
  await mkdir(join(dir, 'nested')); await writeFile(join(dir, 'nested/README.md'), 'Not a replay.');
  const all = run('replay:verify', dir); assert.equal(all.status, 0, all.stdout); assert.match(all.stdout, /PASS/);
});
test('tampered checkpoints report the first divergence tick and final hashes report final tick', async t => {
  const {file, replay} = await replayFixture(t);
  replay.checkpoints[0]!.hash = '0'.repeat(16); replay.finalHash = '0'.repeat(16);
  await writeFile(file, JSON.stringify(replay));
  let result = run('replay:verify', file, '--format', 'json'); assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /first diverging tick: 20/);
  replay.checkpoints.splice(0, replay.checkpoints.length); // Restore real checkpoints from a fresh recording.
  const other = await replayFixture(t); replay.checkpoints = other.replay.checkpoints;
  await writeFile(file, JSON.stringify(replay));
  result = run('replay:verify', file); assert.equal(result.status, 1); assert.match(result.stdout, /first diverging tick: 40/);
});
test('header identity, unknown levels, malformed JSON and empty directories fail', async t => {
  const {file, replay} = await replayFixture(t);
  for (const patch of [{simHash: '0'.repeat(64)}, {rulesVersion: '3.0.0'}, {contentVersion: '9.0.0'}, {levelId: 'unknown'}]) {
    await writeFile(file, JSON.stringify({...replay, header: {...replay.header, ...patch}}));
    const result = run('replay:verify', file, '--format', 'json'); assert.equal(result.status, 1); assert.equal(result.report.ok, false);
  }
  await writeFile(file, '{'); assert.equal(run('replay:verify', file, '--format', 'json').status, 1);
  const empty = await directory(t); assert.equal(run('replay:verify', empty, '--format', 'json').status, 1);
});
test('directory traversal cannot silently skip malformed replay objects among good records', async t => {
  const {dir, replay} = await replayFixture(t);
  const {header: _header, ...broken} = replay;
  await writeFile(join(dir, 'broken.json'), JSON.stringify(broken));
  const result = run('replay:verify', dir, '--format', 'json');
  assert.equal(result.status, 1); assert.ok(result.report.errors.some((e: {file: string}) => e.file.endsWith('broken.json')));
});
test('auxiliary golden command-only logs coexist with recordings without running their commands', async t => {
  const {dir} = await replayFixture(t);
  await writeFile(join(dir, 'commands.json'), JSON.stringify({commands: [{tick: 0, cmd: {type: 'not-a-command'}}]}));
  const result = run('replay:verify', dir, '--format', 'json');
  assert.equal(result.status, 0, result.stdout); assert.match(result.report.summary, /1 replays verified of 1/);
});
