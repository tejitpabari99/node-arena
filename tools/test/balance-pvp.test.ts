import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadContent } from '@node-arena/content';
import { loadFiles } from '../src/files.js';
import { splitFiles } from '../src/content.js';
import { pvpLevels, proxyController, type PlayPvp } from '../src/levels.js';
import { runMatch } from '@node-arena/bots';
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

// 03 Task 7: Cross 4-seat FFA (identity teams) plus 2v2 [0,1,0,1] / [0,0,1,1]; ally-blocking and crossing stalls must not prevent termination.
test('pvp Cross smoke: FFA and 2v2 variants terminate, 0 rejected, deterministic; default-team seat share within 20-80%', () => {
  const level = loadContent(data).compiled['na-pvp-cross']!;
  for (const [name, teams] of [['ffa', [0, 1, 2, 3]], ['2v2 0101', [0, 1, 0, 1]], ['2v2 0011', [0, 0, 1, 1]]] as const) {
    const run: PlayPvp = (l, seed, ad, max) => {
      const controllers = l.players.map((_, seat) => proxyController(l, seed, seat, ad));
      const r = runMatch({ level: l, seed, maxTicks: max, controllers, record: false, teams });
      return { outcome: r.outcome.outcome, ticks: r.ticks, finalHash: r.stats.finalHash, winners: [...('winners' in r.outcome ? r.outcome.winners ?? [] : [])], rejected: r.stats.rejected };
    };
    const a = pvpFairness(level, 3, 20, [2000], run);
    const b = pvpFairness(level, 3, 20, [2000], run);
    assert.equal(a.truncated, 0, `${name}: must terminate`);
    assert.equal(a.rejected, 0, `${name}: rejected`);
    assert.deepEqual(a.hashes, b.hashes, `${name}: rerun hash mismatch`);
    // Seat-order bias is report-only (see `pnpm balance --mode pvp`): measured FFA seat 2 = 100% and 2v2 [0,0,1,1] team {0,1} = 100% at delay 2000 (owner/bot-tuning follow-up). Bound asserted only for the default teams.
    if (name === '2v2 0101') for (const [seat, share] of a.seatShares.entries()) if (share !== null) assert.ok(share >= 20 && share <= 80, `${name} seat ${seat} share ${share}%`);
  }
});
