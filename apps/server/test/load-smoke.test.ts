import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runLoad } from '../scripts/load-smoke.js';

// Anti-rot only (SP10 L9): 3 rooms, a few seconds, NO lateness/RSS thresholds (those are report-only).
test('load-smoke core: 3 bot rooms start and tick', { timeout: 60_000 }, async () => {
  const r = await runLoad({ rooms: 3, seconds: 3, level: 'na-pvp-duel-s', strict: false, quiet: true });
  assert.ok(r.samples.length >= 1, 'sampled');
  assert.equal(r.summary.minRunning, 3, 'all 3 rooms running');
  assert.ok((r.summary.framesPerSecMean as number) > 0, 'tick frames flowed');
  assert.equal(r.summary.errors, 0);
  assert.equal(r.summary.roomClosed, 0);
  assert.equal(r.verdicts.length, 4);
});
