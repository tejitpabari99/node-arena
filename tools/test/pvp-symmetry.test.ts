import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { checkSymmetry, readSymmetry, type SymmetryLevel } from '../src/pvp-symmetry.js';

type B = SymmetryLevel['buildings'][number];
type E = SymmetryLevel['elements'][number];
const fp = { shape: 'circle' as const, radius: 1 };
const b = (id: string, x: number, z: number, owner: number, level = 5, extra: Partial<B> = {}): B =>
  ({ id, archetype: 'house-wt1', kind: 'house', x, z, owner, level, ignoreForWin: false, special: false, footprint: fp, visual: 'v', modules: { spawns: { rate: 1 } }, ...extra });
const e = (id: string, x: number, z: number, extra: Partial<E> = {}): E =>
  ({ id, archetype: 'obstacle', x, z, yawMilliDeg: 0, footprint: fp, visual: 'v', modules: {}, ...extra });
const pl = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, kind: 'human' as const, colorKey: `c${i}` }));

const d2 = (): SymmetryLevel => ({
  id: 'd2', bounds: { minX: -9, maxX: 9, minZ: -5.5, maxZ: 5.5 }, players: pl(2),
  buildings: [b('h0', -6, 0, 0, 12), b('h1', 6, 0, 1, 12), b('n0', -3.5, 2.5, -1, 3), b('n1', 3.5, 2.5, -1, 3), b('n2', -3.5, -2.5, -1, 3), b('n3', 3.5, -2.5, -1, 3), b('c', 0, 0, -1, 6)],
  elements: [e('o0', 0, 2), e('o1', 0, -2)],
});
const d4 = (): SymmetryLevel => ({
  id: 'd4', bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, players: pl(4),
  buildings: [b('h0', -7, 0, 0, 12), b('h1', 0, -7, 1, 12), b('h2', 7, 0, 2, 12), b('h3', 0, 7, 3, 12),
    b('a0', -3.5, 0, -1, 3), b('a1', 0, -3.5, -1, 3), b('a2', 3.5, 0, -1, 3), b('a3', 0, 3.5, -1, 3),
    b('k0', -5.5, -5.5, -1, 5), b('k1', 5.5, -5.5, -1, 5), b('k2', 5.5, 5.5, -1, 5), b('k3', -5.5, 5.5, -1, 5), b('c', 0, 0, -1, 8)],
  elements: [e('e0', -2, -2, { variant: 'a' }), e('e1', 2, -2, { variant: 'a' }), e('e2', 2, 2, { variant: 'a' }), e('e3', -2, 2, { variant: 'a' })],
});

test('d2 fixture passes all four transforms', () => {
  const r = checkSymmetry(d2(), 'd2');
  assert.deepEqual(r, { ok: true, transforms: ['identity', 'mirror-x', 'mirror-z', 'rot180'] });
});
test('d4 fixture passes all eight transforms', () => {
  const r = checkSymmetry(d4(), 'd4');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.transforms.length, 8);
});
test('rotation-only d4 fixture fails the mirror transforms', () => {
  const rot = d4();
  rot.buildings.push(b('r0', -4, -1, -1, 2), b('r1', 1, -4, -1, 2), b('r2', 4, 1, -1, 2), b('r3', -1, 4, -1, 2));
  const r = checkSymmetry(rot, 'd4');
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.transform.startsWith('mirror'));
});

const mutate = (base: () => SymmetryLevel, fn: (l: SymmetryLevel) => void) => { const l = base(); fn(l); return l; };
const cases: Array<[string, () => SymmetryLevel, 'd2' | 'd4', (l: SymmetryLevel) => void]> = [
  ['0.001 building nudge (d2)', d2, 'd2', l => { l.buildings[2]!.x = -3.499; }],
  ['0.001 element nudge (d2)', d2, 'd2', l => { l.elements[0]!.z = 2.001; }],
  ['0.001 building nudge (d4)', d4, 'd4', l => { l.buildings[8]!.z = -5.501; }],
  ['swapped owner (d2)', d2, 'd2', l => { l.buildings[1]!.owner = 0; }],
  ['swapped owner neutral->owned (d4)', d4, 'd4', l => { l.buildings[4]!.owner = 0; }],
  ['wrong level (d2)', d2, 'd2', l => { l.buildings[3]!.level = 4; }],
  ['wrong level (d4)', d4, 'd4', l => { l.buildings[1]!.level = 11; }],
  ['param difference', d2, 'd2', l => { l.buildings[0]!.modules = { spawns: { rate: 2 } }; }],
  ['ignoreForWin difference', d2, 'd2', l => { l.buildings[3]!.ignoreForWin = true; }],
  ['element variant change (d4)', d4, 'd4', l => { l.elements[2]!.variant = 'b'; }],
  ['element archetype change (d2)', d2, 'd2', l => { l.elements[1]!.archetype = 'tree'; }],
  ['missing element (d2)', d2, 'd2', l => { l.elements.pop(); }],
  ['asymmetric bounds (d2)', d2, 'd2', l => { l.bounds.maxX = 9.001; }],
  ['non-square bounds (d4)', d4, 'd4', l => { l.bounds.maxZ = 9; l.bounds.minZ = -9; }],
  ['non-milli coordinate', d2, 'd2', l => { l.buildings[2]!.x = -3.5004; }],
  ['seat owns no building', d2, 'd2', l => { l.players.push({ id: 'p3', kind: 'human', colorKey: 'x' }); }],
];
for (const [name, base, kind, fn] of cases) {
  test(`mutation fails: ${name}`, () => {
    const r = checkSymmetry(mutate(base, fn), kind);
    assert.equal(r.ok, false);
    if (!r.ok) { assert.ok(r.transform.length > 0); assert.ok(r.offender.length > 0); assert.ok(r.reason.length > 0); }
  });
}
test('failure names first offender id and transform', () => {
  const r = checkSymmetry(mutate(d2, l => { l.buildings[2]!.x = -3.499; }), 'd2');
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.transform === 'mirror-x' && r.offender === 'n0');
});
test('sidecar parses and lists the three pvp maps', async () => {
  const s = await readSymmetry(resolve(import.meta.dirname, '../pvp-symmetry.json'));
  assert.deepEqual(s, { 'na-pvp-duel-s': 'd2', 'na-pvp-duel-m': 'd2', 'na-pvp-cross': 'd4' });
});
