// RAW GLB construction helpers (gltf-transform). Assets are RAW Unity geometry: no x-negate, no winding fix (02 Frame contract);
// SP08 owns the single mirror at worldRoot. Output is deterministic: no timestamps, stable insertion order.
import { Document, NodeIO, type Buffer as GltfBuffer, type Material, type Mesh, type Node } from '@gltf-transform/core';
import type { Extract } from './extract.js';
import { parseObj } from './obj.js';

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface PartRec {
  path: string;
  active: boolean;
  lp?: number[];
  lr?: number[];
  ls?: number[];
  mesh?: string;
  meshPid?: number | string;
  animator?: string;
}

export class ModelBuilder {
  readonly doc = new Document();
  readonly buffer: GltfBuffer = this.doc.createBuffer();
  readonly material: Material;
  private readonly meshes = new Map<string, Mesh>();
  constructor(private readonly ex: Extract, private readonly objs: Map<string, string>, materialName = 'team') {
    this.material = this.doc.createMaterial(materialName).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1);
  }

  /** One glTF mesh per Unity mesh pid (shared by every node that uses it). */
  mesh(pid: number | string, name: string): Mesh {
    const key = String(pid);
    const hit = this.meshes.get(key);
    if (hit) return hit;
    const file = this.objs.get(key);
    if (!file) throw new Error(`mesh pid ${key} (${name}) has no OBJ in the extract`);
    const g = parseObj(this.ex.text(file), file);
    const acc = (type: 'SCALAR' | 'VEC2' | 'VEC3', array: Float32Array | Uint16Array | Uint32Array) => this.doc.createAccessor().setType(type).setArray(array).setBuffer(this.buffer);
    const prim = this.doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', g.positions))
      .setIndices(acc('SCALAR', g.vertexCount <= 65535 ? Uint16Array.from(g.indices) : g.indices))
      .setMaterial(this.material);
    if (g.normals) prim.setAttribute('NORMAL', acc('VEC3', g.normals));
    if (g.uvs) prim.setAttribute('TEXCOORD_0', acc('VEC2', g.uvs));
    const mesh = this.doc.createMesh(name).addPrimitive(prim);
    this.meshes.set(key, mesh);
    return mesh;
  }

  /** Finish: single scene around `root`, GLB bytes. */
  async write(root: Node, sceneName: string): Promise<Uint8Array> {
    const scene = this.doc.createScene(sceneName).addChild(root);
    this.doc.getRoot().setDefaultScene(scene);
    return new NodeIO().writeBinary(this.doc);
  }
}

export interface Tree {
  root: Node;
  /** One entry per input record: its node, or null when the record was skipped. */
  nodes: (Node | null)[];
  /** Original prefab path (no leading slash) -> node (last record wins for duplicate paths). */
  byPath: Map<string, Node>;
}

/**
 * Prefab records (DFS order) -> node tree. Transforms are the prefab's local TRS verbatim (RAW), except the root
 * translation, which is the prefab's scene position and is zeroed (placement is the renderer's job).
 * Same-name siblings get `_<k>` suffixes so every node name is unique within its parent.
 */
export function buildTree(b: ModelBuilder, recs: PartRec[], rootName: string, skip: (path: string) => boolean = () => false): Tree {
  const dupes = new Map<string, number>();
  const parentOf = (p: string) => p.split('/').slice(0, -1).join('/');
  const kept = recs.map((r) => {
    const p = r.path.replace(/^\//, '');
    return skip('/' + p) && !r.mesh ? null : p;
  });
  for (const p of kept) if (p !== null) { const k = `${parentOf(p)}\0${p.split('/').pop()}`; dupes.set(k, (dupes.get(k) ?? 0) + 1); }
  const seen = new Map<string, number>();
  const nodes: (Node | null)[] = [];
  const byPath = new Map<string, Node>();
  let root: Node | null = null;
  recs.forEach((r, i) => {
    const p = kept[i];
    if (p === null || p === undefined) { nodes.push(null); return; }
    const base = p.split('/').pop()!;
    const dk = `${parentOf(p)}\0${base}`;
    let name = base;
    if ((dupes.get(dk) ?? 0) > 1) { const k = seen.get(dk) ?? 0; seen.set(dk, k + 1); name = `${base}_${k}`; }
    const isRoot = !p.includes('/');
    const node = b.doc.createNode(isRoot ? rootName : name);
    if (r.lp) node.setTranslation(isRoot ? [0, 0, 0] : (r.lp as Vec3));
    if (r.lr) node.setRotation(r.lr as Vec4);
    if (r.ls) node.setScale(r.ls as Vec3);
    if (!r.active) node.setExtras({ activeInPrefab: false });
    if (r.mesh && r.meshPid !== undefined) node.setMesh(b.mesh(r.meshPid, r.mesh));
    if (isRoot) {
      if (root) throw new Error(`second root record ${p}`);
      root = node;
    } else {
      const parent = byPath.get(parentOf(p));
      if (!parent) throw new Error(`record ${p} has no parent in the kept set`);
      parent.addChild(node);
    }
    byPath.set(p, node);
    nodes.push(node);
  });
  if (!root) throw new Error('no root record');
  return { root, nodes, byPath };
}

export function pngSize(bytes: Uint8Array): [number, number] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== 0x89504e47) throw new Error('not a PNG');
  return [dv.getUint32(16), dv.getUint32(20)];
}
