import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { loadContent, compileLevel, validateContent } from '../../../content/dist/index.js';
import { Sfc32 } from '../../../sim/dist/index.js';

export async function authoredFiles() {
  const root = new URL('../../../content/', import.meta.url);
  const files = { 'content.json': await readFile(new URL('content.json', root), 'utf8') };
  async function visit(path) {
    for (const entry of await readdir(new URL(path, root), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (child.endsWith('.json')) files[child] = await readFile(new URL(child, root), 'utf8');
    }
  }
  await visit('data');
  return files;
}

// Fixed PRNG keeps the test corpus reproducible. All variation goes through the real
// authored schema/loader/compiler, including milli-units and inherited profiles.
export async function compiledCorpus() {
  const files = await authoredFiles();
  assert.deepEqual(validateContent(files).errors, []);
  const loaded = loadContent(files);
  const levels = Object.values(loaded).filter(entity => 'towers' in entity).map(entity => compileLevel(loaded, entity.id));
  const rng = new Sfc32(704);
  const choose = values => values[rng.next() % values.length];
  const personalities = ['rusher', 'turtle', 'economist', 'opportunist'];
  for (let i = 0; i < 8; i++) {
    const map = structuredClone(files);
    const level = JSON.parse(map['data/levels/sample.json']);
    level.id = `random-${i}`;
    level.timeLimitSec = 12 + i;
    level.bounds = { w: 240, h: 160 };
    level.players = [
      { id: 'p1', kind: 'human', colorKey: 'player.1', team: 'p1' },
      { id: 'b1', kind: 'bot', colorKey: 'player.2', team: 'b1', botProfile: `${personalities[i % 4]}-${choose(['easy', 'hard', 'expert'])}` },
      { id: 'b2', kind: 'bot', colorKey: 'player.3', team: 'b2', botProfile: `${personalities[(i + 1) % 4]}-normal` },
    ];
    level.towers = Array.from({ length: 5 + i % 4 }, (_, t) => ({
      id: `t${t}`, archetype: choose(['small', 'standard', 'large']),
      pos: { x: -90 + (t % 4) * 60, y: -35 + Math.floor(t / 4) * 70 },
      owner: t < 3 ? level.players[t].id : choose([null, 'p1', 'b1', 'b2']),
      garrison: choose([0, 5, 10, 19]),
    }));
    level.overrides = { troops: { regular: { speed: choose([3, 10, 25]) } }, archetypes: {
      standard: { components: { garrison: { cap: choose([30, 50, 90]) }, drawsLines: { extraSlotAbove: choose([[], [10], [10, 20]]) } } },
    } };
    delete map['data/levels/sample.json'];
    map[`data/levels/${level.id}.json`] = level;
    assert.deepEqual(validateContent(map).errors, [], level.id);
    levels.push(compileLevel(loadContent(map), level.id));
  }
  return levels;
}
