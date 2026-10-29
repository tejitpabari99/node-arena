import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test, type TestContext } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const launcher = resolve(root, 'scripts/dev-pvp.mjs');

function fixture(t: TestContext) {
  const dir = mkdtempSync(resolve(tmpdir(), 'pvp launcher '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = resolve(dir, 'package manager.cjs');
  writeFileSync(cli, `console.log(JSON.stringify({ args: process.argv.slice(2), port: process.env.PORT, origins: process.env.ALLOWED_ORIGINS, custom: process.env.PVP_TEST_CUSTOM })); process.exit(Number(process.env.PVP_TEST_EXIT || 0));`);
  const run = (overrides: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [launcher], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PORT: '', ALLOWED_ORIGINS: '', npm_execpath: cli, ...overrides },
    timeout: 10_000,
  });
  return { cli, run };
}

test('dev:pvp is a shell-independent Node command usable by Windows cmd', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['dev:pvp'], 'node scripts/dev-pvp.mjs');
});

test('dev:pvp starts both workspace dev servers with local defaults', t => {
  const { run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    args: ['--parallel', '--filter', '@node-arena/web', '--filter', '@node-arena/server', 'dev'],
    port: '8080',
    origins: 'http://localhost:5173,http://127.0.0.1:5173',
  });
});

test('dev:pvp preserves caller configuration and literal shell metacharacters', t => {
  const { run } = fixture(t);
  const result = run({ PORT: '9090', ALLOWED_ORIGINS: 'https://example.test', PVP_TEST_CUSTOM: 'space & $(literal)' });
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.port, '9090');
  assert.equal(actual.origins, 'https://example.test');
  assert.equal(actual.custom, 'space & $(literal)');
});

test('dev:pvp also defaults unset server configuration', t => {
  const result = fixture(t).run({ PORT: undefined, ALLOWED_ORIGINS: undefined });
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.port, '8080');
  assert.equal(actual.origins, 'http://localhost:5173,http://127.0.0.1:5173');
});

test('dev:pvp returns the package manager failure status', t => {
  assert.equal(fixture(t).run({ PVP_TEST_EXIT: '23' }).status, 23);
});

test('dev:pvp gives an actionable error outside a package manager script', t => {
  const result = fixture(t).run({ npm_execpath: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pnpm dev:pvp/);
});

test('dev:pvp reports package manager launch failure', t => {
  const result = fixture(t).run({ npm_execpath: resolve(tmpdir(), 'missing-pvp-manager.exe') });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
});

test('dev:pvp returns a failure status when its child exits on a signal', { skip: process.platform === 'win32' }, t => {
  const { cli, run } = fixture(t);
  writeFileSync(cli, `process.kill(process.pid, 'SIGTERM');`);
  assert.equal(run().status, 143);
});

test('dev:pvp forwards termination and waits for its child to stop', { skip: process.platform === 'win32', timeout: 10_000 }, async t => {
  const { cli } = fixture(t);
  writeFileSync(cli, `process.on('SIGTERM', () => { console.log('stopped'); process.exit(0); }); console.log('ready'); setInterval(() => {}, 1000);`);
  const child = spawn(process.execPath, [launcher], {
    cwd: root, env: { ...process.env, npm_execpath: cli }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGKILL'));
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  await once(child.stdout, 'data');
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  const [code] = await closed;
  assert.equal(code, 0);
  assert.match(output, /ready/);
  assert.match(output, /stopped/);
});

test('dev:pvp termination also stops package manager descendants', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const { cli } = fixture(t);
  writeFileSync(cli, `process.on('SIGTERM', () => process.exit(0)); require('node:child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM', () => { console.log('descendant-stopped'); process.exit(0); }); console.log('descendant-ready:' + process.pid); setInterval(() => {}, 1000);"], { stdio: 'inherit' });`);
  const child = spawn(process.execPath, [launcher], {
    cwd: root, env: { ...process.env, npm_execpath: cli }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let descendantPid: number | undefined;
  t.after(() => {
    child.kill('SIGKILL');
    if (descendantPid) {
      try { process.kill(descendantPid, 'SIGKILL'); } catch { /* Already stopped. */ }
    }
  });
  child.stdout.on('data', chunk => { output += chunk; });
  await once(child.stdout, 'data');
  descendantPid = Number(/descendant-ready:(\d+)/.exec(output)?.[1]);
  assert.ok(descendantPid);
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  await closed;
  assert.match(output, /descendant-stopped/);
});
