import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadContent } from '@node-arena/content';
import { runMatch } from '@node-arena/bots';
import { loadFiles } from '../src/files.js';
import { splitFiles } from '../src/content.js';
import { buildLock, campaignLevels, validatePvpLevel, parseLevelsLock, PVP_CAP_MARGIN, type PlayPvp, customLevels, pvpLevels, checkLevelsLock, humanSeat, selectLevels, validateLevel, validateLevels, type playProxy } from '../src/levels.js';
import { levelsMarkdown } from '../src/levels-output.js';
import { parseUnsolved, readUnsolved, type UnsolvedEntry } from '../src/unsolved.js';
import { checkSymmetry, readSymmetry } from '../src/pvp-symmetry.js';

const root = resolve(import.meta.dirname, '../..');
const { data } = splitFiles(await loadFiles(resolve(root, 'packages/content')));
const compiled = loadContent(data).compiled;
const entry = (id: string): UnsolvedEntry => ({ id, position: 5, reason: 'test', ownerSignOff: null });

test('Common campaign stays exactly 20 levels, one human seat per level', () => {
  const levels = campaignLevels(data);
  assert.equal(levels.length, 20);
  for (const l of levels) assert.ok(humanSeat(compiled[l.id]!) >= 0);
});
test('solvable level passes (a)-(c): no rejects, idle never wins, seed-1 rerun equal', () => {
  const report = validateLevel(compiled['levelview-1']!, 4, 2, null);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.idleWins, 0); assert.equal(report.deterministic, true);
  assert.ok(report.totalWins > 0); assert.equal(report.runs, 6); assert.deepEqual(report.warnings, []);
});
test('allowlisted level that the proxy can solve is reported as a warning, not a failure', () => {
  const report = validateLevel(compiled['levelview-1']!, 4, 1, entry('levelview-1'));
  assert.equal(report.ok, true); assert.match(report.warnings.join(' '), /Now solvable/);
});
test('unsolvable level fails unless allowlisted (warning); capped runs are not failures', () => {
  // Small cap forces 0 wins quickly; the stalemate level never finishes within it.
  const bad = validateLevel(compiled['levelview-2-ab']!, 5, 1, null, 400);
  assert.equal(bad.ok, false); assert.match(bad.errors.join(' '), /Unsolvable by proxy/);
  assert.equal(bad.truncated, bad.runs);
  const listed = validateLevel(compiled['levelview-2-ab']!, 5, 1, entry('levelview-2-ab'), 400);
  assert.equal(listed.ok, true); assert.match(listed.warnings.join(' '), /Unsolved by proxy.*pending/);
});
test('idle human victory fails the gate even when all proxies win', () => {
  const level = structuredClone(compiled['levelview-1']!);
  const seat = humanSeat(level);
  for (const building of level.buildings) building.owner = seat;
  const report = validateLevel(level, 4, 1, null);
  assert.equal(report.ok, false);
  assert.equal(report.idleWins, 1);
  assert.equal(report.totalWins, 3);
  assert.match(report.errors.join(' '), /Idle human won 1\/1/);
});

test('rejected command exceptions fail every affected idle/proxy run, despite allowlisting', () => {
  const level = compiled['levelview-1']!;
  const reject: typeof playProxy = (fixture, seed) => {
    const player = humanSeat(fixture);
    // Exercise the real harness rejection path, rather than fabricating an error message.
    runMatch({ level: fixture, seed, maxTicks: 1, controllers: [{ player, commands: [
      { tick: 0, cmd: { type: 'DrawLine', player, from: -1, to: -1 } },
    ] }] });
    assert.fail('Malformed command must be rejected');
  };
  const report = validateLevel(level, 4, 1, entry(level.id), 1, reject);
  assert.equal(report.ok, false);
  for (const proxy of ['idle', 'proxy-500', 'proxy-1000', 'proxy-2000']) {
    assert.ok(report.errors.some(error => error.startsWith(`${proxy} seed 1: Match rejected 1 command(s)`)), JSON.stringify(report.errors));
  }
});

test('simulation invariant exceptions fail every affected idle/proxy run, despite allowlisting', () => {
  const level = compiled['levelview-1']!;
  // Inject only the simulation failure boundary; the real gate must preserve its diagnostic.
  const invariant: typeof playProxy = () => { throw new Error('invariant: building 0 level out of range'); };
  const report = validateLevel(level, 4, 1, entry(level.id), 1, invariant);
  assert.equal(report.ok, false);
  for (const proxy of ['idle', 'proxy-500', 'proxy-1000', 'proxy-2000']) {
    assert.ok(report.errors.some(error => error.startsWith(`${proxy} seed 1: invariant: building 0 level out of range`)), JSON.stringify(report.errors));
  }
});

test('default 20000-tick cap is accepted and printed as Capped for an allowlisted stalemate', () => {
  const report = validateLevel(compiled['levelview-2-ab']!, 5, 1, entry('levelview-2-ab'));
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.truncated, 3);
  assert.equal(report.lock.outcome, 'truncated');
  assert.equal(report.lock.ticks, 20000);
  assert.equal(report.deterministic, true);
  assert.match(levelsMarkdown([report]), /\| Capped \|/);
  assert.match(levelsMarkdown([report]), /\| 3\/3 \| true \|/);
});

test('validateLevels rejects an allowlist id that is not a campaign level and bad seeds', () => {
  assert.throws(() => validateLevels(data, [entry('nope')], 'levelview-1', 1), /Unknown level nope/);
  assert.throws(() => validateLevels(data, [], 'levelview-1', 0), /Seeds/);
  assert.throws(() => validateLevels(data, [], 'missing', 1), /Unknown or empty/);
});
test('levels lock: matching, stale and missing entries', () => {
  const report = validateLevel(compiled['levelview-1']!, 4, 1, null);
  const lock = buildLock([report]);
  assert.deepEqual(checkLevelsLock([report], lock), []);
  assert.match(checkLevelsLock([report], { 'levelview-1': { ...lock['levelview-1']!, finalHash: '0' } })[0]!, /differs/);
  assert.match(checkLevelsLock([report], {})[0]!, /missing/);
});
test('unsolved-by-proxy.json schema: committed file is valid and ids exist; bad shapes fail', async () => {
  const list = await readUnsolved(resolve(root, 'tools/unsolved-by-proxy.json'));
  const ids = new Set(selectLevels(data).levels.map(l => l.id));
  assert.ok(list.length > 0); for (const e of list) assert.ok(ids.has(e.id), e.id);
  assert.throws(() => parseUnsolved([{ id: 'a', position: 1, reason: 'x' }]), /Invalid/);
  assert.throws(() => parseUnsolved([{ id: 'a', position: 1, reason: 'x', ownerSignOff: null, extra: 1 }]), /Invalid/);
  assert.throws(() => parseUnsolved([entry('a'), entry('a')]), /Duplicate/);
});
test('validate:levels CLI: one level, JSON report with levels payload; bad options fail', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', 'validate:levels', '--format', 'json', ...args], { cwd: root, encoding: 'utf8' });
  const ok = run('--levels', 'levelview-1', '--seeds', '1', '--base', process.env.VERSION_GUARD_BASE || 'HEAD');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const report = JSON.parse(ok.stdout); assert.equal(report.levels.length, 1); assert.equal(report.levels[0].id, 'levelview-1');
  assert.equal(run('--seeds', '0').status, 1);
  assert.equal(run('--levels', 'unknown', '--seeds', '1').status, 1);
});

test('pvp Duel S compiles, is listed in pvp only, and is d2-symmetric', async () => {
  const loaded = loadContent(data);
  const level = loaded.compiled['na-pvp-duel-s']!;
  assert.ok(level);
  assert.equal(level.objective, 'pvp');
  assert.equal(level.buildings.length, 7);
  assert.deepEqual(pvpLevels(data), [{ id: 'na-pvp-duel-s', position: 1 }]);
  assert.equal(campaignLevels(data).length, 20);
  assert.ok(!campaignLevels(data).some(l => l.id.startsWith('na-pvp-')));
  assert.ok(!customLevels(data).some(l => l.id.startsWith('na-pvp-')));
  const kinds = await readSymmetry(resolve(root, 'tools/pvp-symmetry.json'));
  assert.equal(checkSymmetry(level, kinds['na-pvp-duel-s']!).ok, true);
});

const duel = () => structuredClone(compiled['na-pvp-duel-s']!);
const kinds = await readSymmetry(resolve(root, 'tools/pvp-symmetry.json'));
test('pvp branch passes Duel S: symmetry, idle draw, 4 seeds x 2 delays, deterministic, no humanSeat', () => {
  const report = validatePvpLevel(duel(), 1, 4, kinds['na-pvp-duel-s']);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.runs, 8); assert.equal(report.deterministic, true); assert.equal(report.humanSeat, undefined);
  assert.deepEqual(Object.keys(report.pvp!.outcomes).sort(), ['1/1000', '1/2000', '2/1000', '2/2000', '3/1000', '3/2000', '4/1000', '4/2000']);
  assert.ok(['victory', 'timeLimit', 'draw'].includes(report.lock.outcome));
  assert.match(levelsMarkdown([report]), /pvp d2: 1\/1000=/);
});
test('validateLevels routes pvp through the pvp branch and keeps it out of selectLevels', () => {
  const reports = validateLevels(data, [], 'na-pvp-duel-s', 1, undefined, kinds);
  assert.equal(reports.length, 1); assert.equal(reports[0]!.ok, true, JSON.stringify(reports[0]!.errors)); assert.ok(reports[0]!.pvp);
  assert.throws(() => selectLevels(data, 'na-pvp-duel-s'), /Unknown or empty/);
  const missing = validateLevels(data, [], 'na-pvp-duel-s', 1);
  assert.equal(missing[0]!.ok, false); assert.match(missing[0]!.errors.join(' '), /no entry in tools\/pvp-symmetry\.json/);
});
test('pvp branch fails: missing sidecar entry, asymmetric level', () => {
  const none = validatePvpLevel(duel(), 1, 1, undefined);
  assert.equal(none.ok, false); assert.match(none.errors.join(' '), /pvp-symmetry\.json/);
  const bad = duel(); bad.buildings[0]!.x += 0.001;
  const r = validatePvpLevel(bad, 1, 1, 'd2');
  assert.equal(r.ok, false); assert.match(r.errors.join(' '), /Symmetry d2 fails/);
});
test('pvp branch fails: idle seats not a draw (seat 0 holds an extra building)', () => {
  const lvl = duel();
  lvl.buildings.find(b => b.owner === 1)!.owner = 0; // seat 0 holds one more building: timeLimit, not draw
  const r = validatePvpLevel(lvl, 1, 1, 'd2');
  assert.equal(r.ok, false); assert.match(r.errors.join(' '), /Idle seats seed 1 ended (timeLimit|victory); expected draw/);
});
test('pvp branch fails: rejected command, non-termination, rerun hash mismatch', () => {
  const ok: PlayPvp = () => ({ outcome: 'draw', ticks: 10, finalHash: 'a' });
  const reject: PlayPvp = (l, seed, ad) => { if (ad === 1000) throw new Error('Match rejected 1 command(s) at tick 3'); return ok(l, seed, ad, 0); };
  const r1 = validatePvpLevel(duel(), 1, 2, 'd2', reject);
  assert.equal(r1.ok, false); assert.match(r1.errors.join(' '), /proxy-1000 seed 2: Match rejected 1 command/);
  let seen = 0;
  const stuck: PlayPvp = (_l, _s, ad, cap) => { seen = cap; return { outcome: ad === 'idle' ? 'draw' : 'truncated', ticks: cap, finalHash: 'a' }; };
  const r2 = validatePvpLevel(duel(), 1, 1, 'd2', stuck);
  assert.equal(r2.ok, false); assert.match(r2.errors.join(' '), /did not terminate within 9700 ticks/); assert.equal(seen, 480 * 20 + PVP_CAP_MARGIN);
  let calls = 0;
  const flaky: PlayPvp = (_l, _s, ad) => ({ outcome: 'draw', ticks: 10, finalHash: ad === 2000 && ++calls > 1 ? 'b' : 'a' });
  const r3 = validatePvpLevel(duel(), 1, 1, 'd2', flaky);
  assert.equal(r3.ok, false); assert.match(r3.errors.join(' '), /rerun final hash differs/);
});
test('levels lock accepts victory|timeLimit outcomes and the committed Duel S entry', async () => {
  const entry = { ticks: 5, finalHash: '0123456789abcdef' };
  for (const outcome of ['victory', 'timeLimit', 'draw']) assert.ok(parseLevelsLock({ x: { outcome, ...entry } }));
  assert.throws(() => parseLevelsLock({ x: { outcome: 'bogus', ...entry } }), /Invalid levels lock entry/);
  const lock = parseLevelsLock(JSON.parse(await (await import('node:fs/promises')).readFile(resolve(root, 'tools/levels-lock.json'), 'utf8')));
  const report = validatePvpLevel(duel(), 1, 1, 'd2');
  assert.deepEqual(checkLevelsLock([report], lock), []);
});
