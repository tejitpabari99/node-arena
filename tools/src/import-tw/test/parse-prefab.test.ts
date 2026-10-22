import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPrefabLevels, parsePrefabText, PREFAB_DIR } from '../parse-prefab.js';
import { parseCampaign } from '../campaign.js';
import { FIXTURES } from './helpers.js';

test('the 2 frozen prefab levels load, flagged as hand data', () => {
  const levels = loadPrefabLevels();
  assert.deepEqual([...levels.keys()], ['LevelView 100_ES', 'LevelView 182_NB']);
  for (const lv of levels.values()) {
    assert.equal(lv.handData, true);
    assert.equal(lv.source.origin, 'prefab');
    assert.equal(lv.source.dialect, 'prefab-reconstructed');
  }
  assert.deepEqual(levels.get('LevelView 182_NB')?.source.scriptedComponents, ['BaseTutorial', 'TutorLevelBase']);
  assert.equal(levels.get('LevelView 100_ES')?.mapObjects.walls.length, 1);
  assert.equal(levels.get('LevelView 182_NB')?.id, 'levelview-182-nb');
});

test('prefab levels sit at campaign positions 10 (182_NB) and 23 (100_ES)', () => {
  const entries = parseCampaign(readFileSync(join(FIXTURES, 'remote-config.fixture.json'), 'utf8'));
  const levels = loadPrefabLevels();
  const pos = new Map(entries.map((e) => [e.id, e.position]));
  assert.equal(pos.get('LevelView 182_NB'), 10);
  assert.equal(pos.get('LevelView 100_ES'), 23);
  for (const asset of levels.keys()) assert.ok(pos.has(asset), asset);
});

test('non-prefab or malformed ext documents are rejected', () => {
  const good = readFileSync(join(PREFAB_DIR, 'levelview-100-es.ext.json'), 'utf8');
  const doc = JSON.parse(good) as { source: Record<string, unknown>; id: string };
  assert.ok(parsePrefabText('x', good));
  assert.throws(() => parsePrefabText('x', JSON.stringify({ ...doc, source: { ...doc.source, origin: 'raw', dialect: 'v1-short' } })), /not a prefab-reconstructed/);
  assert.throws(() => parsePrefabText('x', JSON.stringify({ ...doc, id: 'other' })), /does not match the asset slug/);
  assert.throws(() => parsePrefabText('x', JSON.stringify({ ...doc, schema: 'nope' })), /unexpected schema/);
  assert.throws(() => parsePrefabText('x', '{'), /invalid JSON/);
});
