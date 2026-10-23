import { DynamicDrawUsage, Group, InstancedMesh, type BufferGeometry, type Material } from 'three';
import type { SimEvent, SimView, TroopBuffer } from '@node-arena/sim';
import { parseModelRef } from '../manifest/model-ref.js';
import { registerRenderer, type Renderer, type RendererContext } from './registry.js';
import { bakeClip, bakeRest, collectParts, loopFrame, mul4, oneShotFrame, phaseOf, proceduralDeath, type BakedClip } from './unit-anim.js';

/** Death ghost pool cap (R4). */
export const GHOST_CAP = 64;
/** Sim world coordinates are milli-units; scene units are metres. */
export const MILLI_TO_WORLD = 0.001;
/** Global LOD (manifest `model.lod`): swap every part to the simplified geometry above LOD_ON alive troops of this visual, back at <= LOD_OFF. Geometry swap only: draw calls are unchanged. */
export const LOD_ON = 200;
export const LOD_OFF = 150;

/** Per-frame input (built by SP08 from `sim.readTroops`): never a snapshot. */
export interface UnitFrame {
  view: Pick<SimView, 'buildingStatic' | 'units' | 'players'>;
  troops: TroopBuffer;
  n: number;
  alpha: number;
}
export interface UnitRendererOptions {
  /** Scene units per sim milli-unit (default {@link MILLI_TO_WORLD}). */
  worldScale?: number;
  /** Force the procedural topple/sink death even if the model has a Death clip. */
  proceduralDeath?: boolean;
}
export interface UnitRenderer extends Renderer {
  root: Group;
  /** Capacity per (part, team) mesh = houses x aliveCap (+ ghost pool). Grow-only. */
  setCapacity(houses: number, aliveCap: number): void;
  update(frame: UnitFrame, events: readonly SimEvent[], dtMs: number): void;
  /** Draw calls the last update issued (meshes with count > 0). */
  readonly drawCalls: number;
  /** Max possible draw calls = parts x teams. */
  readonly maxDrawCalls: number;
  readonly stats: { meshesCreated: number; capacity: number; ghosts: number; /** 1 while the simplified geometry is active. */ lod: 0 | 1 };
}

export interface Pose { x: number; z: number; yaw: number }
/** World pose of troop row `i`: `min(progress + speed*alpha, laneLength)` along its lane (R4). Writes `out` (no allocation). */
export function troopPose(view: Pick<UnitFrame['view'], 'buildingStatic'>, buf: TroopBuffer, i: number, alpha: number, worldScale: number, out: Pose): Pose {
  const bs = view.buildingStatic, n = bs.length, key = buf.channel[i]!;
  const from = Math.floor(key / n), a = bs[from]!, b = bs[key - from * n]!;
  const len = buf.laneLength[i]!, t = Math.min(buf.progress[i]! + buf.speed[i]! * alpha, len);
  const f = len > 0 ? t / len : 1, dx = b.x - a.x, dz = b.z - a.z;
  out.x = (a.x + dx * f) * worldScale; out.z = (a.z + dz * f) * worldScale;
  out.yaw = dx === 0 && dz === 0 ? 0 : Math.atan2(dx, dz);
  return out;
}

const W = new Float32Array(16);
/** W = T(x,z) * Ry(yaw) * S(scale). */
function worldMatrix(x: number, z: number, yaw: number, s: number): Float32Array {
  const c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
  W[0] = c; W[1] = 0; W[2] = -sn; W[3] = 0; W[4] = 0; W[5] = s; W[6] = 0; W[7] = 0;
  W[8] = sn; W[9] = 0; W[10] = c; W[11] = 0; W[12] = x; W[13] = 0; W[14] = z; W[15] = 1;
  return W;
}

export async function createUnitRenderer(ctx: RendererContext, opts: UnitRendererOptions = {}): Promise<UnitRenderer> {
  const worldScale = opts.worldScale ?? MILLI_TO_WORLD, visual = ctx.visual;
  const { scene, animations = [] } = await ctx.models.file(parseModelRef(visual.model.parts).file);
  const { meshes, rest } = collectParts(scene), P = meshes.length;
  const animCfg = (visual as { anim?: { mode: string; clips?: { run?: string; death?: string } } }).anim;
  const clipOf = (name?: string) => name === undefined ? undefined : animations.find(a => a.name === name);
  const runClip = animCfg?.mode === 'node-tracks' ? clipOf(animCfg.clips?.run) : undefined;
  const deathClip = animCfg?.mode === 'node-tracks' && !opts.proceduralDeath ? clipOf(animCfg.clips?.death) : undefined;
  const run: BakedClip = runClip ? bakeClip(scene, runClip, true) : bakeRest(rest, P, 'rest');
  const death: BakedClip = deathClip ? bakeClip(scene, deathClip, false) : proceduralDeath(rest, P);

  if (!visual.team) throw new Error(`Unit visual "${ctx.visualId}" has no team textures`);
  const textures = visual.team.textures, teamKeys = Object.keys(textures), T = teamKeys.length, scale = visual.scale ?? 1;
  const mats: Material[] = teamKeys.map(t => ctx.materials.teamMaterial(ctx.visualId, t, textures));
  const geoms: BufferGeometry[] = meshes.map(m => m.geometry);
  let lodGeoms: BufferGeometry[] | null = null;
  if (visual.model.lod) {
    const lod = collectParts((await ctx.models.file(parseModelRef(visual.model.lod).file)).scene).meshes;
    if (lod.length !== P || lod.some((m, p) => m.name !== meshes[p]!.name)) throw new Error(`LOD ${visual.model.lod} part nodes differ from ${visual.model.parts}`);
    lodGeoms = lod.map(m => m.geometry);
  }
  let useLod = false;
  const root = new Group(); root.name = `units:${ctx.visualId}`;
  const stats: UnitRenderer['stats'] = { meshesCreated: 0, capacity: 0, ghosts: 0, lod: 0 };
  let grid: InstancedMesh[][] = []; // [part][team]

  function allocate(cap: number): void {
    for (const row of grid) for (const m of row) { root.remove(m); m.dispose(); }
    grid = geoms.map((g, p) => mats.map((mat, t) => {
      const m = new InstancedMesh(useLod ? lodGeoms![p]! : g, mat, cap); stats.meshesCreated++;
      m.instanceMatrix.setUsage(DynamicDrawUsage); m.frustumCulled = false; m.count = 0; m.visible = false; m.name = `${meshes[p]!.name}:${teamKeys[t]}`;
      root.add(m); return m;
    }));
    stats.capacity = cap;
  }
  function ensure(cap: number): void { if (cap > stats.capacity) allocate(cap); }
  allocate(GHOST_CAP);

  // Ghost pool (struct of arrays, preallocated).
  const gx = new Float32Array(GHOST_CAP), gz = new Float32Array(GHOST_CAP), gyaw = new Float32Array(GHOST_CAP), gage = new Float32Array(GHOST_CAP);
  const gteam = new Int8Array(GHOST_CAP), gon = new Uint8Array(GHOST_CAP);
  function spawnGhost(x: number, z: number, yaw: number, team: number): void {
    let k = -1, oldest = 0;
    for (let i = 0; i < GHOST_CAP; i++) {
      if (!gon[i]) { k = i; break; }
      if (gage[i]! >= gage[oldest]!) oldest = i;
    }
    if (k < 0) k = oldest; // pool full: recycle the oldest
    gx[k] = x; gz[k] = z; gyaw[k] = yaw; gage[k] = 0; gteam[k] = team; gon[k] = 1;
  }

  // Per-view lookup caches (rebuilt only when the view's arrays change).
  let cUnits: unknown = null, cPlayers: unknown = null;
  let mine = new Uint8Array(0), unitIds: string[] = [], ownerTeam = new Int8Array(0);
  function refreshLookups(view: UnitFrame['view']): void {
    if (cUnits !== view.units) { cUnits = view.units; mine = Uint8Array.from(view.units, u => (u.visual === ctx.visualId ? 1 : 0)); unitIds = view.units.map(u => u.id); }
    if (cPlayers !== view.players) { cPlayers = view.players; ownerTeam = Int8Array.from(view.players, p => teamKeys.indexOf(p.colorKey)); }
  }

  let time = 0, drawCalls = 0;
  const counts = new Int32Array(T), pose: Pose = { x: 0, z: 0, yaw: 0 };

  function put(team: number, clip: BakedClip, frame: number, x: number, z: number, yaw: number): void {
    const w = worldMatrix(x, z, yaw, scale), slot = counts[team]!++, base = frame * P * 16;
    for (let p = 0; p < P; p++) mul4(w, 0, clip.data, base + p * 16, grid[p]![team]!.instanceMatrix.array as Float32Array, slot * 16);
  }

  const r: UnitRenderer = {
    root, stats,
    get drawCalls() { return drawCalls; },
    get maxDrawCalls() { return P * T; },
    setCapacity(houses, aliveCap) { ensure(houses * aliveCap + GHOST_CAP); },
    update(frame, events, dtMs) {
      const { view, troops, n, alpha } = frame, dt = dtMs / 1000;
      refreshLookups(view); time += dt;
      for (const ev of events) {
        if (ev.type !== 'TroopDied') continue;
        const ui = unitIds.indexOf(ev.kind);
        if (ui < 0 || !mine[ui]) continue;
        const team = ownerTeam[ev.owner] ?? -1;
        if (team < 0) continue;
        spawnGhost(ev.x * worldScale, ev.z * worldScale, (phaseOf(ev.channel, ev.seq) - 0.5) * Math.PI * 2, team);
      }
      counts.fill(0);
      for (let i = 0; i < n; i++) {
        if (!mine[troops.kind[i]!]) continue;
        const team = ownerTeam[troops.owner[i]!] ?? -1;
        if (team < 0) continue;
        ensure(counts[team]! + 1 + GHOST_CAP);
        troopPose(view, troops, i, alpha, worldScale, pose);
        put(team, run, loopFrame(run, time, phaseOf(troops.channel[i]!, troops.seq[i]!)), pose.x, pose.z, pose.yaw);
      }
      if (lodGeoms) {
        const alive = counts.reduce((s, c) => s + c, 0), want = useLod ? alive > LOD_OFF : alive > LOD_ON;
        if (want !== useLod) { useLod = want; stats.lod = want ? 1 : 0; for (let p = 0; p < P; p++) for (let t = 0; t < T; t++) grid[p]![t]!.geometry = useLod ? lodGeoms[p]! : geoms[p]!; }
      }
      let live = 0;
      for (let k = 0; k < GHOST_CAP; k++) {
        if (!gon[k]) continue;
        gage[k] = gage[k]! + dt;
        if (gage[k]! >= death.duration) { gon[k] = 0; continue; }
        put(gteam[k]!, death, oneShotFrame(death, gage[k]!), gx[k]!, gz[k]!, gyaw[k]!); live++;
      }
      stats.ghosts = live;
      drawCalls = 0;
      for (let p = 0; p < P; p++) for (let t = 0; t < T; t++) {
        const m = grid[p]![t]!, c = counts[t]!;
        m.count = c; m.visible = c > 0;
        if (c > 0) { drawCalls++; m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, c * 16); m.instanceMatrix.needsUpdate = true; }
      }
    },
    dispose() { for (const row of grid) for (const m of row) { root.remove(m); m.dispose(); } grid = []; gon.fill(0); },
  };
  return r;
}

registerRenderer('unit', ctx => createUnitRenderer(ctx));
