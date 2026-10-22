import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { checkParked, parseParked } from '../src/parked.js';

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
