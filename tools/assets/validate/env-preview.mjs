// Task 4 preview: ground + obstacle GLBs per theme (importer output), mirrored worldRoot, game rig.
// TW_EXTRACT=... node tools/assets/validate/env-preview.mjs  -> BF/ref/proto-check/env-<theme>-preview.png
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { startShooter } from './shots.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const assets = path.join(repo, 'apps/web/assets');
const out = path.join(repo, 'docs/agent_files/feat-tower-war-port-20261022-0321/ref/proto-check');
const extract = process.env.TW_EXTRACT;
if (!extract) { console.log('env-preview: TW_EXTRACT unset; skipping'); process.exit(0); }
const T = 256;
const shooter = await startShooter({ extract });
const bg = { green: 0x6f9a3a, snow: 0x9fb8d0 };
try {
  for (const theme of ['green', 'snow']) {
    const tex = n => `/@fs${path.join(assets, 'textures/tw', `${n}-${theme}.png`)}`;
    const g = path.join(assets, 'models/tw', `ground-${theme}.glb`), o = path.join(assets, 'models/tw', `obstacle-${theme}.glb`);
    const base = { rig: 'tw', w: T, h: T, bg: bg[theme] };
    const shots = [];
    // ground: top-down-ish (game cam) and low oblique, uv repeat/offset from extras (3,3)/(0,-0.05)
    for (const [pitch, fov] of [[85, 30], [55, 30]]) shots.push((await shooter.shoot({ ...base, glb: g, tex: tex('ground'), texRepeat: [3, 3], texOffset: [0, 0.05], yaw: 0, pitch, fov })).buf);
    for (const only of [['small'], ['big']]) for (const yaw of [0, 90, 180]) shots.push((await shooter.shoot({ ...base, glb: o, tex: tex('obstacle'), only, yaw, pitch: 20, fov: 30 })).buf);
    const comps = shots.map((b, i) => ({ input: b, left: (i % 4) * T, top: Math.floor(i / 4) * T }));
    await sharp({ create: { width: 4 * T, height: 2 * T, channels: 3, background: '#303030' } }).composite(comps).png().toFile(path.join(out, `env-${theme}-preview.png`));
    console.log(`env-${theme}-preview.png (ground pitch85/55, small yaw 0/90/180, big yaw 0/90/180)`);
  }
} finally { await shooter.close(); }
