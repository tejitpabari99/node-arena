import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { runDriver, parseArgs } from '../drive.mjs';
import { kaneRunArgs } from '../lib/kane.mjs';
import { initial, mixed } from './fixtures.mjs';
import { runLaunchKane } from '../lib/fallback.mjs';
import { runKane } from '../lib/kane.mjs';
import { runProcess } from '../lib/processes.mjs';
import { resolveChromeBinary } from '../lib/chrome.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const opts = extra => ({ ...parseArgs([]), ...extra });
function harness(responses) {
  const events = []; let calls = 0, launches = 0, closed = 0;
  return { events, stats: () => ({ calls, launches, closed }), deps: {
    emit: (type, fields) => events.push({ type, ...fields }), readCredits: async () => 695,
    ensurePreviewServer: async () => async () => {},
    launchChrome: async () => ({ port: 9222, summary: async () => structuredClone(initial), prepare: async () => {}, close: async () => { closed++; } }),
    runKane: async () => responses[Math.min(calls++, responses.length - 1)],
    runLaunchKane: async (objective, options) => { launches++; assert.match(objective, /up to 8 moves/); assert.equal(options.maxSteps, 20); return { response: { code: 0, end: { status: 'passed' } }, before: structuredClone(initial), after: { ...structuredClone(mixed), result: 'won' }, port: 9223 }; },
  } };
}
const connection = { code: 0, end: { status: 'failed', reason: 'CDP endpoint ECONNREFUSED' }, stderr: '' };

test('launch args use URL, no CDP endpoint, twenty steps and headless protocol', () => {
  const args = kaneRunArgs('strategy', opts({ mode: 'launch', headless: true }));
  assert.equal(args.includes('--cdp-endpoint'), false); assert.equal(args.includes('--allow-missing-url'), false);
  assert.equal(args[args.indexOf('--url') + 1], opts().url); assert.equal(args[args.indexOf('--max-steps') + 1], '20');
  assert.ok(args.includes('--headless'));
});

test('false-status first connection failure falls back to Kane launch and grounded win', async () => {
  const h = harness([connection]); const result = await runDriver(opts(), h.deps);
  assert.equal(result.exitCode, 0); assert.equal(h.stats().launches, 1); assert.equal(h.stats().closed, 1);
  assert.equal(h.events.find(e => e.type === 'fallback').to, 'launch');
});

test('two later connection failures trigger fallback, first later failure retries attach', async () => {
  const h = harness([{ code: 0, end: { status: 'passed' } }, connection, connection]);
  assert.equal((await runDriver(opts({ stallRuns: 5 }), h.deps)).exitCode, 0);
  assert.equal(h.stats().calls, 3); assert.equal(h.stats().launches, 1);
});

test('no-fallback connection failure exits22 with zero launch calls', async () => {
  const h = harness([connection]); assert.equal((await runDriver(opts({ noFallback: true }), h.deps)).exitCode, 22);
  assert.equal(h.stats().launches, 0);
});

test('direct launch never opens independent Chrome and compares fresh per-run histories', async () => {
  const h = harness([]); h.deps.launchChrome = () => { throw new Error('independent launch forbidden'); };
  let runs = 0;
  h.deps.runLaunchKane = async () => ({ response: { code: 0, end: { status: 'passed' } }, before: structuredClone(initial), after: { ...structuredClone(mixed), result: ++runs === 2 ? 'won' : null }, port: 9223 });
  assert.equal((await runDriver(opts({ mode: 'launch' }), h.deps)).exitCode, 0);
  assert.deepEqual(h.events.filter(e => e.type === 'verify').map(e => e.acceptedCount), [2, 2]);
});

test('fallback CDP observer failure exits22 bounded', async () => {
  const h = harness([connection]); h.deps.runLaunchKane = async () => { throw Object.assign(new Error('CDP9223 not available'), { exitCode: 22 }); };
  assert.equal((await runDriver(opts(), h.deps)).exitCode, 22);
  assert.ok(h.events.some(e => e.type === 'fallback'));
});


async function portIsFree() {
  return new Promise(resolve => {
    const server = createServer(); server.once('error', () => resolve(false));
    server.listen(9223, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

test('wrapper preserves literal argv, strips conflicting debug flags, and binds private profile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kane-wrapper-test-'));
  try {
    const binary = join(dir, 'fake chrome'); const output = join(dir, 'args.json');
    await writeFile(binary, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.OUTPUT, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
    const literal = 'https://example.invalid/?value=$(touch /tmp/never-eval-kane)&x=two words';
    const result = await runProcess(resolve('tools/kane/chrome-wrapper.sh'), ['--remote-debugging-port=5555', '--user-data-dir', '/unowned', '--remote-debugging-pipe', literal], {
      env: { ...process.env, KANE_CHROME_REAL_BINARY: binary, KANE_CHROME_PROFILE: join(dir, 'private profile'), OUTPUT: output }, timeoutMs: 3000 });
    assert.equal(result.code, 0); const args = JSON.parse(await readFile(output, 'utf8'));
    assert.ok(args.includes(literal)); assert.equal(args.filter(a => a.startsWith('--remote-debugging-port')).length, 1);
    assert.ok(args.includes('--remote-debugging-port=9223')); assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
    assert.ok(args.includes(`--user-data-dir=${join(dir, 'private profile')}`)); assert.equal(args.includes('--remote-debugging-pipe'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('launch observer uses read-only attach, retains live snapshot after browser close, removes profile', async () => {
  let profile, closed = 0, reads = 0;
  const result = await runLaunchKane('objective', { ...opts({ mode: 'launch' }) }, {
    resolveChromeBinary: async () => '/fake/chrome',
    attachChrome: async options => { assert.equal(options.waitForReady, false); return {
      summary: async () => { reads++; return structuredClone(mixed); }, close: async () => { closed++; },
      prepare: () => { throw new Error('read-only observer must not prepare'); } }; },
    runKane: async (objective, options) => { profile = options.env.KANE_CHROME_PROFILE;
      assert.equal(options.env.KANE_CHROME_DEBUG_PORT, '9223'); assert.match(options.env.KANE_CLI_CHROME_PATH, /chrome-wrapper.sh$/);
      await delay(140); return { code: 0, end: { status: 'passed' } }; },
  });
  assert.ok(reads > 0); assert.equal(closed, 1); assert.equal(result.after.human.drawn, mixed.human.drawn);
  assert.equal(result.before.human.drawn, 0); await assert.rejects(readFile(profile));
});

test('busy fallback port fails before launching Kane and preserves unowned listener', async () => {
  const server = createServer(); await new Promise(resolve => server.listen(9223, '127.0.0.1', resolve));
  let runs = 0;
  try {
    await assert.rejects(runLaunchKane('objective', opts(), { runKane: async () => { runs++; } }), error => error.exitCode === 22);
    assert.equal(runs, 0); assert.equal(server.listening, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('observer startup failure and cancellation clean private profiles without paid runs', async () => {
  for (const aborting of [false, true]) {
    const abort = new AbortController(); let profile;
    await assert.rejects(runLaunchKane('objective', { ...opts(), signal: abort.signal }, {
      resolveChromeBinary: async () => '/fake/chrome', attachChrome: async () => { throw new Error('ECONNREFUSED'); },
      runKane: async (objective, options) => { profile = options.env.KANE_CHROME_PROFILE;
        if (aborting) { abort.abort(new Error('SIGTERM')); options.signal.throwIfAborted(); }
        return { code: 1, end: { reason: 'endpoint missing' } }; },
    }), error => aborting ? /SIGTERM/.test(error.message) : error.exitCode === 22);
    await assert.rejects(readFile(profile));
  }
});

test('fake Kane owns real Chrome wrapper; driver observes terminal summary while browser lives', { skip: !process.env.KANE_TEST_URL, timeout: 15000 }, async () => {
  const binary = await resolveChromeBinary({ preferPlaywright: true });
  const dir = await mkdtemp(join(tmpdir(), 'kane-fake-integration-')); let profile;
  const fake = join(dir, 'kane-cli');
  try {
    const endState = { ...structuredClone(mixed), result: 'won' };
    const html = `<script>window.__na={kane:{summary:()=>(${JSON.stringify(endState)})}}</script>`;
    await writeFile(fake, `#!${process.execPath}\nif(process.argv[2]==='balance'){console.log('Available credits: 695');process.exit(0)}\nconst {spawn}=require('node:child_process');\nconst child=spawn(process.env.KANE_CLI_CHROME_PATH,['--headless=new','--no-sandbox',${JSON.stringify('data:text/html,' + encodeURIComponent(html))}],{stdio:'ignore'});\nconsole.log(JSON.stringify({type:'stream_start'}));\nsetTimeout(()=>{console.log(JSON.stringify({type:'run_end',status:'failed',reason:'fixture ends browser'}));process.exit(0)},1800);\n`, { mode: 0o700 });
    const result = await runLaunchKane('objective', { ...opts({ mode: 'launch', headless: true, softwareGl: true }), chrome: binary }, {
      runKane: (objective, options) => { profile = options.env.KANE_CHROME_PROFILE; return runKane(objective, { ...options,
        runProcessImpl: (command, args, settings) => { assert.equal(command, 'kane-cli'); return runProcess(process.execPath, [fake, ...args], { ...settings, timeoutMs: 5000 }); } }); },
    });
    assert.equal(result.after.result, 'won'); assert.equal(result.response.end.status, 'failed');
    await assert.rejects(readFile(profile)); assert.equal(await portIsFree(), true);
    const server = createHttpServer((request, response) => { response.end('fixture'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const cli = await runProcess(process.execPath, ['tools/kane/drive.mjs', '--mode', 'launch', '--headless', '--chrome', binary,
        '--url', `http://127.0.0.1:${server.address().port}/?kane=1`, '--log', join(dir, 'driver.ndjson')], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, timeoutMs: 7000,
      });
      assert.equal(cli.code, 0, cli.stderr + cli.stdout);
      const events = cli.stdout.trim().split('\n').map(line => JSON.parse(line));
      assert.equal(events.at(-1).outcome, 'won'); assert.ok(events.some(e => e.type === 'chrome_ready' && e.port === 9223));
      assert.ok(events.some(e => e.type === 'verify' && e.acceptedCount === 2));
      assert.equal(await readFile(join(dir, 'driver.ndjson'), 'utf8'), cli.stdout);
      assert.equal(await portIsFree(), true);
    } finally { await new Promise(resolve => server.close(resolve)); }
    console.log(JSON.stringify({ fakeKane: true, result: result.after.result, port: 9223, profileRemoved: true, portFree: true, paidRuns: 0 }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('concurrent fallback drivers cannot share the observer port/profile', async () => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const first = runLaunchKane('objective', opts(), {
    resolveChromeBinary: async () => '/fake/chrome', attachChrome: async () => { throw new Error('startup'); },
    runKane: async () => { entered(); await new Promise(resolve => { release = resolve; }); return { code: 1 }; },
  });
  await ready;
  try { await assert.rejects(runLaunchKane('objective', opts()), error => error.exitCode === 22); }
  finally { release(); await assert.rejects(first, error => error.exitCode === 22); }
});

test('launch observer ignores empty loading snapshots before and after a populated terminal game', async () => {
  const loading = { ...structuredClone(initial), letters: [] };
  const terminal = { ...structuredClone(mixed), result: 'won' };
  let snapshot = loading;
  const announced = [];
  const result = await runLaunchKane('objective', { ...opts(), onReady: value => announced.push(value) }, {
    resolveChromeBinary: async () => '/fake/chrome',
    attachChrome: async () => ({ summary: async () => structuredClone(snapshot), close: async () => {} }),
    runKane: async (objective, options) => {
      await delay(70);
      assert.equal(announced.length, 0, 'loading is not page readiness');
      snapshot = terminal; options.onEvent({ step: 1, status: 'done' });
      await delay(70);
      assert.equal(announced.length, 1);
      assert.equal(announced[0].summary.result, 'won');
      snapshot = loading; options.onEvent({ step: 2, status: 'done' });
      await delay(70);
      return { code: 0, end: { status: 'passed' } };
    },
  });
  assert.equal(result.after.result, 'won');
  assert.equal(result.after.letters.length, terminal.letters.length);
  assert.equal(announced.length, 1);
});
