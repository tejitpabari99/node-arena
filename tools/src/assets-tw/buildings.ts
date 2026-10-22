// Barracks (WT1 House_Default), tank factory (WT2 House_Attack), watch tower, tower projectile: GLB with part nodes, stage
// nodes/enable-lists (D5) and five-colour (projectile: neutral = grey) texture sets resolved by name.
import { ASSETS_DIR, SCENES_DIR, meshIndex, textureByName, type Extract } from './extract.js';
import { ModelBuilder, buildTree, pngSize, type PartRec } from './glb.js';
import type { Output } from './output.js';

export const BUILDING_TEAMS = ['blue', 'green', 'red', 'yellow', 'gray'] as const;
const COLOUR: Record<(typeof BUILDING_TEAMS)[number], string> = { blue: 'Blue', green: 'Green', red: 'Red', yellow: 'Yellow', gray: 'Neutral' };

export const BUILDING_SPECS = [
  { family: 'barracks', prefab: 'House_Default _None_', texture: 'MilitaryDefaultHouse' },
  { family: 'factory', prefab: 'House_Attack _None_', texture: 'MilitaryAttHouse' },
  { family: 'tower', prefab: 'Tower_', texture: 'MilitaryTower' },
] as const;

/** Prototype writer's filter: gameplay/particle helper nodes carry no art. */
const SKIP = ['/Physics', 'ManyPoints', '/Point_', 'lightning', 'evolution', 'Speed x2', 'OnGameStart', 'StageUpdate', 'Particle'];
const skip = (p: string) => SKIP.some((x) => p.includes(x));

interface HierNode { name: string; goPathID: number | string; components: { type: string; script?: string; pathID?: number | string }[]; children: HierNode[] }
interface HouseArtJson { meshesByLevelHouse: { m_PathID: number | string }[]; enableArtByLevel: { artToEnable: { m_PathID: number | string }[] }[] }

function flatten(n: HierNode, prefix: string, out: { path: string; node: HierNode }[] = []) {
  const path = prefix ? `${prefix}/${n.name}` : n.name;
  out.push({ path, node: n });
  for (const c of n.children) flatten(c, path, out);
  return out;
}

export async function buildingsJob(ex: Extract): Promise<Output[]> {
  const parts = ex.json<Record<string, PartRec[]>>('catalog/prefab_parts_assets.json');
  const objs = meshIndex(ex, ASSETS_DIR);
  const artFiles = ex.list(`${ASSETS_DIR}/MonoBehaviour/Game.Main.Buildings.HouseArt`);
  const outs: Output[] = [];
  for (const spec of BUILDING_SPECS) {
    const keys = Object.keys(parts).filter((k) => k.startsWith(spec.prefab));
    if (keys.length !== 1) throw new Error(`prefab ${spec.prefab}: expected 1 match, found ${keys.length}`);
    const key = keys[0]!;
    const recs = parts[key]!;
    const hier = flatten(ex.json<HierNode>(`${ASSETS_DIR}/hierarchy/${key}`), '');
    if (hier.length !== recs.length || hier.some((h, i) => '/' + h.path !== recs[i]!.path)) throw new Error(`${key}: hierarchy and prefab records disagree`);

    const b = new ModelBuilder(ex, objs);
    const tree = buildTree(b, recs, spec.family, skip);
    const goNode = new Map<string, string>(); // GameObject pathID -> output node name
    hier.forEach((h, i) => { const n = tree.nodes[i]; if (n) goNode.set(String(h.node.goPathID), n.getName()); });

    const artIdx = hier.findIndex((h) => h.node.components.some((c) => c.script === 'Game.Main.Buildings.HouseArt'));
    const art = tree.nodes[artIdx];
    const comp = hier[artIdx]?.node.components.find((c) => c.script === 'Game.Main.Buildings.HouseArt');
    if (!art || !comp) throw new Error(`${key}: no HouseArt`);
    const artFile = artFiles.filter((f) => f.endsWith(`_${String(comp.pathID)}.json`));
    if (artFile.length !== 1) throw new Error(`${key}: HouseArt ${String(comp.pathID)} json not unique`);
    const houseArt = ex.json<HouseArtJson>(`${ASSETS_DIR}/MonoBehaviour/Game.Main.Buildings.HouseArt/${artFile[0]!}`);

    const levelPids = houseArt.meshesByLevelHouse.map((m) => String(m.m_PathID));
    const enable = houseArt.enableArtByLevel.map((e) => e.artToEnable.map((a) => {
      const name = goNode.get(String(a.m_PathID));
      if (!name) throw new Error(`${key}: enableArtByLevel references unknown GameObject ${String(a.m_PathID)}`);
      return name;
    }));
    const stageNodes: string[][] = [];
    if (new Set(levelPids).size === levelPids.length) {
      // Stage = mesh swap: the prototype double-counted stage 0 on `Art`; emit stage0..N once, no own mesh on Art.
      art.setMesh(null);
      levelPids.forEach((pid, s) => {
        const objFile = objs.get(pid);
        if (!objFile) throw new Error(`${key}: stage ${s} mesh ${pid} missing`);
        const meshName = objFile.split('/').pop()!.replace(/_-?\d+\.obj$/, '');
        const node = b.doc.createNode(`stage${s}`).setMesh(b.mesh(pid, meshName));
        if (s > 0) node.setExtras({ activeInPrefab: false });
        art.addChild(node);
        stageNodes.push([node.getName(), ...(enable[s] ?? [])]);
      });
    } else if (new Set(levelPids).size === 1) {
      // Stage = enable-list over child nodes (factory: all three stage meshes are the same factory_base).
      const baseIdx = recs.findIndex((r) => r.meshPid !== undefined && String(r.meshPid) === levelPids[0]);
      const base = tree.nodes[baseIdx];
      if (!base) throw new Error(`${key}: base stage mesh node not found`);
      levelPids.forEach((_, s) => stageNodes.push([...new Set([base.getName(), ...(enable[s] ?? [])])]));
    } else throw new Error(`${key}: mixed stage mesh swap/enable layout not supported`);
    tree.root.setExtras({ family: spec.family, teams: [...BUILDING_TEAMS], stageNodes });
    outs.push({ path: `models/tw/${spec.family}.glb`, bytes: await b.write(tree.root, spec.family) });

    for (const team of BUILDING_TEAMS) {
      const rel = textureByName(ex, ASSETS_DIR, `${spec.texture}${COLOUR[team]}Texture`);
      const bytes = ex.read(rel);
      const [w, h] = pngSize(bytes);
      if (w !== 256 || h !== 256) throw new Error(`${rel}: expected 256x256, got ${w}x${h}`);
      outs.push({ path: `textures/tw/${spec.family}-${team}.png`, bytes });
    }
  }
  return outs;
}

/** Tower shot (`TowerProjectile` cannonball): one mesh, five colour textures (neutral = Grey). */
export async function projectileJob(ex: Extract): Promise<Output[]> {
  const parts = ex.json<Record<string, PartRec[]>>('catalog/prefab_parts_scenes.json');
  const keys = Object.keys(parts).filter((k) => k.startsWith('TowerProjectile_'));
  if (keys.length !== 1) throw new Error(`TowerProjectile prefab: expected 1 match, found ${keys.length}`);
  const b = new ModelBuilder(ex, meshIndex(ex, SCENES_DIR));
  const tree = buildTree(b, parts[keys[0]!]!, 'projectile');
  tree.root.setExtras({ family: 'projectile', teams: [...BUILDING_TEAMS] });
  const outs: Output[] = [{ path: 'models/tw/projectile.glb', bytes: await b.write(tree.root, 'projectile') }];
  const names = { blue: 'Blue', green: 'Green', red: 'Red', yellow: 'Yellow', gray: 'Grey' } as const;
  for (const team of BUILDING_TEAMS) {
    const base = `TowerProjectile${names[team]}Texture`;
    const hits = ex.list(`${SCENES_DIR}/Texture2D`).filter((f) => new RegExp(`^${base}_\\d+@sh\\.png$`).test(f));
    if (hits.length !== 1) throw new Error(`${base}: expected 1 texture, found ${hits.length}`);
    const bytes = ex.read(`${SCENES_DIR}/Texture2D/${hits[0]!}`);
    const [w, h] = pngSize(bytes);
    if (w > 256 || h > 256) throw new Error(`${base}: larger than 256px`);
    outs.push({ path: `textures/tw/projectile-${team}.png`, bytes });
  }
  return outs;
}
