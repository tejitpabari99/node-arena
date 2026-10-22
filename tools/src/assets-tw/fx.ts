// FX sprite textures and lane ribbon textures: addressable names resolved through assets/_manifest/container_all.tsv,
// original PNG bytes copied (Texture2D preferred over the Sprite export of the same address).
import type { Extract } from './extract.js';
import type { Output } from './output.js';

const FX_DIR = 'Assets/Addressables/Textures/FX/';
/** [addressable name, output path]. Capture/stage ring+star+glow, death smoke+spark, lane ribbon (WayBaseStandard `wave`, arrows, trail). */
export const FX_TEXTURES: readonly (readonly [string, string])[] = [
  ['CFX3_T_HollowCircle', 'fx/CFX3_T_HollowCircle.png'],
  ['CFX_T_Star Add', 'fx/CFX_T_Star_Add.png'],
  ['glow_2', 'fx/glow_2.png'],
  ['smoke', 'fx/smoke.png'],
  ['Spark', 'fx/Spark.png'],
  ['arrow', 'fx/lane-arrow.png'],
  ['waveArrow', 'fx/lane-waveArrow.png'],
  ['wave', 'fx/lane-wave.png'],
  ['trail', 'fx/lane-trail.png'],
];

export async function fxJob(ex: Extract): Promise<Output[]> {
  const rows = ex.text('assets/_manifest/container_all.tsv').split('\n').map((l) => l.split('\t'));
  const outs: Output[] = [];
  for (const [name, out] of FX_TEXTURES) {
    const hits = rows.filter((r) => r[0] === 'defaultlocalgroup_assets' && r[1] === `${FX_DIR}${name}.png`).map((r) => r[3]!);
    const file = hits.find((f) => f.includes('/Texture2D/')) ?? hits.find((f) => f.includes('/Sprite/'));
    if (!file) throw new Error(`FX texture ${name}: not in container_all.tsv`);
    outs.push({ path: out, bytes: ex.read(file) });
  }
  return outs;
}
