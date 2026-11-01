// Set A "Modern Outpost" - concrete/steel, rectilinear, team colour on roofs/flags/trims.
import { Kit, T, mesh, empty, dummyMat, rig, Q, qTrack, pTrack, deathClip } from './lib.mjs';

function sandRing(k, r, n, layers, gap = 0.5, y0 = 0.1) {
  for (let l = 0; l < layers; l++) for (let i = 0; i < n; i++) {
    const a = (i + (l % 2) * 0.5) / n * Math.PI * 2, d = Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI);
    if (d < gap) continue;
    k.box(l % 2 ? 'sandDark' : 'sand', 0.34, 0.15, 0.2, Math.sin(a) * r, y0 + l * 0.15, Math.cos(a) * r, a);
  }
}
function flag(k, x, z, h, w = 0.5, fh = 0.28) {
  k.cyl('steelLight', 0.025, 0.03, h, x, 0.1, z, 5);
  k.sphere('brass', 0.045, x, 0.1 + h, z, 5, 3);
  k.box('team', w, fh, 0.03, x + w / 2 + 0.02, 0.1 + h - fh - 0.04, z);
  k.box('teamDark', w, 0.05, 0.035, x + w / 2 + 0.02, 0.1 + h - fh - 0.04, z);
}
function door(k, x, y, z, w = 0.34, h = 0.42) {
  k.box('steelDark', w + 0.1, h + 0.06, 0.05, x, y, z);
  k.box('dark', w, h, 0.06, x, y, z + 0.005);
}

export function barracks() {
  const root = new T.Group(); root.name = 'barracks';
  // stage 0: low bunker
  let k = new Kit();
  k.box('concreteDark', 1.55, 0.08, 1.55, 0, 0, 0, Math.PI / 4 * 0);
  k.frustum('concrete', 1.1, 0.9, 0.7, 1.0, 0.8, 0, 0.08, -0.05);
  k.box('team', 1.2, 0.1, 0.95, 0, 0.78, -0.05);
  k.box('teamDark', 1.2, 0.04, 0.95, 0, 0.74, -0.05);
  k.box('steelDark', 0.28, 0.08, 0.28, 0.25, 0.88, -0.1); k.box('steel', 0.28, 0.03, 0.28, 0.25, 0.96, -0.1);
  door(k, 0, 0.08, 0.37);
  k.box('dark', 0.34, 0.07, 0.05, -0.38, 0.45, 0.42, 0); k.box('dark', 0.34, 0.07, 0.05, 0.38, 0.45, 0.42);
  sandRing(k, 0.8, 14, 1, 0.55);
  flag(k, 0.55, -0.45, 1.45);
  let s = mesh('stage0', k, dummyMat); root.add(s); const t0 = k.tris();
  // stage 1: two storey + crates
  k = new Kit();
  k.box('concreteDark', 1.6, 0.08, 1.6, 0, 0, 0);
  k.frustum('concrete', 1.15, 0.95, 0.85, 1.05, 0.85, 0, 0.08, -0.05);
  k.box('hazard', 1.18, 0.07, 0.98, 0, 0.18, -0.05, 0); k.box('concrete', 1.14, 0.08, 0.94, 0, 0.18, -0.05);
  k.box('teamDark', 1.25, 0.06, 1.0, 0, 0.9, -0.05);
  k.frustum('concreteLight', 0.8, 0.6, 0.45, 0.72, 0.52, 0, 0.96, -0.1);
  k.box('glass', 0.62, 0.1, 0.05, 0, 1.2, 0.2); k.box('glass', 0.05, 0.1, 0.4, 0.38, 1.2, -0.1); k.box('glass', 0.05, 0.1, 0.4, -0.38, 1.2, -0.1);
  k.box('team', 0.9, 0.09, 0.72, 0, 1.4, -0.1);
  k.cyl('steelLight', 0.015, 0.02, 0.4, -0.28, 1.49, -0.3, 4); k.box('steelLight', 0.22, 0.015, 0.015, -0.28, 1.86, -0.3);
  door(k, 0, 0.08, 0.42);
  k.box('dark', 0.34, 0.07, 0.05, -0.4, 0.52, 0.47); k.box('dark', 0.34, 0.07, 0.05, 0.4, 0.52, 0.47);
  k.box('olive', 0.22, 0.2, 0.22, -0.6, 0.08, 0.5, 0.3); k.box('woodLight', 0.2, 0.18, 0.2, -0.58, 0.28, 0.49, 0.9);
  sandRing(k, 0.86, 16, 2, 0.5);
  flag(k, 0.62, -0.5, 1.75, 0.58, 0.32);
  s = mesh('stage1', k, dummyMat); root.add(s);
  // stage 2: command bunker
  k = new Kit();
  k.box('concreteDark', 1.7, 0.08, 1.7, 0, 0, 0);
  k.frustum('concrete', 1.25, 1.0, 0.95, 1.15, 0.9, 0, 0.08, -0.05);
  k.box('hazard', 1.28, 0.07, 1.03, 0, 0.18, -0.05); k.box('concrete', 1.24, 0.08, 0.99, 0, 0.18, -0.05);
  k.mirror(sg => { k.frustum('concrete', 0.42, 0.7, 0.5, 0.38, 0.6, sg * 0.82, 0.08, -0.05); k.box('team', 0.5, 0.08, 0.76, sg * 0.82, 0.58, -0.05); });
  k.box('teamDark', 1.35, 0.06, 1.05, 0, 1.0, -0.05);
  k.frustum('concreteLight', 0.9, 0.7, 0.55, 0.8, 0.6, 0, 1.06, -0.1);
  k.box('glass', 0.8, 0.14, 0.05, 0, 1.32, 0.24); k.box('glass', 0.05, 0.14, 0.5, 0.43, 1.32, -0.1); k.box('glass', 0.05, 0.14, 0.5, -0.43, 1.32, -0.1);
  k.box('team', 1.05, 0.1, 0.85, 0, 1.6, -0.1);
  k.box('teamDark', 1.05, 0.04, 0.85, 0, 1.57, -0.1);
  // radar dish + mast
  k.cyl('steelDark', 0.03, 0.04, 0.3, -0.3, 1.7, -0.25, 5); k.sphere('steelLight', 0.2, -0.3, 2.05, -0.25, 8, 4, 1, 0.45, 1, true);
  k.cyl('steelLight', 0.015, 0.02, 0.6, 0.35, 1.7, -0.3, 4);
  door(k, 0, 0.08, 0.42, 0.4, 0.5);
  k.mirror(sg => { k.box('dark', 0.3, 0.08, 0.05, sg * 0.82, 0.38, 0.33); });
  sandRing(k, 0.92, 18, 2, 0.45);
  // corner gun nests
  for (const [cx, cz] of [[-0.78, 0.7], [0.78, 0.7]]) { k.cyl('steelDark', 0.13, 0.15, 0.25, cx, 0.1, cz, 6); k.box('steelLight', 0.05, 0.05, 0.3, cx, 0.3, cz + 0.2); }
  flag(k, 0.7, -0.62, 2.05, 0.66, 0.36); flag(k, -0.7, -0.62, 1.7, 0.5, 0.28);
  s = mesh('stage2', k, dummyMat); root.add(s);
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0), empty('UIPosition', 0, 2, 0));
  return { root };
}

export function factory() {
  const root = new T.Group(); root.name = 'factory';
  const roof = (k, n, len, y0, zBack, w = 0.4, h = 0.32, x0 = 0) => {
    // teeth march toward +z; each tooth: vertical glazed face at its +z... slope rises toward +z.
    for (let i = 0; i < n; i++) {
      const zs = zBack + i * w; // tooth spans zs..zs+w ; slope rises toward +z to height h at z=zs+w (vertical face there)
      // polygon px=-z : points (px,py): z=zs -> px=-zs
      k.prism('team', [[-zs, 0], [-zs - w, 0], [-zs - w, h]].map(([a, b]) => [a, b]), len, x0, y0, 0, Math.PI / 2);
      k.box('glass', len - 0.06, h * 0.78, 0.03, x0, y0 + 0.02, zs + w - 0.005);
      k.box('steelDark', len, 0.04, w, x0, y0 - 0.0, zs + w / 2);
    }
  };
  const stack = (k, x, z, h, r = 0.13) => {
    k.cyl('concreteDark', r * 0.85, r, h, x, 0.1, z, 8);
    k.cyl('team', r * 0.9, r * 0.9, 0.1, x, 0.1 + h * 0.72, z, 8);
    k.cyl('steelDark', r * 1.05, r * 0.88, 0.07, x, 0.1 + h, z, 8);
  };
  const rollDoor = (k, x, y, z, w = 0.62, h = 0.5) => { k.box('steelDark', w + 0.1, h + 0.06, 0.05, x, y, z); for (let i = 0; i < 4; i++) k.box(i % 2 ? 'steelLight' : 'steel', w, h / 4 - 0.01, 0.06, x, y + 0.01 + i * h / 4, z + 0.005); };
  // stage0
  let k = new Kit();
  k.box('concreteDark', 1.55, 0.1, 1.3, 0, 0, 0);
  k.box('concrete', 1.4, 0.65, 0.9, 0, 0.1, 0.02);
  k.box('steel', 1.44, 0.05, 0.94, 0, 0.7, 0.02);
  roof(k, 2, 1.3, 0.75, -0.38 + 0.0, 0.38, 0.3);
  k.box('team', 1.44, 0.07, 0.07, 0, 0.62, 0.5);
  rollDoor(k, 0.2, 0.1, 0.49, 0.6, 0.45);
  stack(k, -0.55, -0.45, 1.05, 0.12);
  k.box('hazard', 0.5, 0.02, 0.3, 0.2, 0.1, 0.8);
  let s = mesh('stage0', k, dummyMat); root.add(s);
  // stage1
  k = new Kit();
  k.box('concreteDark', 1.65, 0.1, 1.4, 0, 0, 0);
  k.box('concrete', 1.45, 0.75, 1.0, -0.05, 0.1, 0);
  k.box('steel', 1.49, 0.05, 1.04, -0.05, 0.8, 0);
  roof(k, 3, 1.35, 0.85, -0.58, 0.38, 0.32, -0.05);
  k.box('concreteLight', 0.5, 0.5, 0.6, 0.72, 0.1, 0.1); k.box('team', 0.56, 0.07, 0.66, 0.72, 0.6, 0.1);
  rollDoor(k, -0.2, 0.1, 0.51, 0.65, 0.5);
  k.box('team', 1.49, 0.07, 0.07, -0.05, 0.72, 0.55);
  stack(k, -0.62, -0.5, 1.35, 0.13); stack(k, -0.3, -0.5, 1.1, 0.1);
  k.link('steel', [-0.62, 0.9, -0.5], [-0.62, 0.9, 0.0], 0.04, 5);
  k.box('hazard', 0.6, 0.02, 0.34, -0.2, 0.1, 0.85);
  s = mesh('stage1', k, dummyMat); root.add(s);
  // stage2
  k = new Kit();
  k.box('concreteDark', 1.7, 0.1, 1.5, 0, 0, 0);
  k.box('concrete', 1.45, 0.9, 1.1, -0.1, 0.1, -0.02);
  k.box('hazard', 1.47, 0.06, 1.12, -0.1, 0.18, -0.02); k.box('concrete', 1.45, 0.07, 1.1, -0.1, 0.18, -0.02);
  k.box('steel', 1.5, 0.05, 1.15, -0.1, 1.0, -0.02);
  roof(k, 4, 1.4, 1.05, -0.68, 0.36, 0.32, -0.1);
  // silo
  k.cyl('steelLight', 0.24, 0.24, 0.8, 0.72, 0.1, 0.35, 10); k.cyl('team', 0.245, 0.245, 0.12, 0.72, 0.62, 0.35, 10); k.sphere('steel', 0.24, 0.72, 0.9, 0.35, 10, 3, 1, 0.5, 1, true);
  k.box('concreteLight', 0.4, 0.55, 0.6, 0.75, 0.1, -0.35); k.box('team', 0.46, 0.07, 0.66, 0.75, 0.65, -0.35);
  rollDoor(k, -0.25, 0.1, 0.55, 0.7, 0.6);
  k.box('team', 1.5, 0.08, 0.07, -0.1, 0.9, 0.58);
  stack(k, -0.7, -0.55, 1.6, 0.14); stack(k, -0.42, -0.55, 1.3, 0.11); stack(k, -0.18, -0.55, 1.05, 0.09);
  k.link('steel', [0.72, 0.5, 0.2], [0.45, 0.8, -0.05], 0.04, 5);
  k.box('hazard', 0.7, 0.02, 0.36, -0.25, 0.1, 0.92);
  s = mesh('stage2', k, dummyMat); root.add(s);
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0), empty('UIPosition', -0.2, 1, 0.3));
  return { root };
}

export function tower() {
  const root = new T.Group(); root.name = 'tower';
  const legs = (k, bw, tw, H, y0 = 0) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.link('steel', [sx * bw, y0, sz * bw], [sx * tw, H, sz * tw], 0.075, 5);
  };
  const braces = (k, bw0, bw1, y0, y1) => {
    const c = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    for (let i = 0; i < 4; i++) { const [ax, az] = c[i], [bx, bz] = c[(i + 1) % 4]; k.link('steelLight', [ax * bw0, y0, az * bw0], [bx * bw1, y1, bz * bw1], 0.022, 4); k.link('steelLight', [bx * bw0, y0, bz * bw0], [ax * bw1, y1, az * bw1], 0.022, 4); }
  };
  const platform = (k, y, hw) => {
    k.box('steelDark', hw * 2 + 0.06, 0.06, hw * 2 + 0.06, 0, y, 0); k.box('teamDark', hw * 2 - 0.04, 0.02, hw * 2 - 0.04, 0, y + 0.06, 0);
    k.box('team', hw * 2 + 0.1, 0.05, 0.05, 0, y + 0.06, hw + 0.03); k.box('team', hw * 2 + 0.1, 0.05, 0.05, 0, y + 0.06, -hw - 0.03);
    k.box('team', 0.05, 0.05, hw * 2 + 0.1, hw + 0.03, y + 0.06, 0); k.box('team', 0.05, 0.05, hw * 2 + 0.1, -hw - 0.03, y + 0.06, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('steelLight', 0.04, 0.2, 0.04, sx * (hw + 0.03), y + 0.06, sz * (hw + 0.03));
  };
  const turret = (k, y, big = 1) => { big *= 1.3;
    k.cyl('steelDark', 0.22 * big, 0.26 * big, 0.14, 0, y, 0, 8);
    k.box('steelLight', 0.4 * big, 0.22 * big, 0.44 * big, 0, y + 0.14, -0.02);
    k.box('team', 0.34 * big, 0.06, 0.38 * big, 0, y + 0.14 + 0.22 * big, -0.02);
    k.box('steelDark', 0.1 * big, 0.12 * big, 0.12, 0, y + 0.2, 0.25 * big);
    k.cyl('steelDark', 0.04 * big, 0.04 * big, 0.55 * big, 0, y + 0.25 * big, 0.45 * big + 0.1, 6, 0, Math.PI / 2);
    k.cyl('steelLight', 0.06 * big, 0.06 * big, 0.08, 0, y + 0.25 * big, 0.45 * big + 0.1 + 0.27 * big, 6, 0, Math.PI / 2);
    if (big > 1) { k.cyl('steelDark', 0.025, 0.025, 0.4, 0.14, y + 0.3, 0.45, 5, 0, Math.PI / 2); k.cyl('steelDark', 0.025, 0.025, 0.4, -0.14, y + 0.3, 0.45, 5, 0, Math.PI / 2); }
  };
  // stage0 H 1.7
  let k = new Kit();
  k.box('concreteDark', 1.0, 0.1, 1.0, 0, 0, 0); k.box('team', 1.04, 0.03, 0.12, 0, 0.1, 0.46);
  legs(k, 0.42, 0.28, 1.7, 0.08); braces(k, 0.4, 0.3, 0.2, 1.6);
  platform(k, 1.68, 0.3); turret(k, 1.76);
  let s = mesh('stage0', k, dummyMat); root.add(s);
  // stage1 H 2.2
  k = new Kit();
  k.box('concreteDark', 1.1, 0.1, 1.1, 0, 0, 0); k.box('team', 1.14, 0.03, 0.12, 0, 0.1, 0.5);
  legs(k, 0.48, 0.3, 2.2, 0.08); braces(k, 0.45, 0.38, 0.2, 1.1); braces(k, 0.38, 0.32, 1.1, 2.1);
  platform(k, 1.05, 0.38); platform(k, 2.18, 0.32); turret(k, 2.26, 1.1);
  k.box('olive', 0.2, 0.16, 0.2, 0.3, 1.11, 0.1, 0.4);
  s = mesh('stage1', k, dummyMat); root.add(s);
  // stage2 H 2.7
  k = new Kit();
  k.box('concreteDark', 1.25, 0.1, 1.25, 0, 0, 0); k.box('team', 1.29, 0.03, 0.14, 0, 0.1, 0.56);
  legs(k, 0.56, 0.32, 2.7, 0.08); braces(k, 0.52, 0.45, 0.2, 0.9); braces(k, 0.45, 0.38, 0.9, 1.75); braces(k, 0.38, 0.33, 1.75, 2.6);
  platform(k, 0.9, 0.46); platform(k, 1.75, 0.4); platform(k, 2.68, 0.34); turret(k, 2.76, 1.25);
  k.cyl('steelLight', 0.02, 0.02, 0.6, -0.36, 2.74, -0.36, 4); k.box('team', 0.42, 0.24, 0.02, -0.15, 3.1, -0.36);
  k.box('olive', 0.24, 0.18, 0.24, 0.35, 0.96, 0.15, 0.4); k.box('olive', 0.2, 0.16, 0.2, -0.3, 1.81, 0.1);
  s = mesh('stage2', k, dummyMat); root.add(s);
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0), empty('UIPosition', 0, 2.24, 0), empty('BulletPosition', 0, 2.4, 0));
  return { root };
}

// ---- units
export function soldier(detail = 1) {
  const sg = detail ? [8, 5] : [5, 3], HIP = [0, 0.42, 0];
  const body = new Kit();
  body.frustum('olive', 0.3, 0.2, 0.36, 0.38, 0.24, 0, 0.42);                 // chest
  body.box('team', 0.34, 0.09, 0.26, 0, 0.62, 0);                              // vest band
  body.box('oliveDark', 0.22, 0.06, 0.16, 0, 0.4, 0);                         // belt
  body.box('oliveDark', 0.26, 0.3, 0.12, 0, 0.44, -0.17);                      // backpack
  body.box('team', 0.26, 0.05, 0.14, 0, 0.74, -0.17);
  body.sphere('skin', 0.1, 0, 0.9, 0.0, ...sg);
  body.sphere('team', 0.135, 0, 0.92, -0.005, sg[0], sg[1], 1, 0.9, 1.05, true);   // helmet shell
  if (detail) body.box('oliveDark', 0.3, 0.025, 0.3, 0, 0.92, 0, 0);               // helmet brim
  const mkArm = (rifle) => { const k = new Kit();
    k.box('olive', 0.09, 0.26, 0.1, 0, -0.26, 0); k.box('skin', 0.075, 0.07, 0.08, 0, -0.33, 0.0);
    if (rifle) { k.box('steelDark', 0.055, 0.07, 0.46, 0, -0.34, 0.16); if (detail) { k.box('steel', 0.04, 0.05, 0.14, 0, -0.34, 0.45); k.box('woodDark', 0.05, 0.1, 0.12, 0, -0.34, -0.12); } }
    return k; };
  const mkLeg = () => { const k = new Kit(); k.box('oliveDark', 0.12, 0.34, 0.13, 0, -0.34, 0); k.box('black', 0.13, 0.1, 0.19, 0, -0.42, 0.03); return k; };
  const parts = [
    { name: 'body', kit: body, pivot: HIP },
    { name: 'armL', kit: mkArm(false), pivot: [0.22, 0.8, 0], local: true },
    { name: 'armR', kit: mkArm(true), pivot: [-0.22, 0.8, 0], local: true },
    { name: 'legL', kit: mkLeg(), pivot: [0.09, 0.42, 0], local: true },
    { name: 'legR', kit: mkLeg(), pivot: [-0.09, 0.42, 0], local: true },
  ];
  const root = new T.Group(); root.name = 'soldier';
  const g = rig('soldier', parts); // flat children
  // run: period 0.5s
  const D = 0.5, times = [0, D / 4, D / 2, 3 * D / 4, D], ph = [0, 1, 0, -1, 0];
  const sw = (a, off = 0) => times.map((_, i) => Q(a * ph[(i + off) % 4 === 0 && false ? 0 : i] ));
  const swing = (amp, shift) => [0, 1, 2, 3, 4].map(i => Q(amp * Math.sin(((i + shift) / 4) * Math.PI * 2)));
  const bob = [0, 1, 2, 3, 4].map(i => [HIP[0], HIP[1] + 0.035 * Math.abs(Math.sin(i / 4 * Math.PI * 2)), HIP[2]]);
  const run = new T.AnimationClip('Run', D, [
    qTrack('legL', times, swing(0.75, 0)), qTrack('legR', times, swing(0.75, 2)),
    qTrack('armL', times, swing(0.6, 2)), qTrack('armR', times, swing(0.25, 0).map((q, i) => Q(0.25 * Math.sin(i / 4 * Math.PI * 2) - 0.25))),
    qTrack('body', times, [0, 1, 2, 3, 4].map(i => Q(0.12 + 0.03 * Math.sin(i / 4 * Math.PI * 4)))),
    pTrack('body', times, bob),
  ]);
  const flail = { body: 0, armL: k => -1.2 * Math.sin(k * 3), armR: k => 0.8 * Math.sin(k * 2.5), legL: k => 0.5 * k, legR: k => -0.3 * k };
  const death = deathClip(parts.map(p => ({ name: p.name, pivot: p.pivot, flail: flail[p.name] })), HIP, { dur: 0.7, ang: -1.45, drop: 0.3, axis: 'x' });
  return { root: g, animations: [run, death] };
}

export function tank() {
  const hull = new Kit(), tur = new Kit();
  // hull wedge (z forward)
    hull.side('slate', [[-0.58, 0.1], [0.5, 0.1], [0.66, 0.26], [0.5, 0.38], [-0.4, 0.38], [-0.58, 0.28]], 0.5, 0, 0, 0);
  // tracks / skirts
  for (const sx of [-1, 1]) {
    hull.side('steelDark', [[-0.62, 0.02], [0.58, 0.02], [0.7, 0.14], [0.56, 0.3], [-0.54, 0.3], [-0.68, 0.14]], 0.16, sx * 0.33, 0, 0);
    hull.side('steel', [[-0.5, 0.3], [0.45, 0.3], [0.5, 0.36], [-0.5, 0.36]], 0.12, sx * 0.34, 0, 0);
    for (const wz of [-0.45, -0.15, 0.15, 0.45]) hull.axle('steel', 0.06, 0.04, sx * 0.43, 0.13, wz, 6);
  }
  hull.box('team', 0.42, 0.03, 0.46, 0, 0.38, -0.2);                         // engine deck
  hull.box('steelDark', 0.3, 0.02, 0.16, 0, 0.38, -0.5);                      // exhaust grille
  hull.box('team', 0.12, 0.06, 0.04, 0, 0.18, -0.58);
  // turret
  tur.side('steel', [[-0.3, 0.38], [0.3, 0.38], [0.38, 0.47], [0.22, 0.62], [-0.2, 0.62], [-0.36, 0.5]], 0.42, 0, 0, 0);
  tur.box('team', 0.34, 0.03, 0.36, 0, 0.62, -0.02); tur.box('team', 0.04, 0.05, 0.3, 0.2, 0.44, -0.02); tur.box('team', 0.04, 0.05, 0.3, -0.2, 0.44, -0.02);
  tur.box('steelDark', 0.2, 0.14, 0.12, 0, 0.44, 0.38);                        // mantlet
  tur.cyl('steelDark', 0.04, 0.04, 0.62, 0, 0.51, 0.7, 6, 0, Math.PI / 2);
  tur.cyl('steelLight', 0.06, 0.06, 0.09, 0, 0.51, 1.0, 6, 0, Math.PI / 2);
  tur.cyl('steelLight', 0.012, 0.012, 0.3, -0.12, 0.62, -0.2, 4);
  tur.box('steelDark', 0.1, 0.06, 0.1, 0.13, 0.62, 0.06);
  const parts = [{ name: 'hull', kit: hull, pivot: [0, 0, 0] }, { name: 'turret', kit: tur, pivot: [0, 0.38, -0.02] }];
  const g = rig('tank', parts);
  const D = 0.4, times = [0, D / 4, D / 2, 3 * D / 4, D];
  const run = new T.AnimationClip('Run', D, [
    pTrack('hull', times, [0, 1, 2, 3, 4].map(i => [0, 0.012 * Math.sin(i / 4 * Math.PI * 4), 0])),
    qTrack('hull', times, [0, 1, 2, 3, 4].map(i => Q(0.015 * Math.sin(i / 4 * Math.PI * 2)))),
    qTrack('turret', times, [0, 1, 2, 3, 4].map(i => Q(-0.01 * Math.sin(i / 4 * Math.PI * 2)))),
  ]);
  const death = deathClip([{ name: 'hull', pivot: [0, 0, 0] }, { name: 'turret', pivot: parts[1].pivot, flail: k => -0.9 * k }], [0, 0.2, 0], { dur: 0.8, ang: 0.5, drop: 0.12, axis: 'z' });
  return { root: g, animations: [run, death] };
}
