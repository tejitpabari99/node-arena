import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadContent } from '@node-arena/content';
import { loadFiles } from '../src/files.js';
import { splitFiles } from '../src/content.js';
import { pvpLevels } from '../src/levels.js';
import { pvpFairness } from '../src/balance-pvp.js';

const root = resolve(import.meta.dirname, '../..');
const { data } = splitFiles(await loadFiles(resolve(root, 'packages/content')));

// 03 R9 / D5: gated smoke, bounds only (never exact values; bot changes shift results). Seat-order bias is reported by `pnpm balance --mode pvp`, not tuned here.
test('pvp self-play smoke (20 seeds, delay 2000): terminates, 0 rejected, rerun hashes equal, seat decisive share within 20-80%', () => {
  const { compiled } = loadContent(data);
  const maps = pvpLevels(data);
  assert.ok(maps.length >= 1);
  for (const map of maps) {
    const level = compiled[map.id]!;
    const a = pvpFairness(level, map.position, 20, [2000]);
    const b = pvpFairness(level, map.position, 20, [2000]);
    assert.equal(a.runs, 20, map.id);
    assert.equal(a.truncated, 0, `${map.id}: runs must end victory|timeLimit|draw`);
    assert.equal(a.victory + a.timeLimit + a.draws, a.runs, map.id);
    assert.equal(a.rejected, 0, `${map.id}: rejected commands`);
    assert.deepEqual(a.hashes, b.hashes, `${map.id}: rerun hash mismatch`);
    // Vacuous when no decisive run (all draws): shares are null and nothing is asserted.
    for (const [seat, share] of a.seatShares.entries()) if (share !== null) assert.ok(share >= 20 && share <= 80, `${map.id} seat ${seat} decisive share ${share}% outside 20-80%`);
  }
});
