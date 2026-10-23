// Manifest fragment (PRD 07 R3/R4): `apps/web/assets/manifest.tw.json` is derived from the importer's own outputs (GLB extras, node/clip
// names, textures) and merged into the single `manifest.json` by `mergeManifest` (`pnpm assets:manifest`). The fragment owns
// `visuals`, `themes`, `fx` and the `fx` field of `events`; everything else in manifest.json (palettes, sfx, camera) is hand-owned.
// Deterministic: fixed key order, no timestamps. Numeric fx `params` tuned in Task 12 against ref/tw-yt.
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import sharp from 'sharp';
import type { Output } from './output.js';

export const FRAGMENT_PATH = 'manifest.tw.json';
export const TEAMS = ['blue', 'green', 'red', 'yellow', 'gray'] as const;
export const THEME_IDS = ['green', 'snow'] as const;

/**
 * TW scene light rig (validation.md "Colour space and lighting"): one white Directional light, intensity 0.2, rotation quat
 * (x,y,z,w) below; flat ambient 0.8962264 (mode 3), intensity 1. Recorded as data; the renderer tunes by screenshot compare.
 */
export const TW_LIGHT = { quat: [0.5016, 0.3786, -0.2589, 0.7335] as const, intensity: 0.2, ambient: 0.8962264 };

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const hex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** Unity directional light shines along its local +z; `dir` is the direction TOWARD the light, in the RAW asset frame. */
export function lightDirFromQuat([x, y, z, w]: readonly [number, number, number, number] | readonly number[]): [number, number, number] {
  const v = [0, 0, 1] as const;
  const c1 = [y! * v[2] - z! * v[1], z! * v[0] - x! * v[2], x! * v[1] - y! * v[0]] as const; // q.xyz x v
  const c2 = [y! * c1[2] - z! * c1[1], z! * c1[0] - x! * c1[2], x! * c1[1] - y! * c1[0]] as const; // q.xyz x c1
  const fwd = [v[0] + 2 * (w! * c1[0] + c2[0]), v[1] + 2 * (w! * c1[1] + c2[1]), v[2] + 2 * (w! * c1[2] + c2[2])];
  return [r4(-fwd[0]!) + 0, r4(-fwd[1]!) + 0, r4(-fwd[2]!) + 0];
}

/** Mean colour of the outermost texture rows (the plane edge, where the clear colour shows past the ground): the theme `sky`. */
export async function edgeColour(png: Uint8Array): Promise<string> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rows = 4, sum = [0, 0, 0];
  let n = 0;
  const ys = [...Array(rows).keys()].flatMap((k) => [k, info.height - 1 - k]);
  for (const y of ys) {
    for (let x = 0; x < info.width; x++) { for (let c = 0; c < 3; c++) sum[c]! += data[(y * info.width + x) * 4 + c]!; n++; }
  }
  return `#${sum.map((s) => hex(s / n)).join('')}`;
}

const tex = (family: string, teams: readonly string[]): Record<string, string> => Object.fromEntries(TEAMS.filter((t) => teams.includes(t)).map((t) => [t, `textures/tw/${family}-${t}.png`]));
const find = (doc: Document, name: string): Node => {
  const n = doc.getRoot().listNodes().find((x) => x.getName() === name);
  if (!n) throw new Error(`node ${name} missing`);
  return n;
};
interface RootExtras { teams?: string[]; stageNodes?: string[][] }
const rootExtras = (doc: Document): RootExtras => (doc.getRoot().listScenes()[0]!.listChildren()[0]!.getExtras() ?? {}) as RootExtras;

export const FX_ENTRIES = {
  'capture-ring': { texture: 'fx/CFX3_T_HollowCircle.png', kind: 'ring', params: { duration: 0.6, radiusFrom: 0.4, radiusTo: 2.2, alpha: 0.8 } },
  'capture-star': { texture: 'fx/CFX_T_Star_Add.png', kind: 'sprite-burst', params: { count: 6, duration: 0.5, size: 0.8, spread: 1.2 } },
  'clash-spark': { texture: 'fx/Spark.png', kind: 'sprite-burst', params: { count: 10, duration: 0.4, size: 0.7, spread: 1.0 } },
  'clash-glow': { texture: 'fx/glow_2.png', kind: 'sprite-burst', params: { count: 1, duration: 0.3, size: 2.0, spread: 0 } },
  'death-smoke': { texture: 'fx/smoke.png', kind: 'sprite-burst', params: { count: 4, duration: 0.7, size: 0.6, spread: 0.5, rise: 0.6 } },
  'tower-shot': { texture: 'fx/lane-trail.png', kind: 'beam', params: { duration: 0.2, width: 0.45 } },
  // Lane ribbon (WayBaseStandard: LineRenderer width 0.6, tiled `wave`, half-alpha tint). Team colour applied at runtime.
  'lane-wave': { texture: 'fx/lane-wave.png', kind: 'beam', params: { width: 0.6, alpha: 0.502, tile: 1 } },
  'lane-waveArrow': { texture: 'fx/lane-waveArrow.png', kind: 'beam', params: { width: 0.6, alpha: 0.502, tile: 1 } },
  'lane-arrow': { texture: 'fx/lane-arrow.png', kind: 'beam', params: { width: 0.6, alpha: 0.502, tile: 1 } },
  'lane-trail': { texture: 'fx/lane-trail.png', kind: 'beam', params: { width: 0.6, alpha: 0.502, tile: 1 } },
} as const;
/** Event id -> fx id. */
export const EVENT_FX = { BuildingCaptured: 'capture-ring', Clash: 'clash-spark', TroopDied: 'death-smoke', TowerShot: 'tower-shot' } as const;

export interface Fragment { visuals: Record<string, unknown>; themes: Record<string, unknown>; fx: Record<string, unknown>; events: Record<string, { fx: string }> }

/** Build the fragment from the importer's generated files (path -> bytes). */
export async function buildFragment(files: ReadonlyMap<string, Uint8Array>): Promise<Fragment> {
  const io = new NodeIO();
  const glb = async (family: string): Promise<Document> => {
    const bytes = files.get(`models/tw/${family}.glb`);
    if (!bytes) throw new Error(`models/tw/${family}.glb not generated`);
    return io.readBinary(bytes);
  };
  const visuals: Record<string, unknown> = {};
  for (const [id, family] of [['building.house-wt1', 'barracks'], ['building.house-wt2', 'factory'], ['building.tower', 'tower']] as const) {
    const doc = await glb(family), x = rootExtras(doc);
    if (!x.stageNodes?.length || !x.teams) throw new Error(`${family}: stageNodes/teams extras missing`);
    visuals[id] = {
      kind: 'building', model: { parts: `models/tw/${family}.glb`, budget: 'building' },
      stages: x.stageNodes.map((nodes) => (nodes.length === 1 ? { mesh: nodes[0]! } : { enable: nodes })),
      team: { mode: 'textureSwap', textures: tex(family, x.teams) },
      scale: 1, label: { height: r4(find(doc, 'UIPosition').getWorldTranslation()[1]) },
    };
  }
  for (const family of ['soldier', 'tank'] as const) {
    const doc = await glb(family), x = rootExtras(doc);
    const clips = doc.getRoot().listAnimations().map((a) => a.getName());
    visuals[`unit.${family}`] = {
      kind: 'unit', model: { parts: `models/tw/${family}.glb`, budget: 'unit' },
      team: { mode: 'textureSwap', textures: tex(family, x.teams ?? []) },
      anim: clips.includes('Run') && clips.includes('Death') ? { mode: 'node-tracks', clips: { run: 'Run', death: 'Death' } } : { mode: 'none' },
      scale: 1,
    };
  }
  // Element visuals need a model; the obstacle mesh is per theme (themes.<id>.obstacle overrides), green is the default.
  visuals['element.obstacle'] = { kind: 'element', model: { parts: 'models/tw/obstacle-green.glb', budget: 'obstacle' }, scale: 1 };
  const proj = rootExtras(await glb('projectile'));
  visuals['fx.projectile'] = { kind: 'fx', model: { parts: 'models/tw/projectile.glb', budget: 'unit' }, team: { mode: 'textureSwap', textures: tex('projectile', proj.teams ?? []) }, scale: 1 };

  const dir = lightDirFromQuat(TW_LIGHT.quat);
  const amb = hex(TW_LIGHT.ambient * 255);
  const themes: Record<string, unknown> = {};
  for (const t of THEME_IDS) {
    const g = files.get(`textures/tw/ground-${t}.png`);
    if (!g) throw new Error(`textures/tw/ground-${t}.png not generated`);
    themes[t] = {
      ground: { mesh: `models/tw/ground-${t}.glb`, texture: `textures/tw/ground-${t}.png` },
      obstacle: { small: `models/tw/obstacle-${t}.glb#small`, big: `models/tw/obstacle-${t}.glb#big`, texture: `textures/tw/obstacle-${t}.png` },
      light: { dir, color: '#ffffff', intensity: TW_LIGHT.intensity, ambient: { color: `#${amb}${amb}${amb}`, intensity: 1 } },
      sky: await edgeColour(g),
    };
  }
  return {
    visuals, themes, fx: { ...FX_ENTRIES },
    events: Object.fromEntries(Object.entries(EVENT_FX).sort(([a], [b]) => (a < b ? -1 : 1)).map(([e, fx]) => [e, { fx }])),
  };
}

export const stringify = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

/** Importer finalizer: the fragment as one more output file. */
export async function fragmentOutputs(files: ReadonlyMap<string, Uint8Array>): Promise<Output[]> {
  return [{ path: FRAGMENT_PATH, bytes: new TextEncoder().encode(stringify(await buildFragment(files))) }];
}

const TOP_ORDER = ['$schema', 'schemaVersion', 'palettes', 'visuals', 'themes', 'fx', 'events', 'camera'] as const;
type Json = Record<string, unknown>;

/**
 * Merge the fragment into the single manifest. Fragment-owned: `visuals`, `themes`, `fx` (replaced wholesale) and `events.<id>.fx`
 * (events keep their hand-owned `sfx`; an event with no fragment fx loses a stale `fx`; sfx-less empty events are dropped).
 * Pure, idempotent, key order canonical (top level fixed, other keys sorted).
 */
export function mergeManifest(base: Json, fragment: Fragment): Json {
  const out: Json = { ...base, visuals: fragment.visuals, themes: fragment.themes, fx: fragment.fx };
  const events: Record<string, Json> = {};
  const prev = (base['events'] ?? {}) as Record<string, Json>;
  for (const id of new Set([...Object.keys(prev), ...Object.keys(fragment.events)])) {
    const { fx: _stale, ...rest } = prev[id] ?? {};
    const fx = fragment.events[id]?.fx;
    const e: Json = { ...rest, ...(fx ? { fx } : {}) };
    if (Object.keys(e).length) events[id] = e;
  }
  out['events'] = events;
  const sortKeys = (o: Json): Json => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const result: Json = {};
  for (const k of TOP_ORDER) if (k in out) result[k] = k === 'events' ? sortKeys(events) : out[k];
  for (const k of Object.keys(out).sort()) if (!(k in result)) result[k] = out[k];
  return result;
}
