import type { AnimationClip, Object3D } from 'three';
import { parseModelRef, type ModelRef } from '../manifest/model-ref.js';

export interface LoadedGltf { scene: Object3D; animations?: readonly AnimationClip[] }
export type GltfLoadFn = (file: string) => Promise<LoadedGltf>;

/** Default loader (browser): three's GLTFLoader + meshopt, imported lazily so node tests never touch it. */
export async function createBrowserGltfLoader(baseURL = '/'): Promise<GltfLoadFn> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  return file => loader.loadAsync(`${baseURL.replace(/\/$/, '')}/${file}`);
}

/** One load per file (failures evicted so a retry reloads). `#node` refs resolve to a named node within the file. */
export class ModelCache {
  private files = new Map<string, Promise<LoadedGltf>>();
  constructor(private load: GltfLoadFn) {}
  get loadedFiles(): number { return this.files.size; }
  file(file: string): Promise<LoadedGltf> {
    let p = this.files.get(file);
    if (!p) {
      p = this.load(file);
      p.catch(() => { if (this.files.get(file) === p) this.files.delete(file); });
      this.files.set(file, p);
    }
    return p;
  }
  /** Scene root for a plain path, or the named node for `file#node`. Returns the shared (uncloned) object. */
  async resolve(ref: string | ModelRef): Promise<Object3D> {
    const r = typeof ref === 'string' ? parseModelRef(ref) : ref;
    const { scene } = await this.file(r.file);
    if (r.node === undefined) return scene;
    const node = scene.getObjectByName(r.node);
    if (!node) throw new Error(`Node "${r.node}" not found in ${r.file}`);
    return node;
  }
  dispose(): void { this.files.clear(); }
}
