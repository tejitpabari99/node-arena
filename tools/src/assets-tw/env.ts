// Environment assets (PRD 07 R1 Obstacles / Environment, D6): per theme a ground plane GLB + obstacle GLB (small/big variants) and
// 256px textures. Mapping is by NAME (Addressables GUID -> prefab is unresolved: catalog.bin is unparsed; see validation.md Task 4):
//   green: `Environment military green for screen` (Ground), obstacles `Obstacle.prefab` child meshes = EnvironmentDataGreen small/big pids
//   snow:  `env snow optimized for screen` (snow_ground), obstacles EnvironmentDataSnow small = big = snow_obstacle
// `top_part_2` / `bottom_part_2` canyon dressing (thousands of tris) and ice_cube are dropped: over the 500-tri ground budget.
import sharp from 'sharp';
import { ASSETS_DIR, meshIndex, textureByName, type Extract } from './extract.js';
import { ModelBuilder, type PartRec } from './glb.js';
import type { Output } from './output.js';

export const ENV_THEMES = ['green', 'snow'] as const;
export const ENV_TEXTURE_PX = 256;

interface EnvSpec {
  theme: (typeof ENV_THEMES)[number];
  prefab: string;
  groundMesh: string;
  groundTexture: string;
  envTexture: string;
  /** EnvironmentData smallObstacleMesh / bigObstacleMesh pids (file EnvironmentData<Theme>_<pid>@sh.json, kept here as the verified values). */
  small: string;
  big: string;
  smallName: string;
  bigName: string;
}
export const ENV_SPECS: readonly EnvSpec[] = [
  { theme: 'green', prefab: 'Environment military green for screen_', groundMesh: 'Ground', groundTexture: 'MilitaryGroundTexture', envTexture: 'MilitartEnvironmentTexture', small: '1959946065686190299', big: '6488534389935003867', smallName: 'green_obstacle_1', bigName: 'green_obstacle_2' },
  { theme: 'snow', prefab: 'env snow optimized for screen_', groundMesh: 'snow_ground', groundTexture: 'SnowGroundTexture', envTexture: 'SnowEnvironmentTexture', small: '-2846296784030547687', big: '-2846296784030547687', smallName: 'snow_obstacle', bigName: 'snow_obstacle' },
];
const OBSTACLE_PREFAB = 'Obstacle_';
/** Ground material (MilitaryGround.mat / SnowGround.mat): _MainTex scale (3,3), offset (0,-0.05). Read from the extract and asserted. */
const GROUND_MATERIAL: Record<string, string> = { green: 'MilitaryGround_6497056197787058761', snow: 'SnowGround_-2704111877889193895' };

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

async function downscale(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(bytes).resize(ENV_TEXTURE_PX, ENV_TEXTURE_PX, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
  return new Uint8Array(out);
}

function prefabKey(parts: Record<string, PartRec[]>, prefix: string): { key: string; recs: PartRec[] } {
  const keys = Object.keys(parts).filter((k) => k.startsWith(prefix));
  if (keys.length !== 1) throw new Error(`prefab ${prefix}: expected 1 match, found ${keys.length}`);
  return { key: keys[0]!, recs: parts[keys[0]!]! };
}

interface MatJson { m_SavedProperties: { m_TexEnvs: [string, { m_Texture: { m_PathID: number | string }; m_Scale: { x: number; y: number }; m_Offset: { x: number; y: number } }][] } }

export async function envJob(ex: Extract): Promise<Output[]> {
  const parts = ex.json<Record<string, PartRec[]>>('catalog/prefab_parts_assets.json');
  const objs = meshIndex(ex, ASSETS_DIR);
  const obstacle = prefabKey(parts, OBSTACLE_PREFAB).recs;
  const children = obstacle.filter((r) => r.mesh);
  const outs: Output[] = [];
  for (const spec of ENV_SPECS) {
    const env = prefabKey(parts, spec.prefab).recs;
    // ---- ground: one 10x10 plane (200 tris), prefab world scale kept, translation zeroed (placement = renderer) ----
    const g = env.filter((r) => r.mesh === spec.groundMesh);
    if (g.length !== 1) throw new Error(`${spec.theme}: expected one ${spec.groundMesh} record, found ${g.length}`);
    const gr = g[0]!;
    const root = env[0]!;
    const worldPos = gr.lp!.map((v, i) => round6(v + root.lp![i]!));
    const mat = ex.json<MatJson>(`${ASSETS_DIR}/Material/${GROUND_MATERIAL[spec.theme]!}.json`).m_SavedProperties.m_TexEnvs.find((t) => t[0] === '_MainTex')![1];
    const gtexRel = textureByName(ex, ASSETS_DIR, spec.groundTexture);
    if (!gtexRel.includes(`_${String(mat.m_Texture.m_PathID)}.png`)) throw new Error(`${spec.theme}: ground material texture ${String(mat.m_Texture.m_PathID)} is not ${gtexRel}`);
    const gb = new ModelBuilder(ex, objs, 'ground');
    const gnode = gb.doc.createNode('ground').setMesh(gb.mesh(gr.meshPid!, gr.mesh!)).setScale(gr.ls as [number, number, number]);
    gnode.setExtras({ prefabWorldPos: worldPos });
    const groot = gb.doc.createNode(`ground-${spec.theme}`).addChild(gnode).setExtras({
      family: 'ground', theme: spec.theme, texture: `ground-${spec.theme}.png`, wrap: 'repeat',
      meshSize: 10, uvRepeat: [round6(mat.m_Scale.x), round6(mat.m_Scale.y)], uvOffset: [round6(mat.m_Offset.x), round6(mat.m_Offset.y)],
      source: spec.prefab.replace(/_$/, ''), dropped: ['top_part_2', 'bottom_part_2', 'ice_cube'],
    });
    outs.push({ path: `models/tw/ground-${spec.theme}.glb`, bytes: await gb.write(groot, `ground-${spec.theme}`) });
    outs.push({ path: `textures/tw/ground-${spec.theme}.png`, bytes: await downscale(ex.read(gtexRel)) });

    // ---- obstacles: `small` / `big` nodes at unit scale; the 8 Obstacle.prefab children (index = level OCP/OCR/S index) in extras ----
    const ob = new ModelBuilder(ex, objs, 'obstacle');
    const oroot = ob.doc.createNode(`obstacle-${spec.theme}`);
    oroot.addChild(ob.doc.createNode('small').setMesh(ob.mesh(spec.small, spec.smallName)));
    oroot.addChild(ob.doc.createNode('big').setMesh(ob.mesh(spec.big, spec.bigName)));
    const kids = children.map((c, index) => {
      const pid = String(c.meshPid);
      if (pid !== '1959946065686190299' && pid !== '6488534389935003867') throw new Error(`Obstacle child ${index}: unexpected mesh ${pid}`);
      return { index, variant: pid === '1959946065686190299' ? 'small' : 'big', scale: (c.ls as number[]).map(round6), localPosition: (c.lp as number[]).map(round6) };
    });
    if (kids.length !== 8) throw new Error(`Obstacle.prefab: expected 8 children, found ${kids.length}`);
    oroot.setExtras({
      family: 'obstacle', theme: spec.theme, texture: `obstacle-${spec.theme}.png`, variants: ['small', 'big'],
      mapping: 'level obstacle id o<cluster>-<k>: k = Obstacle.prefab child index, variant from elements[].variant, scale from children[k].scale',
      children: kids,
    });
    outs.push({ path: `models/tw/obstacle-${spec.theme}.glb`, bytes: await ob.write(oroot, `obstacle-${spec.theme}`) });
    outs.push({ path: `textures/tw/obstacle-${spec.theme}.png`, bytes: await downscale(ex.read(textureByName(ex, ASSETS_DIR, spec.envTexture))) });
  }
  return outs;
}
