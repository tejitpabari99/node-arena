import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serverName } from '../src/main.js';

test('server package loads', () => {
  assert.equal(serverName(), '@node-arena/server');
});
