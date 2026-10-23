// Pure geometry/texture checks for the SP07 prototype validation gate (R2). No three.js / fs dependency.
// Matrices are column-major number[16] (glTF / three.js layout); vertex data are flat arrays (x,y,z,...).

export type Mat4 = readonly number[];
export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** The 02 Frame contract mirror (`worldRoot.scale.z = -1`). Mirrors apps world-root.js (tools/assets/validate/world-root.js). */
export const MIRROR_Z: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];

export function mulMat4(a: Mat4, b: Mat4): number[] {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
    o[c * 4 + r] = s;
  }
  return o;
}

/** Determinant of the upper-left 3x3 (sign tells whether three.js flips face winding). */
export function det3(m: Mat4): number {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]] as [number, number, number, number, number, number, number, number, number];
  // columns (a,b,c) (d,e,f) (g,h,i)
  return a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
}

export function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ];
}

/** Signed volume of an indexed triangle mesh after transform by `m` (CCW-outward => positive, no winding flip). */
export function signedVolume(pos: ArrayLike<number>, idx: ArrayLike<number>, m: Mat4 = IDENTITY): number {
  let v = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const [ax, ay, az] = transformPoint(m, pos[3 * idx[t]!]!, pos[3 * idx[t]! + 1]!, pos[3 * idx[t]! + 2]!);
    const [bx, by, bz] = transformPoint(m, pos[3 * idx[t + 1]!]!, pos[3 * idx[t + 1]! + 1]!, pos[3 * idx[t + 1]! + 2]!);
    const [cx, cy, cz] = transformPoint(m, pos[3 * idx[t + 2]!]!, pos[3 * idx[t + 2]! + 1]!, pos[3 * idx[t + 2]! + 2]!);
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/**
 * Signed volume as the game sees it: three.js flips front-face winding when the world matrix has a negative
 * determinant, so a mesh is front-facing iff signedVolume(world) * sign(det) > 0.
 */
export function signedVolumeAsSeen(pos: ArrayLike<number>, idx: ArrayLike<number>, world: Mat4): number {
  return signedVolume(pos, idx, world) * Math.sign(det3(world));
}

/** Fraction of triangles whose geometric (CCW) normal agrees with the average authored vertex normal. */
export function normalAgreement(pos: ArrayLike<number>, nor: ArrayLike<number>, idx: ArrayLike<number>): number {
  let ok = 0, n = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const i0 = idx[t]!, i1 = idx[t + 1]!, i2 = idx[t + 2]!;
    const e1 = [0, 1, 2].map(k => pos[3 * i1 + k]! - pos[3 * i0 + k]!);
    const e2 = [0, 1, 2].map(k => pos[3 * i2 + k]! - pos[3 * i0 + k]!);
    const gx = e1[1]! * e2[2]! - e1[2]! * e2[1]!, gy = e1[2]! * e2[0]! - e1[0]! * e2[2]!, gz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    let sx = 0, sy = 0, sz = 0;
    for (const i of [i0, i1, i2]) { sx += nor[3 * i]!; sy += nor[3 * i + 1]!; sz += nor[3 * i + 2]!; }
    const d = gx * sx + gy * sy + gz * sz;
    if (d !== 0) { n++; if (d > 0) ok++; }
  }
  return n === 0 ? 1 : ok / n;
}

export interface UvReport { min: [number, number]; max: [number, number]; inRange: boolean; outOfRange: number }
/** UVs must lie within [0,1] (clamp-wrapped textures); `eps` tolerates float noise. */
export function uvRange(uv: ArrayLike<number>, eps = 1e-4): UvReport {
  const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
  let bad = 0;
  for (let i = 0; i + 1 < uv.length; i += 2) {
    const u = uv[i]!, v = uv[i + 1]!;
    min[0] = Math.min(min[0], u); min[1] = Math.min(min[1], v); max[0] = Math.max(max[0], u); max[1] = Math.max(max[1], v);
    if (u < -eps || u > 1 + eps || v < -eps || v > 1 + eps) bad++;
  }
  return { min, max, inRange: bad === 0, outOfRange: bad };
}

export interface Bbox { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] }
export function bbox(pos: ArrayLike<number>, m: Mat4 = IDENTITY): Bbox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const p = transformPoint(m, pos[i]!, pos[i + 1]!, pos[i + 2]!);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[k]!); max[k] = Math.max(max[k]!, p[k]!); }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
export function mergeBbox(a: Bbox | null, b: Bbox): Bbox {
  if (!a) return b;
  const min = a.min.map((v, k) => Math.min(v, b.min[k]!)) as [number, number, number];
  const max = a.max.map((v, k) => Math.max(v, b.max[k]!)) as [number, number, number];
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
/** Each axis of `size` within `tol` (relative) of `expected`; axis-order independent (sorted compare). */
export function bboxWithin(size: readonly number[], expected: readonly number[], tol = 0.15): boolean {
  const a = [...size].sort((x, y) => x - y), b = [...expected].sort((x, y) => x - y);
  return a.every((v, k) => Math.abs(v - b[k]!) <= tol * b[k]!);
}

/** Index of the vertex nearest to `p` (used to pick the texel probe for a part centroid). */
export function nearestVertex(pos: ArrayLike<number>, p: readonly [number, number, number]): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const d = (pos[i]! - p[0]) ** 2 + (pos[i + 1]! - p[1]) ** 2 + (pos[i + 2]! - p[2]) ** 2;
    if (d < bd) { bd = d; best = i / 3; }
  }
  return best;
}
export function centroid(pos: ArrayLike<number>): [number, number, number] {
  let x = 0, y = 0, z = 0;
  const n = pos.length / 3;
  for (let i = 0; i < pos.length; i += 3) { x += pos[i]!; y += pos[i + 1]!; z += pos[i + 2]!; }
  return n ? [x / n, y / n, z / n] : [0, 0, 0];
}
/** RGBA texel at glTF UV (v=0 at image top, clamp-to-edge). */
export function texelAt(rgba: ArrayLike<number>, w: number, h: number, u: number, v: number): [number, number, number, number] {
  const x = Math.min(w - 1, Math.max(0, Math.floor(u * w))), y = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
  const o = 4 * (y * w + x);
  return [rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!];
}
export const isOpaqueTexel = (t: readonly number[], minAlpha = 128): boolean => (t[3] ?? 0) >= minAlpha;

/** Quaternion (x,y,z,w) angular distance in radians. */
export function quatAngle(a: readonly number[], b: readonly number[]): number {
  const d = Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
  return 2 * Math.acos(Math.min(1, d));
}
export interface PoseDelta { maxPos: number; maxAngle: number; worst: string }
/** Max per-node TRS delta between two poses (bind vs Run frame 0). Seams = large deltas. */
export function poseDelta(bind: Record<string, { t: readonly number[]; r: readonly number[] }>, frame: Record<string, { t?: readonly number[]; r?: readonly number[] }>): PoseDelta {
  let maxPos = 0, maxAngle = 0, worst = '';
  for (const [name, b] of Object.entries(bind)) {
    const f = frame[name];
    if (!f) continue;
    const dp = f.t ? Math.hypot(f.t[0]! - b.t[0]!, f.t[1]! - b.t[1]!, f.t[2]! - b.t[2]!) : 0;
    const da = f.r ? quatAngle(b.r, f.r) : 0;
    if (dp > maxPos) maxPos = dp;
    if (da > maxAngle) { maxAngle = da; worst = name; }
  }
  return { maxPos, maxAngle, worst };
}

/**
 * Weapon-hand side: which side of `rightAxis` the far (muzzle) end of the weapon lies, relative to the body centre.
 * Far end = weapon vertex farthest from the grip point. Returns +1/-1 (0 if degenerate).
 */
export function muzzleSide(weapon: ArrayLike<number>, grip: readonly [number, number, number], bodyCentre: readonly [number, number, number], rightAxis: readonly [number, number, number]): number {
  let best = -1, bd = -1;
  for (let i = 0; i + 2 < weapon.length; i += 3) {
    const d = (weapon[i]! - grip[0]) ** 2 + (weapon[i + 1]! - grip[1]) ** 2 + (weapon[i + 2]! - grip[2]) ** 2;
    if (d > bd) { bd = d; best = i; }
  }
  if (best < 0) return 0;
  const s = (weapon[best]! - bodyCentre[0]) * rightAxis[0] + (weapon[best + 1]! - bodyCentre[1]) * rightAxis[1] + (weapon[best + 2]! - bodyCentre[2]) * rightAxis[2];
  return Math.sign(s);
}
