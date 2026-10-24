import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { loadContent } from '../src/index.js';

// Missing picker entries or incomplete authored layouts must fail before art review.
test('custom showcases load and compile every building type, owner and starting stage in both themes', async () => {
  const root = new URL('../data/', import.meta.url);
  const files: Record<string, string> = { 'data/balance.json': await readFile(new URL('balance.json', root), 'utf8') };
  for (const dir of ['units', 'buildings', 'elements', 'campaigns', 'levels']) {
    for (const name of await readdir(new URL(`${dir}/`, root))) {
      files[`data/${dir}/${name}`] = await readFile(new URL(`${dir}/${name}`, root), 'utf8');
    }
  }
  const loaded = loadContent(files);
  assert.equal(loaded.catalog.campaigns['common']!.entries.length, 20);
  for (const theme of ['green', 'snow']) {
    const id = `na-showcase-${theme}`;
    assert.ok(loaded.catalog.campaigns['custom']!.entries.some(entry => entry.level === id), `${id} selectable from custom list`);
    const level = loaded.compiled[id]!;
    assert.equal(level.theme, theme);
    assert.equal(level.buildings.length, 15);
    assert.deepEqual(level.players.map(player => player.colorKey).sort(), ['blue', 'green', 'red', 'yellow']);
    assert.equal(level.bots.length, 3);
    for (const archetype of ['house-wt1', 'house-wt2', 'tower']) {
      const buildings = level.buildings.filter(building => building.archetype === archetype);
      assert.deepEqual(buildings.map(building => building.owner).sort(), [-1, 0, 1, 2, 3]);
      // 1/15/40 sit below, between and above the real stage boundaries 10/30.
      const stages = buildings.map(building => level.rules.stageThresholds.filter(threshold => building.level >= threshold).length);
      assert.deepEqual([...new Set(stages)].sort(), [0, 1, 2]);
    }
    assert.deepEqual(level.elements.map(element => element.variant).sort(), ['big', 'big', 'small', 'small']);
    assert.ok(level.bots.every(bot => (bot.bot.script?.length ?? 0) > 0), 'scripted opening routes engage without waiting for player input');
  }
});
