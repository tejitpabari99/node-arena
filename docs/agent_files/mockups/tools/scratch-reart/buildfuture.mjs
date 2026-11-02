// SCRATCH: builds the FUTURE set: GLBs, textures, manifest.art.future.json. Usage: node buildfuture.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { useSwatches, atlasPngsRGBA, exportGlb, countTris, T, tri } from './lib.mjs';
import * as F from './setfuture.mjs';
import { deck, iceHex } from './groundtex.mjs';
import { GLTFLoader } from '../../apps/web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const ASSETS = new URL('../../apps/web/assets/', import.meta.url).pathname;
useSwatches(F.SWATCHES);
const { base, mask } = atlasPngsRGBA();
mkdirSync(ASSETS + 'art/textures', { recursive: true });
writeFileSync(ASSETS + 'art/textures/reart-future-atlas.png', base); writeFileSync(ASSETS + 'art/textures/reart-future-atlas-mask.png', mask);
writeFileSync(ASSETS + 'art/textures/future-ground-deck.png', deck()); writeFileSync(ASSETS + 'art/textures/future-ground-ice.png', iceHex());
const dir = 'art/models/set-future/'; mkdirSync(ASSETS + dir, { recursive: true });
const save = async (name, root, anim = []) => { writeFileSync(ASSETS + dir + name + '.glb', await exportGlb(root, anim)); };
const report = {};
const per = (n, root) => { const o = {}; root.traverse(m => { if (m.isMesh) o[m.name] = tri(m.geometry); }); report[n] = o; };
for (const [n, r] of Object.entries({ barracks: F.barracks(), factory: F.factory(), tower: F.tower(), soldier: F.soldier(1), tank: F.tank(), projectile: F.projectile() })) { await save(n, r.root, r.animations ?? []); per(n, r.root); }
const lod = F.soldier(0); await save('soldier-lod1', lod.root, lod.animations); per('soldier-lod1', lod.root);
const tw = async f => { const b = readFileSync(ASSETS + 'models/tw/' + f); const g = await new Promise((res, rej) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej)); let ch; g.scene.traverse(o => { if (o.userData?.children) ch = o.userData.children; }); return ch; };
for (const [id, tw1] of [['green', 'obstacle-green.glb'], ['snow', 'obstacle-snow.glb']]) {
  const o = F.obstacles(id); o.grp.userData = { name: 'obstacle-' + id, family: 'obstacle', theme: id, texture: 'reart-future-atlas.png', variants: ['small', 'big'], children: await tw(tw1) };
  await save('obstacle-' + id, o.root); per('obstacle-' + id, o.root);
}
await save('ground-green', F.ground('green', 'future-ground-deck.png').root); await save('ground-snow', F.ground('snow', 'future-ground-ice.png').root);
const team = { mode: 'tintMask', base: 'art/textures/reart-future-atlas.png', mask: 'art/textures/reart-future-atlas-mask.png' };
const stages = [{ mesh: 'stage0' }, { mesh: 'stage1' }, { mesh: 'stage2' }], SC = 1.7;
const theme = (id, texFile, sky) => ({
  ground: { mesh: `${dir}ground-${id}.glb`, texture: `art/textures/${texFile}` },
  obstacle: { small: `${dir}obstacle-${id}.glb#small`, big: `${dir}obstacle-${id}.glb#big`, texture: 'art/textures/reart-future-atlas.png' }, sky,
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
  themes: { green: theme('green', 'future-ground-deck.png', '#070d17'), snow: theme('snow', 'future-ground-ice.png', '#0a1620') },
};
writeFileSync(ASSETS + 'manifest.art.future.json', JSON.stringify(patch, null, 2) + '\n');
console.log(JSON.stringify(report));
