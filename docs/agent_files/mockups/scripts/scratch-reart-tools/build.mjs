// SCRATCH: builds GLBs + atlas + manifest art patches for model sets. Usage: node build.mjs [a|b ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { atlasPngs, exportGlb, countTris, T } from './lib.mjs';
const ASSETS = new URL('../../apps/web/assets/', import.meta.url).pathname;
const sets = process.argv.slice(2).length ? process.argv.slice(2) : ['a', 'b'];
const { base, mask } = atlasPngs();
mkdirSync(ASSETS + 'art/textures', { recursive: true });
writeFileSync(ASSETS + 'art/textures/reart-atlas.png', base); writeFileSync(ASSETS + 'art/textures/reart-atlas-mask.png', mask);
const report = {}; const SC = 1.2;
for (const id of sets) {
  const m = await import(`./set${id}.mjs`);
  const dir = `art/models/set-${id}/`; mkdirSync(ASSETS + dir, { recursive: true });
  const out = (name, r, extra = '') => exportGlb(r.root, r.animations ?? []).then(b => { writeFileSync(ASSETS + dir + name + extra + '.glb', b); });
  const jobs = {
    barracks: m.barracks(), factory: m.factory(), tower: m.tower(), soldier: m.soldier(1), tank: m.tank(),
  };
  const lod = m.soldier(0);
  for (const [n, r] of Object.entries(jobs)) {
    await out(n, r);
    const per = {}; r.root.traverse(o => { if (o.isMesh) per[o.name] = o.geometry.attributes.position.count / 3; });
    report[id + ':' + n] = per;
  }
  await out('soldier', lod, '-lod1');
  report[id + ':soldier-lod1'] = countTris(lod.root);
  const team = { mode: 'tintMask', base: 'art/textures/reart-atlas.png', mask: 'art/textures/reart-atlas-mask.png' };
  const stages = [{ mesh: 'stage0' }, { mesh: 'stage1' }, { mesh: 'stage2' }];
  const patch = {
    $schema: '../../../packages/content/schemas/manifest-art.schema.json', schemaVersion: '2.0.0',
    visuals: {
      'building.house-wt1': { model: { parts: `${dir}barracks.glb` }, stages, team, scale: SC, label: { height: m.LABEL?.barracks ?? 2.2 } },
      'building.house-wt2': { model: { parts: `${dir}factory.glb` }, stages, team, scale: SC, label: { height: m.LABEL?.factory ?? 1.7 } },
      'building.tower': { model: { parts: `${dir}tower.glb` }, stages, team, scale: SC, label: { height: m.LABEL?.tower ?? 2.6 } },
      'unit.soldier': { model: { parts: `${dir}soldier.glb`, lod: `${dir}soldier-lod1.glb` }, team },
      'unit.tank': { model: { parts: `${dir}tank.glb` }, team },
    },
  };
  writeFileSync(ASSETS + `manifest.art.${id}.json`, JSON.stringify(patch, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 1));
