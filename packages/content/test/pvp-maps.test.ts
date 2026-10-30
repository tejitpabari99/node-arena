import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { loadContent, listPvpMaps } from '../src/index.js';

async function real() {
  const root = new URL('../data/', import.meta.url);
  const all: Record<string, string> = { 'data/balance.json': await readFile(new URL('balance.json', root), 'utf8') };
  for (const dir of ['units', 'buildings', 'elements', 'campaigns', 'levels']) {
    for (const name of await readdir(new URL(`${dir}/`, root))) all[`data/${dir}/${name}`] = await readFile(new URL(`${dir}/${name}`, root), 'utf8');
  }
  return loadContent(all);
}

test('listPvpMaps: exactly the shipped pvp maps in pvp.json order', async () => {
  const c = await real();
  const maps = listPvpMaps(c);
  const ids = c.catalog.campaigns['pvp']!.entries.map((e) => e.level);
  assert.deepEqual(maps.map((m) => m.id), ids);
  assert.ok(maps.length >= 1);
  for (const m of maps) {
    const lv = c.compiled[m.id]!;
    assert.equal(m.name, c.levels[m.id]!.level.name);
    assert.equal(m.seats, lv.players.length);
    assert.equal(m.teams.length, m.seats);
    assert.equal(m.timeLimitSec, lv.timeLimitSec);
    assert.equal(m.theme, lv.theme);
    assert.equal(lv.objective, 'pvp');
  }
  const duel = maps.find((m) => m.id === 'na-pvp-duel-s')!;
  assert.deepEqual(duel.teams, [0, 1]);
  assert.equal(duel.timeLimitSec, 480);
});

test('listPvpMaps: Common stays 20, custom unaffected, pvp ids absent from single-player lists', async () => {
  const c = await real();
  const camp = c.catalog.campaigns;
  assert.equal(camp['common']!.entries.length, 20);
  const pvpIds = new Set(listPvpMaps(c).map((m) => m.id));
  for (const id of ['common', 'custom']) for (const e of camp[id]!.entries) assert.ok(!pvpIds.has(e.level), `${id} lists pvp level ${e.level}`);
  assert.deepEqual(camp['custom']!.entries.map((e) => e.level), ['na-trial']);
});

test('listPvpMaps: no pvp campaign -> empty', async () => {
  const c = await real();
  const { pvp: _p, ...rest } = c.catalog.campaigns;
  assert.deepEqual(listPvpMaps({ ...c, catalog: { ...c.catalog, campaigns: rest } }), []);
});
