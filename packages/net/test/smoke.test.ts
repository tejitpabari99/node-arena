import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NET_PACKAGE } from '../src/index.js';

test('net package scaffold loads', () => {
  assert.equal(NET_PACKAGE, '@node-arena/net');
});
