// SCRATCH: builds the XMAS set: GLBs, textures, manifest.art.xmas.json. Usage: node buildxmas.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { useSwatches, atlasPngsRGBA, exportGlb, countTris, T, tri } from './lib.mjs';
import * as F from './setxmas.mjs';
import { snowCobble, candyIce } from './xmasground.mjs';
import { GLTFLoader } from '../../apps/web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const ASSETS = new URL('../../apps/web/assets/', import.meta.url).pathname;
useSwatches(F.SWATCHES);
const { base, mask } = atlasPngsRGBA();
mkdirSync(ASSETS + 'art/textures', { recursive: true });
writeFileSync(ASSETS + 'art/textures/reart-xmas-atlas.png', base); writeFileSync(ASSETS + 'art/textures/reart-xmas-atlas-mask.png', mask);
writeFileSync(ASSETS + 'art/textures/xmas-ground-cobble.png', snowCobble()); writeFileSync(ASSETS + 'art/textures/xmas-ground-candy.png', candyIce());
const dir = 'art/models/set-xmas/'; mkdirSync(ASSETS + dir, { recursive: true });
const save = async (name, root, anim = []) => { writeFileSync(ASSETS + dir + name + '.glb', await exportGlb(root, anim)); };
const report = {};
const per = (n, root) => { const o = {}; root.traverse(m => { if (m.isMesh) o[m.name] = tri(m.geometry); }); report[n] = o; };
for (const [n, r] of Object.entries({ barracks: F.barracks(), factory: F.factory(), tower: F.tower(), soldier: F.soldier(1), tank: F.tank(), projectile: F.projectile() })) { await save(n, r.root, r.animations ?? []); per(n, r.root); }
const lod = F.soldier(0); await save('soldier-lod1', lod.root, lod.animations); per('soldier-lod1', lod.root);
const tw = async f => { const b = readFileSync(ASSETS + 'models/tw/' + f); const g = await new Promise((res, rej) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej)); let ch; g.scene.traverse(o => { if (o.userData?.children) ch = o.userData.children; }); return ch; };
for (const [id, tw1] of [['green', 'obstacle-green.glb'], ['snow', 'obstacle-snow.glb']]) {
  const o = F.obstacles(id); o.grp.userData = { name: 'obstacle-' + id, family: 'obstacle', theme: id, texture: 'reart-xmas-atlas.png', variants: ['small', 'big'], children: await tw(tw1) };
  await save('obstacle-' + id, o.root); per('obstacle-' + id, o.root);
}
await save('ground-green', F.ground('green', 'xmas-ground-cobble.png').root); await save('ground-snow', F.ground('snow', 'xmas-ground-candy.png').root);
const team = { mode: 'tintMask', base: 'art/textures/reart-xmas-atlas.png', mask: 'art/textures/reart-xmas-atlas-mask.png' };
const stages = [{ mesh: 'stage0' }, { mesh: 'stage1' }, { mesh: 'stage2' }], SC = 2.0;
const theme = (id, texFile, sky) => ({
  ground: { mesh: `${dir}ground-${id}.glb`, texture: `art/textures/${texFile}` },
  obstacle: { small: `${dir}obstacle-${id}.glb#small`, big: `${dir}obstacle-${id}.glb#big`, texture: 'art/textures/reart-xmas-atlas.png' }, sky,
});
const patch = {
  $schema: '../../../packages/content/schemas/manifest-art.schema.json', schemaVersion: '2.0.0',
  visuals: {
    'building.house-wt1': { model: { parts: `${dir}barracks.glb` }, stages, team, scale: SC, label: { height: F.LABEL.barracks } },
    'building.house-wt2': { model: { parts: `${dir}factory.glb` }, stages, team, scale: SC, label: { height: F.LABEL.factory } },
    'building.tower': { model: { parts: `${dir}tower.glb` }, stages, team, scale: SC, label: { height: F.LABEL.tower } },
    'unit.soldier': { model: { parts: `${dir}soldier.glb`, lod: `${dir}soldier-lod1.glb` }, team },
    'unit.tank': { model: { parts: `${dir}tank.glb` }, team },
    'fx.projectile': { model: { parts: `${dir}projectile.glb` }, team },
  },
  themes: { green: theme('green', 'xmas-ground-cobble.png', '#1d2a4a'), snow: theme('snow', 'xmas-ground-candy.png', '#12304a') },
};
writeFileSync(ASSETS + 'manifest.art.xmas.json', JSON.stringify(patch, null, 2) + '\n');
console.log(JSON.stringify(report));
