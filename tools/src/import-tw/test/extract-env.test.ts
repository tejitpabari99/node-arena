import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_EXTRACT_MESSAGE, requireTwExtract, twExtractRoot } from '../env.js';

test('TW_EXTRACT unset or blank -> null', () => {
  assert.equal(twExtractRoot({}), null);
  assert.equal(twExtractRoot({ TW_EXTRACT: '  ' }), null);
  assert.equal(twExtractRoot({ TW_EXTRACT: '/x' }), '/x');
});

test('requireTwExtract exits 2 with a one-line message when unset', () => {
  let code = -1;
  let out = '';
  const exit = ((c: number) => { code = c; throw new Error('exit'); }) as (c: number) => never;
  assert.throws(() => requireTwExtract({}, exit, (l) => { out += l; }), /exit/);
  assert.equal(code, 2);
  assert.equal(out, `${NO_EXTRACT_MESSAGE}\n`);
  assert.equal(out.trimEnd().split('\n').length, 1);
  assert.equal(requireTwExtract({ TW_EXTRACT: '/x' }, exit), '/x');
});
