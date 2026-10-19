import { Box3, BufferAttribute, Color, DodecahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Scene, Vector3 } from 'three';
import type { Manifest } from '@node-arena/content';
import type { Disposables } from './disposables.js';
import { mulberry32 } from './rng.js';

/** Grass patch = level bounds + GRASS_PAD, fading to sand over EDGE_SOFT. */
export const GRASS_PAD = 8, EDGE_SOFT = 6, CORNER_RADIUS = 8;
const FALLBACK = { grass: '#A3D419', grassAlt: '#9DCB10', sand: '#FFE1B3', rock: '#BC5439' };
type Theme = Manifest['themes'][string];

/** Ground contract (SP04): every top surface is y = 0 (sand sits 0.02 below, never coplanar); no decal/prop/shadow-catcher
 * geometry lives inside the grass interior. Every mesh here carries userData.visualRole = 'ground'. */
export function createGround(options: { scene: Scene; scope: Disposables; theme: Theme; bounds: Box3 }) {
  const { scene, scope, theme, bounds } = options;
  const palette = { ...FALLBACK, ...(theme.palette ?? {}), grass: theme.palette?.grass ?? theme.ground };
  const size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
  const core = { w: Math.max(size.x, .01) + 2 * GRASS_PAD, h: Math.max(size.z, .01) + 2 * GRASS_PAD };

  // Sand base plane >= 4x bounds.
  const sand = new Mesh(new PlaneGeometry(Math.max(size.x, 1) * 4 + 100, Math.max(size.z, 1) * 4 + 100), new MeshStandardMaterial({ color: palette.sand }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(center.x, -.02, center.z); sand.receiveShadow = true;
  sand.userData.visualRole = 'ground'; scene.add(sand); scope.object(sand);

  // Grass patch: rounded rect, vertex colours (two low-frequency greens, soft sand fade at the rim).
  const hx = core.w / 2 + EDGE_SOFT / 2, hz = core.h / 2 + EDGE_SOFT / 2;
  const geometry = new PlaneGeometry(hx * 2, hz * 2, Math.ceil(hx * 2), Math.ceil(hz * 2));
  const pos = geometry.getAttribute('position'), colors = new Float32Array(pos.count * 3);
  const grass = new Color(palette.grass), alt = new Color(palette.grassAlt), sandColor = new Color(palette.sand), c = new Color();
  const r = Math.min(CORNER_RADIUS, core.w / 2, core.h / 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i); // plane local x, y (y -> world -z after rotation)
    const qx = Math.abs(x) - (core.w / 2 - r), qy = Math.abs(y) - (core.h / 2 - r);
    const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    const t = Math.min(1, Math.max(0, (sd + EDGE_SOFT / 2) / EDGE_SOFT)), w = t * t * (3 - 2 * t); // 0 inside, 1 sand
    const wx = x + center.x, wz = -y + center.z;
    const n = .5 + .55 * (Math.sin(wx * .11 + wz * .07) + Math.sin(wx * .045 - wz * .13 + 1.7) * .8 + Math.sin(wx * .23 + wz * .19) * .4), shade = 1 + .08 * Math.sin(wx * .19 - wz * .17 + 4);
    c.copy(grass).lerp(alt, Math.min(1, Math.max(0, n))).multiplyScalar(shade).lerp(sandColor, w);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const ground = new Mesh(geometry, new MeshStandardMaterial({ color: 0xffffff, vertexColors: true }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(center.x, 0, center.z); ground.receiveShadow = true;
  ground.userData.visualRole = 'ground'; ground.userData.grassColor = palette.grass;
  // World corners of the solid grass patch for the visual probe (ground.playQuadScreen).
  const x0 = center.x - hx, x1 = center.x + hx, z0 = center.z - hz, z1 = center.z + hz; // outer extent incl. soft rim
  ground.userData.playQuad = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  scene.add(ground); scope.object(ground);

  // Rock clusters (squashed dodecahedra) in a ring outside the grass patch, deterministic from theme.scatter.seed.
  const rand = mulberry32((theme.scatter?.seed ?? 1) * 7919 + 17);
  const rockCount = 160, rocks = new InstancedMesh(new DodecahedronGeometry(1, 0), new MeshStandardMaterial({ color: palette.rock, flatShading: true }), rockCount);
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), up = new Vector3(0, 1, 0);
  const perimeter = 2 * (core.w + core.h); let placed = 0;
  while (placed < rockCount) {
    const clusterAt = rand() * perimeter, n = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n && placed < rockCount; k++, placed++) {
      let d = clusterAt + (rand() - .5) * 8; d = ((d % perimeter) + perimeter) % perimeter;
      const off = EDGE_SOFT / 2 + 1 + rand() * 6; let rx: number, rz: number;
      if (d < core.w) { rx = d - core.w / 2; rz = -core.h / 2 - off; } else if (d < core.w + core.h) { rx = core.w / 2 + off; rz = d - core.w - core.h / 2; }
      else if (d < 2 * core.w + core.h) { rx = core.w / 2 - (d - core.w - core.h); rz = core.h / 2 + off; } else { rx = -core.w / 2 - off; rz = core.h / 2 - (d - 2 * core.w - core.h); }
      const sc = .8 + rand() * 1.8; s.set(sc * (1 + rand() * .5), sc * (.45 + rand() * .3), sc * (1 + rand() * .5));
      q.setFromAxisAngle(up, rand() * Math.PI * 2); p.set(center.x + rx, 0, center.z + rz);
      m.compose(p, q, s); rocks.setMatrixAt(placed, m);
    }
  }
  rocks.castShadow = true; rocks.receiveShadow = true; rocks.userData.visualRole = 'ground'; rocks.instanceMatrix.needsUpdate = true;
  scene.add(rocks); scope.object(rocks);
  return { ground, sand, rocks };
}
