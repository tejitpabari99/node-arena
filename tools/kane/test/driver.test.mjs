import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, mixed } from './fixtures.mjs';
import { parseArgs, runDriver } from '../drive.mjs';
import { kaneRunArgs, readCredits, runKane } from '../lib/kane.mjs';

function harness({ summaries = [initial], balances = [695], claim = 'passed', onRun, sleep } = {}) {
  let reads = 0, credits = 0, runs = 0, closed = 0, stopped = 0, prepared = 0;
  const events = [];
  const page = { port: 9222, pid: 123, headless: true,
    summary: async () => structuredClone(summaries[Math.min(reads++, summaries.length - 1)]),
    prepare: async () => { prepared++; }, close: async () => { closed++; } };
  return { events, stats: () => ({ runs, closed, stopped, prepared }), deps: {
    emit: (type, fields) => events.push({ type, ...fields }),
    readCredits: async () => balances[Math.min(credits++, balances.length - 1)],
    ensurePreviewServer: async () => async () => { stopped++; },
    launchChrome: async () => page,
    runKane: async (objective, options) => { runs++; await onRun?.(options); options.onEvent({ step: 1, status: 'done' }); return { code: 0, end: { status: claim, credits_consumed: 9 }, durationMs: 10, stderr: '' }; },
    sleep: sleep ?? (async () => {}),
  } };
}
const opts = extra => ({ ...parseArgs([]), ...extra });

test('CLI parses full defaults, pnpm separator, seed/speed and validates bounds', () => {
  const args = parseArgs(['--', '--headless', '--seed', '7', '--speed', '0.5', '--moves', '2']);
  assert.equal(new URL(args.url).searchParams.get('seed'), '7');
  assert.equal(new URL(args.url).searchParams.get('speed'), '0.5');
  assert.equal(args.softwareGl, true); assert.equal(args.moves, 2); assert.equal(args.runTimeout, 150);
  assert.equal(args.mode, 'attach'); assert.equal(args.maxRuns, 20); assert.equal(args.stallRuns, 3);
  for (const list of [['--run-timeout', '119'], ['--moves', '0'], ['--port', '99999'], ['--speed', 'NaN'], ['--wat'], ['--url']]) assert.throws(() => parseArgs(list));
});

test('false PASS stalls from zero accepted moves; raw Kane step preserved and cleanup performed', async () => {
  const h = harness(); const result = await runDriver(opts({ stallRuns: 2 }), h.deps);
  assert.equal(result.exitCode, 20); assert.equal(h.stats().runs, 2);
  assert.equal(h.stats().closed, 1); assert.equal(h.stats().stopped, 1);
  assert.deepEqual(h.events.find(e => e.type === 'kane').event, { step: 1, status: 'done' });
  assert.equal(h.events.filter(e => e.type === 'verify').every(e => e.claimMatches === false), true);
  assert.equal(h.events.at(-1).type, 'driver_end');
});

test('accepted counter survives ambiguous rejected attribution and reaches max runs', async () => {
  const h = harness({ summaries: [initial, initial, mixed] });
  const result = await runDriver(opts({ maxRuns: 1, stallRuns: 1 }), h.deps);
  assert.equal(result.exitCode, 30); assert.equal(h.events.find(e => e.type === 'verify').acceptedCount, 2);
  assert.ok(h.events.some(e => e.code === 'ambiguous_delta'));
});

for (const [result, exitCode] of [['won', 0], ['lost', 10], ['timeout', 11]]) test(`ground truth ${result} beats Kane failure`, async () => {
  const h = harness({ summaries: [initial, initial, { ...initial, result }], claim: 'failed' });
  const outcome = await runDriver(opts(), h.deps);
  assert.equal(outcome.exitCode, exitCode); assert.equal(h.stats().runs, 1);
  assert.equal(h.events.find(e => e.type === 'game_over').result, result);
});

test('initial credit floor and auth failure prevent preview, Chrome and paid run', async () => {
  for (const failure of [false, true]) {
    const h = harness();
    if (failure) h.deps.readCredits = async () => { throw new Error('unauthenticated'); };
    const result = await runDriver(opts({ minCredits: 99999 }), h.deps);
    assert.equal(result.exitCode, 21); assert.equal(h.stats().runs, 0); assert.equal(h.stats().stopped, 0);
    assert.equal(h.events.at(-1).type, 'driver_end');
  }
});

test('credit floor is checked again before every paid run', async () => {
  const h = harness({ balances: [695, 695, 100] });
  assert.equal((await runDriver(opts(), h.deps)).exitCode, 21); assert.equal(h.stats().runs, 1);
});

test('idle polling is local and bounded with zero paid runs', async () => {
  const h = harness({ summaries: [{ ...initial, pairs: [] }] });
  const result = await runDriver(opts({ idleMax: 4 }), h.deps);
  assert.equal(result.exitCode, 20); assert.equal(h.stats().runs, 0);
  assert.deepEqual(h.events.filter(e => e.type === 'idle').map(e => e.waitedS), [0, 2, 4]);
});

test('dry run emits required events and never calls Kane run', async () => {
  const h = harness(); assert.equal((await runDriver(opts({ dryRun: true }), h.deps)).exitCode, 20);
  for (const type of ['driver_start', 'chrome_ready', 'page_ready', 'state', 'run_start', 'driver_end']) assert.ok(h.events.some(e => e.type === type), type);
  assert.equal(h.stats().runs, 0);
});

test('aborted paid run and event sink failures clean up all owned resources', async () => {
  for (const failLog of [false, true]) {
    const abort = new AbortController(); const h = harness({ onRun: async options => { abort.abort(new Error('SIGTERM')); options.signal.throwIfAborted(); } });
    if (failLog) { const emit = h.deps.emit; h.deps.emit = (type, fields) => { if (type === 'run_start') throw new Error('EIO'); emit(type, fields); }; }
    assert.equal((await runDriver(opts(), { ...h.deps, signal: abort.signal })).exitCode, 1);
    assert.equal(h.stats().closed, 1); assert.equal(h.stats().stopped, 1); assert.equal(h.events.at(-1).type, 'driver_end');
  }
});

test('unknown game results fail instead of masquerading as max runs', async () => {
  const h = harness({ summaries: [{ ...initial, result: 'PASS' }] });
  assert.equal((await runDriver(opts(), h.deps)).exitCode, 1); assert.equal(h.stats().runs, 0);
});

test('Kane arguments match bounded PRD contract and child has codex user agent', async () => {
  const args = kaneRunArgs('strategy', opts());
  assert.deepEqual(args, ['run', 'strategy', '--cdp-endpoint', 'http://127.0.0.1:9222', '--allow-missing-url', '--agent', '--max-steps', '8', '--timeout', '150', '--mode', 'action', '--assertion-mode', 'dom', '--final-validation', 'off', '--bug-detection', 'off']);
  let captured; const events = [];
  const result = await runKane('strategy', { ...opts(), onEvent: e => events.push(e), runProcessImpl: async (cmd, argv, options) => {
    captured = { cmd, argv, options }; options.onStdout('{"step":1,"sta'); options.onStdout('tus":"done"}\n{"type":"run_end","status":"passed","credits_consumed":9}');
    return { code: 0, stdout: '', stderr: '' };
  } });
  assert.equal(captured.options.env.KANE_CLI_USER_AGENT, 'codex'); assert.equal(events.length, 2); assert.equal(result.end.credits_consumed, 9);
  assert.equal(await readCredits({ runProcessImpl: async () => ({ code: 0, stdout: 'Available credits: 695.2', stderr: '' }) }), 695.2);
  await assert.rejects(readCredits({ runProcessImpl: async () => ({ code: 1, stdout: '', stderr: 'auth' }) }), /auth/);
});

test('CDP read failure exits22 and not-ready preparation exits23 with cleanup', async () => {
  for (const exitCode of [22, 23]) {
    const h = harness();
    h.deps.launchChrome = async () => ({ port: 9222, close: async () => { h.cleaned = true; }, summary: async () => structuredClone(initial), prepare: async () => { throw Object.assign(new Error('CDP/page failure'), exitCode === 23 ? { exitCode: 23 } : {}); } });
    assert.equal((await runDriver(opts(), h.deps)).exitCode, exitCode); assert.equal(h.cleaned, true);
  }
});

test('failure claiming CDP connection exits22, bounded and without launch adapter', async () => {
  const h = harness();
  h.deps.runKane = async () => ({ code: 1, stderr: 'ECONNREFUSED endpoint', end: { status: 'failed' }, durationMs: 1 });
  assert.equal((await runDriver(opts(), h.deps)).exitCode, 22);
});

test('game-over winner is read from shipped summary.over.winner', async () => {
  const h = harness({ summaries: [{ ...initial, result: 'won', over: { winner: 0, reason: 'elimination' } }] });
  assert.equal((await runDriver(opts(), h.deps)).exitCode, 0);
  assert.equal(h.events.find(e => e.type === 'game_over').winner, 0);
});

test('explicit paid-run auth refusal maps21 while grounded win still wins', async () => {
  for (const won of [false, true]) {
    const h = harness({ summaries: won ? [initial, initial, { ...initial, result: 'won' }] : [initial] });
    h.deps.runKane = async () => ({ code: 3, stderr: 'Unauthorized: token expired, please login', end: { status: 'failed', reason_code: 'AUTH_REQUIRED' }, durationMs: 1 });
    assert.equal((await runDriver(opts(), h.deps)).exitCode, won ? 0 : 21);
  }
});

test('Kane output sink error aborts the owned process immediately', async () => {
  await assert.rejects(runKane('strategy', { ...opts(), onEvent: () => { throw new Error('log EIO'); }, runProcessImpl: async (cmd, argv, options) => {
    options.onStdout('{"step":1,"status":"running"}\n');
    assert.equal(options.signal.aborted, true);
    options.signal.throwIfAborted();
  } }), /log EIO/);
});

test('unavailable preview is page-not-ready23 before starting Chrome', async () => {
  const h = harness(); h.deps.ensurePreviewServer = async () => { throw new Error('Preview unavailable'); };
  assert.equal((await runDriver(opts(), h.deps)).exitCode, 23);
  assert.equal(h.stats().runs, 0); assert.equal(h.stats().closed, 0);
});
