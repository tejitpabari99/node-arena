// Code-built chibi troop (SP04 Task 6 fallback): sphere head + box torso/legs/arms, no rig, no textures.
// Usage: node tools/assets/build-troop-chibi.mjs [outFile]. Body parts use material `Shirt` (team colour), head `Head`.
import { Document, NodeIO } from '@gltf-transform/core';
import { resolve } from 'node:path';
const out = process.argv[2] ?? resolve(import.meta.dirname, '../../apps/web/assets/models/troop-regular.glb');
const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene('troop');
const shirt = doc.createMaterial('Shirt').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
const head = doc.createMaterial('Head').setBaseColorFactor([0.5, 0.5, 0.5, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
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
function merge(parts) { const P = [], N = [], I = []; for (const p of parts) { const o = P.length / 3; P.push(...p.P); N.push(...p.N); I.push(...p.I.map(i => i + o)); } return { P, N, I }; }
function prim(mesh, g, material) {
  const acc = (arr, type, T) => doc.createAccessor().setType(type).setArray(T.from(arr)).setBuffer(buffer);
  mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION', acc(g.P, 'VEC3', Float32Array)).setAttribute('NORMAL', acc(g.N, 'VEC3', Float32Array))
    .setAttribute('TEXCOORD_0', acc(new Array(g.P.length / 3 * 2).fill(0), 'VEC2', Float32Array)).setIndices(acc(g.I, 'SCALAR', Uint16Array)).setMaterial(material));
  return g.I.length / 3;
}
const mesh = doc.createMesh('troop');
// units: model height ~0.40 (manifest scale sizes it), +z forward
let tris = prim(mesh, merge([box([-0.03, 0.045, 0], [0.055, 0.09, 0.06]), box([0.03, 0.045, 0], [0.055, 0.09, 0.06]), box([0, 0.16, 0], [0.17, 0.15, 0.1]),
  box([-0.115, 0.17, 0.02], [0.05, 0.12, 0.06]), box([0.115, 0.17, 0.02], [0.05, 0.12, 0.06])]), shirt);
tris += prim(mesh, sphere([0, 0.30, 0.015], 0.08), head);
scene.addChild(doc.createNode('troop').setMesh(mesh));
await new NodeIO().write(out, doc);
console.log(out, 'tris', tris);
