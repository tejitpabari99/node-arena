import { LinearMipmapLinearFilter, MeshLambertMaterial, SRGBColorSpace, type Texture } from 'three';

export const TEXTURE_ANISOTROPY = 4;
export type TextureLoadFn = (path: string) => Texture;

/** Default loader (browser). `baseURL` is prefixed to manifest-relative paths. */
export async function createBrowserTextureLoader(baseURL = '/'): Promise<TextureLoadFn> {
  const { TextureLoader } = await import('three');
  const loader = new TextureLoader();
  return path => loader.load(`${baseURL.replace(/\/$/, '')}/${path}`);
}

/**
 * One cached `MeshLambertMaterial({ map })` per (family, team); the tint path is gone (R4).
 * Textures: SRGBColorSpace, mipmaps on, anisotropy 4, flipY=false (glTF UV convention).
 * Colour-space expectation (Task 2): renderer.outputColorSpace stays the SRGB default (SP08 owns it); lighting via light-rig.ts.
 */
export class MaterialCache {
  private textures = new Map<string, Texture>();
  private materials = new Map<string, MeshLambertMaterial>();
  constructor(private load: TextureLoadFn) {}
  texture(path: string): Texture {
    let t = this.textures.get(path);
    if (!t) {
      t = this.load(path);
      t.colorSpace = SRGBColorSpace; t.generateMipmaps = true; t.minFilter = LinearMipmapLinearFilter;
      t.anisotropy = TEXTURE_ANISOTROPY; t.flipY = false; t.needsUpdate = true;
      this.textures.set(path, t);
    }
    return t;
  }
  material(family: string, team: string, texturePath: string): MeshLambertMaterial {
    const k = `${family}\u0000${team}`;
    let m = this.materials.get(k);
    if (!m) { m = new MeshLambertMaterial({ map: this.texture(texturePath) }); this.materials.set(k, m); }
    return m;
  }
  /** Material for a visual's `team.textures[team]`; throws on a team with no texture. */
  teamMaterial(family: string, team: string, textures: Readonly<Record<string, string | undefined>>): MeshLambertMaterial {
    const p = Object.hasOwn(textures, team) ? textures[team] : undefined;
    if (!p) throw new Error(`Visual "${family}" has no texture for team "${team}"`);
    return this.material(family, team, p);
  }
  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.materials.clear(); this.textures.clear();
  }
}
