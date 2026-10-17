import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { validateContent } from '@node-arena/content';
import { loadFiles } from '../src/files.js';
import { generateLayout, type LayoutInput } from '../layout/layout.js';

const root = resolve(import.meta.dirname, '../..');
const base = (symmetry: LayoutInput['symmetry'], seats: number): LayoutInput => ({
  symmetry,
  level: { id: `sym-${symmetry}`, name: 'Sym', order: 2, band: 1 },
  seats: [{ id: 'p1', kind: 'human', colorKey: 'player.1' }, ...Array.from({ length: seats - 1 }, (_, i) => ({ id: `b${i + 1}`, kind: 'bot' as const, botProfile: 'rusher-easy', colorKey: `player.${i + 2}` }))],
  towers: [
    { id: 'home', archetype: 'standard', pos: { x: -40, y: 5 }, owner: 'seat', garrison: 10 },
    { id: 'near', archetype: 'small', pos: { x: -22.0004, y: -17 }, owner: null, garrison: 12 },
  ],
});
async function check(input: LayoutInput) {
  const level = generateLayout(input);
  const files = await loadFiles(join(root, 'packages/content'));
  delete files['data/levels/sample.json'];
  files[`data/levels/${level.id}.json`] = JSON.stringify(level);
  const result = validateContent(files);
  assert.deepEqual(result.errors, []);
  return level;
}
test('mirror emits valid 2-seat level with mirrored owners', async () => {
  const l = await check(base('mirror', 2));
  assert.equal(l.towers.length, 4);
  assert.deepEqual(l.towers.map(t => t.owner), ['p1', 'b1', null, null]);
  assert.deepEqual(l.towers[1]!.pos, { x: 40, y: 5 });
  assert.equal(l.towers[2]!.pos.x, -22); // rounded to 3 decimals
});
test('rot3 emits valid 3-seat level', async () => {
  const input = base('rot3', 3); input.towers = [{ id: 'home', archetype: 'standard', pos: { x: -30, y: 0 }, owner: 'seat', garrison: 10 }, { id: 'n', archetype: 'small', pos: { x: -8, y: 12 }, owner: null, garrison: 12 }];
  const l = await check(input);
  assert.equal(l.towers.length, 6); assert.deepEqual(l.towers.filter(t => t.owner).map(t => t.owner), ['p1', 'b1', 'b2']);
});
test('rot4 emits valid 4-seat level, deterministic ids', async () => {
  const input = base('rot4', 4); input.towers = [{ id: 'home', archetype: 'standard', pos: { x: -30, y: 0 }, owner: 'seat', garrison: 10 }, { id: 'n', archetype: 'small', pos: { x: -20, y: 20 }, owner: null, garrison: 12 }];
  const l = await check(input);
  assert.equal(l.towers.length, 8);
  assert.deepEqual(generateLayout(input), l);
  assert.equal(new Set(l.towers.map(t => t.id)).size, 8);
});
test('rejects out-of-bounds, wrong seat count, too-close towers', () => {
  const rot3 = base('rot3', 3); rot3.towers = [{ id: 'home', archetype: 'standard', pos: { x: -50, y: 0 }, owner: 'seat', garrison: 10 }];
  assert.throws(() => generateLayout(rot3), /outside bounds/);
  assert.throws(() => generateLayout(base('rot4', 3)), /requires 4 seats/);
  const close = base('mirror', 2); close.towers[1]!.pos = { x: -38, y: 5 };
  assert.throws(() => generateLayout(close), /closer than 18/);
});
