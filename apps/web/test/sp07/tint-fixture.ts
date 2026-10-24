import { AmbientLight, Color, DataTexture, Mesh, MeshLambertMaterial, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, UnsignedByteType, WebGLRenderer, type Texture } from 'three';
import { MaterialCache } from '../../src/render/materials.js';

const N = 64, BASE: [number, number, number] = [200, 160, 120];
/** Base: flat colour. Mask: left half white, right half black (R channel). */
const tex = (fill: (x: number) => [number, number, number]): DataTexture => {
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = fill(x), i = (y * N + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
  const t = new DataTexture(d, N, N, RGBAFormat, UnsignedByteType); t.needsUpdate = true; return t;
};
const PALETTES = { blue: '#3355ff', green: '#33aa44', red: '#dd3333', yellow: '#ddcc33', gray: '#888888' };

/** Render a quad with `material` 1:1 into an NxN canvas; return RGB at the masked (left) and unmasked (right) probes. */
function probe(renderer: WebGLRenderer, material: MeshLambertMaterial): { masked: number[]; unmasked: number[] } {
  const scene = new Scene(); scene.add(new AmbientLight(0xffffff, Math.PI), new Mesh(new PlaneGeometry(2, 2), material));
  renderer.setSize(N, N, false); renderer.render(scene, new OrthographicCamera(-1, 1, 1, -1, 0.1, 10).translateZ(2));
  const gl = renderer.getContext(), px = new Uint8Array(4), at = (x: number): number[] => { gl.readPixels(x, N / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [...px.slice(0, 3)]; };
  return { masked: at(N / 4), unmasked: at((3 * N) / 4) };
}

export function run(): Record<string, unknown> {
  const canvas = document.createElement('canvas'), renderer = new WebGLRenderer({ canvas, preserveDrawingBuffer: true });
  const loads: Record<string, Texture> = {};
  const cache = new MaterialCache(p => (loads[p] = p === 'mask.png' ? tex(x => (x < N / 2 ? [255, 255, 255] : [0, 0, 0])) : tex(() => BASE)), PALETTES);
  const def = { mode: 'tintMask', base: 'base.png', mask: 'mask.png' } as const;
  const plain = probe(renderer, new MeshLambertMaterial({ map: (() => { const t = tex(() => BASE); t.colorSpace = 'srgb'; return t; })() }));
  const out: Record<string, unknown> = { plain, keys: cache.teamKeys(def), count: renderer.info.render.calls };
  const lin = (c: number): number => new Color().setRGB(c / 255, 0, 0, 'srgb').r;
  out['base'] = BASE.map(lin);
  for (const team of Object.keys(PALETTES)) {
    const m = cache.visualTeamMaterial('fam', team, def);
    out[team] = { ...probe(renderer, m), same: m === cache.visualTeamMaterial('fam', team, def), tint: new Color(PALETTES[team as keyof typeof PALETTES]).toArray() };
  }
  return out;
}
(window as unknown as { tintRun: typeof run }).tintRun = run;
