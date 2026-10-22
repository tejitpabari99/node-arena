import { Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, CircleGeometry, DoubleSide, Vector3, type BufferGeometry, type Scene } from 'three';
import { isqrt, TICK_RATE, type SimEvent, type SimView } from '@node-arena/sim';
import type { Manifest } from '@node-arena/content';
import { createManifestResolver, ManifestError } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
/** Clash burst reads as dust/impact, not a team colour (SP04 Req 7). */
export const CLASH_CREAM = '#fff4d6';
/** Legacy renderer's local effect set (replaced by the registry-driven fx renderer in Task 10). */
const LEGACY_FX = Object.freeze(['pulse', 'puff', 'spark'] as const);
type Effect = typeof LEGACY_FX[number];
/** Return the colour owner, or undefined to skip events with no meaningful position. Target is borrowed. */
export type EventLocator = (event: SimEvent, view: SimView, target: Vector3) => number | undefined;
export interface FxRendererOptions { view: SimView; manifest: Manifest; scene: Scene; scope: Disposables; capacity?: number; reducedMotion?: boolean; palette?: keyof Manifest['palettes']; eventLocators?: Partial<Record<SimEvent['type'], EventLocator>> }
interface Slot { readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>; effect: Effect; owner: number; cream: boolean; born: number; duration: number; active: boolean }
function towerPosition(view: SimView, tower: number, target: Vector3) { const p = view.towerStatic[tower]; if (!p) return false; target.set(p.x / 1000, .12, p.y / 1000); return true; }
/** This registry describes event payload geometry, never archetype or visual identities. */
export const EVENT_FX_LOCATORS: Readonly<Partial<Record<SimEvent['type'], EventLocator>>> = {
  Clash(event, view, target) {
    if (event.type !== 'Clash') return;
    const n = view.towerStatic.length, from = Math.floor(event.channel / n), to = event.channel % n, a = view.towerStatic[from], b = view.towerStatic[to];
    if (!a || !b) return;
    const dx = b.x-a.x, dz = b.y-a.y, length = isqrt((dx*TICK_RATE)**2+(dz*TICK_RATE)**2), t = length ? Math.min(1,Math.max(0,event.progA/length)) : 0;
    target.set((a.x+dx*t)/1000,.15,(a.y+dz*t)/1000); return view.tower.owner[from] ?? -1;
  },
  Captured(event, view, target) { if (event.type === 'Captured' && towerPosition(view,event.tower,target)) return event.to; },
  TroopArrived(event, view, target) { if (event.type === 'TroopArrived' && towerPosition(view,event.tower,target)) return event.owner; },
  LineDrawn(event, view, target) { if (event.type === 'LineDrawn' && towerPosition(view,event.from,target)) return event.owner; },
  LineCut(event, view, target) { if (event.type === 'LineCut') { const from = Math.floor(event.channel/view.towerStatic.length); if (towerPosition(view,from,target)) return view.tower.owner[from] ?? -1; } },
  TroopSpawned(event, view, target) { if (event.type === 'TroopSpawned' && towerPosition(view,Math.floor(event.channel/view.towerStatic.length),target)) return event.owner; },
  PlayerEliminated(event, view, target) { if (event.type !== 'PlayerEliminated') return; let count=0,x=0,z=0; for(let i=0;i<view.towerStatic.length;i++) if(view.tower.owner[i]===event.player){ x+=view.towerStatic[i]!.x;z+=view.towerStatic[i]!.y;count++; } if(!count) return;target.set(x/count/1000,.12,z/count/1000);return event.player; },
  GameOver(_event, view, target) { if (!view.towerStatic.length) return;let x=0,z=0;for(const t of view.towerStatic){x+=t.x;z+=t.y;}target.set(x/view.towerStatic.length/1000,.12,z/view.towerStatic.length/1000);return -1; },
};
/** Fixed meshes/materials and shared geometry: spawning/animating never allocates GPU resources. Clock is absolute seconds, like troop renderer. */
export function createFxRenderer(options: FxRendererOptions) {
  const scope = new Disposables(), resolver = createManifestResolver(options.manifest), locators = { ...EVENT_FX_LOCATORS, ...options.eventLocators };
  const geometries: Record<Effect, BufferGeometry> = { pulse: scope.add(new RingGeometry(.7,1,24).rotateX(-Math.PI/2)), puff: scope.add(new SphereGeometry(.45,8,6)), spark: scope.add(new CircleGeometry(.7,8).rotateX(-Math.PI/2)) };
  const durations: Record<Effect, number> = { pulse: .8, puff: .5, spark: .4 }, slots: Slot[] = [], meshes: Mesh<BufferGeometry, MeshBasicMaterial>[] = [];
  let view = options.view, palette = options.palette ?? 'default', reduced = options.reducedMotion ?? false, seconds = 0, cursor = 0, disposed = false;
  const position = new Vector3(), capacity = Math.max(1, Math.floor(options.capacity ?? 64));
  for (let i=0;i<capacity;i++) {
    const material = scope.add(new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide }));
    const mesh = new Mesh(geometries.pulse, material); mesh.visible=false; mesh.renderOrder=2; options.scene.add(mesh); scope.defer(()=>mesh.removeFromParent());
    meshes.push(mesh); slots.push({ mesh, effect:'pulse', owner:-1, cream:false, born:0, duration:0, active:false });
  }
  function tint(slot: Slot) { slot.mesh.material.color.set(slot.cream ? CLASH_CREAM : resolver.color(view.players[slot.owner]?.colorKey ?? 'neutral',palette)); }
  function update(now: number) {
    if (disposed) return; seconds = now;
    for (let i=0;i<slots.length;i++) { const slot=slots[i]!; if(!slot.active) continue;
      const age=Math.max(0,seconds-slot.born), t=age/slot.duration;
      if(t>=1){slot.active=false;slot.mesh.visible=false;continue;}
      slot.mesh.material.opacity=1-t; const scale=slot.effect==='pulse' ? .4+t*2.6 : slot.effect==='puff' ? .4+t*1.4 : .3+t*1.8;
      slot.mesh.scale.setScalar(scale); slot.mesh.rotation.y=slot.effect==='spark'&&!reduced ? t*1.5 : 0;
    }
  }
  function consumeEvents(events: readonly SimEvent[], nextView = view) {
    if(disposed) return; view=nextView;
    for(const event of events) {
      const mapping=resolver.event(event.type);
      const fx=mapping?.fx ?? (event.type==='Captured' ? resolver.visual(view.towerStatic[event.tower]!.visual,'tower').fx : undefined);
      if(!fx) continue;
      if(!(LEGACY_FX as readonly string[]).includes(fx)) throw new ManifestError('key',event.type,`Unresolved fx ${fx}`);
      const owner=locators[event.type]?.(event,view,position); if(owner===undefined) continue;
      let slot: Slot | undefined;
      for(let i=0;i<slots.length;i++) { const candidate=slots[(cursor+i)%slots.length]!; if(!candidate.active){slot=candidate;cursor=(cursor+i+1)%slots.length;break;} }
      if(!slot){slot=slots[cursor]!;cursor=(cursor+1)%slots.length;}
      slot.effect=fx as Effect;slot.owner=owner;slot.cream=event.type==='Clash';slot.active=true;slot.born=seconds;slot.duration=durations[slot.effect]*(reduced?.35:1);
      slot.mesh.geometry=geometries[slot.effect];slot.mesh.position.copy(position);slot.mesh.scale.setScalar(.4);slot.mesh.rotation.set(0,0,0);slot.mesh.material.opacity=1;slot.mesh.visible=true;tint(slot);
    }
  }
  function dispose(){if(disposed)return;disposed=true;for(const slot of slots){slot.active=false;slot.mesh.visible=false;}scope.dispose();}
  options.scope.defer(dispose);
  return { consumeEvents, update, dispose, get meshes(): readonly Mesh<BufferGeometry,MeshBasicMaterial>[] { return meshes; }, get slots(): readonly Readonly<Slot>[] { return slots; },
    get activeCount(){let count=0;for(const slot of slots)if(slot.active)count++;return count;},
    setPalette(value: keyof Manifest['palettes']){palette=value;for(const slot of slots)if(slot.active)tint(slot);},
    setReducedMotion(value: boolean){reduced=value;for(const slot of slots)if(slot.active)slot.duration=durations[slot.effect]*(reduced?.35:1);},
  };
}
