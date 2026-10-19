// Import-time art processing (SP05 Task 6). Usage:
//   pnpm --filter @node-arena/tools assets:import -- <dir with unzipped packs: commercial/ chars/> [outDir]
// Inputs are Kenney CC0 GLBs (City Kit Commercial 2.1, Mini Characters 1.0; the road/light/cone prop pass was retired by SP03 Task 1). Output: optimised GLBs.
// SP03 Task 3 `nature` pass: Kenney Nature Kit (nature/Models/GLTF format) + Survival Kit (survival/Models/GLB format) -> models/prop-*.glb.
// Each pass is skipped when its pack dir is absent, so one pack can be re-imported alone.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, meshopt, textureCompress, flatten, join, resample } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { resolve } from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const [src, out = resolve(import.meta.dirname, '../../apps/web/assets/models')] = process.argv.slice(2);
if (!src) throw new Error('usage: import-art.mjs <packs dir> [outDir]');
const TEXTURE_MAX = 1024; // budget cap only: Kenney colormaps are 512 px palettes and shrinking them darkened/bled swatches
const TROOP_TRIS = 300;
const PROP_TRIS = 500;
const WHITE_SWATCH_UV = [0.53, 0.8]; // character-male-a colormap.png (512 px): white swatch near x=272,y=410
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const tris = doc => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

async function finish(doc, file) {
  await doc.transform(
    dedup({ keepUniqueNames: true }), prune(),
    textureCompress({ encoder: sharp, resize: [TEXTURE_MAX, TEXTURE_MAX] }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8 }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await io.write(resolve(out, file), doc);
  console.log(file, 'tris', tris(doc), 'bytes', (await stat(resolve(out, file))).size);
}

async function building(input, file) {
  const doc = await io.read(resolve(src, 'commercial/Models/GLB format', input));
  for (const prim of doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())) prim.setAttribute('TANGENT', null);
  await finish(doc, file);
}

async function prop(input, file) {
  const doc = await io.read(resolve(src, 'roads/Models/GLB format', input));
  for (const prim of doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())) prim.setAttribute('TANGENT', null);
  await finish(doc, file);
}

// Border props: same pipeline, tangents dropped, <= PROP_TRIS each.
async function nature(pack, dir, input, file) {
  const doc = await io.read(resolve(src, pack, dir, input));
  for (const prim of doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())) prim.setAttribute('TANGENT', null);
  await finish(doc, file);
  if (tris(doc) > PROP_TRIS) throw new Error(`${file}: ${tris(doc)} tris exceeds ${PROP_TRIS}`);
}

// Characters: static rest-pose mesh, skin + animations stripped (renderer `bob` replaces skinning), body/head split
// so the body material can be named `Shirt` (teamMaterial) while the head keeps skin/hair colours.
async function character(input, file, ratios) {
  const doc = await io.read(resolve(src, 'chars/Models/GLB format', input));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) { for (const c of a.listChannels()) c.dispose(); for (const x of a.listSamplers()) x.dispose(); a.dispose(); }
  const joints = new Set(root.listSkins().flatMap(sk => sk.listJoints()));
  for (const node of root.listNodes()) node.setSkin(null);
  for (const sk of root.listSkins()) sk.dispose();
  for (const j of joints) if (!j.getMesh()) j.dispose();
  for (const prim of root.listMeshes().flatMap(m => m.listPrimitives()))
    for (const s of ['JOINTS_0', 'WEIGHTS_0', 'TANGENT', 'TEXCOORD_1']) prim.setAttribute(s, null);
  const base = root.listMaterials()[0];
  const shirt = base.clone().setName('Shirt');
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.setMaterial(mesh.getName() === 'body-mesh' ? shirt : base);
  }
  // Body (shirt) UVs -> one near-white palette swatch so `teamMaterial` multiplies to a clear team colour
  // (the original body swatches are dark/saturated and would stay muddy). Head keeps its skin/hair UVs.
  const png = await sharp(base.getBaseColorTexture().getImage()).raw().toBuffer({ resolveWithObject: true });
  const [u, v] = WHITE_SWATCH_UV, px = Math.floor(v * png.info.height) * png.info.width * png.info.channels + Math.floor(u * png.info.width) * png.info.channels;
  if ([0, 1, 2].some(c => png.data[px + c] < 240)) throw new Error('white swatch moved: update WHITE_SWATCH_UV');
  for (const prim of root.listMeshes().filter(m => m.getName() === 'body-mesh').flatMap(m => m.listPrimitives())) {
    const uv = prim.getAttribute('TEXCOORD_0');
    for (let i = 0; i < uv.getCount(); i++) uv.setElement(i, [u, v]);
  }
  // Rig nodes (joints) no longer needed once skin is gone; prune removes them.
  await doc.transform(prune(), weld());
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: ratios.ratio, error: ratios.error, lockBorder: false }));
  await finish(doc, file);
  if (tris(doc) > TROOP_TRIS) throw new Error(`${file}: ${tris(doc)} tris exceeds ${TROOP_TRIS}`);
}

await mkdir(out, { recursive: true });
if (existsSync(resolve(src, 'commercial'))) {
  await building('building-d.glb', 'tower-small.glb');
  await building('building-g.glb', 'tower-standard.glb');
  await building('building-skyscraper-a.glb', 'tower-large.glb');
}
if (existsSync(resolve(src, 'chars'))) {
  await character('character-male-a.glb', 'troop-regular.glb', { ratio: Number(process.env.ART_RATIO ?? 0.4), error: Number(process.env.ART_ERROR ?? 0.1) });
}
if (existsSync(resolve(src, 'nature'))) {
  const n = (input, file) => nature('nature', 'Models/GLTF format', input, file);
  await n('tree_pineTallA.glb', 'prop-tree-pine.glb');
  await n('tree_default.glb', 'prop-tree-round.glb');
  await n('stump_round.glb', 'prop-stump.glb');
}
if (existsSync(resolve(src, 'survival'))) {
  const n = (input, file) => nature('survival', 'Models/GLB format', input, file);
  await n('box.glb', 'prop-crate.glb');
}
