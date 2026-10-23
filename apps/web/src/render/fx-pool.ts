import {
  AdditiveBlending, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, NormalBlending, PlaneGeometry, Sprite, SpriteMaterial,
  type Texture,
} from 'three';
import type { FxKind, SimEvent } from '@node-arena/defs';
import type { ManifestV2 } from '@node-arena/content';
import type { Renderer, RendererContext, RendererFactory } from './registry.js';
import { registerRenderer } from './registry.js';

/** Sim milli-units -> scene units (same constant as building.ts / unit-renderer.ts). */
const MILLI = 1000;
/** Clash/death sparks read as dust/impact, not a team colour. */
export const CLASH_CREAM = '#fff4d6';
/** Stage-up glow (validation.md: ~#F2F08A at ~0.35 alpha, tuned in Task 12). */
export const STAGE_UP_TINT = '#f2f08a';
export const STAGE_UP_ALPHA = 0.35;
/** fx id used for stage-up (shape source CFX3_T_HollowCircle). */
export const STAGE_UP_FX = 'capture-ring';
/** Fixed tints (otherwise team colour for captures, white for the rest). */
const FIXED_TINT: Readonly<Record<string, string>> = { 'clash-spark': CLASH_CREAM, 'clash-glow': CLASH_CREAM };
/** One-level companions spawned together with an event's primary fx (PRD R1: capture = ring + star; death = smoke + spark; clash = spark + glow). */
export const COMPANIONS: Readonly<Record<string, readonly string[]>> = {
  'capture-ring': ['capture-star'], 'clash-spark': ['clash-glow'], 'death-smoke': ['clash-spark'],
};
export interface FxCapacity { sprites: number; rings: number; beams: number }
export const DEFAULT_CAPACITY: Readonly<FxCapacity> = { sprites: 160, rings: 24, beams: 24 };
const GOLDEN = 2.399963229728653;
const RING_Y = 0.06, SPRITE_Y = 0.55, BEAM_Y = 0.9, NEUTRAL = 'gray';
const ADDITIVE = /add|glow|spark|hollow|trail/i;

type FxEntry = ManifestV2['fx'][string];
export interface FxDeps {
  manifest: Pick<ManifestV2, 'fx' | 'events' | 'palettes'>;
  capacity?: Partial<FxCapacity>;
}
export interface FxBuilding { index: number; x: number; z: number }
export interface FxFrame { view?: { players?: ReadonlyArray<{ colorKey: string }>; buildings?: { stage: ArrayLike<number> } } }
export interface PoolStats { cap: number; active: number; created: number }
export interface FxRenderer extends Renderer {
  readonly root: Group;
  setBuildings(list: readonly FxBuilding[]): void;
  update(frame: FxFrame | null, events: readonly SimEvent[], dtMs: number): void;
  /** Spawn fx `id` at sim milli (x, z). `to` (milli) is the beam end. */
  spawn(id: string, x: number, z: number, tint?: Color | null, alphaScale?: number, toX?: number, toZ?: number): void;
  readonly stats: { sprites: PoolStats; rings: PoolStats; beams: PoolStats };
  readonly activeCount: number;
}

interface Slot { active: boolean; age: number; dur: number; a: number; b: number; c: number; d: number; e: number; f: number; g: number; alpha: number }
const mkSlot = (): Slot => ({ active: false, age: 0, dur: 1, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, alpha: 1 });
const num = (p: Readonly<Record<string, number>>, k: string, d: number) => (Object.hasOwn(p, k) ? p[k]! : d);

class Pool<O extends Mesh | Sprite> {
  readonly slots: Slot[] = []; cursor = 0; active = 0;
  constructor(readonly objs: O[]) { for (let i = 0; i < objs.length; i++) this.slots.push(mkSlot()); }
  /** First idle slot from the cursor; if every slot is busy the cursor slot (the oldest allocation) is recycled. Never grows. */
  acquire(): number {
    const n = this.slots.length;
    for (let k = 0; k < n; k++) {
      const i = (this.cursor + k) % n;
      if (!this.slots[i]!.active) { this.cursor = (i + 1) % n; this.slots[i]!.active = true; this.active++; return i; }
    }
    const i = this.cursor; this.cursor = (i + 1) % n; return i;
  }
  release(i: number): void { const s = this.slots[i]!; if (s.active) { s.active = false; this.active--; } this.objs[i]!.visible = false; }
  stats(): PoolStats { return { cap: this.slots.length, active: this.active, created: this.objs.length }; }
}

export function createFxFactory(deps: FxDeps): RendererFactory {
  return (ctx: RendererContext): FxRenderer => new FxRendererImpl(ctx, deps);
}
/** Registers renderer kind `fx` on the default registry. */
export function registerFxRenderer(deps: FxDeps): void { registerRenderer('fx', createFxFactory(deps)); }

class FxRendererImpl implements FxRenderer {
  [k: string]: unknown;
  readonly root = new Group();
  private sprites: Pool<Sprite>; private rings: Pool<Mesh>; private beams: Pool<Mesh>;
  private flat = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private mats: Array<SpriteMaterial | MeshBasicMaterial> = [];
  private tex = new Map<string, Texture>(); private colors = new Map<string, Color>();
  private bx: number[] = []; private bz: number[] = []; private prevStage: number[] = [];
  private white = new Color(1, 1, 1);
  private fxIds: Record<string, FxEntry>;

  constructor(private ctx: RendererContext, private deps: FxDeps) {
    this.root.name = `fx:${ctx.visualId}`;
    this.fxIds = deps.manifest.fx;
    const cap = { ...DEFAULT_CAPACITY, ...deps.capacity };
    const first = Object.values(deps.manifest.fx)[0];
    const seedTex = first ? this.texture(first.texture) : null;
    const sp: Sprite[] = [], rg: Mesh[] = [], bm: Mesh[] = [];
    for (let i = 0; i < cap.sprites; i++) {
      const m = new SpriteMaterial({ map: seedTex, transparent: true, depthWrite: false, depthTest: true }); this.mats.push(m);
      const s = new Sprite(m); s.visible = false; s.renderOrder = 5; this.root.add(s); sp.push(s);
    }
    for (let i = 0; i < cap.rings; i++) { const m = this.meshMat(seedTex); const o = new Mesh(this.flat, m); o.visible = false; o.renderOrder = 2; this.root.add(o); rg.push(o); }
    for (let i = 0; i < cap.beams; i++) { const m = this.meshMat(seedTex); const o = new Mesh(this.flat, m); o.visible = false; o.renderOrder = 4; this.root.add(o); bm.push(o); }
    this.sprites = new Pool(sp); this.rings = new Pool(rg); this.beams = new Pool(bm);
    for (const [k, hex] of Object.entries(deps.manifest.palettes)) this.colors.set(k, new Color(hex as string));
    for (const [k, hex] of Object.entries(FIXED_TINT)) this.colors.set(`#${k}`, new Color(hex));
    this.colors.set('#stage', new Color(STAGE_UP_TINT));
  }

  private meshMat(map: Texture | null): MeshBasicMaterial {
    const m = new MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: DoubleSide }); this.mats.push(m); return m;
  }
  private texture(path: string): Texture {
    let t = this.tex.get(path); if (!t) { t = this.ctx.materials.texture(path); this.tex.set(path, t); } return t;
  }

  get stats() { return { sprites: this.sprites.stats(), rings: this.rings.stats(), beams: this.beams.stats() }; }
  get activeCount(): number { return this.sprites.active + this.rings.active + this.beams.active; }

  setBuildings(list: readonly FxBuilding[]): void {
    this.bx.length = 0; this.bz.length = 0; this.prevStage.length = 0;
    for (const b of list) { this.bx[b.index] = b.x; this.bz[b.index] = b.z; this.prevStage[b.index] = -1; }
  }

  private tintFor(id: string, teamKey: string | null): Color {
    const fixed = this.colors.get(`#${id}`); if (fixed) return fixed;
    return (teamKey && this.colors.get(teamKey)) || this.white;
  }

  spawn(id: string, x: number, z: number, tint: Color | null = null, alphaScale = 1, toX = x, toZ = z): void {
    const def = this.fxIds[id]; if (!def) return;
    const p = def.params, tex = this.texture(def.texture), add = ADDITIVE.test(def.texture) || ADDITIVE.test(id) ? AdditiveBlending : NormalBlending;
    const col = tint ?? this.white, wx = x / MILLI, wz = z / MILLI;
    const kind: FxKind = def.kind;
    if (kind === 'ring') {
      const i = this.rings.acquire(), o = this.rings.objs[i]!, s = this.rings.slots[i]!, m = o.material as MeshBasicMaterial;
      m.map = tex; m.blending = add; m.color.copy(col);
      s.age = 0; s.dur = num(p, 'duration', 0.6) * 1000; s.a = num(p, 'radiusFrom', 0.4); s.b = num(p, 'radiusTo', 2); s.alpha = num(p, 'alpha', 0.8) * alphaScale;
      o.position.set(wx, RING_Y, wz); o.visible = true; this.applyRing(o, s, 0);
    } else if (kind === 'beam') {
      const i = this.beams.acquire(), o = this.beams.objs[i]!, s = this.beams.slots[i]!, m = o.material as MeshBasicMaterial;
      m.map = tex; m.blending = add; m.color.copy(col);
      const dx = toX / MILLI - wx, dz = toZ / MILLI - wz;
      s.age = 0; s.dur = num(p, 'duration', 0.15) * 1000; s.a = num(p, 'width', 0.12); s.b = Math.hypot(dx, dz); s.alpha = num(p, 'alpha', 1) * alphaScale;
      o.position.set(wx + dx / 2, BEAM_Y, wz + dz / 2); o.rotation.y = -Math.atan2(dz, dx); o.scale.set(Math.max(s.b, 1e-3), 1, s.a);
      o.visible = true; m.opacity = s.alpha;
    } else {
      const count = Math.max(1, Math.round(num(p, 'count', 1))), dur = num(p, 'duration', 0.5), size = num(p, 'size', 0.5), spread = num(p, 'spread', 0), rise = num(p, 'rise', spread * 0.3);
      for (let k = 0; k < count; k++) {
        const i = this.sprites.acquire(), o = this.sprites.objs[i]!, s = this.sprites.slots[i]!, m = o.material as SpriteMaterial;
        m.map = tex; m.blending = add; m.color.copy(col);
        // deterministic fan-out: golden-angle spiral offset by the event position (replays look identical)
        const ang = k * GOLDEN + (x * 0.00137 + z * 0.00291), r = spread * (0.55 + 0.45 * ((k * 0.618) % 1));
        s.age = 0; s.dur = dur * 1000; s.alpha = 0.9 * alphaScale; s.g = size;
        s.a = wx; s.b = SPRITE_Y; s.c = wz; s.d = (Math.cos(ang) * r) / dur; s.e = rise / dur; s.f = (Math.sin(ang) * r) / dur;
        o.position.set(wx, SPRITE_Y, wz); o.scale.set(size, size, 1); m.opacity = s.alpha; o.visible = true;
      }
    }
  }

  private applyRing(o: Mesh, s: Slot, u: number): void {
    const r = s.a + (s.b - s.a) * (1 - (1 - u) * (1 - u));
    o.scale.set(r * 2, 1, r * 2); (o.material as MeshBasicMaterial).opacity = s.alpha * (1 - u);
  }

  update(frame: FxFrame | null, events: readonly SimEvent[], dtMs: number): void {
    const dt = Math.max(0, dtMs);
    for (let i = 0; i < this.sprites.slots.length; i++) {
      const s = this.sprites.slots[i]!; if (!s.active) continue;
      s.age += dt; const u = s.age / s.dur; if (u >= 1) { this.sprites.release(i); continue; }
      const o = this.sprites.objs[i]!, t = s.age / 1000, sz = s.g * (1 + 0.5 * u);
      o.position.set(s.a + s.d * t, s.b + s.e * t, s.c + s.f * t); o.scale.set(sz, sz, 1); (o.material as SpriteMaterial).opacity = s.alpha * (1 - u);
    }
    for (let i = 0; i < this.rings.slots.length; i++) {
      const s = this.rings.slots[i]!; if (!s.active) continue;
      s.age += dt; const u = s.age / s.dur; if (u >= 1) { this.rings.release(i); continue; }
      this.applyRing(this.rings.objs[i]!, s, u);
    }
    for (let i = 0; i < this.beams.slots.length; i++) {
      const s = this.beams.slots[i]!; if (!s.active) continue;
      s.age += dt; const u = s.age / s.dur; if (u >= 1) { this.beams.release(i); continue; }
      (this.beams.objs[i]!.material as MeshBasicMaterial).opacity = s.alpha * (1 - u);
    }
    const view = frame?.view;
    for (let n = 0; n < events.length; n++) this.onEvent(events[n]!, view);
    const stage = view?.buildings?.stage;
    if (stage) {
      for (let i = 0; i < this.prevStage.length; i++) {
        const prev = this.prevStage[i]; if (prev === undefined || this.bx[i] === undefined) continue;
        const cur = stage[i]!;
        if (prev >= 0 && cur > prev) this.spawnTinted(STAGE_UP_FX, this.bx[i]!, this.bz[i]!, this.colors.get('#stage')!, STAGE_UP_ALPHA / 0.8);
        this.prevStage[i] = cur;
      }
    }
  }

  private spawnTinted(id: string, x: number, z: number, tint: Color, alphaScale = 1): void { this.spawn(id, x, z, tint, alphaScale); }

  private fire(id: string, x: number, z: number, teamKey: string | null, toX?: number, toZ?: number): void {
    this.spawn(id, x, z, this.tintFor(id, teamKey), 1, toX, toZ);
    const extra = COMPANIONS[id];
    if (extra && this.fxIds[id]!.kind !== 'beam') for (let k = 0; k < extra.length; k++) this.spawn(extra[k]!, x, z, this.tintFor(extra[k]!, teamKey));
  }

  private onEvent(ev: SimEvent, view: FxFrame['view']): void {
    const id = this.deps.manifest.events[ev.type]?.fx; if (!id || !this.fxIds[id]) return;
    switch (ev.type) {
      case 'Clash': case 'TroopDied': this.fire(id, ev.x, ev.z, null); break;
      case 'TowerShot': {
        const tx = this.bx[ev.tower], tz = this.bz[ev.tower]; if (tx === undefined || tz === undefined) break;
        this.spawn(id, tx, tz, this.white, 1, ev.x, ev.z); break;
      }
      case 'BuildingCaptured': {
        const x = this.bx[ev.building], z = this.bz[ev.building]; if (x === undefined || z === undefined) break;
        const key = ev.to >= 0 ? view?.players?.[ev.to]?.colorKey ?? null : NEUTRAL;
        this.fire(id, x, z, key); break;
      }
      default: break;
    }
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    this.flat.dispose(); this.root.removeFromParent(); this.root.clear();
  }
}
