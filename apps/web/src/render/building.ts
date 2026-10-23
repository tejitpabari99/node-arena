import {
  DoubleSide, Group, Mesh, MeshBasicMaterial, CircleGeometry, RingGeometry, Sprite, SpriteMaterial, Vector3,
  type Material, type Object3D,
} from 'three';
import type { SimEvent } from '@node-arena/defs';
import type { SimView } from '@node-arena/sim';
import type { RendererContext, RendererFactory, VisualDef, Renderer } from './registry.js';
import { registerRenderer } from './registry.js';
import type { LabelPainter } from './building-label.js';

/** Sim coordinates are milli-units; scene units = milli / 1000. */
export const MILLI = 1000;
/** Tower projectile flight time (presentation only). */
export const PROJECTILE_MS = 220;
export const NEUTRAL_TEAM = 'gray';
const LABEL_SIZE = 1.2;

/** One building to draw. `x`,`z`,`radius` are sim milli-units (level frame, already rotated by the importer). */
export interface BuildingInit { index: number; id: string; x: number; z: number; radius: number }
export interface BuildingAnchor { pos: Vector3; radius: number; labelPos: Vector3 }
export interface BuildingFrame { view: Pick<SimView, 'buildings' | 'players'> }
export interface RangeSource { towerRadiusMilli(view: never, building: number): number }

export interface BuildingDeps {
  painter: LabelPainter;
  /** `fx.projectile` visual (tower shots); omit to skip projectiles. */
  projectile?: { visualId: string; visual: VisualDef };
  /** Resolves when the label font is ready (see building-label.loadLabelFont). */
  fontReady?: () => Promise<unknown>;
}

export interface BuildingRenderer extends Renderer {
  /** Parent inside the (mirrored) worldRoot: building meshes, rings, projectiles. */
  readonly root: Group;
  /** Parent OUTSIDE the mirrored worldRoot: level-number sprites. */
  readonly labelRoot: Group;
  /** Set the (mirrored) worldRoot so label sprites follow it: label world pos = worldRoot.matrixWorld * labelPos. */
  bindWorldRoot(worldRoot: Object3D): void;
  setBuildings(list: readonly BuildingInit[]): void;
  update(frame: BuildingFrame, events: readonly SimEvent[], dtMs: number, sim?: { towerRadiusMilli(view: any, building: number): number }): void;
  readonly anchors: { building(id: string): BuildingAnchor | undefined };
  /** Visible meshes of every building (raycast targets); `mesh.userData.buildingIndex` is the building index. */
  readonly pickMeshes: Mesh[];
  select(index: number | null): void;
  setShowTowerRanges(on: boolean): void;
}

interface Instance {
  init: BuildingInit; group: Group; model: Object3D; meshes: Mesh[]; stageNodes: Map<string, Object3D>;
  team: string | null; stage: number; level: number; label: Sprite; labelOffset: Vector3; bullet: Vector3 | null;
  ring: Mesh | null; ringRadius: number; picks: Mesh[];
}
interface Shot { group: Object3D; from: Vector3; to: Vector3; t: number }

const stageNames = (v: VisualDef): string[][] => (v.stages ?? []).map(s => ('enable' in s && s.enable ? [...s.enable] : 'mesh' in s && s.mesh ? [s.mesh] : []));

export function createBuildingFactory(deps: BuildingDeps): RendererFactory {
  return async (ctx: RendererContext): Promise<BuildingRenderer> => {
    await deps.fontReady?.();
    const sceneRoot = await ctx.models.resolve(ctx.visual.model.parts);
    const template = sceneRoot.children.length === 1 ? sceneRoot.children[0]! : sceneRoot;
    const projScene = deps.projectile ? await ctx.models.resolve(deps.projectile.visual.model.parts) : null;
    const projTpl = projScene && projScene.children.length === 1 ? projScene.children[0]! : projScene;
    return new BuildingRendererImpl(ctx, deps, template, projTpl);
  };
}

/** Registers renderer kind `building` on the default registry. */
export function registerBuildingRenderer(deps: BuildingDeps): void { registerRenderer('building', createBuildingFactory(deps)); }

class BuildingRendererImpl implements BuildingRenderer {
  [k: string]: unknown;
  readonly root = new Group(); readonly labelRoot = new Group();
  private worldRoot: Object3D | null = null;
  private inst = new Map<number, Instance>(); private byId = new Map<string, Instance>();
  private stageSets: Set<string>[]; private allStageNodes: string[];
  private shots: Shot[] = []; private selected: number | null = null; private showRanges = true;
  private ringGeo = new RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2);
  /** Translucent fill under the edge ring (TW refs: filled disc + brighter edge). Team-neutral. */
  private discGeo = new CircleGeometry(1, 64).rotateX(-Math.PI / 2);
  private discMats = { range: new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide }), sel: new MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.2, depthWrite: false, side: DoubleSide }) };
  private ringMats = { range: new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }), sel: new MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide }) };
  private spriteMats: SpriteMaterial[] = []; private lastPick: Mesh[] | null = null;

  constructor(private ctx: RendererContext, private deps: BuildingDeps, private template: Object3D, private projTpl: Object3D | null) {
    this.root.name = `buildings:${ctx.visualId}`; this.labelRoot.name = `labels:${ctx.visualId}`;
    const names = stageNames(ctx.visual);
    if (!names.length) throw new Error(`Visual "${ctx.visualId}" has no stages`);
    this.stageSets = names.map(n => new Set(n));
    this.allStageNodes = [...new Set(names.flat())];
    for (const n of this.allStageNodes) if (!template.getObjectByName(n)) throw new Error(`Stage node "${n}" not found in ${ctx.visual.model.parts}`);
  }

  get anchors() { return { building: (id: string): BuildingAnchor | undefined => {
    const i = this.byId.get(id); if (!i) return undefined;
    const pos = i.group.position.clone();
    return { pos, radius: i.init.radius / MILLI, labelPos: pos.clone().add(i.labelOffset) };
  } }; }
  get pickMeshes(): Mesh[] {
    const out: Mesh[] = []; for (const i of this.inst.values()) out.push(...i.picks); return out;
  }

  setBuildings(list: readonly BuildingInit[]): void {
    this.clearInstances();
    const scale = this.ctx.visual.scale ?? 1;
    const uiNode = this.template.getObjectByName('UIPosition');
    for (const init of list) {
      const group = new Group(); group.name = init.id; group.position.set(init.x / MILLI, 0, init.z / MILLI);
      const model = this.template.clone(true); model.scale.multiplyScalar(scale); model.position.y += this.ctx.visual.yOffset ?? 0;
      for (const n of ['TowerRadius', 'radiusIcon']) { const o = model.getObjectByName(n); if (o) o.visible = false; }
      group.add(model); this.root.add(group);
      const meshes: Mesh[] = []; model.traverse(o => { if ((o as Mesh).isMesh) { meshes.push(o as Mesh); o.userData['buildingIndex'] = init.index; } });
      const stageNodes = new Map<string, Object3D>();
      for (const n of this.allStageNodes) stageNodes.set(n, model.getObjectByName(n)!);
      const labelOffset = new Vector3(0, (this.ctx.visual.label?.height ?? 2), 0);
      if (uiNode) { const u = uiNode.position; labelOffset.x = u.x * scale; labelOffset.z = u.z * scale; }
      group.updateMatrixWorld(true);
      const bulletNode = model.getObjectByName('BulletPosition');
      const bullet = bulletNode ? group.worldToLocal(bulletNode.getWorldPosition(new Vector3())) : null;
      const sm = new SpriteMaterial({ transparent: true, depthTest: false }); this.spriteMats.push(sm);
      const label = new Sprite(sm); label.scale.set(LABEL_SIZE, LABEL_SIZE, 1); label.renderOrder = 10; label.visible = false;
      this.labelRoot.add(label);
      const i: Instance = { init, group, model, meshes, stageNodes, team: null, stage: -1, level: -1, label, labelOffset, bullet, ring: null, ringRadius: 0, picks: [] };
      this.inst.set(init.index, i); this.byId.set(init.id, i);
      this.applyStage(i, 0);
    }
  }

  bindWorldRoot(worldRoot: Object3D): void { this.worldRoot = worldRoot; }

  select(index: number | null): void { this.selected = index; }
  setShowTowerRanges(on: boolean): void { this.showRanges = on; }

  update(frame: BuildingFrame, events: readonly SimEvent[], dtMs: number, sim?: { towerRadiusMilli(view: any, building: number): number }): void {
    const { view } = frame, b = view.buildings;
    for (const i of this.inst.values()) {
      const k = i.init.index, owner = b.owner[k]!;
      const team = owner < 0 ? NEUTRAL_TEAM : view.players[owner]!.colorKey;
      if (team !== i.team) this.applyTeam(i, team);
      const stage = Math.max(0, Math.min(this.stageSets.length - 1, b.stage[k]! - 1));
      if (stage !== i.stage) this.applyStage(i, stage);
      const level = b.level[k]!;
      if (level !== i.level || i.label.userData['stage'] !== stage) this.applyLabel(i, level, stage);
      this.updateRing(i, view, sim);
    }
    for (const e of events) if (e.type === 'TowerShot') this.spawnShot(e, view);
    this.advanceShots(dtMs);
    this.syncLabels();
  }

  private applyTeam(i: Instance, team: string): void {
    const m = this.ctx.materials.teamMaterial(this.ctx.visualId, team, this.ctx.visual.team?.textures ?? {});
    for (const mesh of i.meshes) mesh.material = m;
    i.team = team;
  }

  private applyStage(i: Instance, stage: number): void {
    const on = this.stageSets[stage]!;
    for (const [n, o] of i.stageNodes) o.visible = on.has(n);
    i.stage = stage;
    i.picks = i.meshes.filter(m => { for (let o: Object3D | null = m; o && o !== i.group; o = o.parent) if (!o.visible) return false; return true; });
  }

  private applyLabel(i: Instance, level: number, stage: number): void {
    (i.label.material as SpriteMaterial).map = this.deps.painter.texture(level, stage);
    i.label.material.needsUpdate = true; i.label.userData['stage'] = stage; i.label.visible = true; i.level = level;
  }

  private updateRing(i: Instance, view: BuildingFrame['view'], sim?: { towerRadiusMilli(view: any, building: number): number }): void {
    const isTower = i.bullet !== null, sel = this.selected === i.init.index;
    const want = sel || (isTower && this.showRanges);
    if (!want) { if (i.ring) i.ring.visible = false; return; }
    const r = (isTower && sim ? sim.towerRadiusMilli(view, i.init.index) : i.init.radius * 1.25) / MILLI;
    if (r <= 0) { if (i.ring) i.ring.visible = false; return; }
    if (!i.ring) { i.ring = new Mesh(this.ringGeo, this.ringMats.range); i.ring.position.y = 0.02; i.ring.renderOrder = 2; const disc = new Mesh(this.discGeo, this.discMats.range); disc.name = 'range-disc'; disc.position.y = -0.005; disc.renderOrder = 1; i.ring.add(disc); i.group.add(i.ring); }
    i.ring.material = sel ? this.ringMats.sel : this.ringMats.range;
    (i.ring.getObjectByName('range-disc') as Mesh).material = sel ? this.discMats.sel : this.discMats.range;
    i.ring.scale.set(r, 1, r); i.ring.visible = true; i.ringRadius = r;
  }

  private spawnShot(e: Extract<SimEvent, { type: 'TowerShot' }>, view: BuildingFrame['view']): void {
    const t = this.inst.get(e.tower), p = this.deps.projectile;
    if (!t || !t.bullet || !p || !this.projTpl) return;
    const owner = view.buildings.owner[e.tower]!, team = owner < 0 ? NEUTRAL_TEAM : view.players[owner]!.colorKey;
    const g = this.projTpl.clone(true); g.scale.multiplyScalar(p.visual.scale ?? 1);
    const m = this.ctx.materials.teamMaterial(p.visualId, team, p.visual.team?.textures ?? {});
    g.traverse(o => { if ((o as Mesh).isMesh) (o as Mesh).material = m as Material; });
    const from = t.bullet.clone().add(t.group.position), to = new Vector3(e.x / MILLI, from.y * 0.5, e.z / MILLI);
    g.position.copy(from); g.lookAt(to); this.root.add(g);
    this.shots.push({ group: g, from, to, t: 0 });
  }

  private advanceShots(dtMs: number): void {
    for (const s of this.shots) { s.t += dtMs / PROJECTILE_MS; s.group.position.lerpVectors(s.from, s.to, Math.min(1, s.t)); }
    this.shots = this.shots.filter(s => { if (s.t < 1) return true; this.root.remove(s.group); return false; });
  }

  /** Mirror-safe: world position of each label = worldRoot.matrixWorld x labelPos (labels live outside the mirrored root). */
  private syncLabels(): void {
    const wr = this.worldRoot; if (wr) wr.updateWorldMatrix(true, false);
    for (const i of this.inst.values()) {
      i.label.position.copy(i.group.position).add(i.labelOffset);
      if (wr) i.label.position.applyMatrix4(wr.matrixWorld);
    }
  }

  private clearInstances(): void {
    for (const i of this.inst.values()) { this.root.remove(i.group); this.labelRoot.remove(i.label); }
    for (const s of this.shots) this.root.remove(s.group);
    for (const m of this.spriteMats) m.dispose();
    this.spriteMats = []; this.shots = []; this.inst.clear(); this.byId.clear();
  }

  dispose(): void {
    this.clearInstances(); this.ringGeo.dispose(); this.discGeo.dispose(); this.discMats.range.dispose(); this.discMats.sel.dispose(); this.ringMats.range.dispose(); this.ringMats.sel.dispose(); this.deps.painter.dispose();
  }
}
