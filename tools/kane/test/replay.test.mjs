import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { runReplay, replayExitCode, validateRecording } from '../replay.mjs';
import { ensurePreviewServer } from '../lib/server.mjs';
import { runProcess } from '../lib/processes.mjs';

const body = 'Click the ready button. Verify active text is visible.';
const hash = createHash('md5').update(`${body}\n{"optional":false}`).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'na-replay-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'tools/kane/tests');
  await mkdir(directory, { recursive: true });
  const server = createServer((req, res) => res.end('fixture'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const file = join(directory, 'smoke_test.md');
  await writeFile(file, `---\nmode: testing\nurl: ${url}\nheadless: true\ntags: [smoke]\n---\n# Smoke\n## Route\n${body}\n`);
  const output = join(directory, 'output-smoke');
  await mkdir(join(output, '.internal/steps', `1-${hash.slice(0, 8)}`, 'flows/0'), { recursive: true });
  await writeFile(join(output, 'Result.md'), `---\nstatus: passed\n---\n# Smoke — Result\n## Route ✓ passed (1s)\nmd5: ${hash}\n${body}\n`);
  await writeFile(join(output, '.internal/meta.json'), '{}');
  await writeFile(join(output, '.internal/steps', `1-${hash.slice(0, 8)}`, 'flows/0/actions.ndjson'), '{"action_type":"click"}\n');
  let stderr = '';
  let stdout = '';
  const options = { root, env: { ...process.env, KANE_CLI_CHROME_PATH: process.execPath }, stdout: line => { stdout += line; }, stderr: line => { stderr += line; } };
  const fake = async source => {
    const binary = join(root, 'fake-kane.mjs');
    await writeFile(binary, `#!/usr/bin/env node\n${source}\n`);
    await chmod(binary, 0o755);
    options.kaneCommand = binary;
  };
  return { root, file, output, url, options, fake, stderr: () => stderr, stdout: () => stdout };
}

for (const [exit, terminal, expected] of [[0, 'passed', 0], [1, 'failed', 1], [2, null, 2], [3, null, 2], [0, null, 2], [0, 'failed', 1], [7, 'passed', 2]]) {
  test(`exit mapping Kane ${exit}, terminal ${terminal} -> ${expected}`, () => assert.equal(replayExitCode(exit, terminal && { overall_status: terminal }), expected));
}

test('copies recordings, uses exact replay flags/environment, waits for test_md_done, removes temp output', async t => {
  const f = await fixture(t);
  const record = join(f.root, 'record.json');
  await f.fake(`import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(record)}, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),chrome:process.env.KANE_CLI_CHROME_PATH,agent:process.env.KANE_CLI_USER_AGENT}));
writeFileSync('output-smoke/.internal/meta.json','changed');
console.log(JSON.stringify({type:'run_end',status:'failed',reason:'per-step only'}));
await new Promise(r=>setTimeout(r,50));
console.log(JSON.stringify({type:'test_md_done',overall_status:'passed'}));`);
  assert.equal(await runReplay(['--', f.file], f.options), 0, f.stderr());
  const info = JSON.parse(await readFile(record, 'utf8'));
  assert.deepEqual(info.args, ['testmd', 'run', join(info.cwd, 'smoke_test.md'), '--headless', '--agent', '--no-adaptive-heal', '--timeout', '120']);
  assert.equal(info.chrome, process.execPath);
  assert.equal(info.agent, process.env.KANE_CLI_USER_AGENT || 'codex');
  assert.equal(await readFile(join(f.output, '.internal/meta.json'), 'utf8'), '{}');
  await assert.rejects(access(info.cwd));
});

test('test failure includes test, terminal status, step reason, and session dir', async t => {
  const f = await fixture(t);
  await f.fake(`console.log(JSON.stringify({type:'run_end',status:'failed',reason:'action_failed',session_dir:'/tmp/kane-session'}));
console.log(JSON.stringify({type:'test_md_done',overall_status:'broken'}));process.exitCode=1;`);
  assert.equal(await runReplay([], f.options), 1);
  assert.match(f.stderr(), /smoke_test.md.*broken.*action_failed.*\/tmp\/kane-session/);
});

test('missing terminal event, Kane infra exits, missing executable map infra', async t => {
  const f = await fixture(t);
  for (const exit of [0, 2, 3]) {
    await f.fake(`console.log(JSON.stringify({type:'run_end',status:'passed'}));process.exitCode=${exit};`);
    assert.equal(await runReplay([], f.options), 2);
  }
  f.options.kaneCommand = join(f.root, 'missing');
  assert.equal(await runReplay([], f.options), 2);
});

test('missing/stale/failed/empty recordings refuse to start Kane authoring', async t => {
  const f = await fixture(t);
  await validateRecording(f.file);
  await writeFile(f.file, (await readFile(f.file, 'utf8')).replace('ready button', 'green button'));
  await assert.rejects(validateRecording(f.file), /recording|cache/i);
  await writeFile(f.file, (await readFile(f.file, 'utf8')).replace('green button', 'ready button'));
  await writeFile(join(f.output, 'Result.md'), (await readFile(join(f.output, 'Result.md'), 'utf8')).replace('✓ passed', '✗ failed'));
  await assert.rejects(validateRecording(f.file), /recording|cache/i);
  await rm(f.output, { recursive: true });
  await f.fake(`throw new Error('MUST NOT RUN');`);
  assert.equal(await runReplay([], f.options), 2);
  assert.match(f.stderr(), /recording|cache/i);
});

test('server down exits 2 without invoking Kane', async t => {
  const f = await fixture(t);
  const source = await readFile(f.file, 'utf8');
  await writeFile(f.file, source.replace(f.url, 'http://127.0.0.1:1/'));
  await f.fake(`throw new Error('MUST NOT RUN');`);
  assert.equal(await runReplay([], f.options), 2);
  assert.match(f.stderr(), /server.*unavailable|server.*down/i);
});

test('preexisting preview is retained and external server spawning refused', async t => {
  const f = await fixture(t);
  const cleanup = await ensurePreviewServer({ url: f.url, serve: true, cwd: f.root });
  await cleanup();
  assert.equal((await fetch(f.url)).status, 200);
  await assert.rejects(ensurePreviewServer({ url: 'http://example.com:4173', serve: true }), /loopback/i);
});

test('owned preview uses custom port and strictPort; cleanup stops process group', async t => {
  const f = await fixture(t);
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  let launched;
  const cleanup = await ensurePreviewServer({ url: `http://127.0.0.1:${port}/`, serve: true, cwd: f.root, spawnImpl: (command, args, options) => {
    assert.equal(command, 'pnpm');
    assert.deepEqual(args, ['--filter', '@node-arena/web', 'preview:test', '--port', String(port), '--strictPort']);
    launched = spawn(process.execPath, ['--input-type=module', '-e', `import {createServer} from 'node:http';createServer((q,r)=>r.end('ok')).listen(${port},'127.0.0.1')`], options);
    return launched;
  } });
  await cleanup();
  assert.notEqual(launched.exitCode ?? launched.signalCode, null);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
});

test('abort kills Kane descendants ignoring SIGTERM and removes temp copies', async t => {
  const f = await fixture(t);
  const record = join(f.root, 'child.json');
  await f.fake(`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
process.on('SIGTERM',()=>{});
const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync(${JSON.stringify(record)},JSON.stringify({pid:process.pid,descendant:child.pid,cwd:process.cwd()}));setInterval(()=>{},1000);`);
  const controller = new AbortController();
  const pending = runReplay([], { ...f.options, signal: controller.signal });
  for (let i = 0; i < 100; i++) { try { await access(record); break; } catch { await delay(20); } }
  const info = JSON.parse(await readFile(record, 'utf8'));
  controller.abort();
  assert.equal(await pending, 2);
  await assert.rejects(access(info.cwd));
  assert.throws(() => process.kill(info.pid, 0), { code: 'ESRCH' });
  // Linux may briefly retain an orphan zombie; it cannot execute or hold ports.
  try { const stat = await readFile(`/proc/${info.descendant}/stat`, 'utf8'); assert.equal(stat.split(' ')[2], 'Z'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
});

test('runProcess cleans a surviving descendant after leader exits', async t => {
  const f = await fixture(t);
  const result = await runProcess(process.execPath, ['-e', 'const {spawn}=require("node:child_process");spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});console.log("finished");process.exit(0);'], { cwd: f.root, timeoutMs: 3000 });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /finished/);
});

test('normal assurance heading/metadata and flat step YAML retain matching cached hash', async t => {
  const f = await fixture(t);
  const source = await readFile(f.file, 'utf8');
  const config = { global_context: 'Use DOM text only', optional: false, timeout: 120 };
  const nextHash = createHash('md5').update(body).update('\n').update(JSON.stringify(config)).digest('hex');
  await writeFile(f.file, source.replace('tags: [smoke]', 'tags: [smoke]\nassurance:\n  id: smoke\n  base: sha256:abc').replace('## Route\n', '## Route @verifies ac-smoke\n```yaml\ntimeout: 120\nglobal_context: "Use DOM text only"\n```\n'));
  await writeFile(join(f.output, 'Result.md'), (await readFile(join(f.output, 'Result.md'), 'utf8')).replace(hash, nextHash));
  const flows = join(f.output, '.internal/steps', `1-${nextHash.slice(0, 8)}`, 'flows/0');
  await mkdir(flows, { recursive: true });
  await writeFile(join(flows, 'actions.ndjson'), '{"action_type":"click"}\n');
  await validateRecording(f.file);
});

test('empty action cache is infra before Kane, flags and variables fail closed', async t => {
  const f = await fixture(t);
  await writeFile(join(f.output, '.internal/steps', `1-${hash.slice(0, 8)}`, 'flows/0/actions.ndjson'), '');
  await assert.rejects(validateRecording(f.file), /empty recorded actions/);
  assert.equal(await runReplay(['--verify-cdp'], f.options), 2);
  const source = await readFile(f.file, 'utf8');
  await writeFile(f.file, source.replace('mode: testing', 'mode: testing\nvariables:\n  button: ready'));
  await assert.rejects(validateRecording(f.file), /frontmatter/);
});

test('preview startup errors and aborts clean owned child', async t => {
  const f = await fixture(t);
  for (const abort of [false, true]) {
    const controller = new AbortController();
    let child;
    const pending = ensurePreviewServer({ url: 'http://127.0.0.1:1', serve: true, cwd: f.root, startupTimeoutMs: 250, signal: controller.signal, spawnImpl: (command, args, options) => {
      child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options);
      if (abort) setTimeout(() => controller.abort(), 30);
      return child;
    } });
    await assert.rejects(pending);
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  }
});

test('CLI SIGINT and SIGTERM exit infra and remove child groups/temp directories', async t => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const f = await fixture(t);
    const record = join(f.root, 'cli.json');
    await f.fake(`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(record)},JSON.stringify({pid:process.pid,cwd:process.cwd()}));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
    await writeFile(join(f.root, 'kane-cli'), await readFile(f.options.kaneCommand));
    await chmod(join(f.root, 'kane-cli'), 0o755);
    const child = spawn(process.execPath, [new URL('../replay.mjs', import.meta.url).pathname, '--', f.file], { env: { ...f.options.env, PATH: `${f.root}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    for (let i = 0; i < 150; i++) { try { await access(record); break; } catch { await delay(20); } }
    const info = JSON.parse(await readFile(record, 'utf8'));
    child.kill(signal);
    assert.deepEqual(await completed, { code: 2, signal: null });
    assert.match(stderr, new RegExp(signal));
    await assert.rejects(access(info.cwd));
    assert.throws(() => process.kill(info.pid, 0), { code: 'ESRCH' });
  }
});
