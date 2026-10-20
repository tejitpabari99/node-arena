// Code-built chibi troop (SP04 Task 6 fallback): sphere head + box torso/legs/arms, no rig, no textures.
// Usage: node tools/assets/build-troop-chibi.mjs [outFile]. Body parts use material `Shirt` (team colour), head `Head`.
import { Document, NodeIO } from '@gltf-transform/core';
import { resolve } from 'node:path';
const out = process.argv[2] ?? resolve(import.meta.dirname, '../../apps/web/assets/models/troop-regular.glb');
const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene('troop');
const shirt = doc.createMaterial('Shirt').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
const mat = (n, c) => doc.createMaterial(n).setBaseColorFactor([...c, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
const skin = mat('Skin', [0.75, 0.45, 0.3]), cloth = mat('Cloth', [0.85, 0.85, 0.85]);
function box(c, s) { // flat-shaded box centred c, size s
  const P = [], N = [], I = [];
  const faces = [[[1,0,0],[0,1,0],[0,0,1]], [[-1,0,0],[0,0,1],[0,1,0]], [[0,1,0],[0,0,1],[1,0,0]], [[0,-1,0],[1,0,0],[0,0,1]], [[0,0,1],[1,0,0],[0,1,0]], [[0,0,-1],[0,1,0],[1,0,0]]];
  for (const [n, u, v] of faces) {
    const base = P.length / 3;
    for (const [a, b] of [[-1,-1],[1,-1],[1,1],[-1,1]]) { for (let k = 0; k < 3; k++) P.push(c[k] + (n[k] + u[k] * a + v[k] * b) * s[k] / 2); N.push(...n); }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { P, N, I };
}
function sphere(c, r, seg = 10, rings = 6) {
  const P = [], N = [], I = [];
  for (let y = 0; y <= rings; y++) for (let x = 0; x <= seg; x++) {
    const th = Math.PI * y / rings, ph = 2 * Math.PI * x / seg, n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    P.push(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r); N.push(...n);
    if (y < rings && x < seg) { const a = y * (seg + 1) + x, b = a + seg + 1; I.push(a, a + 1, b, a + 1, b + 1, b); }
  }
  return { P, N, I };
}
function cyl(c, r, h, seg = 12) { // y-axis cylinder, side + top cap, flat shaded
  const P = [], N = [], I = [];
  for (let i = 0; i < seg; i++) {
    const a0 = 2 * Math.PI * i / seg, a1 = 2 * Math.PI * (i + 1) / seg, am = (a0 + a1) / 2, nn = [Math.cos(am), 0, Math.sin(am)], b = P.length / 3;
    for (const [a, y] of [[a0, 0], [a1, 0], [a1, h], [a0, h]]) { P.push(c[0] + Math.cos(a) * r, c[1] + y, c[2] + Math.sin(a) * r); N.push(...nn); }
    I.push(b, b + 2, b + 1, b, b + 3, b + 2);
    const t = P.length / 3; P.push(c[0], c[1] + h, c[2], c[0] + Math.cos(a0) * r, c[1] + h, c[2] + Math.sin(a0) * r, c[0] + Math.cos(a1) * r, c[1] + h, c[2] + Math.sin(a1) * r); N.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    I.push(t, t + 2, t + 1);
  }
  return { P, N, I };
}
function merge(parts) { const P = [], N = [], I = []; for (const p of parts) { const o = P.length / 3; P.push(...p.P); N.push(...p.N); I.push(...p.I.map(i => i + o)); } return { P, N, I }; }
function prim(mesh, g, material) {
  const acc = (arr, type, T) => doc.createAccessor().setType(type).setArray(T.from(arr)).setBuffer(buffer);
  mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION', acc(g.P, 'VEC3', Float32Array)).setAttribute('NORMAL', acc(g.N, 'VEC3', Float32Array))
    .setAttribute('TEXCOORD_0', acc(new Array(g.P.length / 3 * 2).fill(0), 'VEC2', Float32Array)).setIndices(acc(g.I, 'SCALAR', Uint16Array)).setMaterial(material));
  return g.I.length / 3;
}
const mesh = doc.createMesh('troop');
// units: model height ~0.40 (manifest scale sizes it), +z forward
// Tower War style: team hat with wide brim, skin face, white torso, team arms/legs.
let tris = prim(mesh, merge([box([-0.03, 0.045, 0], [0.055, 0.09, 0.06]), box([0.03, 0.045, 0], [0.055, 0.09, 0.06]),
  box([-0.115, 0.17, 0.02], [0.05, 0.12, 0.06]), box([0.115, 0.17, 0.02], [0.05, 0.12, 0.06]), cyl([0, 0.34, -0.01], 0.105, 0.016), cyl([0, 0.356, -0.01], 0.058, 0.04)]), shirt);
tris += prim(mesh, box([0, 0.16, 0], [0.17, 0.15, 0.1]), cloth);
tris += prim(mesh, sphere([0, 0.30, 0.012], 0.088, 10, 5), skin);
scene.addChild(doc.createNode('troop').setMesh(mesh));
await new NodeIO().write(out, doc);
console.log(out, 'tris', tris);
