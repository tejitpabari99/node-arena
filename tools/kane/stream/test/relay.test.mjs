import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { filterDriverEvent, parseDriverLine, createRelayBuffer, serializeSse } from '../relay.mjs';

const raw = (type, fields = {}, seq = 1) => ({ type, seq, v: 1, ts: '2026-10-24T12:00:00Z', ...fields });
const fixtures = readFileSync(new URL('./fixtures-real-driver.ndjson', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);

test('R6 real-run fixtures retain public steps and outcomes, omit infrastructure and private data', () => {
  const output = fixtures.map(filterDriverEvent).filter(Boolean);
  const kane = output.filter(e => e.type === 'kane');
  assert.equal(kane.length, 3, 'only running/done steps and run_end pass');
  assert.ok(kane.some(e => e.event.step && e.event.status && !Object.hasOwn(e.event, 'type')));
  assert.ok(kane.some(e => e.event.summary && Object.hasOwn(e.event, 'credits_consumed')));
  assert.ok(output.some(e => e.type === 'driver_end' && e.outcome === 'won'));
  const forbidden = new Set(['v', 'ts', 'id', 'balance', 'floor', 'pid', 'port', 'headless', 'args', 'url', 'credits',
    'test_url', 'share_url', 'session_dir', 'run_dir', 'screenshot_path', 'commit_id', 'testcase_id', 'project_id',
    'org_id', 'session_id', 'run_id', 'context', 'verdict', 'result_code', 'reason_code', 'recent_actions',
    'creditsRun', 'creditsUsed', 'sessionDir', 'kaneExit', 'exitCode', 'final_state']);
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, key); visit(child);
    }
  };
  visit(output);
  assert.doesNotMatch(JSON.stringify(output), /fixture-id|example\.invalid|\/home\/|\/root\//);
});

test('R6 every driver type applies its own exact field allowlist', () => {
  const cases = [
    ['driver_start', { mode: 'attach', args: { token: 'private' }, credits: 900, url: 'http://localhost' }, { mode: 'attach' }],
    ['chrome_ready', { pid: 9, port: 9222, headless: true }, {}],
    ['page_ready', { levelId: 'na-kane', speed: 0.25, letters: [{ letter: 'A', index: 0, owner: -1, level: 5, id: 'private', extra: 1 }] },
      { levelId: 'na-kane', speed: 0.25, letters: [{ letter: 'A', index: 0, owner: -1, level: 5 }] }],
    ['credits', { ok: true, balance: 900, floor: 200 }, { ok: true }],
    ['state', { iter: 1, tick: 7, result: null, ready: 2, active: 1, unavailable: 0, humanDrawn: 1, humanCut: 0 },
      { iter: 1, tick: 7, result: null, ready: 2, active: 1, unavailable: 0, humanDrawn: 1, humanCut: 0 }],
    ['idle', { iter: 1, waitedS: 5, noProgress: 4 }, { iter: 1, waitedS: 5 }],
    ['stall', { iter: 2, noProgress: 3, waitedS: 8 }, { iter: 2, noProgress: 3 }],
    ['fallback', { iter: 1, to: 'launch', reason: 'private' }, { iter: 1, to: 'launch' }],
    ['run_start', { iter: 1, phase: 'capture', objective: 'Click A', maxSteps: 20 }, { iter: 1, phase: 'capture', objective: 'Click A', maxSteps: 20 }],
    ['run_end', { iter: 1, kaneStatus: 'passed', durationMs: 1200, creditsRun: 9, sessionDir: 'private', kaneExit: 0 }, { iter: 1, kaneStatus: 'passed', durationMs: 1200 }],
    ['verify', { iter: 1, accepted: [{ tick: 1, type: 'DrawLine', from: 0, to: 4, id: 'private', cmd: { secret: 'private' } }], rejected: [{ reason: 'busy', balance: 200 }], claimMatches: true, acceptedCount: 1 },
      { iter: 1, accepted: [{ tick: 1, type: 'DrawLine', from: 0, to: 4 }], rejected: [{ reason: 'busy' }], claimMatches: true }],
    ['warn', { code: 'kane_auth', msg: 'private' }, { code: 'kane_auth' }],
    ['game_over', { result: 'won', winner: 0, tick: 100, humanCommands: [{ tick: 1, cmd: { type: 'DrawLine', player: 0, from: 0, to: 4, id: 'private' }, extra: 1 }], drawn: 1, cut: 0 },
      { result: 'won', winner: 0, tick: 100, humanCommands: [{ tick: 1, cmd: { type: 'DrawLine', player: 0, from: 0, to: 4 } }], drawn: 1, cut: 0 }],
    ['driver_end', { outcome: 'won', runs: 3, wallMs: 999, creditsUsed: 1, exitCode: 0 }, { outcome: 'won', runs: 3, wallMs: 999 }],
  ];
  for (const [type, input, expected] of cases) {
    assert.deepEqual(filterDriverEvent(raw(type, { ...input, unknown: 'private' })), { seq: 1, type, ...expected }, type);
  }
});

test('R6 unknown types, invalid JSON/envelopes and unsafe sequence ids fail closed', () => {
  for (const value of ['', 'not json', '{}\n{}', 'null', '[]', '5', '"state"']) assert.equal(parseDriverLine(value), null, value);
  for (const value of [null, [], {}, raw('new_type'), raw('__proto__'), raw('constructor')]) assert.equal(filterDriverEvent(value), null);
  for (const seq of [undefined, 0, -1, 1.2, '1', '1\ndata: private', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(filterDriverEvent({ ...raw('state'), seq }), null);
  }
  assert.deepEqual(parseDriverLine('  ' + JSON.stringify(raw('credits', { ok: true, balance: 200 })) + '\r\n'), { seq: 1, type: 'credits', ok: true });
});

test('R6 Kane only accepts absent-type step lines and run_end, reducing their exact nested fields', () => {
  const step = { step: 2, status: 'running', remark: 'Click A', test_url: 'https://example.invalid', recent_actions: ['private'] };
  assert.deepEqual(filterDriverEvent(raw('kane', { iter: 1, event: step })), { seq: 1, type: 'kane', iter: 1, event: { step: 2, status: 'running', remark: 'Click A' } });
  const end = { type: 'run_end', status: 'passed', summary: 'All done', duration: 4.25, credits_consumed: 2.75, context: { secret: 'private' }, share_url: 'https://example.invalid' };
  assert.deepEqual(filterDriverEvent(raw('kane', { iter: 1, event: end })), { seq: 1, type: 'kane', iter: 1, event: { status: 'passed', summary: 'All done', duration: 4.25, credits_consumed: 2.75 } });
  for (const event of [{ type: 'stream_start' }, { type: 'recording_state' }, { type: 'bifurcation' },
    { type: 'unknown', ...step }, { type: 'step', ...step }, { type: 'run_end', status: 'passed' },
    { status: 'passed', summary: 'missing discriminator' }, { step: '2', status: 'running' },
    { step: 2, status: {} }, null, [], 'private']) {
    assert.equal(filterDriverEvent(raw('kane', { event })), null, JSON.stringify(event));
  }
});

test('R6 all passed strings get hygiene before truncation, including every nested shape', () => {
  const unsafe = ['LT_abc', 'TOKEN=abc', 'secret value', 'api_key: abc', 'api-key: abc', 'Bearer abc', 'password',
    '/root/private', '/home/user/private', 'https://portal.example/run', 'http://example.org/share',
    'http://localhost.evil/private', 'https://localhost@evil.example/private', 'http://localhost:4173@evil.example/private', 'x'.repeat(301) + ' secret'];
  for (const value of unsafe) {
    assert.deepEqual(filterDriverEvent(raw('warn', { code: value })), { seq: 1, type: 'warn' });
    assert.deepEqual(filterDriverEvent(raw('kane', { event: { step: 2, status: 'running', remark: value } })), { seq: 1, type: 'kane', event: { step: 2, status: 'running' } });
    const out = filterDriverEvent(raw('verify', { accepted: [{ type: value }], rejected: [{ reason: value }] }));
    assert.deepEqual(out, { seq: 1, type: 'verify', accepted: [], rejected: [] });
    assert.equal(Object.hasOwn(filterDriverEvent(raw('page_ready', { letters: [{ letter: value }] })).letters[0] ?? {}, 'letter'), false);
    const commands = filterDriverEvent(raw('game_over', { humanCommands: [{ cmd: { type: value } }] }));
    assert.deepEqual(commands.humanCommands, []);
  }
  assert.equal(filterDriverEvent(raw('warn', { code: 'x'.repeat(400) })).code.length, 300);
  assert.equal(filterDriverEvent(raw('warn', { code: 'http://localhost:4173/?kane=1' })).code, 'http://localhost:4173/?kane=1');
});

test('R6 malformed field types cannot tunnel arrays or objects through scalar fields', () => {
  assert.deepEqual(filterDriverEvent(raw('state', { tick: { secret: 'private' }, result: ['private'], ready: '20', humanDrawn: true, active: Infinity })), { seq: 1, type: 'state' });
  assert.deepEqual(filterDriverEvent(raw('credits', { ok: 'true' })), { seq: 1, type: 'credits' });
  assert.deepEqual(filterDriverEvent(raw('page_ready', { letters: { secret: 'private' }, speed: [] })), { seq: 1, type: 'page_ready' });
  assert.deepEqual(filterDriverEvent(raw('verify', { accepted: [null, [], 'private', { tick: 1, type: { secret: 'private' }, from: [], to: null }], rejected: [null, { reason: [] }] })),
    { seq: 1, type: 'verify', accepted: [{ tick: 1 }], rejected: [] });
});

test('R6 replay bounds to last 200 filtered events; resumes by driver seq across dropped gaps', () => {
  const buffer = createRelayBuffer();
  for (let seq = 1; seq <= 205; seq++) buffer.append(raw('state', { tick: seq }, seq));
  assert.equal(buffer.size, 200);
  assert.equal(buffer.replaySince()[0].seq, 6);
  assert.deepEqual(buffer.replaySince('203').map(e => e.seq), [204, 205]);
  assert.deepEqual(buffer.replaySince('205'), []);
  assert.equal(buffer.replaySince('1').length, 200);
  assert.equal(buffer.replaySince('999').length, 200, 'stale prior-run cursor beyond max replays current run');
  assert.equal(buffer.append(raw('unknown', {}, 206)), null);
  buffer.append(raw('state', { tick: 207 }, 207));
  assert.deepEqual(buffer.replaySince('206').map(e => e.seq), [207]);
  assert.equal(buffer.append(raw('state', {}, 205)), null);
  assert.equal(buffer.append(raw('state', {}, 207)), null);
  for (const cursor of ['invalid', '1\n', '-1', '1.5', '9007199254740992', ['207']]) assert.equal(buffer.replaySince(cursor).length, 200);
});

test('R6 replay snapshots cannot mutate stored data and explicit run reset allows seq restart', () => {
  const buffer = createRelayBuffer({ capacity: 2 });
  const input = raw('verify', { accepted: [{ tick: 1, type: 'DrawLine', from: 0, to: 4 }] }, 1);
  const event = buffer.append(input);
  input.accepted[0].from = 999;
  assert.equal(buffer.replaySince()[0].accepted[0].from, 0);
  assert.throws(() => { event.accepted[0].from = 999; }, TypeError);
  const snapshot = buffer.replaySince(); snapshot.pop();
  assert.equal(buffer.size, 1);
  buffer.append(raw('driver_end', { outcome: 'won' }, 9));
  buffer.reset();
  assert.equal(buffer.size, 0);
  assert.equal(buffer.append(raw('driver_start', { mode: 'attach' }, 1)).seq, 1);
  assert.deepEqual(buffer.replaySince('9').map(e => e.seq), [1]);
  for (const capacity of [0, -1, 1.5, 201, Infinity]) assert.throws(() => createRelayBuffer({ capacity }), /capacity/);
});

test('R6 SSE uses driver seq for id, safely frames text, and refilters untrusted serialization input', () => {
  const event = raw('kane', { iter: 2, event: { step: 3, status: 'done', remark: 'line one\n\nid: 99\ndata: extra' }, secret: 'private' }, 17);
  const encoded = serializeSse(event);
  assert.equal(encoded.split('\n').length, 4);
  assert.equal(encoded.split('\n')[0], 'id: 17');
  assert.deepEqual(JSON.parse(encoded.split('\n')[1].slice(6)), filterDriverEvent(event));
  assert.equal(serializeSse(raw('unknown')), null);
  assert.doesNotMatch(encoded, /private|secret/);
  const alreadyFiltered = filterDriverEvent(raw('kane', { event: { type: 'run_end', status: 'passed', summary: 'done' } }));
  assert.equal(JSON.parse(serializeSse(alreadyFiltered).split('\n')[1].slice(6)).event.summary, 'done');
});
