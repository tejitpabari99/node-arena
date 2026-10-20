import { Mesh, MeshBasicMaterial, SphereGeometry, type Scene } from 'three';
import { mulberry32 } from './rng.js';
import type { Disposables } from './disposables.js';
/** Fixed-size pool of cosmetic dust puffs: preallocated meshes, zero allocation while spawning or updating.
 * Offsets and lifetimes are a pure function of the caller's integer `seed` (pair + tick), never wall clock or unseeded random.
 * `born` is resolved on the next `update(seconds)` so a puff spawned in a tick handler starts at the next rendered frame. */
export const PUFF_LIFE = .6;
interface Puff { readonly mesh: Mesh<SphereGeometry, MeshBasicMaterial>; active: boolean; born: number; life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }
export interface PuffPool { spawn(x: number, y: number, z: number, seed: number, count?: number, color?: number): void; update(seconds: number): void; clear(): void; readonly activeCount: number; readonly meshes: readonly Mesh[] }
export function createPuffPool(scene: Scene, scope: Disposables, capacity = 8): PuffPool {
  const geometry = scope.add(new SphereGeometry(.45, 14, 10)), puffs: Puff[] = []; let cursor = 0;
  for (let i = 0; i < capacity; i++) {
    const mesh = new Mesh(geometry, scope.add(new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 0 })));
    mesh.visible = false; mesh.renderOrder = 4; mesh.frustumCulled = false; scene.add(mesh); scope.defer(() => mesh.removeFromParent());
    puffs.push({ mesh, active: false, born: 0, life: PUFF_LIFE, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  }
  function place(p: Puff, age: number) {
    const t = Math.min(1, age / p.life); p.mesh.position.set(p.x + p.vx * age, p.y + p.vy * age, p.z + p.vz * age);
    p.mesh.scale.setScalar(.9 + 1.8 * t); p.mesh.material.opacity = .9 * (1 - t) * (1 - t * .3);
  }
  return {
    spawn(x, y, z, seed, count = 1, color = 0xffffff) {
      const rand = mulberry32(seed);
      for (let k = 0; k < count; k++) {
        const p = puffs[cursor]!; cursor = (cursor + 1) % puffs.length;
        const angle = (k / count + rand() * .5) * Math.PI * 2, speed = 3 + rand() * 2;
        p.active = true; p.born = NaN; p.life = PUFF_LIFE * (.8 + rand() * .4); p.x = x; p.y = y; p.z = z; p.vx = Math.cos(angle) * speed; p.vz = Math.sin(angle) * speed; p.vy = .6 + rand() * .8;
        p.mesh.material.color.setHex(color); p.mesh.visible = true; place(p, 0);
      }
    },
    update(seconds) {
      for (const p of puffs) { if (!p.active) continue; if (Number.isNaN(p.born)) p.born = seconds; const age = seconds - p.born; if (age >= p.life) { p.active = false; p.mesh.visible = false; continue; } place(p, Math.max(0, age)); }
    },
    clear() { for (const p of puffs) { p.active = false; p.mesh.visible = false; } },
    get activeCount() { let c = 0; for (const p of puffs) if (p.active) c++; return c; },
    get meshes() { return puffs.map(p => p.mesh); },
  };
}
