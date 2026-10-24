import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRunController, readRunConfig, outcomeForExit } from '../run.mjs';
import { main as fakeMain } from './fake-driver.mjs';

function harness(overrides = {}) {
  let now = 0, pid = 100;
  const timers = new Map(), spawned = [], signals = [], records = [];
  const processes = {
    load: async () => null, persist: async record => records.push(structuredClone(record)), clear: async () => {},
    identity: async id => ({ pid: id, starttime: '1', cmdline: ['node', 'owned'], pgid: id }),
    descendants: async () => [], matches: async () => true,
    signal: async (identity, signal) => { signals.push([identity.pid, signal]); },
    removeProfile: async () => {}, acquire: async () => {}, release: async () => {}, checkPorts: async () => {},
  };
  function spawn(command, args, options) {
    const child = new EventEmitter();
    Object.assign(child, { pid: pid++, stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
    child.finish = (code = 0) => { child.exitCode = code; child.emit('exit', code, null); child.emit('close', code, null); };
    spawned.push({ command, args, options, child });
    if (args.includes('--credits-only')) queueMicrotask(() => {
      if (overrides.pendingCredits) return;
      child.stdout.end(overrides.creditsOutput ?? '{"credits":500}\n'); child.finish(overrides.creditExit ?? 0);
    });
    return child;
  }
  const deps = {
    spawn, processes, now: () => now,
    setTimeout: (fn, ms) => { const id = Symbol(); timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id), sleep: async () => {},
  };
  return {
    deps, spawned, signals, records, processes,
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await new Promise(resolve => setImmediate(resolve)); },
    async create(env = {}) { return createRunController({ env: { KANE_IP_COOLDOWN_S: '0', ...env }, deps, handleSignals: false }); },
  };
}

// Injected process and clock boundaries: no Kane/Chrome calls.
test('start reserves starting synchronously before bounded credit preflight; second start rejected', async () => {
  const h = harness({ pendingCredits: true }); const run = await h.create();
  const first = run.start('one');
  assert.equal(run.snapshot().state, 'starting');
  assert.deepEqual(await run.start('two'), { status: 409, message: 'unavailable' });
  await new Promise(resolve => setImmediate(resolve));
  await run.close();
  assert.equal((await first).status, 503);
  assert.equal(h.spawned.length, 1);
});

test('fixed detached argv and public snapshot; raw lines and Chrome readiness trigger live', async () => {
  const h = harness(); const run = await h.create({ KANE_STREAM_PREVIEW_PORT: '4175', KANE_STREAM_CDP_PORT: '9225' });
  const lines = [], ready = []; run.on('line', line => lines.push(line)); run.on('chrome_ready', value => ready.push(value));
  const result = await run.start('one'); assert.equal(result.status, 202);
  const driver = h.spawned[1];
  assert.equal(driver.options.detached, true);
  assert.deepEqual(driver.args.slice(1, 13), ['--headless', '--software-gl', '--serve', '--min-credits', '200', '--max-runs', '20', '--port', '9225', '--url', 'http://127.0.0.1:4175/?kane=1', '--log']);
  assert.equal(driver.args.includes('--max-run-s'), false);
  driver.child.stdout.write('{"type":"chrome_ready","pid":999,"port":9225}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.snapshot().state, 'live'); assert.equal(lines.length, 1); assert.equal(ready.length, 1);
  assert.deepEqual(Object.keys(run.snapshot()).sort(), ['endsAtMax', 'runId', 'startedAt', 'state', 'viewers']);
  await run.close();
});

test('credit floor, invalid balance, output bounds and exit errors prevent driver spawn without leaks', async () => {
  for (const options of [{ creditsOutput: '{"credits":199}' }, { creditsOutput: '{"credits":-1}' }, { creditsOutput: 'secret 500' }, { creditsOutput: 'x'.repeat(8193) }, { creditExit: 21 }]) {
    const h = harness(options); const run = await h.create();
    assert.deepEqual(await run.start(), { status: 503, message: 'unavailable' });
    assert.equal(h.spawned.length, 1); assert.equal(run.snapshot().state, 'idle'); await run.close();
  }
  const h = harness(); const run = await h.create({ KANE_STREAM_MIN_CREDITS: '99999' });
  assert.equal((await run.start()).status, 503); assert.equal(h.spawned.length, 1); await run.close();
});

test('credit preflight timeout aborts child and leaves no pending start', async () => {
  const h = harness({ pendingCredits: true }); const run = await h.create(); const pending = run.start();
  await new Promise(resolve => setImmediate(resolve)); await h.advance(10000);
  assert.equal((await pending).status, 503); assert.ok(h.signals.some(([, signal]) => signal === 'SIGKILL'));
  assert.equal(run.snapshot().state, 'idle'); await run.close();
});

test('exit enters ending, ordered cleanup, 120 second cooldown, then daily cap rejects', async () => {
  const h = harness(); const run = await h.create({ KANE_DAILY_CAP: '1' }); const states = [];
  run.on('state', value => states.push(value.state));
  await run.start('one'); h.spawned[1].child.finish(10);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.snapshot().state, 'cooldown'); assert.equal(run.snapshot().outcome, 'lost');
  assert.equal((await run.start('two')).status, 409);
  assert.deepEqual(h.signals.filter(([pid]) => pid === 101).map(([, signal]) => signal), ['SIGTERM', 'SIGKILL']);
  await h.advance(119999); assert.equal(run.snapshot().state, 'cooldown');
  await h.advance(1); assert.equal(run.snapshot().state, 'idle');
  assert.equal((await run.start('two')).status, 429);
  assert.deepEqual(states, ['starting', 'ending', 'cooldown', 'idle']); await run.close();
});

test('wall clock timeout ends run even without any driver events', async () => {
  const h = harness(); const run = await h.create({ KANE_STREAM_MAX_RUN_S: '2' });
  await run.start(); await h.advance(2000);
  assert.equal(run.snapshot().outcome, 'timeout'); assert.equal(run.snapshot().state, 'cooldown'); await run.close();
});

test('startup sweep and teardown refuse reused PIDs and remove only verified owned profiles', async () => {
  const h = harness(); const killed = [], removed = [];
  h.processes.load = async () => ({ version: 1, processes: [{ pid: 123, starttime: 'old', cmdline: ['node'], pgid: 123, profile: '/tmp/node-arena-chrome-safe' }, { pid: 124, starttime: 'new', cmdline: ['node'], pgid: 124 }] });
  h.processes.matches = async identity => identity.pid === 124;
  h.processes.signal = async (identity, signal) => killed.push([identity.pid, signal]);
  h.processes.removeProfile = async identity => removed.push(identity);
  const run = await h.create();
  assert.ok(killed.every(([pid]) => pid === 124)); assert.equal(killed.length, 2);
  assert.equal(removed.some(value => value.pid === 123), false); await run.close();
});

test('configuration rejects invalid ports, unsafe preview host, and maps exit statuses', () => {
  assert.equal(readRunConfig({}).minCredits, 200);
  assert.throws(() => readRunConfig({ KANE_STREAM_CDP_PORT: '0' }));
  assert.throws(() => readRunConfig({ KANE_STREAM_PREVIEW_HOST: '0.0.0.0' }));
  for (const [code, outcome] of [[0, 'won'], [10, 'lost'], [11, 'timeout'], [20, 'failed'], [21, 'unavailable'], [22, 'failed'], [23, 'failed'], [30, 'failed'], [null, 'failed']]) assert.equal(outcomeForExit(code), outcome);
});

test('startup refuses to sweep an active stream owner', async () => {
  const h = harness();
  h.processes.load = async () => ({ version: 1, owner: { pid: 42 }, processes: [{ pid: 43 }] });
  await assert.rejects(h.create(), /owner is still active/); assert.equal(h.signals.length, 0);
});

test('driver_end emits ending before cleanup and provides a public end outcome', async () => {
  const h = harness(); const run = await h.create(); const events = [];
  run.on('state', value => { if (value.state === 'ending') events.push(['ending', h.signals.length]); });
  run.on('end', value => events.push(['end', value.outcome]));
  await run.start(); const signalsBefore = h.signals.length;
  h.spawned[1].child.stdout.write('{"type":"driver_end","outcome":"credit_floor","exitCode":21}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [['ending', signalsBefore], ['end', 'unavailable']]); await run.close();
});

test('resource occupancy returns unavailable and does not spawn driver', async () => {
  const h = harness(); h.processes.checkPorts = async () => { throw new Error('occupied'); };
  const run = await h.create(); assert.equal((await run.start()).status, 503);
  assert.equal(h.spawned.length, 1); assert.equal(run.snapshot().state, 'idle'); await run.close();
});

test('real detached driver and detached grandchild are gone after forced cleanup', { timeout: 15000 }, async () => {
  const { mkdtemp, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createProcessOps } = await import('../run.mjs');
  const cwd = await mkdtemp(join(tmpdir(), 'node-arena-lifecycle-test-'));
  const env = { KANE_STREAM_DRIVER: fileURLToPath(new URL('./lifecycle-process.mjs', import.meta.url)) };
  const config = readRunConfig(env, cwd), ops = createProcessOps(config);
  // This fixture binds no ports and launches no browser. Do not touch shared runtime locks.
  ops.acquire = async () => {}; ops.release = async () => {}; ops.checkPorts = async () => {};
  const run = await createRunController({ cwd, env, deps: { processes: ops }, handleSignals: false });
  let identities = [];
  try {
    assert.equal((await run.start()).status, 202);
    for (let attempt = 0; attempt < 100; attempt++) {
      const record = JSON.parse(await readFile(config.pidFile, 'utf8'));
      identities = record.processes;
      if (identities.length >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(identities.length >= 2, 'recorded driver and detached descendant');
    await run.close();
    for (const identity of identities) assert.equal(await ops.identity(identity.pid), null, `PID ${identity.pid} remains`);
    await assert.rejects(readFile(config.pidFile), { code: 'ENOENT' });
  } finally {
    await run.close();
    for (const identity of identities) await ops.signal(identity, 'SIGKILL');
    await rm(cwd, { recursive: true, force: true });
  }
});

test('recorded descendant argv refreshes after verified exec and cleanup kills the new identity', async () => {
  const h = harness(); let execed = false;
  h.processes.descendants = async roots => roots.some(row => row.pid === 101) ? [{ pid: 102, starttime: '1', pgid: 102, cmdline: [execed ? 'vite' : 'pnpm'] }] : [];
  const run = await h.create(); await run.start();
  execed = true; await h.advance(100);
  assert.deepEqual(h.records.at(-1).processes.find(row => row.pid === 102).cmdline, ['vite']);
  await run.close();
});

test('profile removal accepts only owned temp directories and refuses symlinks/outside paths', async () => {
  const { mkdtemp, mkdir, rm, symlink, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { createProcessOps } = await import('../run.mjs');
  const profile = await mkdtemp(join(tmpdir(), 'node-arena-chrome-profiletest-'));
  const outside = await mkdtemp(join(tmpdir(), 'node-arena-nonprofile-'));
  const link = `${profile}-symlink`;
  const ops = createProcessOps(readRunConfig({}));
  const identity = path => ({ cmdline: ['/usr/bin/chromium', `--user-data-dir=${path}`] });
  try {
    await symlink(outside, link); await mkdir(join(outside, 'keep'));
    await ops.removeProfile(identity(link)); assert.ok((await stat(join(outside, 'keep'))).isDirectory());
    await ops.removeProfile(identity(outside)); assert.ok((await stat(outside)).isDirectory());
    await ops.removeProfile({ cmdline: ['/usr/bin/node', `--user-data-dir=${profile}`] }); assert.ok((await stat(profile)).isDirectory());
    await ops.removeProfile(identity(profile)); await assert.rejects(stat(profile), { code: 'ENOENT' });
  } finally { await rm(profile, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); await rm(link, { force: true }); }
});


test('credit-free fake driver emits realistic events and launches only injected preview/Chrome', async () => {
  const lines = [], calls = []; let now = 0;
  const summary = { tick: 1, result: null, letters: [], speed: 0.25 };
  const code = await fakeMain(['--serve', '--port', '9225', '--url', 'http://127.0.0.1:4175/?kane=1'], {
    env: { KANE_STREAM_FAKE_DURATION_S: '2', KANE_CLI_CHROME_PATH: '/fixture/chrome' }, now: () => now, write: line => lines.push(JSON.parse(line)),
    sleep: async () => { now += 1000; },
    ensurePreviewServer: async options => { calls.push(['preview', options.url]); return async () => calls.push(['preview_close']); },
    resolveChromeBinary: async options => {
      assert.deepEqual(options, { chrome: '/fixture/chrome', preferPlaywright: true });
      return '/fixture/resolved-chromium';
    },
    launchChrome: async options => {
      assert.equal(options.chrome, '/fixture/resolved-chromium');
      calls.push(['chrome', options.port, options.headless]);
      return { port: options.port, pid: 555, summary: async () => summary, prepare: async () => {}, close: async () => calls.push(['chrome_close']) };
    },
  });
  assert.equal(code, 30); assert.equal(lines.at(-1).outcome, 'max_runs');
  assert.deepEqual(lines.filter(row => row.type === 'kane').map(row => row.event.credits_consumed).filter(value => value !== undefined), [0]);
  assert.deepEqual(calls, [['preview', 'http://127.0.0.1:4175/?kane=1'], ['chrome', 9225, true], ['chrome_close'], ['preview_close']]);
});

test('fake credits-only and floor refusal never launch browser', async () => {
  const lines = []; const deps = { write: line => lines.push(JSON.parse(line)), launchChrome: async () => { throw new Error('must not launch'); } };
  assert.equal(await fakeMain(['--credits-only'], deps), 0); assert.deepEqual(lines, [{ credits: 500 }]);
  lines.length = 0;
  assert.equal(await fakeMain(['--min-credits', '99999'], deps), 21); assert.equal(lines.at(-1).outcome, 'credit_floor');
});

test('runtime owner lock excludes another controller and recovers a dead owner without touching advisory lock', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { createProcessOps } = await import('../run.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'node-arena-lock-test-'));
  const config = { ...readRunConfig({}), lockDir: join(directory, 'owner.lock') };
  const first = createProcessOps(config), second = createProcessOps(config);
  try {
    await first.acquire(); await assert.rejects(second.acquire(), /unavailable/);
    await first.release(); await second.acquire(); await second.release();
    await mkdir(config.lockDir);
    await writeFile(join(config.lockDir, '11111111-1111-4111-8111-111111111111.json'), JSON.stringify({ owner: { pid: 2147483647, starttime: '1', pgid: 2147483647, cmdline: ['dead'] } }));
    await first.acquire(); await assert.rejects(second.acquire(), /unavailable/); await first.release();
  } finally { await first.release(); await second.release(); await rm(directory, { recursive: true, force: true }); }
});
