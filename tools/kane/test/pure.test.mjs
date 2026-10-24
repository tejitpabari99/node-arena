import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, mixed } from './fixtures.mjs';

const load = name => import(`../lib/${name}.mjs`);
const objective = await load('objective'), balance = await load('balance');
const events = await load('events'), delta = await load('delta'), outcomes = await load('outcomes');
const api = (module, key) => { assert.equal(typeof module[key], 'function', `${key} must be implemented`); return module[key]; };

test('objective selects capture, attack after neutral captures, and cut only without ready pairs', () => {
  const phase = api(objective, 'objectivePhase');
  assert.equal(phase(initial), 'capture');
  const captured = structuredClone(initial);
  captured.letters.forEach(row => { if (row.owner < 0) row.owner = 0; });
  assert.equal(phase(captured), 'attack');
  captured.pairs = [{ state: 'active' }];
  assert.equal(phase(captured), 'cut');
  captured.pairs.push({ state: 'ready' });
  assert.equal(phase(captured), 'attack');
  captured.pairs = [];
  assert.equal(phase(captured), 'attack');
});

test('objectives stay below 120 words, carry strategy and never select concrete buttons', () => {
  const build = api(objective, 'buildObjective');
  const captured = structuredClone(initial);
  captured.letters.forEach(row => { if (row.owner < 0) row.owner = 0; });
  const capture = build(initial, { moves: 2 }), attack = build(captured);
  const cut = build({ ...captured, pairs: [{ state: 'active' }] });
  assert.match(capture, /2 moves/);
  assert.match(capture, /neutral.*lowest level/);
  assert.match(attack, /red-owned/);
  assert.match(cut, /Double-click one red.*active/);
  assert.doesNotMatch(cut, /single click|green.*ready/);
  for (const text of [capture, attack, cut]) {
    assert.ok(text.trim().split(/\s+/).length < 120);
    assert.match(text, /do not navigate or reload/i);
    assert.match(text, /bottom panel/);
    assert.doesNotMatch(text, /[A-E]\s*→|b[0-4]|\b(?:A|B|C|D|E) button/);
    assert.match(text, /exact text/);
  }
  assert.throws(() => build(initial, { moves: 0 }), RangeError);
});

test('balance parser tolerates update banners and rejects malformed or missing balances', () => {
  const parse = api(balance, 'parseBalance');
  assert.equal(parse('Update 0.9.1 available\nAvailable credits: 762.8408\n'), 762.8408);
  assert.equal(parse('Available credits: 0'), 0);
  for (const text of ['', 'Unauthenticated', 'Available credits: 2.3.4', 'Available credits: -2', 'Available credits: Infinity']) {
    assert.throws(() => parse(text), /credit/i);
  }
});

test('NDJSON encoding protects v1 common keys and serializes exactly one newline-terminated object', () => {
  const encode = api(events, 'encodeEvent');
  const line = encode('warn', { code: 'extra_tab', msg: 'one\ntwo', v: 9, seq: 99, ts: 'bad', type: 'fake' },
    { seq: 4, ts: '2026-10-24T01:02:03.000Z' });
  assert.equal(line.split('\n').length, 2);
  assert.deepEqual(JSON.parse(line), { code: 'extra_tab', msg: 'one\ntwo', v: 1, seq: 4, ts: '2026-10-24T01:02:03.000Z', type: 'warn' });
  const names = ['driver_start', 'chrome_ready', 'page_ready', 'credits', 'state', 'idle', 'run_start', 'kane', 'run_end', 'verify', 'stall', 'warn', 'fallback', 'game_over', 'driver_end'];
  assert.deepEqual(events.EVENT_TYPES, names);
  assert.ok(Object.isFrozen(events.EVENT_TYPES));
  for (const type of names) assert.equal(JSON.parse(encode(type, {}, { seq: 1, ts: '2026-10-24T00:00:00Z' })).type, type);
  assert.throws(() => encode('invented', {}, { seq: 1, ts: '2026-10-24T00:00:00Z' }), /type/i);
});

test('event encoder advances sequence across event types with injected timestamps', () => {
  const create = api(events, 'createEventEncoder');
  const encode = create({ now: () => new Date('2026-10-24T00:00:00Z'), startSeq: 7 });
  assert.deepEqual(['state', 'run_start', 'verify'].map(type => JSON.parse(encode(type)).seq), [8, 9, 10]);
  assert.equal(JSON.parse(encode('driver_end')).ts, '2026-10-24T00:00:00.000Z');
});

test('Kane line wrapper preserves raw step objects without type and typed run_end records', () => {
  const wrap = api(events, 'wrapKaneLine');
  assert.deepEqual(wrap('{"step":1,"status":"done","remark":"clicked"}', 2), { iter: 2, event: { step: 1, status: 'done', remark: 'clicked' } });
  assert.deepEqual(wrap('{"type":"run_end","credits_consumed":9.1,"extra":true}', 3), { iter: 3, event: { type: 'run_end', credits_consumed: 9.1, extra: true } });
  assert.equal(wrap(' \n', 1), null);
  for (const line of ['update banner', 'null', '[]', '4']) assert.throws(() => wrap(line, 1));
});

test('delta emits exact numeric draw/cut rows when accepted counts identify every new command', () => {
  const compute = api(delta, 'acceptedMoveDelta');
  const after = structuredClone(mixed);
  after.human.commands.splice(1, 1); after.human.rejected = [];
  assert.deepEqual(compute(initial, after), { accepted: [
    { tick: 0, type: 'DrawLine', from: 0, to: 2 }, { tick: 1, type: 'CutLine', from: 0, to: 2 },
  ], rejected: [], drawn: 1, cut: 1, acceptedCount: 2, ambiguous: false });
  assert.deepEqual(compute(after, after), { accepted: [], rejected: [], drawn: 0, cut: 0, acceptedCount: 0, ambiguous: false });
});

test('delta never invents rejected pair attribution from the shipped command-only rejection shape', () => {
  const compute = api(delta, 'acceptedMoveDelta');
  assert.deepEqual(compute(initial, mixed), { accepted: [{ tick: 1, type: 'CutLine', from: 0, to: 2 }],
    rejected: [{ reason: 'blocked-obstacle' }], drawn: 1, cut: 1, acceptedCount: 2, ambiguous: true });
  const onlyRejected = structuredClone(initial);
  onlyRejected.human.commands = [mixed.human.commands[1]];
  onlyRejected.human.rejected = mixed.human.rejected;
  assert.deepEqual(compute(initial, onlyRejected), { accepted: [], rejected: [{ reason: 'blocked-obstacle' }], drawn: 0, cut: 0, acceptedCount: 0, ambiguous: false });
});

test('delta handles repeated same-pair draws/cuts and ignores prior rejections and nonhuman commands', () => {
  const compute = api(delta, 'acceptedMoveDelta');
  const after = structuredClone(mixed);
  after.human.commands.push(
    { tick: 2, cmd: { type: 'DrawLine', player: 0, from: 0, to: 2 } },
    { tick: 3, cmd: { type: 'CutLine', player: 0, from: 0, to: 2 } },
    { tick: 4, cmd: { type: 'DrawLine', player: 1, from: 3, to: 1 } },
  );
  after.human.drawn++; after.human.cut++;
  assert.deepEqual(compute(mixed, after), { accepted: [
    { tick: 2, type: 'DrawLine', from: 0, to: 2 }, { tick: 3, type: 'CutLine', from: 0, to: 2 },
  ], rejected: [], drawn: 1, cut: 1, acceptedCount: 2, ambiguous: false });
});

test('delta rejects reset histories instead of reporting bogus progress', () => {
  const compute = api(delta, 'acceptedMoveDelta');
  assert.throws(() => compute(mixed, initial), /reset|history/i);
});

test('exit mapping follows authoritative game outcomes and infrastructure reasons', () => {
  const code = api(outcomes, 'exitCodeFor');
  for (const [outcome, expected] of Object.entries({ won: 0, lost: 10, timeout: 11, stalled: 20,
    credit_floor: 21, auth: 21, chrome: 22, not_ready: 23, max_runs: 30, error: 1 })) assert.equal(code(outcome), expected);
  assert.equal(code('completed'), 1);
  assert.equal(code(null), 1);
});

test('delta does not attribute an older pending acceptance to a newly rejected same-type row', () => {
  const compute = api(delta, 'acceptedMoveDelta');
  const before = structuredClone(initial);
  before.human.commands = [mixed.human.commands[0]];
  const after = structuredClone(before);
  after.human.commands.push(mixed.human.commands[1]);
  after.human.drawn = 1;
  after.human.rejected = mixed.human.rejected;
  assert.deepEqual(compute(before, after), { accepted: [], rejected: [{ reason: 'blocked-obstacle' }],
    drawn: 1, cut: 0, acceptedCount: 1, ambiguous: true });
});

test('event encoder rejects non-ISO timestamp and invalid sequence values', () => {
  const encode = api(events, 'encodeEvent');
  assert.throws(() => encode('state', {}, { seq: 0, ts: '2026-10-24T00:00:00Z' }), /seq/i);
  assert.throws(() => encode('state', {}, { seq: 1, ts: 'October 24, 2026' }), /ISO/i);
});
