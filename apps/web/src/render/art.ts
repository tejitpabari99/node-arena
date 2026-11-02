// SCRATCH re-art variants (not for merge). Select with ?art=v1..v4. Rendering-only; no asset changes.
import {
  ACESFilmicToneMapping, BufferAttribute, AmbientLight, BackSide, BufferGeometry, Color, DataTexture, DirectionalLight, FogExp2, HemisphereLight,
  InstancedMesh, LinearSRGBColorSpace, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, MeshToonMaterial, NearestFilter,
  NoToneMapping, PCFShadowMap, PMREMGenerator, RedFormat, Scene, WebGLRenderer, type Texture,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LightRig } from './light-rig.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HalfFloatType, MeshLambertMaterial, Vector2, WebGLRenderTarget, type Camera } from 'three';

/** SCRATCH: ?models=future (or lineup ?set=future) switches models + ground + obstacles + lighting + bloom together. */
export const XMAS = typeof location !== 'undefined' && (() => { const q = new URLSearchParams(location.search); return q.get('models') === 'xmas' || q.get('set') === 'xmas'; })();
export const FUTURE = XMAS || (typeof location !== 'undefined' && (() => { const q = new URLSearchParams(location.search); return q.get('models') === 'future' || q.get('set') === 'future'; })());
/** Christmas palette (UI designer reference). */
export const XMAS_PALETTE = { night: '#1d2a4a', pole: '#12304a', snow: '#f4f8fd', shade: '#c3d4e8', ginger: '#bf7a3f', icing: '#fff8ee', candyRed: '#d8343c', pine: '#2e6b46', gold: '#f0be45', window: '#ffc76b' };
/** Future palette (UI designer reference). */
export const FUTURE_PALETTE = { void: '#070d17', deck: '#222a36', plate: '#4b5667', hull: '#cbd5e0', cyan: '#3fe6ff', amber: '#ffb347', violet: '#a284ff', ice: '#b9d6e6' };
const GLOW_K = 2.1;
function glowPatch(shader: { fragmentShader: string; uniforms: Record<string, { value: unknown }> }, tint: boolean, k = GLOW_K): void {
  shader.uniforms['uGlowK'] = { value: k };
  let f = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlowK;\nfloat gM;');
  f = f.replace('#include <map_fragment>', '#include <map_fragment>\n\tgM = clamp((1.0 - sampledDiffuseColor.a) * 2.0, 0.0, 1.0);' + (tint ? '' : ''));
  f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uGlowK * gM;');
  shader.fragmentShader = f;
}
/** Ground/obstacle material (atlas or tile texture whose alpha encodes glow). */
function futureMaterial(fam: Fam, map: Texture, path: string): Material {
  const ground = fam === 'ground';
  const m = new MeshStandardMaterial({ map, roughness: XMAS ? 0.88 : ground ? 0.5 : 0.45, metalness: XMAS ? 0 : ground ? 0.35 : 0.3 });
  m.userData['fam'] = fam; m.userData['future'] = true;
  if (!XMAS && ground && /ice/.test(path)) { m.color.setRGB(0.5, 0.56, 0.62); m.metalness = 0.1; }
  m.onBeforeCompile = sh => glowPatch(sh as never, false, XMAS ? (ground ? 1.1 : 1.3) : ground ? 0.75 : 1.5);
  m.customProgramCacheKey = () => 'future-' + fam;
  if (/future-atlas/.test(path)) { map.generateMipmaps = false; map.minFilter = map.magFilter = NearestFilter; }
  return m;
}
/** tintMask replacement: team colour via mask, glow via base alpha, standard (metal) shading. */
export function futureTint(base: Texture, mask: Texture, hex: string): MeshLambertMaterial {
  for (const t of [base, mask]) { t.generateMipmaps = false; t.minFilter = t.magFilter = NearestFilter; }
  const m = new MeshStandardMaterial({ map: base, roughness: XMAS ? 0.8 : 0.42, metalness: XMAS ? 0 : 0.35 });
  const uTeam = { value: new Color(hex) }, uMask = { value: mask };
  m.userData['fam'] = 'prop'; m.userData['future'] = true;
  m.onBeforeCompile = sh => {
    sh.uniforms['uTeam'] = uTeam; sh.uniforms['uMask'] = uMask;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTeam;\nuniform sampler2D uMask;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uTeam, texture2D( uMask, vMapUv ).r );');
    glowPatch(sh as never, true, XMAS ? 1.3 : 1.7);
  };
  m.customProgramCacheKey = () => 'future-tint';
  return m as unknown as MeshLambertMaterial;
}

let composer: EffectComposer | null = null, bloom: UnrealBloomPass | null = null, curW = 1440, curH = 810;
/** Renders through bloom when FUTURE; returns false when the caller should render normally. */
export function futureRender(renderer: WebGLRenderer, scene: Scene, camera: Camera): boolean {
  if (!FUTURE) return false;
  if (!composer) {
    const rt = new WebGLRenderTarget(curW, curH, { type: HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt); composer.addPass(new RenderPass(scene, camera));
    bloom = XMAS ? new UnrealBloomPass(new Vector2(curW, curH), 0.38, 0.65, 1.05) : new UnrealBloomPass(new Vector2(curW, curH), 0.32, 0.5, 0.8); composer.addPass(bloom); composer.addPass(new OutputPass());
    composer.setSize(curW, curH);
  } else (composer.passes[0] as RenderPass).camera = camera;
  composer.render(); return true;
}


export type ArtId = 'v1' | 'v2' | 'v3' | 'v4';
const raw = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('art') : null;
export const ART: ArtId | null = raw === 'v1' || raw === 'v2' || raw === 'v3' || raw === 'v4' ? raw : null;

type Fam = 'ground' | 'obstacle' | 'building' | 'unit' | 'fx';
const famOf = (f: string): Fam => f === 'ground' ? 'ground' : f === 'obstacle' ? 'obstacle' : f.startsWith('building') ? 'building' : f.startsWith('unit') ? 'unit' : 'fx';

const HEAD = `float lum = dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722));
float mx = max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b)), mn = min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b));
float sat = (mx-mn)/(mx+1e-4);
float hsh = fract(sin(dot(floor(vMapUv*220.0),vec2(12.9898,78.233)))*43758.5453);
`;

function grade(art: ArtId, fam: Fam, theme: 'grass' | 'snow'): string {
  const G = fam === 'ground';
  switch (art) {
    case 'v1': return HEAD + `
      diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, ${G ? (theme === 'snow' ? '0.8' : '0.62') : '0.55'});
      diffuseColor.rgb *= ${G && theme === 'snow' ? 'vec3(0.98,1.0,1.02) * 1.12' : 'vec3(1.06,0.97,0.84) * ' + (G ? '0.9' : '0.88')};
      diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.02, 0.4, lum));
      diffuseColor.rgb *= 0.96 + 0.08*hsh;`;
    case 'v2': return HEAD + `
      vec3 c = mix(vec3(lum), diffuseColor.rgb, ${G ? '1.0' : '1.35'});
      float lg = pow(max(dot(c, vec3(0.2126,0.7152,0.0722)),1e-4), 0.4545);
      float q = floor(lg * ${G ? '6.0' : '4.0'} + 0.5) / ${G ? '6.0' : '4.0'};
      diffuseColor.rgb = c * (pow(max(q,0.04), 2.2) / max(pow(lg,2.2),1e-4)) * ${G ? '1.0' : '1.0'};`;
    case 'v3': return HEAD + `
      diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, ${G ? '0.9' : '0.75'}) * ${G ? (theme === 'snow' ? '0.68' : '0.5') : '0.7'};
      diffuseColor.rgb *= 0.9 + 0.2*hsh;`;
    case 'v4':
      if (G) return HEAD + `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * ${theme === 'snow' ? 'vec3(0.66,0.72,0.82)' : 'vec3(0.78,0.74,0.66)'}, 0.9);`;
      if (fam === 'obstacle') return HEAD + `diffuseColor.rgb = vec3(lum) * vec3(1.15,1.05,0.9) * 0.9;`;
      if (fam === 'building') return HEAD + `
        float team = smoothstep(0.22, 0.45, sat);
        vec3 clay = vec3(0.82,0.72,0.58) * (0.35 + 0.95*lum);
        vec3 acc = mix(vec3(lum), diffuseColor.rgb, 1.05);
        diffuseColor.rgb = mix(clay, acc, team);`;
      return HEAD + `diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, 0.9);`;
  }
}

const ramp = (() => { const d = new DataTexture(new Uint8Array([120, 190, 255]), 3, 1, RedFormat); d.minFilter = d.magFilter = NearestFilter; d.needsUpdate = true; return d; })();

export function artMaterial(family: string, _team: string, path: string, map: Texture): Material | null {
  if (FUTURE) return futureMaterial(famOf(family), map, path || '');
  if (!ART) return null;
  const fam = famOf(family), theme: 'grass' | 'snow' = /snow/.test(path) ? 'snow' : 'grass';
  let m: Material;
  if (ART === 'v2') m = new MeshToonMaterial({ map, gradientMap: ramp });
  else if (ART === 'v3') m = new MeshStandardMaterial({ map, roughness: fam === 'ground' ? 0.95 : fam === 'building' ? 0.62 : 0.8, metalness: fam === 'building' ? 0.25 : 0.0 });
  else m = new (MeshStandardMaterial)({ map, roughness: 1, metalness: 0 });
  if (ART === 'v1' || ART === 'v4') { // matte: standard w/ roughness 1 (lambert-like)
    m.dispose(); m = new MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
  }
  m.userData['fam'] = fam;
  // `theme` guess happens at material creation; snow vs grass textures are named ground-snow/obstacle-snow.
  const snow = theme === 'snow';
  const frag = grade(ART, fam, snow ? 'snow' : 'grass');
  m.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n{\n${frag}\n}`); };
  m.customProgramCacheKey = () => `art-${ART}-${fam}-${snow}`;
  return m;
}

export function artLights(rig: LightRig, themeId: string): void {
  if (XMAS) {
    const d = rig.directional, snow = themeId === 'snow';
    if (rig.ambient) rig.group.remove(rig.ambient);
    rig.group.add(new HemisphereLight(snow ? '#9cc8f0' : '#a3b8ea', snow ? '#2c3a52' : '#343b5a', snow ? 0.62 : 0.6));
    d.color.set('#ffd2a0'); d.intensity = snow ? 1.55 : 1.7; d.position.set(-22, 26, 20);
    d.castShadow = true; d.shadow.mapSize.set(2048, 2048);
    const c = d.shadow.camera; c.left = -36; c.right = 36; c.top = 36; c.bottom = -36; c.near = 1; c.far = 120;
    d.shadow.bias = -0.0005; d.shadow.normalBias = 0.02; d.shadow.radius = 4;
    return;
  }
  if (FUTURE) {
    const d = rig.directional, snow = themeId === 'snow';
    if (rig.ambient) rig.group.remove(rig.ambient);
    rig.group.add(new HemisphereLight(snow ? '#8cc4f0' : '#86a8e0', snow ? '#14202c' : '#141b27', snow ? 0.6 : 0.9));
    d.color.set(snow ? '#c4e4ff' : '#cfe4ff'); d.intensity = snow ? 1.9 : 2.8; d.position.set(-16, 34, 16);
    d.castShadow = true; d.shadow.mapSize.set(2048, 2048);
    const c = d.shadow.camera; c.left = -34; c.right = 34; c.top = 34; c.bottom = -34; c.near = 1; c.far = 120;
    d.shadow.bias = -0.0005; d.shadow.normalBias = 0.02; d.shadow.radius = 3;
    return;
  }
  if (!ART) return;
  const d = rig.directional, snow = themeId === 'snow';
  const shadow = (size: number, radius: number, bias: number) => {
    d.castShadow = true; d.shadow.mapSize.set(2048, 2048);
    const c = d.shadow.camera; c.left = -size; c.right = size; c.top = size; c.bottom = -size; c.near = 1; c.far = 120;
    d.shadow.bias = bias; d.shadow.normalBias = 0.02; d.shadow.radius = radius;
  };
  const setDir = (color: string, intensity: number, pos: [number, number, number]) => {
    d.color.set(color); d.intensity = intensity; d.position.set(...pos);
  };
  if (ART === 'v1') {
    if (rig.ambient) { rig.ambient.color.set('#f3e3cf'); rig.ambient.intensity = 1.5; }
    setDir('#ffd9a8', 2.3, [-14, 36, 20]); shadow(34, 6, -0.0006);
  } else if (ART === 'v2') {
    if (rig.ambient) { rig.ambient.color.set('#dfe6f2'); rig.ambient.intensity = 1.05; }
    setDir('#fffaf0', 1.9, [-14, 36, 20]); shadow(34, 1, -0.0006);
  } else if (ART === 'v3') {
    if (rig.ambient) rig.group.remove(rig.ambient);
    rig.group.add(new HemisphereLight(snow ? '#cfe2ff' : '#bcd4ff', snow ? '#6d7482' : '#3b3a24', 0.9));
    setDir('#fff0d6', 6.5, [-18, 30, 18]); shadow(34, 3, -0.0005);
  } else {
    if (rig.ambient) { rig.ambient.color.set('#f4efe8'); rig.ambient.intensity = 2.0; }
    setDir('#fff3e0', 2.6, [-14, 36, 20]); shadow(34, 4, -0.0006);
  }
}

const SKY: Record<ArtId, { grass: string; snow: string }> = {
  v1: { grass: '#c9a574', snow: '#cfd3d8' }, v2: { grass: '#9ad06a', snow: '#b8d8f4' },
  v3: { grass: '#2d3b2c', snow: '#3a4656' }, v4: { grass: '#b9b3a8', snow: '#c4cbd4' },
};

export function configureArt(renderer: WebGLRenderer, scene: Scene, themeId: string, parent: HTMLElement): void {
  if (XMAS) {
    const snow = themeId === 'snow', bg = snow ? XMAS_PALETTE.pole : XMAS_PALETTE.night;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap;
    renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    scene.background = new Color(bg); scene.fog = new FogExp2(bg, 0.0045);
    const pm = new PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35; pm.dispose();
    return;
  }
  if (FUTURE) {
    const snow = themeId === 'snow';
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap;
    renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
    scene.background = new Color(snow ? '#0a1620' : '#070d17');
    scene.fog = new FogExp2(snow ? '#0a1620' : '#070d17', 0.004);
    const pm = new PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.4; pm.dispose();
    return;
  }
  if (!ART) return;
  const snow = themeId === 'snow';
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  scene.background = new Color(SKY[ART][snow ? 'snow' : 'grass']);
  if (ART === 'v3') {
    renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    scene.fog = new FogExp2(snow ? '#3a4656' : '#2d3b2c', 0.006);
    const pm = new PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = snow ? 0.22 : 0.18; pm.dispose();
  } else renderer.toneMapping = NoToneMapping;
  if (ART === 'v1' || ART === 'v3') {
    const v = document.createElement('div');
    v.style.cssText = `position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,transparent 45%,rgba(${ART === 'v1' ? '60,35,10,0.42' : '0,0,0,0.5'}) 100%)`;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(v);
  }
}

// ---- per-frame: shadows flags + inverted-hull outlines (v2) ----
const uRes = { value: [1440, 810] as [number, number] }, uOut = { value: 2.2 };
const outlineMat = (() => {
  const m = new MeshBasicMaterial({ color: '#1a1422', side: BackSide });
  m.onBeforeCompile = s => {
    s.uniforms['uRes'] = uRes; s.uniforms['uOut'] = uOut;
    s.vertexShader = s.vertexShader.replace('void main() {', 'uniform vec2 uRes;\nuniform float uOut;\nvoid main() {')
      .replace('#include <project_vertex>', `#include <project_vertex>
      vec3 nO = normal;
      #ifdef USE_INSTANCING
        nO = mat3(instanceMatrix) * nO;
      #endif
      vec3 nV = mat3(modelViewMatrix) * nO;
      vec2 od = normalize(nV.xy + vec2(1e-5));
      gl_Position.xy += od * uOut * 2.0 / uRes * gl_Position.w;`);
  };
  m.customProgramCacheKey = () => 'outline';
  return m;
})();
const smoothCache = new WeakMap<BufferGeometry, BufferGeometry>();
function smoothed(g: BufferGeometry): BufferGeometry {
  let s = smoothCache.get(g);
  if (!s) {
    const pos = g.attributes['position']!, n = pos.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = pos.getX(i); arr[i * 3 + 1] = pos.getY(i); arr[i * 3 + 2] = pos.getZ(i); }
    const c = new BufferGeometry(); c.setAttribute('position', new BufferAttribute(arr, 3));
    if (g.index) { const ix = g.index, ia = new Uint32Array(ix.count); for (let i = 0; i < ix.count; i++) ia[i] = ix.getX(i); c.setIndex(new BufferAttribute(ia, 1)); }
    s = mergeVertices(c, 1e-4); s.computeVertexNormals(); smoothCache.set(g, s);
  }
  return s;
}
const pairs: { src: InstancedMesh; out: InstancedMesh }[] = [];

export function artFrame(scene: Scene, _renderer: WebGLRenderer): void {
  if (!ART && !FUTURE) return;
  const todo: Mesh[] = [];
  scene.traverse(o => { const m = o as Mesh; if (m.isMesh && !m.userData['artDone'] && !m.userData['isOutline']) todo.push(m); });
  for (const m of todo) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const fam = mat?.userData?.['fam'] as Fam | undefined; if (!fam) continue;
    m.userData['artDone'] = true;
    if (fam === 'ground') { m.receiveShadow = true; continue; }
    if (fam === 'fx') continue;
    m.castShadow = true; m.receiveShadow = true;
    if (FUTURE) continue;
    if (ART === 'v2') {
      const g = smoothed(m.geometry);
      let o: Mesh;
      if ((m as InstancedMesh).isInstancedMesh) {
        const s = m as InstancedMesh; const io = new InstancedMesh(g, outlineMat, s.instanceMatrix.count);
        io.instanceMatrix = s.instanceMatrix; io.frustumCulled = false; io.count = s.count; pairs.push({ src: s, out: io }); o = io;
      } else o = new Mesh(g, outlineMat);
      o.userData['isOutline'] = true; o.userData['artDone'] = true; o.frustumCulled = false; m.add(o);
    }
  }
  for (const p of pairs) { p.out.count = p.src.count; p.out.visible = p.src.visible; }
}

export function setRes(w: number, h: number): void { uRes.value = [w, h]; curW = w; curH = h; composer?.setSize(w, h); }
