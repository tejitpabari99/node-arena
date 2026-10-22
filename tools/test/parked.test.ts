import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { checkParked, parkedArtifacts, parseParked } from '../src/parked.js';
import { PARKED_COMMANDS } from '../src/parked-commands.js';

const root = resolve(import.meta.dirname, '../..');
const empty = '# PARKED=( "commented:SP01" )\nPARKED=(\n)\n';
const filled = 'PARKED=(\n  "sim:golden:SP03"\n  "check:rules:SP04"\n)\n';

test('parseParked reads active entries and ignores comments', () => {
  assert.deepEqual(parseParked(empty), []);
  assert.deepEqual(parseParked(filled), [{ gate: 'sim:golden', owner: 'SP03' }, { gate: 'check:rules', owner: 'SP04' }]);
});
test('parseParked rejects entries without an SP owner and missing arrays', () => {
  assert.throws(() => parseParked('PARKED=( "sim:golden" )'), /Malformed/);
  assert.throws(() => parseParked('echo hi'), /not found/);
});
test('default mode lists and passes', () => {
  const r = checkParked(filled, false);
  assert.equal(r.ok, true);
  assert.match(r.text, /PARKED\(SP03\) sim:golden/);
  assert.equal(checkParked(empty, false).ok, true);
});
test('strict mode fails when non-empty and passes when empty', () => {
  assert.equal(checkParked(filled, true).ok, false);
  assert.equal(checkParked(empty, true).ok, true);
});
test('CLI check:parked --strict runs on the real ci.sh and rejects unknown flags', () => {
  const run = (...a: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'tools/src/cli.ts', 'check:parked', ...a], { cwd: root, encoding: 'utf8' });
  assert.equal(run().status, 0);
  assert.equal(run('--bogus').status, 2);
});

test('strict mode also fails on parked artifacts even when the PARKED list is empty', () => {
  const r = checkParked(empty, true, ['tools/src/_parked exists']);
  assert.equal(r.ok, false);
  assert.match(r.text, /PARKED artifact: tools\/src\/_parked exists/);
  assert.equal(checkParked(empty, false, ['x']).ok, true, 'default mode only lists');
});
test('parkedArtifacts reports _parked dirs and a non-empty refusal list', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'parked-'));
  assert.deepEqual(parkedArtifacts(dir, {}), []);
  mkdirSync(resolve(dir, 'tools/src/_parked'), { recursive: true });
  assert.deepEqual(parkedArtifacts(dir, {}), ['tools/src/_parked exists']);
  mkdirSync(resolve(dir, 'tools/test/_parked'), { recursive: true });
  assert.equal(parkedArtifacts(dir, { balance: 'SP06' }).length, 3);
});
test('PARKED_COMMANDS owners agree with ci.sh PARKED entries; the real repo lists its artifacts', () => {
  const entries = parseParked(readFileSync(resolve(root, 'scripts/ci.sh'), 'utf8'));
  for (const [command, owner] of Object.entries(PARKED_COMMANDS)) {
    const gate = entries.find(e => e.gate === command);
    if (gate) assert.equal(gate.owner, owner, command);
  }
  assert.ok(parkedArtifacts(root).some(a => a.startsWith('cli command validate:levels')));
  assert.ok(!parkedArtifacts(root).some(a => a.includes('replay')), 'replay is un-parked');
});
