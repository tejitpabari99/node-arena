// Regenerates levels.json (compiled levels for capture scenes l4-green / l21-snow). Run after `pnpm build:prerequisites`:
//   node tools/assets/capture/fixtures/gen-levels.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../../../../packages/content/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../packages/content');
const files = { 'data/balance.json': fs.readFileSync(path.join(root, 'data/balance.json'), 'utf8') };
for (const dir of ['units', 'buildings', 'elements', 'campaigns', 'levels']) {
  for (const name of fs.readdirSync(path.join(root, 'data', dir)).sort()) files[`data/${dir}/${name}`] = fs.readFileSync(path.join(root, 'data', dir, name), 'utf8');
}
const { compiled } = loadContent(files);
// l4/l21 have no obstacles; levelview-4 (green, 10) and levelview-20 (snow, 22) exercise the obstacle renderer.
const pick = { 'l4-green': 'levelview-1', 'l21-snow': 'levelview-19', 'obstacles-green': 'levelview-4', 'obstacles-snow': 'levelview-20' };
const out = {};
for (const [scene, id] of Object.entries(pick)) {
  const l = compiled[id];
  out[scene] = { id: l.id, theme: l.theme, bounds: l.bounds, players: l.players, buildings: l.buildings.map(b => ({ id: b.id, x: b.x, z: b.z, owner: b.owner, kind: b.kind, visual: b.visual })), elements: l.elements.map(e => ({ id: e.id, x: e.x, z: e.z, yawMilliDeg: e.yawMilliDeg, visual: e.visual, variant: e.variant })) };
}
fs.writeFileSync(path.join(here, 'levels.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote levels.json', Object.keys(out));
