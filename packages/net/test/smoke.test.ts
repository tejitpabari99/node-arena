import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LockstepClient, LockstepServer, PROTOCOL_VERSION, parseClientMessage, toWireOutcome } from '../src/index.js';

test('net package public surface loads', () => {
  assert.equal(typeof PROTOCOL_VERSION, 'number');
  for (const f of [LockstepClient, LockstepServer, parseClientMessage, toWireOutcome]) assert.equal(typeof f, 'function');
});
