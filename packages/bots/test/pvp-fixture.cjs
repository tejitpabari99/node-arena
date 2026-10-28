// Test-only pvp fixture (SP03 owns real maps). Derived from the compiled golden level; never listed or locked.
const fx = require('../../sim/test/fixtures.cjs');

/** owners[i] = seat owning building i (-1 neutral); teams[i] = team of seat i. levels[i] optional garrison. */
function pvpLevel(owners, teams, { limit = 30, levels = [] } = {}) {
  const l = structuredClone(fx.compiledGolden());
  while (l.players.length < teams.length) l.players.push({ id: `p${l.players.length + 1}`, kind: 'human', colorKey: 'green' });
  l.players.forEach((p, i) => { p.kind = 'human'; p.team = teams[i]; });
  l.objective = 'pvp';
  l.timeLimitSec = limit;
  l.bots = [];
  l.elements = [];
  l.buildings = l.buildings.slice(0, owners.length);
  l.buildings.forEach((b, i) => { b.owner = owners[i]; b.level = levels[i] ?? b.level; });
  return l;
}
module.exports = { pvpLevel, fx };
