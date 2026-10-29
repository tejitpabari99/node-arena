const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
require('tsx/cjs');
const { pvpScenarios } = require('./golden/scenarios-pvp.ts');
const { runGoldens } = require('./golden/run.ts');
const { metadata } = require('./fixtures.cjs');

// Separate bundle (same format as baseline.json) so campaign goldens/baseline inputs stay untouched; `pnpm replay:verify golden` plays it.
// Regenerate with: UPDATE_FORFEIT_GOLDEN=1 node --test packages/sim/test/forfeit-golden.test.cjs
const file = path.join(__dirname, 'golden', 'pvp-forfeit.json');
const versions = ['rulesVersion', 'schemaVersion', 'contentVersion'];
const build = () => ({
  format: 1,
  metadata: Object.fromEntries(versions.map((k) => [k, metadata[k]])),
  scenarios: JSON.parse(JSON.stringify(pvpScenarios)),
  results: runGoldens(metadata, pvpScenarios).map(({ events, ...r }) => JSON.parse(JSON.stringify(r))),
});

test('covers R-FFT-03: pvp forfeit golden matches the committed bundle; forfeit/elimination/draw shape', () => {
  const fresh = build();
  if (process.env.UPDATE_FORFEIT_GOLDEN === '1') fs.writeFileSync(file, JSON.stringify(fresh, null, 2) + '\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), fresh);
  const r = fresh.results[0].replay;
  assert.deepEqual(r.commands.filter((c) => c.cmd.type === 'Forfeit').map((c) => c.cmd.player), [0, 0, 1, 3, 2]);
  assert.equal(r.outcome.outcome, 'draw');
  assert.equal(r.outcome.winner, null);
});
