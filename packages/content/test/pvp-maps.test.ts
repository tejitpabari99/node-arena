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
    assert.equal(m.maxPlayers, lv.players.length);
    assert.equal(m.teams.length, m.maxPlayers);
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

test('covers R-SEA-01: every pvp map maxPlayers equals players.length, each slot has a home, owners in range', async () => {
  const c = await real();
  for (const m of listPvpMaps(c)) {
    const lv = c.compiled[m.id]!;
    assert.equal(m.maxPlayers, lv.players.length, m.id);
    assert.ok(lv.players.length >= 2 && lv.players.length <= 4, m.id);
    for (let slot = 0; slot < lv.players.length; slot++) {
      assert.ok(lv.buildings.some((b) => b.owner === slot), `${m.id} slot ${slot} owns a building`);
    }
    for (const b of lv.buildings) assert.ok(b.owner >= -1 && b.owner < lv.players.length, `${m.id} ${b.id} owner ${b.owner}`);
  }
});

test('covers R-SEA-01: Cross authored teams are [0,0,1,1] with each team on opposite corners; every prefix 2..4 is usable', async () => {
  const c = await real();
  const cross = c.compiled['na-pvp-cross']!;
  assert.deepEqual(cross.players.map((p) => p.team), [0, 0, 1, 1]);
  const home = (slot: number) => cross.buildings.find((b) => b.owner === slot && b.id.startsWith('home'))!;
  const homes = [0, 1, 2, 3].map(home);
  for (const [a, b] of [[0, 1], [2, 3]] as const) {
    assert.equal(homes[a]!.x + homes[b]!.x, 0, `team homes ${a},${b} mirror in x`);
    assert.equal(homes[a]!.z + homes[b]!.z, 0, `team homes ${a},${b} mirror in z`);
    assert.ok(homes[a]!.x !== homes[b]!.x || homes[a]!.z !== homes[b]!.z);
  }
  // Authored order p1,p3,p2,p4: slots 0,1 face each other across the centre, so a 2-seat prefix is a fair duel.
  assert.deepEqual(cross.players.map((p) => p.id), ['p1', 'p3', 'p2', 'p4']);
});

test('covers R-SEA-01: Cross n=2 prefix is point-symmetric (slots 0,1 swap under 180deg rotation; neutrals incl. dead-slot homes map onto equals)', async () => {
  const c = await real();
  const cross = c.compiled['na-pvp-cross']!;
  // Same reduction the sim applies (R-SEA-01): buildings of slots >= 2 become neutral. Inlined: content must not import sim.
  const reduced = { buildings: cross.buildings.map((b) => (b.owner >= 2 ? { ...b, owner: -1 } : b)) };
  const key = (b: { x: number; z: number; archetype: string | number; level: number; owner: number }) => `${b.x},${b.z},${String(b.archetype)},${b.level},${b.owner}`;
  const home = (slot: number) => reduced.buildings.find((b) => b.owner === slot && b.id.startsWith('home'))!;
  const a = home(0), b = home(1);
  assert.deepEqual([0 - a.x, 0 - a.z], [b.x, b.z]);
  assert.equal(a.level, b.level);
  assert.equal(a.archetype, b.archetype);
  // Every non-seat building has a rotated twin with identical archetype and level.
  const rest = reduced.buildings.filter((x) => x.owner === -1);
  assert.ok(rest.length > 0);
  const set = new Set(rest.map(key));
  for (const x of rest) assert.ok(set.has(key({ ...x, x: 0 - x.x, z: 0 - x.z })), `${x.id} has a point-reflected twin`);
  // Dead-slot homes (slots 2,3) are neutral after reduction and mirror each other too.
  const deadHomes = reduced.buildings.filter((x) => x.id === 'home-2' || x.id === 'home-4');
  assert.ok(deadHomes.every((x) => x.owner === -1));
});
