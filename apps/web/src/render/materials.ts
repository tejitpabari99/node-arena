import { Color, LinearMipmapLinearFilter, MeshLambertMaterial, NoColorSpace, SRGBColorSpace, type Texture } from 'three';
import type { ManifestV2 } from '@node-arena/content';

type TeamDef = ManifestV2['visuals'][string]['team'];

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
  /** `palettes` (manifest colour per team key) feeds tintMask materials and their team set. */
  constructor(private load: TextureLoadFn, private palettes: Readonly<Record<string, string>> = {}) {}
  texture(path: string, data = false): Texture {
    const key = data ? `mask\u0000${path}` : path;
    let t = this.textures.get(key);
    if (!t) {
      t = this.load(path);
      t.colorSpace = data ? NoColorSpace : SRGBColorSpace; t.generateMipmaps = true; t.minFilter = LinearMipmapLinearFilter;
      t.anisotropy = TEXTURE_ANISOTROPY; t.flipY = false; t.needsUpdate = true;
      this.textures.set(key, t);
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
  /** Team keys a visual renders: texture keys for textureSwap, palette teams for tintMask. */
  teamKeys(team: TeamDef): string[] {
    if (team?.mode === 'tintMask') return Object.keys(this.palettes);
    return Object.keys(team?.textures ?? {});
  }
  /** Team material for either mode (textureSwap -> `teamMaterial`; tintMask -> shared base+mask tinted by `palettes[team]`). */
  visualTeamMaterial(family: string, team: string, def: TeamDef): MeshLambertMaterial {
    if (def?.mode !== 'tintMask') return this.teamMaterial(family, team, def?.textures ?? {});
    const k = `${family}\u0000${team}`;
    let m = this.materials.get(k);
    if (!m) {
      const hex = Object.hasOwn(this.palettes, team) ? this.palettes[team] : undefined;
      if (!hex) throw new Error(`Visual "${family}" has no palette colour for team "${team}"`);
      m = tintMaskMaterial(this.texture(def.base), this.texture(def.mask, true), hex); this.materials.set(k, m);
    }
    return m;
  }
  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.materials.clear(); this.textures.clear();
  }
}

/**
 * tintMask: Lambert material whose map colour is multiplied by the team colour where the mask's R channel is white.
 * `uTeam` is linear (Color.set converts the sRGB hex under ColorManagement), matching the linear `diffuseColor` after `map_fragment`.
 * Uses `vMapUv` (three r186 map varying; shared by `map` and the mask sample).
 */
export function tintMaskMaterial(base: Texture, mask: Texture, hex: string): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ map: base }), uTeam = { value: new Color(hex) }, uMask = { value: mask };
  m.onBeforeCompile = shader => {
    shader.uniforms['uTeam'] = uTeam; shader.uniforms['uMask'] = uMask;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTeam;\nuniform sampler2D uMask;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uTeam, texture2D( uMask, vMapUv ).r );');
  };
  m.customProgramCacheKey = () => 'tintMask';
  return m;
}
