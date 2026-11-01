// SCRATCH procedural model kit (not for merge). Builds flat-shaded low-poly geometry with atlas-swatch UVs.
import { deflateSync } from 'node:zlib';
import * as T from '../../apps/web/node_modules/three/build/three.module.js';
import { mergeGeometries } from '../../apps/web/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFExporter } from '../../apps/web/node_modules/three/examples/jsm/exporters/GLTFExporter.js';

export { T };

// ---- swatch atlas: [baseHex, maskByte]. mask 255 = team-tinted. 8x8 cells of 8px = 64x64 px.
export const SW = {
  team: [0xF4F4F4, 255], teamDark: [0xBDBDBD, 255], teamLight: [0xFFFFFF, 255], teamMid: [0xDADADA, 255],
  concrete: [0xB4B1A8, 0], concreteDark: [0x8C8A84, 0], concreteLight: [0xCFCCC2, 0],
  stone: [0xA7A59B, 0], stoneDark: [0x7D7B74, 0], stoneLight: [0xC4C1B5, 0],
  steel: [0x6B7480, 0], steelDark: [0x3E444D, 0], steelLight: [0x9BA4AF, 0],
  wood: [0x8B5E3B, 0], woodDark: [0x5C3D27, 0], woodLight: [0xB88858, 0],
  slate: [0x59606A, 0], glass: [0x6FB0BE, 0], dark: [0x23262B, 0], black: [0x111215, 0],
  sand: [0xC4B186, 0], sandDark: [0xA89668, 0], olive: [0x5F6B4B, 0], oliveDark: [0x434D35, 0],
  rust: [0x9C5B3C, 0], skin: [0xE0AE84, 0], cloth: [0xD8CDB2, 0], brass: [0xC9A24A, 0],
  mortar: [0x6E6B64, 0], hazard: [0xE0B53A, 0],
};
export const SWN = Object.keys(SW);
const CELL = 8, COLS = 8;
const cellOf = k => { const i = SWN.indexOf(k); if (i < 0) throw new Error('swatch ' + k); return i; };

export function atlasPngs() {
  const W = COLS * CELL, H = Math.ceil(SWN.length / COLS) * CELL;
  const rgb = Buffer.alloc(W * H * 3, 0), grey = Buffer.alloc(W * H, 0);
  SWN.forEach((k, i) => {
    const [hex, m] = SW[k], cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const p = (cy + y) * W + cx + x;
      rgb[p * 3] = hex >> 16 & 255; rgb[p * 3 + 1] = hex >> 8 & 255; rgb[p * 3 + 2] = hex & 255; grey[p] = m;
    }
  });
  return { base: png(W, H, 2, rgb), mask: png(W, H, 0, grey), W, H };
}
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
function png(W, H, colorType, data) {
  const bpp = colorType === 2 ? 3 : 1, raw = Buffer.alloc((W * bpp + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * bpp + 1)] = 0; data.copy(raw, y * (W * bpp + 1) + 1, y * W * bpp, (y + 1) * W * bpp); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- geometry helpers. All return BufferGeometry (non-indexed, flat normals, uv at swatch centre).
const ROWS = Math.ceil(SWN.length / COLS);
function finish(g, sw, m) {
  g = g.index ? g.toNonIndexed() : g;
  if (m) { g.applyMatrix4(m); }
  const i = cellOf(sw), u = ((i % COLS) + 0.5) / COLS, v = (Math.floor(i / COLS) + 0.5) / ROWS;
  const n = g.attributes.position.count, uv = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) { uv[k * 2] = u; uv[k * 2 + 1] = v; }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(g.attributes.position.array.slice(), 3));
  out.setAttribute('uv', new T.BufferAttribute(uv, 2));
  out.computeVertexNormals();
  return out;
}
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, 'YXZ')), new T.Vector3(sx, sy, sz));

/** A Kit collects parts for one mesh. Positions: y is the BOTTOM of the primitive for box/cyl/cone. */
export class Kit {
  constructor() { this.gs = []; }
  add(g) { this.gs.push(g); return this; }
  box(sw, w, h, d, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) { return this.add(finish(new T.BoxGeometry(w, h, d), sw, M(x, y + h / 2, z, rx, ry, rz))); }
  /** tapered box: top scaled. */
  frustum(sw, w, d, h, tw, td, x = 0, y = 0, z = 0, ry = 0) {
    const g = new T.BoxGeometry(1, 1, 1); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const top = p.getY(i) > 0; p.setX(i, p.getX(i) * (top ? tw : w)); p.setZ(i, p.getZ(i) * (top ? td : d)); p.setY(i, (p.getY(i) + 0.5) * h); }
    return this.add(finish(g, sw, M(x, y, z, 0, ry, 0)));
  }
  cyl(sw, rt, rb, h, x = 0, y = 0, z = 0, seg = 8, ry = 0, rx = 0, rz = 0, open = false) { return this.add(finish(new T.CylinderGeometry(rt, rb, h, seg, 1, open), sw, M(x, y + h / 2, z, rx, ry, rz))); }
  /** cylinder lying along X (axle) centred at y. */
  axle(sw, r, len, x = 0, y = 0, z = 0, seg = 8) { return this.add(finish(new T.CylinderGeometry(r, r, len, seg), sw, M(x, y, z, 0, 0, Math.PI / 2))); }
  cone(sw, r, h, x = 0, y = 0, z = 0, seg = 8, ry = 0) { return this.add(finish(new T.ConeGeometry(r, h, seg), sw, M(x, y + h / 2, z, 0, ry, 0))); }
  sphere(sw, r, x = 0, y = 0, z = 0, ws = 8, hs = 5, sx = 1, sy = 1, sz = 1, half = false) {
    return this.add(finish(new T.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, half ? Math.PI / 2 : Math.PI), sw, M(x, y, z, 0, 0, 0, sx, sy, sz)));
  }
  /** prism: polygon pts [[x,y]..] in XY, extruded along Z by depth (centred on z). */
  prism(sw, pts, depth, x = 0, y = 0, z = 0, ry = 0, rx = 0) {
    const s = new T.Shape(pts.map(([a, b]) => new T.Vector2(a, b)));
    const g = new T.ExtrudeGeometry(s, { depth, bevelEnabled: false }); g.translate(0, 0, -depth / 2);
    return this.add(finish(g, sw, M(x, y, z, rx, ry, 0)));
  }
  lathe(sw, pts, x = 0, y = 0, z = 0, seg = 8) { return this.add(finish(new T.LatheGeometry(pts.map(([r, h]) => new T.Vector2(r, h)), seg), sw, M(x, y, z))); }
  /** mirror-copy helper: runs fn(sign) for -1 and 1 */
  mirror(fn) { fn(1); fn(-1); return this; }
  geometry() { return mergeGeometries(this.gs, false); }
  tris() { return this.gs.reduce((s, g) => s + g.attributes.position.count / 3, 0); }
}
export const tri = g => g.attributes.position.count / 3;

export function mesh(name, kit, mat) { const m = new T.Mesh(kit.geometry(), mat); m.name = name; return m; }
export function empty(name, x = 0, y = 0, z = 0) { const o = new T.Object3D(); o.name = name; o.position.set(x, y, z); return o; }
export const dummyMat = new T.MeshStandardMaterial({ name: 'atlas', color: 0xffffff });

// ---- GLB export (Node shim for FileReader).
if (!globalThis.FileReader) {
  globalThis.FileReader = class { readAsArrayBuffer(b) { b.arrayBuffer().then(r => { this.result = r; this.onloadend?.(); }); } readAsDataURL(b) { b.arrayBuffer().then(r => { this.result = 'data:' + (b.type || 'application/octet-stream') + ';base64,' + Buffer.from(r).toString('base64'); this.onloadend?.(); }); } };
}
export async function exportGlb(root, animations = []) {
  const scene = new T.Scene(); scene.add(root); scene.updateMatrixWorld(true);
  const ex = new GLTFExporter();
  const ab = await ex.parseAsync(scene, { binary: true, animations, trs: true, onlyVisible: false });
  return Buffer.from(ab);
}
export function countTris(root) { let n = 0; root.traverse(o => { if (o.isMesh) n += tri(o.geometry); }); return n; }

// ---- more helpers
Kit.prototype.link = function (sw, a, b, r = 0.04, seg = 4) {
  const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
  const m = new T.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new T.Vector3(1, 1, 1));
  return this.add(finish(new T.CylinderGeometry(r, r, len, seg), sw, m));
};
/** side-profile prism: pts are [z,y] (z forward = +z), width along X centred at x. */
Kit.prototype.side = function (sw, pts, width, x = 0, y = 0, z = 0) { return this.prism(sw, pts.map(([zz, yy]) => [-zz, yy]), width, x, y, z, Math.PI / 2); };
/** gable roof along Z: ridge along z; w total width, h rise, len along z. */
Kit.prototype.gable = function (sw, w, h, len, x = 0, y = 0, z = 0) { return this.prism(sw, [[-w / 2, 0], [w / 2, 0], [0, h]], len, x, y, z); };
/** gable roof whose ridge runs along X. */
Kit.prototype.gableX = function (sw, w, h, len, x = 0, y = 0, z = 0) { return this.prism(sw, [[-w / 2, 0], [w / 2, 0], [0, h]], len, x, y, z, Math.PI / 2); };

export function rig(name, parts) {
  const root = new T.Group(); root.name = name;
  for (const p of parts) {
    const g = p.kit.geometry(); if (!p.local) g.translate(-p.pivot[0], -p.pivot[1], -p.pivot[2]);
    const m = new T.Mesh(g, dummyMat); m.name = p.name; m.position.set(...p.pivot); root.add(m);
  }
  return root;
}
const Q = (x, y = 0, z = 0) => new T.Quaternion().setFromEuler(new T.Euler(x, y, z, 'XYZ'));
export const qTrack = (name, times, quats) => new T.QuaternionKeyframeTrack(name + '.quaternion', times, quats.flatMap(q => q.toArray()));
export const pTrack = (name, times, vecs) => new T.VectorKeyframeTrack(name + '.position', times, vecs.flat());
export { Q };

/** Whole-body death: rigid rotation about `hip` (axis 'x' or 'z') by `ang`, sinking `drop`, + per-part flail. parts: [{name,pivot,flail?:(k)=>euler x}] */
export function deathClip(parts, hip, { dur = 0.7, ang = -1.45, drop = 0.3, axis = 'x', n = 8 } = {}) {
  const times = [], per = parts.map(() => ({ p: [], q: [] }));
  for (let i = 0; i <= n; i++) {
    const k = i / n, e = k * k * (3 - 2 * k) * 0.35 + k * k * 0.65; times.push(k * dur);
    const th = ang * e, R = axis === 'x' ? Q(th) : Q(0, 0, th), Rm = new T.Matrix4().makeRotationFromQuaternion(R);
    parts.forEach((pt, j) => {
      const rel = new T.Vector3(pt.pivot[0] - hip[0], pt.pivot[1] - hip[1], pt.pivot[2] - hip[2]).applyMatrix4(Rm);
      per[j].p.push([hip[0] + rel.x, hip[1] + rel.y - drop * e, hip[2] + rel.z]);
      const fl = pt.flail ? pt.flail(k) : 0;
      per[j].q.push(R.clone().multiply(axis === 'x' ? Q(fl) : Q(0, 0, fl)));
    });
  }
  const tracks = [];
  parts.forEach((pt, j) => { tracks.push(pTrack(pt.name, times, per[j].p), qTrack(pt.name, times, per[j].q)); });
  return new T.AnimationClip('Death', dur, tracks);
}
