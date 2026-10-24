import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, chmod, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'na-hook-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['tools/kane/hooks', 'apps/web/src', 'bin', 'tmp']) await mkdir(join(root, dir), { recursive: true });
  await copyFile(new URL('../kane-verify.sh', import.meta.url), join(root, 'tools/kane/hooks/kane-verify.sh'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q'); git('config', 'user.email', 'fixture@example.com'); git('config', 'user.name', 'Fixture');
  await writeFile(join(root, '.gitignore'), 'bin/\ntmp/\napps/web/dist-test/\ncalls\nfire.log\n');
  await writeFile(join(root, 'apps/web/src/Overlay.tsx'), 'ready\n');
  await writeFile(join(root, 'tools/kane/replay.mjs'), '');
  git('add', '.'); git('commit', '-qm', 'fixture');
  const command = async (name, source) => {
    const file = join(root, 'bin', name);
    await writeFile(file, `#!/bin/bash\n${source}\n`); await chmod(file, 0o755);
  };
  await command('kane-cli', 'echo unexpected-kane-call >> "$TEST_CALLS"; exit 99');
  await command('pnpm', 'echo "build $*" >> "$TEST_CALLS"; for n in {1..40}; do echo "build-line-$n"; done; exit "${TEST_BUILD_RC:-0}"');
  await command('node', `if [[ "$1" == tools/kane/replay.mjs ]]; then
  echo "replay $* timeout=$KANE_TIMEOUT agent=$KANE_CLI_USER_AGENT" >> "$TEST_CALLS"
  echo 'smoke_test.md: status=broken reason=action_failed session_dir=/tmp/kane-session' >&2
  exit "\u0024{TEST_REPLAY_RC:-0}"
fi
exec ${JSON.stringify(process.execPath)} "$@"`);
  const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, TMPDIR: join(root, 'tmp'), TEST_CALLS: join(root, 'calls'), KANE_HOOK_NOBUILD: '1' };
  for (const key of ['KANE_WATCH', 'KANE_HOOK_FORCE', 'KANE_HOOK_LOG', 'KANE_TIMEOUT']) delete env[key];
  const run = (extra = {}, input = '{"stop_hook_active":false}', cwd = root) => spawnSync('/bin/bash', [join(root, 'tools/kane/hooks/kane-verify.sh')], { cwd, env: { ...env, ...extra }, input, encoding: 'utf8', timeout: 10000 });
  const calls = async () => { try { return await readFile(join(root, 'calls'), 'utf8'); } catch { return ''; } };
  const change = text => writeFile(join(root, 'apps/web/src/Overlay.tsx'), text);
  return { root, git, run, calls, change };
}

test('loop guard returns immediately even forced; optional fire log records invocation', async t => {
  const f = await fixture(t);
  const started = performance.now();
  const result = f.run({ KANE_HOOK_FORCE: '1', KANE_HOOK_LOG: join(f.root, 'fire.log') }, '{"stop_hook_active":true}');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(performance.now() - started < 1000);
  assert.equal(await f.calls(), '');
  assert.match(await readFile(join(f.root, 'fire.log'), 'utf8'), /hook fired/);
});

test('clean watched tree skips replay; force bypasses clean and passed cache', async t => {
  const f = await fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(await f.calls(), '');
  assert.equal(f.run({ KANE_HOOK_FORCE: '1' }).status, 0);
  assert.equal(f.run({ KANE_HOOK_FORCE: '1' }).status, 0);
  assert.equal((await f.calls()).split('\n').filter(Boolean).length, 2);
});

for (const mode of ['unstaged', 'staged', 'untracked']) test(`${mode} changes replay once; changed content invalidates last passed cache`, async t => {
  const f = await fixture(t);
  const file = join(f.root, mode === 'untracked' ? 'apps/web/src/new file.tsx' : 'apps/web/src/Overlay.tsx');
  await writeFile(file, 'first');
  if (mode === 'staged') f.git('add', 'apps/web');
  assert.equal(f.run().status, 0);
  const first = await f.calls(); assert.match(first, /replay/);
  assert.equal(f.run().status, 0); assert.equal(await f.calls(), first);
  await writeFile(file, 'other'); // same byte length: metadata-only hashes must not pass
  if (mode === 'staged') f.git('add', 'apps/web');
  assert.equal(f.run().status, 0); assert.notEqual(await f.calls(), first);
});

test('failure exits 2 with diagnostics and evidence hint; failed state never cached', async t => {
  const f = await fixture(t); await f.change('go');
  for (let i = 0; i < 2; i++) {
    const result = f.run({ TEST_REPLAY_RC: '1' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /smoke_test.md.*status=broken.*reason=action_failed.*session_dir=/);
    assert.match(result.stderr, /kane-cli evidence serve <session_dir>\/evidence\/\*\.evidence/);
  }
  assert.equal((await f.calls()).split('\n').filter(Boolean).length, 2);
});

for (const reason of ['preview unavailable', 'unauthenticated']) test(`infra ${reason} skips without caching`, async t => {
  const f = await fixture(t); await f.change('go');
  assert.equal(f.run({ TEST_REPLAY_RC: '2' }).status, 0);
  assert.match(f.run({ TEST_REPLAY_RC: '2' }).stderr, /skipped/);
  assert.equal((await f.calls()).split('\n').filter(Boolean).length, 2);
});

test('watch override works from nested cwd; timeout/user agent pass through', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'watched.txt'), 'changed');
  assert.equal(f.run().status, 0); assert.equal(await f.calls(), '');
  assert.equal(f.run({ KANE_WATCH: 'watched.txt', KANE_TIMEOUT: '240' }, undefined, join(f.root, 'apps/web')).status, 0);
  assert.match(await f.calls(), /timeout=240 agent=codex/);
});

test('missing dependency skips; loop guard still succeeds with missing jq', async t => {
  const f = await fixture(t);
  const minimal = join(f.root, 'minimal'); await mkdir(minimal);
  for (const name of ['cat', 'dirname', 'date']) await copyFile(`/usr/bin/${name}`, join(minimal, name));
  const result = f.run({ PATH: minimal, KANE_HOOK_FORCE: '1' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /missing.*jq.*skipped/);
  assert.equal(f.run({ PATH: minimal }, '{"stop_hook_active":true}').status, 0);
  assert.equal(await f.calls(), '');
});

test('every uncached verification builds even a fresh bundle; NOBUILD skips build; default timeout120', async t => {
  const f = await fixture(t); await f.change('go');
  const env = { KANE_HOOK_NOBUILD: '0', KANE_HOOK_FORCE: '1' };
  assert.equal(f.run(env).status, 0);
  await mkdir(join(f.root, 'apps/web/dist-test'));
  const index = join(f.root, 'apps/web/dist-test/index.html');
  await writeFile(index, 'bundle'); await utimes(index, 1, 1);
  assert.equal(f.run(env).status, 0);
  const fresh = new Date(Date.now() + 2000); await utimes(index, fresh, fresh);
  assert.equal(f.run(env).status, 0);
  assert.equal(f.run({ ...env, KANE_HOOK_NOBUILD: '1' }).status, 0);
  const calls = await f.calls();
  assert.equal(calls.split('\n').filter(line => line.startsWith('build ')).length, 3);
  assert.match(calls, /timeout=120/);
});

test('build error exits2 with last30 lines and no replay', async t => {
  const f = await fixture(t); await f.change('go');
  const result = f.run({ KANE_HOOK_NOBUILD: '0', TEST_BUILD_RC: '1' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /build-line-11/); assert.match(result.stderr, /build-line-40/);
  assert.doesNotMatch(result.stderr, /build-line-10\b/);
  assert.doesNotMatch(await f.calls(), /replay/);
});


for (const change of ['source deletion', 'index.html', 'vite.config.ts']) test(`${change} rebuilds a fresh bundle before replay and caches only a passing verification`, async t => {
  const f = await fixture(t);
  const pairs = join(f.root, 'apps/web/src/pairs.ts');
  const html = join(f.root, 'apps/web/index.html');
  const config = join(f.root, 'apps/web/vite.config.ts');
  await writeFile(pairs, 'export const label = "ready";');
  await f.change('import {label} from "./pairs"; console.log(label);');
  await writeFile(html, '<main>original</main>');
  await writeFile(config, 'export default {};');
  f.git('add', 'apps/web'); f.git('commit', '-qm', 'build inputs');
  await mkdir(join(f.root, 'apps/web/dist-test'));
  const bundle = join(f.root, 'apps/web/dist-test/index.html');
  await writeFile(bundle, 'previous successful build');
  const fresh = new Date(Date.now() + 2000); await utimes(bundle, fresh, fresh);
  if (change === 'source deletion') await rm(pairs);
  else await writeFile(change === 'index.html' ? html : config, 'broken build input');
  const result = f.run({ KANE_HOOK_NOBUILD: '0', TEST_BUILD_RC: '1' });
  assert.equal(result.status, 2, result.stderr);
  assert.match(await f.calls(), /build --filter @node-arena\/web build:test/);
  assert.doesNotMatch(await f.calls(), /replay/);
  // A build failure cannot cache a pass against the obsolete preview bundle.
  assert.equal(f.run({ KANE_HOOK_NOBUILD: '0' }).status, 0);
  const calls = await f.calls();
  assert.equal(calls.split('\n').filter(line => line.startsWith('build ')).length, 2);
  assert.equal(f.run({ KANE_HOOK_NOBUILD: '0' }).status, 0);
  assert.equal(await f.calls(), calls);
});
