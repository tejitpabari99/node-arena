// Default soldier (skin id 1) and tank (T-72, skin id 1): rigid part nodes + Run/Death glTF animations (soldier only),
// four team textures each (original 256px PNG bytes, no recompress).
import type { Node } from '@gltf-transform/core';
import { SCENES_DIR, meshIndex, type Extract } from './extract.js';
import { ModelBuilder, buildTree, pngSize, type PartRec, type Tree } from './glb.js';
import type { Output } from './output.js';

export const UNIT_TEAMS = ['blue', 'green', 'red', 'yellow'] as const;
const COLOUR: Record<(typeof UNIT_TEAMS)[number], string> = { blue: 'Blue', green: 'Green', red: 'Red', yellow: 'Yellow' };

/** Default skin per unit type: WarriorSkinSettings.defaultWarriorSkinsData = [2404 tank, 2394 soldier, 2415 artillery] (validation.md). */
export const UNIT_SPECS = [
  { family: 'soldier', skin: '1_MilitaryDefaultWarriorSkinData' },
  { family: 'tank', skin: '1_MilitaryAttackWarriorSkinData' },
] as const;

interface Skin { name: string; modelPrefabHierarchy: string; materials: Record<string, { tex: { _MainTex?: string } }> }
interface ClipTrack { pos?: number[][]; rot?: number[][]; scl?: number[][] }
interface Clip { name: string; duration: number; loop: boolean; tracks: Record<string, ClipTrack> }
interface AnimCatalog { skins: Record<string, { clips: Record<string, number> } | undefined>; clips: Record<string, Clip> }

/** Clips exported to the GLB (D4: runtime bakes from these). ParachuteFly is out of scope. */
const CLIPS: Record<string, string> = { '1_Run': 'Run', '1_Death': 'Death' };

const allZero = (rows: number[][]) => rows.every((r) => r.slice(1).every((v) => v === 0));

/**
 * Unity AnimationClips -> glTF animations. Tracks are the catalog's 30 fps samples (quaternions renormalised: the
 * samples are rounded). A track that is exactly zero everywhere is a constant curve the catalog decoder did not
 * recover (zero scale / zero quaternion are impossible poses), so it is omitted and the node keeps its bind value.
 */
function addAnimations(b: ModelBuilder, tree: Tree, recs: PartRec[], clips: Record<string, number>, cat: AnimCatalog): void {
  const animRec = recs.find((r) => r.animator);
  if (!animRec) return;
  const animRoot = animRec.path.replace(/^\//, '');
  const timeAcc = new Map<string, ReturnType<typeof b.doc.createAccessor>>();
  for (const clipKey of Object.keys(CLIPS).sort()) {
    const pid = clips[clipKey];
    if (pid === undefined) continue;
    const clip = cat.clips[String(pid)];
    if (!clip) throw new Error(`clip ${clipKey} (${pid}) missing from anim_unit_clips.json`);
    const anim = b.doc.createAnimation(CLIPS[clipKey]!);
    const omitted: string[] = [];
    for (const tp of Object.keys(clip.tracks).sort()) {
      if (tp.startsWith('#') && tp !== '#0') throw new Error(`clip ${clip.name}: unresolved binding ${tp}`);
      const node: Node | undefined = tree.byPath.get(tp === '#0' || tp === '' ? animRoot : `${animRoot}/${tp}`);
      if (!node) throw new Error(`clip ${clip.name}: track ${tp} has no node`);
      const track = clip.tracks[tp]!;
      for (const [kind, path, type, width] of [['pos', 'translation', 'VEC3', 3], ['rot', 'rotation', 'VEC4', 4], ['scl', 'scale', 'VEC3', 3]] as const) {
        const rows = track[kind];
        if (!rows) continue;
        if (allZero(rows)) { omitted.push(`${tp || '#0'}:${path}`); continue; }
        const tkey = rows.map((r) => r[0]).join(',');
        let times = timeAcc.get(tkey);
        if (!times) { times = b.doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(rows.map((r) => r[0]!))).setBuffer(b.buffer); timeAcc.set(tkey, times); }
        const out = new Float32Array(rows.length * width);
        rows.forEach((r, i) => {
          const v = r.slice(1);
          if (kind === 'rot') { const n = Math.hypot(...v); for (let k = 0; k < 4; k++) out[i * 4 + k] = n > 0 ? v[k]! / n : v[k]!; }
          else for (let k = 0; k < 3; k++) out[i * 3 + k] = v[k]!;
        });
        const values = b.doc.createAccessor().setType(type).setArray(out).setBuffer(b.buffer);
        const sampler = b.doc.createAnimationSampler().setInput(times).setOutput(values).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(b.doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
      }
    }
    anim.setExtras({ loop: clip.loop, duration: clip.duration, fps: 30, omittedUndecodedTracks: omitted.sort() });
  }
}

export async function unitsJob(ex: Extract): Promise<Output[]> {
  const skins = ex.json<Skin[]>('catalog/skins.json');
  const parts = ex.json<Record<string, PartRec[]>>('catalog/prefab_parts_scenes.json');
  const anims = ex.json<AnimCatalog>('catalog/anim_unit_clips.json');
  const objs = meshIndex(ex, SCENES_DIR);
  const outs: Output[] = [];
  for (const spec of UNIT_SPECS) {
    const skin = skins.find((s) => s.name === spec.skin);
    if (!skin) throw new Error(`skin ${spec.skin} not in skins.json`);
    const recs = parts[skin.modelPrefabHierarchy];
    if (!recs) throw new Error(`no prefab parts for ${skin.modelPrefabHierarchy}`);
    const b = new ModelBuilder(ex, objs);
    const tree = buildTree(b, recs, spec.family);
    const clips = anims.skins[skin.modelPrefabHierarchy]?.clips;
    if (clips) addAnimations(b, tree, recs, clips, anims);
    tree.root.setExtras({ family: spec.family, teams: [...UNIT_TEAMS], source: skin.name });
    outs.push({ path: `models/tw/${spec.family}.glb`, bytes: await b.write(tree.root, spec.family) });
    for (const team of UNIT_TEAMS) {
      const tex = skin.materials[COLOUR[team]]?.tex._MainTex;
      if (!tex) throw new Error(`${spec.skin}: no ${COLOUR[team]} texture`);
      const bytes = ex.read(`${SCENES_DIR}/Texture2D/${tex}@sh.png`);
      const [w, h] = pngSize(bytes);
      if (w !== 256 || h !== 256) throw new Error(`${tex}: expected 256x256, got ${w}x${h}`);
      outs.push({ path: `textures/tw/${spec.family}-${team}.png`, bytes });
    }
  }
  return outs;
}
