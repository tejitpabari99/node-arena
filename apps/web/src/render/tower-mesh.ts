import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, LatheGeometry, Matrix4, MeshStandardMaterial, Quaternion, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Code-built Tower War stacked tower (SP03 R7). One InstancedMesh per material across ALL towers (<= 6 meshes, independent of tower count).
 * Bottom to top: team plinth + grey trim ring + door/buttresses, 1-5 floors (white body + dark slit on a thin team band, ~4% taper), team roof cap.
 * Unit space: tower width (plinth across-flats) = 1; every instance is scaled by the tower width. */
export const MAX_FLOORS = 5;
const PLINTH_H = .2, RING_H = .11, BAND_H = .13, ROOF_H = .15;
/** Floor pitch (w units) shrinks with the floor count (refs: a lone floor reads tall, 4-5 floors read tight; the steep camera hides side faces). */
export const floorPitch = (floors: number) => .4 + .46 / floors;
const PLINTH_A = .5, RING_A = .47, FLOOR_A = .4, TAPER = .04, ROOF_OVERHANG = .01;
const BASE_Y = PLINTH_H + RING_H;
export const BODY_COLOR = '#E6E8EA', DETAIL_COLOR = '#1B2430', NEUTRAL_ROOF = '#8C8C8C', NEUTRAL_BAND = '#C0C0C0', NEUTRAL_PLINTH = '#8C8C8C', TRIM_COLOR = '#D5D9DD';
/** Linear-RGB gain that cancels the theme's warm key + sand hemisphere light on grey/white parts (measured in l01: lit grey renders
 * x(.77,.64,.47)), so grey/white read neutral and team paint is vivid like the refs. Applied to every tower colour so the rendered paint matches the manifest palette (a lit #F0313F otherwise dims to V .75 and reads as rock). */
export const LIGHT_GAIN = [1.3, 1.56, 2.15] as const;
const lit = (c: Color, hex: string) => { c.set(hex); c.r *= LIGHT_GAIN[0]; c.g *= LIGHT_GAIN[1]; c.b *= LIGHT_GAIN[2]; return c; };
export const POP_FLOOR_MS = 150, POP_CAPTURE_MS = 250;

/** floors = clamp(ceil(5 x count / cap), 1, 5); towers without a cap show one floor. */
export function floorsFor(count: number, cap: number | null | undefined): number {
  if (!cap || cap <= 0 || !Number.isFinite(count)) return 1;
  return Math.min(MAX_FLOORS, Math.max(1, Math.ceil(MAX_FLOORS * count / cap)));
}
/** World width (across flats) of a stacked tower: 2 x footprint radius x manifest scale. */
export function towerWidth(footprintRadiusWorld: number, scale: number): number { return 2 * footprintRadiusWorld * scale; }
/** Plinth-to-roof-top height in world units for `floors` floors at tower `width`. */
export function stackHeight(floors: number, width: number): number { return (BASE_Y + floors * floorPitch(floors) + ROOF_H) * width; }
const floorHalf = (k: number) => FLOOR_A * (1 - TAPER * k);

type Profile = readonly (readonly [number, number, number])[]; // [halfWidth across flats, y, shade of the segment starting here]
const OCT = 1 / Math.cos(Math.PI / 8);
/** Chamfered octagonal prism from a profile (flats face the axes). Segment shading is baked as vertex colour (multiplies instanceColor). */
function lathe(profile: Profile): BufferGeometry {
  const pts: Vector2[] = [], shade: number[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i]!, b = profile[i + 1]!;
    pts.push(new Vector2(a[0] * OCT, a[1]), new Vector2(b[0] * OCT, b[1])); shade.push(a[2], a[2]);
  }
  const g = new LatheGeometry(pts, 8, Math.PI / 8, Math.PI * 2), colors = new Float32Array(g.attributes.position!.count * 3);
  for (let s = 0; s <= 8; s++) for (let j = 0; j < pts.length; j++) { const k = (s * pts.length + j) * 3; colors.fill(shade[j]!, k, k + 3); }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3)); return finish(g);
}
function finish(g: BufferGeometry): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g; out.deleteAttribute('uv');
  if (!out.getAttribute('color')) out.setAttribute('color', new BufferAttribute(new Float32Array(out.getAttribute('position').count * 3).fill(1), 3));
  return out;
}
function box(w: number, h: number, d: number, x: number, y: number, z: number, shade = 1): BufferGeometry {
  const g = new BoxGeometry(w, h, d).translate(x, y, z); g.setAttribute('color', new BufferAttribute(new Float32Array(g.attributes.position!.count * 3).fill(shade), 3)); return finish(g);
}
/** Prism with chamfered bottom/top edges: halfWidth `a`, height `h`, chamfer `c`, top-edge shade `edge`. */
function prism(a: number, h: number, c: number, edge: number): Profile {
  return [[0, 0, 1], [a - c, 0, .82], [a, c, .95], [a, h - c, 1], [a - c, h, edge], [0, h, 1]];
}
export interface TowerGeometries { plinth: BufferGeometry; trim: BufferGeometry; band: BufferGeometry; body: BufferGeometry; roof: BufferGeometry; dark: BufferGeometry }
export function buildTowerGeometries(): TowerGeometries {
  const ring = lathe(prism(RING_A, RING_H, .015, .9)).translate(0, PLINTH_H, 0);
  const door = box(.26, .25, .05, 0, .125, PLINTH_A + .01), side = (sx: number) => box(.05, .2, .14, sx * (PLINTH_A + .025), .1, .02);
  const trim = mergeGeometries([ring, door, side(-1), side(1)])!;
  const body = lathe(prism(1, 1, .04, .86)), band = lathe(prism(1, 1, .02, .9)), roof = lathe(prism(1, 1, .09, .72)), plinth = lathe(prism(1, 1, .05, .88));
  return { plinth, trim, band, body, roof, dark: finish(new BoxGeometry(1, 1, 1)) };
}

export interface StackedTowerSpec { id: string; x: number; z: number; width: number }
export interface TowerMeshState { floors: number; /** team colour, or null for neutral (all grey) */ color: string | null; }
export interface TowerMeshes {
  group: Group;
  meshes: readonly InstancedMesh[];
  /** Apply floors/colour for tower `index`. `now` (ms) starts a pop when floors changed (150 ms) or `captured` (250 ms). Returns true when instances changed. */
  setState(index: number, state: TowerMeshState, now?: number, captured?: boolean): boolean;
  /** World-x shear per unit height for tower `index` (x += shear x y): cancels perspective lean so stacks read upright like the refs. */
  setShear(index: number, shear: number): void;
  /** Tower root matrix (translation x shear) for the empty logical root group. */
  rootMatrix(index: number, out: Matrix4): Matrix4;
  /** Advance pop animations; returns true while any tower is still animating. */
  animate(now: number): boolean;
  floors(index: number): number;
  height(index: number): number;
  dispose(): void;
}

const NAMES = ['plinth', 'trim', 'band', 'body', 'roof', 'dark'] as const;
type Part = typeof NAMES[number];
const PER_TOWER: Record<Part, number> = { plinth: 1, trim: 1, band: MAX_FLOORS, body: MAX_FLOORS, roof: 1, dark: MAX_FLOORS + 1 };
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

export function createTowerMeshes(specs: readonly StackedTowerSpec[]): TowerMeshes {
  const n = specs.length, geo = buildTowerGeometries(), group = new Group(), tmp = new Color();
  const material = (color: string, grey: boolean) => { const m = new MeshStandardMaterial({ flatShading: true, vertexColors: true, roughness: .85, metalness: 0 }); if (grey) { lit(m.color, color); m.emissive.set(color).multiplyScalar(.3); } else m.color.set(color); return m; }; // emissive = neutral fill: faces turned away from the key light stay white, not tan
  const meshes = {} as Record<Part, InstancedMesh>;
  for (const part of NAMES) {
    const mesh = new InstancedMesh(geo[part], material(part === 'dark' ? DETAIL_COLOR : part === 'trim' ? TRIM_COLOR : part === 'body' ? BODY_COLOR : '#ffffff', part === 'trim' || part === 'body'), Math.max(1, n * PER_TOWER[part]));
    mesh.count = n * PER_TOWER[part]; mesh.frustumCulled = false; mesh.name = `tower-${part}`; mesh.receiveShadow = false; // no tower self-shadowing: the roof overhang must not grey the white floors
    mesh.castShadow = part === 'body' || part === 'roof'; mesh.userData.visualRole = 'tower';
    mesh.userData.towerIds = Array.from({ length: mesh.count }, (_, i) => specs[Math.floor(i / PER_TOWER[part])]!.id);
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, HIDDEN);
    if (part === 'plinth' || part === 'band' || part === 'roof') for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, tmp.set('#ffffff'));
    mesh.instanceMatrix.needsUpdate = true; group.add(mesh); meshes[part] = mesh;
  }
  const shear = new Array<number>(n).fill(0), pose = new Array<number>(n).fill(1), skew = new Matrix4(), tilt = new Matrix4();
  const floors = new Array<number>(n).fill(0), colors = new Array<string | null | undefined>(n).fill(undefined);
  const pop = new Array<{ start: number; dur: number; amp: number } | undefined>(n).fill(undefined);
  const root = new Matrix4(), local = new Matrix4(), world = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3();
  const put = (part: Part, slot: number, i: number, tx: number, ty: number, tz: number, sx: number, sy: number, sz: number) => {
    local.compose(p.set(tx, ty, tz), q.identity(), s.set(sx, sy, sz)); world.multiplyMatrices(root, local);
    meshes[part].setMatrixAt(i * PER_TOWER[part] + slot, world);
  };
  const hide = (part: Part, slot: number, i: number) => meshes[part].setMatrixAt(i * PER_TOWER[part] + slot, HIDDEN);
  const write = (i: number, scale: number) => {
    const w = specs[i]!.width, F = floors[i]!;
    pose[i] = scale; root.makeTranslation(specs[i]!.x, 0, specs[i]!.z); skew.set(1, shear[i]!, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); tilt.makeScale(scale, scale, scale); root.multiply(skew).multiply(tilt);
    put('plinth', 0, i, 0, 0, 0, PLINTH_A * w, PLINTH_H * w, PLINTH_A * w); put('trim', 0, i, 0, 0, 0, w, w, w);
    for (let k = 0; k < MAX_FLOORS; k++) {
      if (k >= F) { hide('band', k, i); hide('body', k, i); hide('dark', k, i); continue; }
      const a = floorHalf(k) * w, pitch = floorPitch(F), bodyH = pitch - BAND_H, y0 = (BASE_Y + k * pitch) * w;
      put('band', k, i, 0, y0, 0, a + .035 * w, BAND_H * w, a + .035 * w);
      put('body', k, i, 0, y0 + BAND_H * w, 0, a, bodyH * w, a);
      put('dark', k, i, 0, y0 + (BAND_H + bodyH * .55) * w, floorHalf(k) * w + .004 * w, a * 1.12, .06 * w, .02 * w);
    }
    const ra = (floorHalf(F - 1) + ROOF_OVERHANG) * w;
    put('roof', 0, i, 0, (BASE_Y + F * floorPitch(F)) * w, 0, ra, ROOF_H * w, ra);
    put('dark', MAX_FLOORS, i, 0, .115 * w, (PLINTH_A + .04) * w, .15 * w, .19 * w, .02 * w);
    for (const part of NAMES) meshes[part].instanceMatrix.needsUpdate = true;
  };
  const paint = (i: number, color: string | null) => {
    const roof = (c: Color) => color ? lit(c, color) : lit(c, NEUTRAL_ROOF), plinth = (c: Color) => color ? lit(c, color) : lit(c, NEUTRAL_PLINTH), band = (c: Color) => color ? lit(c, color) : lit(c, NEUTRAL_BAND);
    meshes.roof.setColorAt(i, roof(tmp)); meshes.plinth.setColorAt(i, plinth(tmp));
    for (let k = 0; k < MAX_FLOORS; k++) meshes.band.setColorAt(i * MAX_FLOORS + k, band(tmp));
    for (const part of ['roof', 'plinth', 'band'] as const) meshes[part].instanceColor!.needsUpdate = true;
  };
  const ease = (t: number, amp: number) => 1 + amp * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
  return {
    group, meshes: NAMES.map(k => meshes[k]),
    setState(i, state, now, captured) {
      const first = colors[i] === undefined, floorsChanged = floors[i] !== state.floors, colorChanged = colors[i] !== state.color;
      if (!floorsChanged && !colorChanged) return false;
      floors[i] = state.floors; if (colorChanged) { colors[i] = state.color; paint(i, state.color); }
      if (!first && now !== undefined) {
        if (colorChanged && captured !== false) pop[i] = { start: now, dur: POP_CAPTURE_MS, amp: .1 };
        else if (floorsChanged) pop[i] = { start: now, dur: POP_FLOOR_MS, amp: .06 };
      }
      write(i, pop[i] && now !== undefined ? ease(0, pop[i]!.amp) : 1); return true;
    },
    setShear(i, value) { if (!Number.isFinite(value) || shear[i] === value) return; shear[i] = value; if (floors[i]) write(i, pose[i]!); },
    animate(now) {
      let active = false;
      for (let i = 0; i < n; i++) { const a = pop[i]; if (!a) continue;
        const t = (now - a.start) / a.dur;
        if (t >= 1) { pop[i] = undefined; write(i, 1); } else { active = true; write(i, ease(t, a.amp)); } }
      return active;
    },
    rootMatrix: (i, out) => out.makeTranslation(specs[i]!.x, 0, specs[i]!.z).multiply(skew.set(1, shear[i]!, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)),
    floors: i => floors[i] ?? 0,
    height: i => stackHeight(floors[i] || 1, specs[i]!.width),
    dispose() { for (const part of NAMES) { meshes[part].geometry.dispose(); (meshes[part].material as MeshStandardMaterial).dispose(); meshes[part].dispose(); } group.removeFromParent(); },
  };
}
