import { BufferAttribute, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RepeatWrapping, type Texture } from 'three';
import type { SimView } from '@node-arena/sim';
import { type Renderer, type RendererContext } from './registry.js';
import { MILLI_TO_WORLD } from './scale.js';

/** `WayBaseStandard` (validation Task 2): LineRenderer width 0.6, Tile texture mode, half-alpha (0.502) team tint, flat. */
export const LANE_WIDTH = 0.6;
export const LANE_ALPHA = 0.502;
/** Height above the ground plane (y = 0); lanes draw under buildings/units. */
export const LANE_Y = 0.05;
/** Texture scroll speed in tiles per second along the lane (from -> to). */
export const LANE_SCROLL = 0.5;
export const LANE_TEXTURE = 'fx/lane-wave.png';
const FALLBACK_COLOR = '#6E6E6E';
/** Darker, higher-contrast line tints (lines only; building/unit team textures unchanged). Was blue #2E8BFF, green #35B84A, red #F0313F, yellow #FDC534, gray #8C8C8C. */
export const LANE_COLORS: Readonly<Record<string, string>> = {
  blue: '#1458C8', green: '#1C7A2C', red: '#C81E2C', yellow: '#D9A010', gray: '#6E6E6E',
};
const laneColor = (palettes: Readonly<Record<string, string>>, key: string): string =>
  Object.hasOwn(LANE_COLORS, key) ? LANE_COLORS[key]! : palettes[key]!;

/**
 * End point of a drawn line. A line with an opposing reverse line (head-on clash, R-LIN-03/R-CMB-01) stops at the
 * midpoint so the two owners' colours meet there; otherwise it runs to `b`. Writes into `out`.
 */
export function clashEnd(a: LanePoint, b: LanePoint, opposed: boolean, out: LanePoint): LanePoint {
  out.x = opposed ? (a.x + b.x) / 2 : b.x; out.z = opposed ? (a.z + b.z) / 2 : b.z; return out;
}
export const hasOpposite = (lines: readonly { from: number; to: number }[], i: number): boolean => {
  const l = lines[i]!;
  for (let j = 0; j < lines.length; j++) if (j !== i && lines[j]!.from === l.to && lines[j]!.to === l.from) return true;
  return false;
};

export interface LaneStyle {
  /** Asset path of a manifest `beam` fx texture (`fx/lane-{wave,arrow,waveArrow,trail}.png`). */
  texture: string;
  width: number; alpha: number;
  /** Texture repeats per `width` of lane length (manifest beam `tile`); 1 = square tiles. */
  tile: number;
  scroll: number;
  /** colorKey -> `#rrggbb` (manifest `palettes`). */
  palettes: Readonly<Record<string, string>>;
}
export interface LanePoint { x: number; z: number }
export interface LaneFrame {
  view: Pick<SimView, 'lines' | 'buildingStatic' | 'players'>;
}

export interface LaneRenderer extends Renderer {
  root: Group;
  setStyle(style: Partial<LaneStyle>): void;
  /** Sync ribbons to `view.lines` and advance the UV scroll. Allocation-free once the pool has grown. */
  update(view: LaneFrame['view'], dtMs: number): void;
  /** Drag preview from `from` to `to` (scene units, data frame x/z), tinted with the colorKey `team` (gray when omitted). */
  previewLane(from: LanePoint, to: LanePoint, team?: string): void;
  clearPreview(): void;
  /** Ribbon meshes ever created / currently visible (pool stats). */
  readonly stats: { created: number; active: number; previewVisible: boolean };
  /** Current texture scroll offset (u units, in [0,1)). */
  readonly scrollOffset: number;
}

/** UV length of a ribbon: tiles = length / (width / tile). */
export const laneTiles = (length: number, width: number, tile: number): number => (length * tile) / width;

class Ribbon {
  mesh: Mesh; private geo = new PlaneGeometry(1, 1); private lastTiles = NaN;
  constructor(material: MeshBasicMaterial) {
    this.geo.rotateX(-Math.PI / 2); // flat on XZ, facing +y; local x = lane direction, local z = width
    this.mesh = new Mesh(this.geo, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.visible = false;
  }
  set(a: LanePoint, b: LanePoint, width: number, tiles: (len: number) => number, material: MeshBasicMaterial): void {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), m = this.mesh;
    m.position.set((a.x + b.x) / 2, LANE_Y, (a.z + b.z) / 2);
    m.rotation.y = Math.atan2(-dz, dx); // local +x -> (dx, dz)
    m.scale.set(len, 1, width); m.material = material; m.visible = len > 0;
    const t = tiles(len);
    if (t !== this.lastTiles) {
      const uv = this.geo.getAttribute('uv') as BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) < 0.5 ? 0 : t); // u: 0 at `from`, `tiles` at `to`
      uv.needsUpdate = true; this.lastTiles = t;
    }
  }
  dispose(): void { this.geo.dispose(); }
}

export function createLaneRenderer(ctx: RendererContext, initial: Partial<LaneStyle> = {}): LaneRenderer {
  const root = new Group(); root.name = 'lanes';
  const style: LaneStyle = { texture: LANE_TEXTURE, width: LANE_WIDTH, alpha: LANE_ALPHA, tile: 1, scroll: LANE_SCROLL, palettes: {}, ...initial };
  const mats = new Map<string, MeshBasicMaterial>();
  let tex: Texture | null = null;
  const texture = (): Texture => {
    if (!tex || (tex as Texture & { __path?: string }).__path !== style.texture) {
      tex = ctx.materials.texture(style.texture); tex.wrapS = tex.wrapT = RepeatWrapping; if (tex.image) tex.needsUpdate = true;
      (tex as Texture & { __path?: string }).__path = style.texture;
    }
    return tex;
  };
  const dropMats = () => { for (const m of mats.values()) m.dispose(); mats.clear(); };
  function material(colorKey: string): MeshBasicMaterial {
    const key = Object.hasOwn(style.palettes, colorKey) ? colorKey : '';
    let m = mats.get(key);
    if (!m) {
      m = new MeshBasicMaterial({ map: texture(), color: key ? laneColor(style.palettes, key) : FALLBACK_COLOR, transparent: true, opacity: style.alpha, depthWrite: false, side: DoubleSide });
      mats.set(key, m);
    }
    return m;
  }
  const pool: Ribbon[] = []; const preview = new Ribbon(material('')); root.add(preview.mesh);
  const stats = { created: 0, active: 0, previewVisible: false };
  let time = 0, offset = 0;
  const A: LanePoint = { x: 0, z: 0 }, B: LanePoint = { x: 0, z: 0 };
  const tiles = (len: number) => laneTiles(len, style.width, style.tile);

  const r: LaneRenderer = {
    root, stats,
    get scrollOffset() { return offset; },
    setStyle(s) { Object.assign(style, s); dropMats(); texture(); },
    update(view, dtMs) {
      time += dtMs / 1000;
      // Flow from -> to: offset decreases so the pattern moves toward increasing u.
      offset = (((-time * style.scroll) % 1) + 1) % 1;
      texture().offset.x = offset;
      const lines = view.lines, bs = view.buildingStatic;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!, a = bs[l.from]!, b = bs[l.to]!;
        let rib = pool[i];
        if (!rib) { rib = new Ribbon(material('')); pool.push(rib); root.add(rib.mesh); stats.created++; }
        A.x = a.x * MILLI_TO_WORLD; A.z = a.z * MILLI_TO_WORLD; B.x = b.x * MILLI_TO_WORLD; B.z = b.z * MILLI_TO_WORLD;
        clashEnd(A, B, hasOpposite(lines, i), B);
        rib.set(A, B, style.width, tiles, material(view.players[l.owner]?.colorKey ?? ''));
      }
      for (let i = lines.length; i < pool.length; i++) pool[i]!.mesh.visible = false;
      stats.active = lines.length;
    },
    previewLane(from, to, team = '') {
      preview.set(from, to, style.width, tiles, material(team)); stats.previewVisible = preview.mesh.visible;
      texture().offset.x = offset;
    },
    clearPreview() { preview.mesh.visible = false; stats.previewVisible = false; },
    dispose() {
      for (const rib of pool) { root.remove(rib.mesh); rib.dispose(); }
      pool.length = 0; root.remove(preview.mesh); preview.dispose(); dropMats(); stats.active = 0;
    },
  };
  texture();
  return r;
}
