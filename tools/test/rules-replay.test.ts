import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compileLevel, loadContent } from '@node-arena/content';
import { createReplayRecorder } from '../../packages/sim/src/index.js';
import { loadFiles } from '../src/files.js';

const root = resolve(import.meta.dirname, '../..');
function run(command: string, ...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', command, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, report: args.includes('json') ? JSON.parse(result.stdout) : undefined };
}
async function directory(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), 'arena-rules-replay-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function rulesFixture(t: { after(fn: () => Promise<void>): void }, rules: string, source: string) {
  const dir = await directory(t); const packages = join(dir, 'packages');
  await mkdir(join(packages, 'fixture/test'), { recursive: true });
  const rulesFile = join(dir, 'GAME_RULES.md'); await writeFile(rulesFile, rules);
  await writeFile(join(packages, 'fixture/test/rules.test.ts'), source);
  return ['--rules', rulesFile, '--packages-dir', packages];
}

test('check:rules passes the repository with JSON and Markdown reports', () => {
  const result = run('check:rules', '--format', 'json');
  assert.equal(result.status, 0, result.stdout); assert.equal(result.report.ok, true);
  assert.match(result.report.summary, /28/);
  const markdown = run('check:rules'); assert.equal(markdown.status, 0, markdown.stdout); assert.match(markdown.stdout, /# check:rules: PASS/);
});
test('check:rules fails untested headings and unknown title tags', async t => {
  const args = await rulesFixture(t, '### R-GEN-01\nActive.\n### R-LIN-02\nActive.', "test('covers R-GEN-01, covers R-BOGUS-99', () => {});");
  const result = run('check:rules', ...args, '--format', 'json');
  assert.equal(result.status, 1); assert.equal(result.report.ok, false);
  assert.ok(result.report.errors.some((e: {message: string}) => /R-LIN-02.*untested/.test(e.message)));
  assert.ok(result.report.errors.some((e: {message: string}) => /R-BOGUS-99.*unknown/.test(e.message)));
});
test('rule coverage ignores body references, code fences, tombstones and helper/comment tags', async t => {
  const args = await rulesFixture(t, '### R-GEN-01\nReferences R-LIN-99.\n### R-OLD-01 — Tombstone\nRemoved.\n## Example referring to R-FAKE-02\n```md\n### R-FAKE-01\n```', "// test('covers R-GEN-01', () => {});\nconst helper = 'covers R-GEN-01';\ntest('unrelated', () => { const s = 'covers R-GEN-01'; });\ntest.skip('covers R-GEN-01', () => {});\ntest('covers R-GEN-01', {skip:true}, () => {});");
  let result = run('check:rules', ...args, '--format', 'json');
  assert.equal(result.status, 1); assert.equal(result.report.errors.length, 1); assert.match(result.report.errors[0].message, /R-GEN-01.*untested/);
  const packages = args[3]!;
  await writeFile(join(packages, 'fixture/test/rules.test.ts'), "it(`covers R-GEN-01: ${'variant'}`, () => {}); test('covers R-OLD-01', () => {});");
  result = run('check:rules', ...args, '--format', 'json'); assert.equal(result.status, 0, result.stdout);
});
test('disabled suite ancestry cannot satisfy rule coverage while matching active suites do', async t => {
  const { checkRules } = await import('../src/rules.js');
  const forms = [
    ["describe.skip('outer', () => BODY)", "describe('outer', () => BODY)"],
    ["describe('outer', {skip:true}, () => BODY)", "describe('outer', {skip:false}, () => BODY)"],
    ["describe('outer', {todo:true}, () => BODY)", "describe('outer', {todo:false}, () => BODY)"],
    ["describe.skip('outer', () => describe('inner', {skip:false}, () => BODY))", "describe('outer', () => describe('inner', {skip:false}, () => BODY))"],
    ["test.describe.skip('outer', () => BODY)", "test.describe('outer', () => BODY)"],
    ["test.describe.fixme('outer', () => BODY)", "test.describe.parallel('outer', () => BODY)"],
    ["describe.skip.each([1])('outer', () => BODY)", "describe.each([1])('outer', () => BODY)"],
  ];
  const args = await rulesFixture(t, '### R-GEN-01\nActive.', '');
  const file = join(args[3]!, 'fixture/test/rules.test.ts');
  for (const [disabled, active] of forms) {
    const body = "{ test('covers R-GEN-01', () => {}); throw new Error('Fixture source must never execute'); }";
    await writeFile(file, disabled!.replace('BODY', body));
    const failed = await checkRules(args[1]!, args[3]!);
    assert.equal(failed.errors.length, 1, disabled);
    assert.match(failed.errors[0]!.message, /R-GEN-01.*untested/);
    await writeFile(file, active!.replace('BODY', body));
    assert.deepEqual((await checkRules(args[1]!, args[3]!)).errors, [], active);
  }
});
test('disabled suite pruning preserves active siblings and their unknown rule diagnostics', async t => {
  const { checkRules } = await import('../src/rules.js');
  const args = await rulesFixture(t, '### R-GEN-01\nActive.', `
    describe.skip('disabled', () => test('covers R-BOGUS-99', () => {}));
    describe('active', () => {
      describe.skip('nested disabled', () => test('covers R-OTHER-99', () => {}));
      describe('nested active', {skip:false}, () => test('covers R-GEN-01', () => {}));
      test('covers R-UNKNOWN-99', () => {});
    });`);
  const result = await checkRules(args[1]!, args[3]!);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]!.message, /R-UNKNOWN-99.*unknown/);
});
test('coverage traversal skips build/dependencies and refuses test symlinks', async t => {
  const args = await rulesFixture(t, '### R-GEN-01\nActive.', "test('covers R-GEN-01', () => {});");
  const packages = args[3]!;
  await mkdir(join(packages, 'fixture/dist'), {recursive: true});
  await writeFile(join(packages, 'fixture/dist/unknown.test.js'), "test('covers R-NOPE-01', () => {});");
  assert.equal(run('check:rules', ...args, '--format', 'json').status, 0);
  await symlink(join(packages, 'fixture/test/rules.test.ts'), join(packages, 'fixture/test/link.test.ts'));
  const result = run('check:rules', ...args, '--format', 'json'); assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /symlink/i);
});
test('replay:verify golden scans all eleven sim and three bot recordings', () => {
  const result = run('replay:verify', 'golden', '--format', 'json');
  assert.equal(result.status, 0, result.stdout); assert.match(result.report.summary, /14 replays verified of 14/);
});
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
  for (const patch of [{simHash: '0'.repeat(64)}, {rulesVersion: '2.0.0'}, {contentVersion: '9.0.0'}, {levelId: 'unknown'}]) {
    await writeFile(file, JSON.stringify({...replay, header: {...replay.header, ...patch}}));
    const result = run('replay:verify', file, '--format', 'json'); assert.equal(result.status, 1); assert.equal(result.report.ok, false);
  }
  await writeFile(file, '{'); assert.equal(run('replay:verify', file, '--format', 'json').status, 1);
  const empty = await directory(t); assert.equal(run('replay:verify', empty, '--format', 'json').status, 1);
});
test('golden bundles use authoritative versions and recompute embedded compiled identities', async t => {
  const dir = await directory(t); const file = join(dir, 'baseline.json');
  const original = JSON.parse(await readFile(join(root, 'packages/sim/test/golden/baseline.json'), 'utf8'));
  const bundle = structuredClone(original); bundle.metadata.contentVersion = '9.0.0';
  await writeFile(file, JSON.stringify(bundle)); assert.equal(run('replay:verify', file, '--format', 'json').status, 1);
  bundle.metadata = original.metadata; bundle.scenarios[0].level.towers[0].garrison += 1;
  await writeFile(file, JSON.stringify(bundle)); const result = run('replay:verify', file, '--format', 'json');
  assert.equal(result.status, 1); assert.match(result.report.errors[0].message, /compiled.*hash/i);
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
