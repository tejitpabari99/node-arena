import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
