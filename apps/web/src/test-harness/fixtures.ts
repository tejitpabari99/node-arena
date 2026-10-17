import type { ContentFileMap } from '@node-arena/content';
/** Authored test campaign only; never changes the shipped sample/content identities. */
export function fixtureFiles(source: ContentFileMap, mode: string): ContentFileMap {
  const files = { ...source };
  const samplePath = 'data/levels/sample.json';
  const sample = JSON.parse(files[samplePath] as string);
  delete files[samplePath];
  for (const p of Object.keys(files)) if (/^data\/levels\/\d{2}-/.test(p)) delete files[p]; // shipped campaign levels
  const standard = JSON.parse(files['data/archetypes/standard.json'] as string);
  if (mode === 'stress') {
    standard.components.garrison.cap = 100000;
    standard.components.generates.ratePerSec = 200;
    files['data/archetypes/standard.json'] = JSON.stringify(standard);
    const troop = JSON.parse(files['data/troops/regular.json'] as string);
    troop.speed = 0.1;
    files['data/troops/regular.json'] = JSON.stringify(troop);
  }
  if (mode === 'visual') {
    files['data/archetypes/fixture-building.json'] = JSON.stringify({ ...standard, id: 'fixture-building', visual: 'tower.fixture' });
  }
  if (mode === 'capture' || mode === 'victory') {
    files['data/archetypes/fixture-defender.json'] = JSON.stringify({ ...standard, id: 'fixture-defender', components: { garrison: { cap: 1 }, drawsLines: { extraSlotAbove: [] }, capturable: {} } });
  }
  for (let i = 1; i <= 20; i++) {
    const towers = sample.towers.map((t: Record<string, unknown>) => ({ ...t }));
    if (mode === 'visual') towers[0].archetype = 'fixture-building';
    if (mode === 'cut') {
      towers[2].owner = 'p1';
      towers[2].pos = { x: -40, y: 30 };
      towers.push({ ...towers[2], id: 't4', owner: null, pos: { x: 0, y: 30 } });
    }
    if (mode === 'capture' || mode === 'victory') {
      towers[1].garrison = 1;
      towers[1].archetype = 'fixture-defender';
      towers[2].owner = 'p1';
      towers[2].garrison = 20;
    } else if (mode === 'stress') towers[0].garrison = 100000;
    files[`data/levels/${String(i).padStart(2, '0')}-fixture.json`] = JSON.stringify({
      ...sample, id: `fixture-${i}`, name: `Fixture ${i}`, order: i,
      towers, ...(mode === 'timeout' ? { timeLimitSec: 1 } : {}),
    });
  }
  return files;
}
