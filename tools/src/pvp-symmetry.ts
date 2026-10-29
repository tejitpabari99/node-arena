import { canonicalJson, type CompiledLevel } from '@node-arena/content';
import { readFile } from 'node:fs/promises';
import { LocatedError } from './files.js';

/**
 * PvP symmetry gate (03-pvp-maps R5/R7, D2/D3).
 * Checked on the COMPILED level (what validate:levels already holds): owner is a dense seat index and `modules`
 * is the archetype+params merge, so a param difference (authored `params`) shows up as a modules difference.
 * Element yaw is not compared (a mirrored prop legitimately has a different heading); pos/archetype/variant/modules are.
 * Coordinates are converted to integer milli-units and mapped exactly; no tolerance.
 */
export type SymmetryKind = 'd2' | 'd4';
export type SymmetryLevel = Pick<CompiledLevel, 'id' | 'bounds' | 'players' | 'buildings' | 'elements'>;
export type SymmetryResult = { ok: true; transforms: string[] } | { ok: false; transform: string; offender: string; reason: string };

type Pt = readonly [number, number];
const TRANSFORMS: Record<SymmetryKind, ReadonlyArray<readonly [string, (p: Pt) => Pt]>> = {
  d2: [
    ['identity', ([x, z]) => [x, z]],
    ['mirror-x', ([x, z]) => [-x, z]],
    ['mirror-z', ([x, z]) => [x, -z]],
    ['rot180', ([x, z]) => [-x, -z]],
  ],
  d4: [
    ['identity', ([x, z]) => [x, z]],
    ['rot90', ([x, z]) => [-z, x]],
    ['rot180', ([x, z]) => [-x, -z]],
    ['rot270', ([x, z]) => [z, -x]],
    ['mirror-x', ([x, z]) => [-x, z]],
    ['mirror-z', ([x, z]) => [x, -z]],
    ['mirror-diag', ([x, z]) => [z, x]],
    ['mirror-antidiag', ([x, z]) => [-z, -x]],
  ],
};

const milli = (v: number): number | null => { const m = Math.round(v * 1000); return Math.abs(v * 1000 - m) < 1e-6 ? m : null; };
const key = (x: number, z: number): string => `${x},${z}`;
const fail = (transform: string, offender: string, reason: string): SymmetryResult => ({ ok: false, transform, offender, reason });

interface Item { id: string; x: number; z: number; sig: string; owner?: number }

function toMilli(kind: string, id: string, x: number, z: number): { x: number; z: number } | string {
  const mx = milli(x), mz = milli(z);
  return mx === null || mz === null ? `${kind} ${id} has a coordinate that is not an exact milli-unit (${x}, ${z})` : { x: mx, z: mz };
}

export function checkSymmetry(level: SymmetryLevel, kind: SymmetryKind): SymmetryResult {
  const set = TRANSFORMS[kind];
  if (!set) throw new RangeError(`Unknown symmetry kind ${String(kind)}`);
  const first = set[0]![0];
  const b = level.bounds;
  const mb = [b.minX, b.maxX, b.minZ, b.maxZ].map(milli);
  if (mb.includes(null)) return fail(first, 'bounds', 'bounds are not exact milli-units');
  const [minX, maxX, minZ, maxZ] = mb as number[];
  const buildings: Item[] = [], elements: Item[] = [];
  for (const x of level.buildings) {
    const p = toMilli('building', x.id, x.x, x.z);
    if (typeof p === 'string') return fail(first, x.id, p);
    buildings.push({ id: x.id, ...p, owner: x.owner, sig: canonicalJson({ a: x.archetype, l: x.level, i: x.ignoreForWin, m: x.modules }) });
  }
  for (const x of level.elements) {
    const p = toMilli('element', x.id, x.x, x.z);
    if (typeof p === 'string') return fail(first, x.id, p);
    elements.push({ id: x.id, ...p, sig: canonicalJson({ a: x.archetype, v: x.variant ?? null, m: x.modules }) });
  }
  const index = (items: Item[], what: string): Map<string, Item> | SymmetryResult => {
    const map = new Map<string, Item>();
    for (const it of items) {
      const k = key(it.x, it.z);
      const dup = map.get(k);
      if (dup) return fail(first, it.id, `${what} ${it.id} and ${dup.id} share a position`);
      map.set(k, it);
    }
    return map;
  };
  const bIndex = index(buildings, 'building'); if (!(bIndex instanceof Map)) return bIndex;
  const eIndex = index(elements, 'element'); if (!(eIndex instanceof Map)) return eIndex;

  for (const [name, f] of set) {
    // Bounds: the rectangle must map onto itself (corners map to corners of the same rectangle).
    const c1 = f([minX!, minZ!]), c2 = f([maxX!, maxZ!]);
    const lo = [Math.min(c1[0], c2[0]), Math.min(c1[1], c2[1])], hi = [Math.max(c1[0], c2[0]), Math.max(c1[1], c2[1])];
    if (lo[0] !== minX || lo[1] !== minZ || hi[0] !== maxX || hi[1] !== maxZ) return fail(name, 'bounds', 'bounds are not symmetric under this transform');

    const perm = new Map<number, number>(); // seat -> image seat, derived from owned buildings
    for (const src of buildings) {
      const [ix, iz] = f([src.x, src.z]);
      const dst = bIndex.get(key(ix, iz));
      if (!dst) return fail(name, src.id, `building ${src.id} has no image at (${ix / 1000}, ${iz / 1000})`);
      if (dst.sig !== src.sig) return fail(name, src.id, `building ${src.id} differs from its image ${dst.id} (archetype/level/params/ignoreForWin)`);
      const a = src.owner!, d = dst.owner!;
      if ((a < 0) !== (d < 0)) return fail(name, src.id, `building ${src.id} and its image ${dst.id} differ in neutral/owned`);
      if (a >= 0) {
        const seen = perm.get(a);
        if (seen !== undefined && seen !== d) return fail(name, src.id, `seat ${a} maps to both seat ${seen} and seat ${d}`);
        perm.set(a, d);
      }
    }
    if (new Set(perm.values()).size !== perm.size) return fail(name, 'players', 'seat permutation is not injective');
    for (let s = 0; s < level.players.length; s++) {
      if (!perm.has(s)) return fail(name, `players[${s}]`, `seat ${s} owns no building, so its image cannot be derived`);
    }
    for (const src of elements) {
      const [ix, iz] = f([src.x, src.z]);
      const dst = eIndex.get(key(ix, iz));
      if (!dst) return fail(name, src.id, `element ${src.id} has no image at (${ix / 1000}, ${iz / 1000})`);
      if (dst.sig !== src.sig) return fail(name, src.id, `element ${src.id} differs from its image ${dst.id} (archetype/variant/params)`);
    }
  }
  return { ok: true, transforms: set.map(([n]) => n) };
}

/** Sidecar `tools/pvp-symmetry.json`: level id -> kind. Missing level files are fine; callers look up by id. */
export function parseSymmetry(value: unknown): Record<string, SymmetryKind> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid pvp-symmetry sidecar: expected an object');
  for (const [id, kind] of Object.entries(value)) if (kind !== 'd2' && kind !== 'd4') throw new Error(`Invalid pvp-symmetry sidecar: ${id} must be "d2" or "d4"`);
  return value as Record<string, SymmetryKind>;
}
export async function readSymmetry(path: string): Promise<Record<string, SymmetryKind>> {
  try { return parseSymmetry(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) { throw new LocatedError(path, (error as Error).message); }
}
