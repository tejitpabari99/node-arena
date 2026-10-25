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
  assert.deepEqual(Object.keys(run.snapshot()).sort(), ['attemptId', 'cooldownEndsAt', 'endsAtMax', 'runId', 'startedAt', 'state', 'viewers']);
  await run.close();
});

test('attach readiness switches to fixed launch fallback and rejects other port/mode combinations', async () => {
  const h = harness(), run = await h.create({ KANE_STREAM_CDP_PORT: '9225' });
  const ready = []; run.on('chrome_ready', event => ready.push(event));
  try {
    await run.start();
    const emit = async event => {
      h.spawned[1].child.stdout.write(JSON.stringify({ type: 'chrome_ready', ...event }) + '\n');
      await new Promise(resolve => setImmediate(resolve));
    };
    await emit({ mode: 'attach', port: 9225, pid: 999 });
    for (const event of [{ mode: 'attach', port: 9223 }, { port: 9223 }, { mode: 'invalid', port: 9223 },
      { mode: 'launch', port: '9223' }, { mode: 'launch', port: 9224 }, { mode: 'launch', port: 0 }]) await emit(event);
    assert.deepEqual(ready.map(event => event.port), [9225]);
    await emit({ mode: 'launch', port: 9223, headless: true });
    assert.deepEqual(ready.map(event => [event.mode, event.port]), [['attach', 9225], ['launch', 9223]]);
    assert.equal(run.snapshot().state, 'live');
  } finally { await run.close(); }
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

test('fallback readiness records PID-less detached descendants and cleanup kills only owned processes', { timeout: 15000 }, async () => {
  const { mkdtemp, rm, readFile, stat } = await import('node:fs/promises');
  const { spawn } = await import('node:child_process');
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
  let identities = []; const ready = [];
  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  const unrelatedProfile = await mkdtemp(join(tmpdir(), 'node-arena-chrome-unrelated-'));
  run.on('chrome_ready', event => ready.push(event));
  try {
    assert.equal((await run.start()).status, 202);
    for (let attempt = 0; attempt < 100; attempt++) {
      const record = JSON.parse(await readFile(config.pidFile, 'utf8'));
      identities = record.processes;
      if (identities.length >= 3 && ready.length >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(identities.length >= 3, 'recorded driver, attach child and detached fallback descendant');
    assert.deepEqual(ready.map(event => [event.mode, event.port]), [['attach', 9222], ['launch', 9223]]);
    assert.equal(Object.hasOwn(ready[1], 'pid'), false);
    const profiles = identities.flatMap(identity => identity.cmdline.filter(arg => arg.startsWith('--user-data-dir=')).map(arg => arg.slice('--user-data-dir='.length)));
    assert.equal(profiles.length, 2, 'Node-only browser stand-ins own attach and fallback profiles');
    assert.equal((await run.stop()).status, 200);
    assert.equal(run.snapshot().outcome, 'stopped');
    await run.close();
    for (const identity of identities) assert.equal(await ops.identity(identity.pid), null, `PID ${identity.pid} remains`);
    for (const profile of profiles) await assert.rejects(stat(profile), { code: 'ENOENT' });
    assert.ok(await ops.identity(foreign.pid), 'foreign detached process survives Stop');
    assert.ok((await stat(unrelatedProfile)).isDirectory());
    await assert.rejects(readFile(config.pidFile), { code: 'ENOENT' });
  } finally {
    await run.close();
    for (const identity of identities) await ops.signal(identity, 'SIGKILL');
    foreign.kill('SIGKILL');
    await rm(unrelatedProfile, { recursive: true, force: true });
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
  const launchProfile = await mkdtemp(join(tmpdir(), 'node-arena-kane-launch-profiletest-'));
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
    await ops.removeProfile(identity(launchProfile)); await assert.rejects(stat(launchProfile), { code: 'ENOENT' });
  } finally { await rm(launchProfile, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); await rm(link, { force: true }); }
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

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}

for (const boundary of ['acquire', 'preflight', 'checkPorts', 'mkdir', 'identity', 'persist']) {
  test(`Stop cancels ${boundary}, drains cleanup without a promise cycle, and never later becomes live`, { timeout: 3000 }, async () => {
    const h = harness({ pendingCredits: boundary === 'preflight' });
    const gate = deferred(), entered = deferred();
    let releases = 0;
    h.processes.release = async () => { releases++; };
    if (['acquire', 'checkPorts'].includes(boundary)) h.processes[boundary] = async () => { entered.resolve(); await gate.promise; };
    if (boundary === 'mkdir') h.deps.mkdir = async () => { entered.resolve(); await gate.promise; };
    if (boundary === 'identity') {
      const original = h.processes.identity;
      h.processes.identity = async pid => { if (pid === 101) { entered.resolve(); await gate.promise; } return original(pid); };
    }
    if (boundary === 'persist') {
      const original = h.processes.persist;
      h.processes.persist = async record => { if (record.processes.some(row => row.pid === 101)) { entered.resolve(); await gate.promise; } return original(record); };
    }
    const run = await h.create();
    assert.equal(typeof run.stop, 'function');
    try {
      const live = []; run.on('chrome_ready', value => live.push(value));
      const pending = run.start('one');
      if (boundary === 'preflight') await turn(); else await entered.promise;
      const stopped = run.stop();
      assert.equal(run.snapshot().outcome, 'stopped');
      assert.equal(run.snapshot().state, 'ending');
      assert.equal(run.stop(), stopped, 'repeated Stop shares cleanup');
      assert.equal((await run.reset()).status, 409);
      assert.equal((await run.start('two')).status, 409);
      gate.resolve();
      assert.equal((await stopped).status, 200);
      assert.equal((await pending).status, 503);
      assert.equal(run.snapshot().state, 'cooldown');
      assert.equal(run.snapshot().outcome, 'stopped');
      assert.equal(h.spawned.filter(row => !row.args.includes('--credits-only')).length, ['identity', 'persist'].includes(boundary) ? 1 : 0);
      for (const row of h.spawned.filter(row => !row.child.stdout.writableEnded)) { row.child.stdout.write('{"type":"chrome_ready","port":9222}\n'); row.child.finish(0); }
      await turn(); assert.equal(live.length, 0); assert.equal(run.snapshot().outcome, 'stopped');
      assert.equal(releases, 1);
    } finally { gate.resolve(); await run.close(); }
  });
}

test('Stop from synchronous starting listener invalidates the reserved attempt before acquire/preflight', async () => {
  const h = harness(); let acquisitions = 0; h.processes.acquire = async () => { acquisitions++; };
  const run = await h.create(); let stopped;
  run.on('state', value => { if (value.state === 'starting') stopped = run.stop(); });
  const pending = run.start();
  assert.equal((await stopped).status, 200); assert.equal((await pending).status, 503);
  assert.equal(acquisitions, 0); assert.equal(h.spawned.length, 0);
  await run.close();
});

test('live Stop preserves stopped through exits, repeated end and concurrent close; owned cleanup once', async () => {
  const h = harness(), run = await h.create(); await run.start();
  h.spawned[1].child.stdout.write('{"type":"chrome_ready","port":9222}\n'); await turn();
  assert.equal(run.snapshot().state, 'live');
  const gate = deferred(), entered = deferred(); let clears = 0;
  h.processes.clear = async () => { clears++; entered.resolve(); await gate.promise; };
  const stopped = run.stop(); await entered.promise;
  h.spawned[1].child.finish(0);
  assert.equal(run.stop(), stopped); const closing = run.close(); assert.equal(run.close(), closing);
  gate.resolve(); await Promise.all([stopped, closing, run.end('won')]);
  assert.equal(clears, 1); assert.equal(run.snapshot().outcome, 'stopped');
  assert.equal((await run.stop()).status, 503); assert.equal((await run.reset()).status, 503);
});

test('Reset clears presentation and emits reset before state, retains original cooldown and admission history', async () => {
  const h = harness(), run = await h.create({ KANE_IP_COOLDOWN_S: '600', KANE_DAILY_CAP: '2' });
  assert.equal(h.spawned.length, 0); assert.equal((await run.reset()).status, 200); assert.equal(h.spawned.length, 0);
  await run.start('one'); await run.stop(); await h.advance(60000);
  const events = []; run.on('reset', () => events.push('reset')); run.on('state', () => events.push('state'));
  assert.equal((await run.reset()).status, 200);
  assert.deepEqual(events, ['reset', 'state']);
  assert.deepEqual(run.snapshot(), { state: 'cooldown', runId: null, attemptId: null, startedAt: null, endsAtMax: null, cooldownEndsAt: 120000, serverNow: 60000, viewers: 0 });
  await run.reset(); assert.equal((await run.start('two')).status, 409);
  await h.advance(59999); assert.equal(run.snapshot().state, 'cooldown');
  await h.advance(1); assert.equal(run.snapshot().state, 'idle');
  assert.equal((await run.start('one')).status, 429); assert.equal(h.spawned.length, 2);
  assert.equal((await run.start('two')).status, 202); await run.stop(); await run.reset(); await h.advance(120000);
  assert.equal((await run.start('three')).status, 429); assert.equal(h.spawned.length, 4);
  await run.close();
});

test('Reset cannot bypass credit floor and stale prior driver cannot end a fresh run', async () => {
  const h = harness(), run = await h.create();
  await run.start(); const stale = h.spawned[1].child; await run.stop(); await run.reset(); await h.advance(120000);
  await run.start(); stale.finish(0); stale.stdout.write('{"type":"driver_end","exitCode":10}\n'); await turn();
  assert.equal(run.snapshot().state, 'starting'); assert.equal(run.snapshot().outcome, undefined); await run.stop(); await run.close();
  const low = harness({ creditsOutput: '{"credits":199}' }), floor = await low.create();
  await floor.reset(); assert.equal((await floor.start()).status, 503); await floor.reset();
  assert.equal((await floor.start()).status, 503); assert.equal(low.spawned.length, 2); await floor.close();
});

for (const boundary of ['identity', 'persist']) {
  test(`Stop drains preflight ${boundary} before allowing Reset or restart`, { timeout: 3000 }, async () => {
    const h = harness(), entered = deferred(), gate = deferred();
    if (boundary === 'identity') {
      const original = h.processes.identity;
      h.processes.identity = async pid => { if (pid === 100) { entered.resolve(); await gate.promise; } return original(pid); };
    } else {
      const original = h.processes.persist;
      h.processes.persist = async record => { if (record.processes.some(row => row.pid === 100)) { entered.resolve(); await gate.promise; } return original(record); };
    }
    const run = await h.create(), pending = run.start(); await entered.promise;
    const stopped = run.stop(), closing = run.close();
    assert.equal(run.snapshot().state, 'ending'); gate.resolve();
    await Promise.all([pending, stopped, closing]);
    assert.equal(h.spawned.length, 1); assert.equal(run.snapshot().outcome, 'stopped');
    assert.ok(h.signals.some(([pid, signal]) => pid === 100 && signal === 'SIGKILL'));
  });
}

test('Stop waits for live discovery; cancelled readiness cannot emit live after cleanup', async () => {
  const h = harness(), run = await h.create(); await run.start();
  const original = h.processes.descendants, entered = deferred(), gate = deferred(); let blocked = true;
  h.processes.descendants = async roots => {
    if (blocked) { blocked = false; entered.resolve(); await gate.promise; }
    return original(roots);
  };
  const ready = []; run.on('chrome_ready', value => ready.push(value));
  h.spawned[1].child.stdout.write('{"type":"chrome_ready","port":9222}\n'); await entered.promise;
  const stopped = run.stop(); assert.equal(run.snapshot().state, 'ending');
  assert.equal((await run.reset()).status, 409); gate.resolve(); await stopped; await turn();
  assert.equal(ready.length, 0); assert.equal(run.snapshot().outcome, 'stopped'); await run.close();
});

test('Stop reports actual cleanup failure generically and does not claim Stopped', async () => {
  for (const operation of ['signal', 'clear', 'release']) {
    const h = harness(), run = await h.create(); await run.start();
    const original = h.processes[operation];
    h.processes[operation] = async () => { throw new Error('private cleanup path'); };
    assert.deepEqual(await run.stop(), { status: 503, message: 'unavailable' });
    assert.equal(run.snapshot().outcome, 'failed');
    h.processes[operation] = original; await run.close();
  }
});

test('attemptId precedes starting, survives null-run preflight rejection, and Reset clears it without spawning', async () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  const h = harness({ creditsOutput: '{"credits":199}' }), run = await h.create();
  const states = []; run.on('state', state => states.push(state));
  assert.equal(run.snapshot().attemptId, null);
  const pending = run.start('one', id);
  assert.equal(run.snapshot().attemptId, id);
  assert.equal((await pending).status, 503);
  assert.equal(run.snapshot().state, 'idle'); assert.equal(run.snapshot().runId, null);
  assert.equal(run.snapshot().outcome, undefined); assert.equal(run.snapshot().attemptId, id);
  assert.ok(states.every(state => state.attemptId === id));
  assert.equal(h.spawned.length, 1);
  await run.reset(); assert.equal(run.snapshot().attemptId, null); assert.equal(h.spawned.length, 1);
  await run.close();
});

test('conditional Stop rejects stale attempts before abort or reuse of shared cleanup, including after a new Start', async () => {
  const a = '12345678-1234-4234-8234-123456789abc', b = '22345678-1234-4234-8234-123456789abc';
  const h = harness(), run = await h.create();
  await run.start('one', a);
  const before = run.snapshot(), signals = h.signals.length;
  assert.equal((await run.stop(b)).status, 409);
  assert.deepEqual(run.snapshot(), before); assert.equal(h.signals.length, signals);
  const stop = run.stop(a);
  assert.equal((await run.stop(b)).status, 409); assert.equal(run.stop(a), stop);
  await stop; assert.equal(run.snapshot().attemptId, a);
  await run.reset(); assert.equal(run.snapshot().attemptId, null); await h.advance(120000);
  await run.start('two', b);
  const next = run.snapshot(), nextSignals = h.signals.length;
  assert.equal((await run.stop(a)).status, 409);
  assert.deepEqual(run.snapshot(), next); assert.equal(h.signals.length, nextSignals);
  assert.ok(h.spawned.every(child => !child.args.includes(a) && !child.args.includes(b)));
  await run.stop(b); await run.close();
});


test('cooldown deadline precedes state/end events, survives Reset and clears only at original expiry', async () => {
  const h = harness(), run = await h.create({ KANE_STREAM_COOLDOWN_S: '30' });
  assert.equal(run.snapshot().cooldownEndsAt, null);
  await run.start(); await h.advance(7000);
  const deadlines = [];
  run.on('state', value => { if (value.state === 'cooldown') deadlines.push(value.cooldownEndsAt); });
  run.on('end', () => deadlines.push(run.snapshot().cooldownEndsAt));
  await run.stop();
  assert.deepEqual(deadlines, [37000, 37000]);
  await h.advance(10000);
  assert.equal(run.snapshot().serverNow, 17000);
  await run.reset(); await run.reset();
  assert.equal(run.snapshot().cooldownEndsAt, 37000);
  await h.advance(19999);
  assert.equal(run.snapshot().state, 'cooldown');
  assert.equal((await run.start()).status, 409);
  await h.advance(1);
  assert.equal(run.snapshot().state, 'idle');
  assert.equal(run.snapshot().cooldownEndsAt, null);
  await run.start();
  assert.equal(run.snapshot().cooldownEndsAt, null);
  await run.close();
});
