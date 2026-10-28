import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { create } from '@node-arena/sim';
import type { Command } from '@node-arena/defs';
import { encodeServer } from '../src/codec.js';
import { endMessage, toWireOutcome, type SimOver } from '../src/outcome.js';
import { parseServerMessage } from '../src/validate.js';

const H = 'abcdef0123456789';

test('victory (elimination) maps verbatim', () => {
  assert.deepEqual(toWireOutcome({ outcome: 'victory', winner: 0, winners: [0, 1] }), { outcome: 'victory', winner: 0, winners: [0, 1] });
});
test('timeLimit maps verbatim', () => {
  assert.deepEqual(toWireOutcome({ outcome: 'timeLimit', winner: 2, winners: [2] }), { outcome: 'timeLimit', winner: 2, winners: [2] });
});
test('draw with tied winners: winner null, winners kept', () => {
  assert.deepEqual(toWireOutcome({ outcome: 'draw', winner: null, winners: [0, 3] }), { outcome: 'draw', winner: null, winners: [0, 3] });
});
test('zero-alive draw: winners []', () => {
  assert.deepEqual(toWireOutcome({ outcome: 'draw', winner: null, winners: [] }), { outcome: 'draw', winner: null, winners: [] });
  assert.deepEqual(toWireOutcome({ outcome: 'draw', winner: null }), { outcome: 'draw', winner: null, winners: [] });
});
test('output does not alias sim winners array', () => {
  const w = [1];
  const out = toWireOutcome({ outcome: 'victory', winner: 1, winners: w });
  out!.winners.push(9);
  assert.deepEqual(w, [1]);
});
test('null and campaign outcomes rejected (null, no throw)', () => {
  assert.equal(toWireOutcome(null), null);
  for (const outcome of ['won', 'lost', 'timeout'] as const) {
    assert.equal(toWireOutcome({ outcome, winner: null }), null);
    assert.equal(endMessage({ outcome, winner: null }, 5, H), null);
  }
  assert.equal(endMessage(null, 5, H), null);
});

test('real pvp sim run to end -> valid end message round-trips', () => {
  const { pvpLevel } = createRequire(import.meta.url)('../../bots/test/pvp-fixture.cjs');
  const level = pvpLevel([0, 1], [0, 1], { limit: 60, levels: [30, 2] });
  const sim = create(level, 1, { teams: [0, 1] });
  const dl: Command = { type: 'DrawLine', player: 0, from: 0, to: 1 };
  let over: SimOver = null;
  for (let n = 0; n < 5000 && over === null; n++) { sim.step(n === 0 ? [dl] : []); over = sim.view.over; }
  assert.ok(over, 'match ended');
  const msg = endMessage(over, sim.view.tick, sim.hash());
  assert.ok(msg);
  assert.equal(msg.outcome.outcome, 'victory');
  assert.deepEqual(msg.outcome.winners, [0]);
  assert.equal(msg.outcome.winner, 0);
  const back = parseServerMessage(encodeServer(msg));
  assert.deepEqual(back, { ok: true, msg });
});
