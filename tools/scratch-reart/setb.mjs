// Set B "Frontier Stronghold" - stone + timber, team colour on banners / roofs / cloth / shields.
import { Kit, T, mesh, empty, dummyMat, rig, Q, qTrack, pTrack, deathClip } from './lib.mjs';

function merlons(k, hw, hd, y, n = 3, sw = 'stoneLight', s = 0.17, h = 0.16, skipFront = false) {
  const put = (x, z) => k.box(sw, s, h, s, x, y, z);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : -1 + 2 * i / (n - 1);
    put(t * (hw - s / 2), hd - s / 2); put(t * (hw - s / 2), -hd + s / 2);
    if (i > 0 && i < n - 1) { put(hw - s / 2, t * (hd - s / 2)); put(-hw + s / 2, t * (hd - s / 2)); }
  }
}
function banner(k, x, y, z, h = 0.6, w = 0.28, ry = 0) {
  k.cyl('woodDark', 0.025, 0.03, h + 0.1, x, y, z, 5);
  k.box('woodDark', w + 0.06, 0.04, 0.04, x, y + h + 0.06, z);
  k.prism('team', [[-w / 2, 0], [w / 2, 0], [w / 2, h * 0.85], [0, h * 0.62], [-w / 2, h * 0.85]], 0.03, x, y + 0.02 + h * 0.15, z + 0.04, ry);
}
function pennant(k, x, y, z, len = 0.5, ht = 0.26) {
  k.cyl('woodDark', 0.025, 0.03, 0.8, x, y, z, 5);
  k.prism('team', [[0, 0], [len, ht * 0.5], [0, ht]], 0.03, x + 0.03, y + 0.5, z, 0);
}
function arch(k, x, y, z, w = 0.34, h = 0.42) {
  k.box('woodDark', w + 0.1, h, 0.06, x, y, z); k.box('dark', w, h - 0.06, 0.07, x, y, z + 0.005);
  k.box('stoneDark', w + 0.2, 0.08, 0.08, x, y + h, z - 0.005);
}
function timberFrame(k, w, d, y, h, z0 = 0) { // dark beams on the front/back faces
  for (const sz of [-1, 1]) { const zz = z0 + sz * (d / 2 + 0.005); for (const bx of [-w / 2 + 0.03, 0, w / 2 - 0.03]) k.box('woodDark', 0.05, h, 0.03, bx, y, zz); k.box('woodDark', w, 0.05, 0.03, 0, y + h - 0.03, zz); }
}

export const LABEL = { barracks: 2.0, factory: 1.5, tower: 2.4 };

export function barracks() {
  const root = new T.Group(); root.name = 'barracks';
  // stage0: small keep
  let k = new Kit();
  k.box('stoneDark', 1.5, 0.08, 1.5, 0, 0, 0);
  k.frustum('stone', 1.18, 1.18, 0.95, 1.08, 1.08, 0, 0.08, 0);
  k.frustum('stoneDark', 1.24, 1.24, 0.14, 1.18, 1.18, 0, 0.08, 0);
  k.box('stoneLight', 1.22, 0.1, 1.22, 0, 0.98, 0);                 // parapet walk
  merlons(k, 0.6, 0.6, 1.08, 4);
  k.cone('team', 0.78, 0.55, 0, 1.0, 0, 4, Math.PI / 4); k.cone('woodDark', 0.02, 0.22, 0, 1.52, 0, 4); // team pyramid roof inside the battlement
  arch(k, 0, 0.08, 0.57); k.box('team', 1.0, 0.16, 0.04, 0, 0.7, 0.575);  // banner band over gate
  k.box('dark', 0.08, 0.22, 0.04, -0.38, 0.5, 0.56); k.box('dark', 0.08, 0.22, 0.04, 0.38, 0.5, 0.56);
  banner(k, 0.5, 1.08, 0.5, 0.62, 0.32);
  let s = mesh('stage0', k, dummyMat); root.add(s);
  // stage1: + corner turrets
  k = new Kit();
  k.box('stoneDark', 1.6, 0.08, 1.6, 0, 0, 0);
  k.frustum('stone', 1.22, 1.22, 1.15, 1.1, 1.1, 0, 0.08, 0);
  k.frustum('stoneDark', 1.28, 1.28, 0.14, 1.2, 1.2, 0, 0.08, 0);
  k.box('stoneLight', 1.26, 0.1, 1.26, 0, 1.18, 0);
  merlons(k, 0.62, 0.62, 1.28, 4);
  k.cone('team', 0.8, 0.62, 0, 1.2, 0, 4, Math.PI / 4); k.cone('woodDark', 0.02, 0.22, 0, 1.78, 0, 4);
  arch(k, 0, 0.08, 0.59, 0.4, 0.5); k.box('team', 1.1, 0.18, 0.04, 0, 0.85, 0.595);
  k.mirror(sx => { const x = sx * 0.62, z = 0.62; k.cyl('stone', 0.2, 0.23, 1.3, x, 0.08, z, 8); k.cyl('stoneDark', 0.25, 0.25, 0.08, x, 1.2, z, 8); k.cone('team', 0.3, 0.46, x, 1.28, z, 8); k.cone('woodDark', 0.02, 0.2, x, 1.74, z, 4); });
  k.box('dark', 0.08, 0.22, 0.04, -0.4, 0.62, 0.62); k.box('dark', 0.08, 0.22, 0.04, 0.4, 0.62, 0.62);
  banner(k, 0.55, 1.28, 0.45, 0.8, 0.34);
  s = mesh('stage1', k, dummyMat); root.add(s);
  // stage2: full castle
  k = new Kit();
  k.box('stoneDark', 1.75, 0.08, 1.75, 0, 0, 0);
  k.frustum('stone', 1.2, 1.2, 1.2, 1.08, 1.08, 0, 0.08, 0);
  k.frustum('stoneDark', 1.26, 1.26, 0.14, 1.18, 1.18, 0, 0.08, 0);
  k.box('stoneLight', 1.24, 0.1, 1.24, 0, 1.22, 0);
  merlons(k, 0.62, 0.62, 1.32, 4);
  // central keep
  k.frustum('stone', 0.7, 0.7, 0.6, 0.64, 0.64, 0, 1.32, -0.02);
  k.box('stoneLight', 0.74, 0.08, 0.74, 0, 1.92, -0.02); merlons(k, 0.37, 0.37, 2.0, 3, 'stoneLight', 0.14, 0.13);
  k.cone('team', 0.42, 0.55, 0, 2.05, -0.02, 4, Math.PI / 4); k.cone('woodDark', 0.02, 0.25, 0, 2.58, -0.02, 4);
  k.box('team', 0.5, 0.05, 0.05, 0, 1.72, 0.32);
  arch(k, 0, 0.08, 0.6, 0.44, 0.55); k.box('team', 1.1, 0.2, 0.04, 0, 0.92, 0.605);
  k.mirror(sx => { for (const sz of [-1, 1]) { const x = sx * 0.66, z = sz * 0.66; k.cyl('stone', 0.22, 0.26, 1.45, x, 0.08, z, 8); k.cyl('stoneDark', 0.28, 0.28, 0.08, x, 1.4, z, 8); k.cone('team', 0.34, 0.5, x, 1.48, z, 8); k.cone('woodDark', 0.02, 0.2, x, 1.97, z, 4); } });
  k.box('dark', 0.08, 0.24, 0.04, -0.42, 0.7, 0.62); k.box('dark', 0.08, 0.24, 0.04, 0.42, 0.7, 0.62);
  banner(k, 0, 1.32, -0.55, 0.75, 0.3); 
  s = mesh('stage2', k, dummyMat); root.add(s);
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0), empty('UIPosition', 0, 2, 0));
  return { root };
}

function wheel(k, x, y, z, r, n = 8) {
  k.axle('woodDark', r * 0.98, 0.12, x, y, z, n);
  k.axle('woodLight', r * 0.6, 0.15, x, y, z, 6);
  for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * Math.PI * 2; k.box('woodLight', 0.2, 0.09, r * 0.34, x, y + Math.sin(a) * r * 0.92 - 0.045, z + Math.cos(a) * r * 0.92, 0, 0, 0); }
}
function chimney(k, x, z, y0, h) { k.box('stoneDark', 0.2, h, 0.2, x, y0, z); k.box('stoneLight', 0.26, 0.07, 0.26, x, y0 + h, z); k.box('team', 0.28, 0.04, 0.28, x, y0 + h - 0.1, z); k.box('dark', 0.12, 0.02, 0.12, x, y0 + h + 0.07, z); }
export function factory() {
  const root = new T.Group(); root.name = 'factory';
  const body = (k, w, d, wallH, roofH) => {
    k.box('stoneDark', w + 0.1, 0.08, d + 0.1, 0, 0, 0);
    k.box('stone', w, 0.32, d, 0, 0.08, 0);
    k.box('cloth', w - 0.02, wallH - 0.32, d - 0.02, 0, 0.4, 0);
    timberFrame(k, w, d - 0.02, 0.4, wallH - 0.32);
    k.gableX('team', d + 0.2, roofH, w + 0.16, 0, 0.08 + wallH, 0);
    k.box('woodDark', w + 0.2, 0.05, 0.05, 0, 0.08 + wallH + roofH - 0.02, 0);
  };
  const door = (k, x, w, d) => { k.box('woodDark', w + 0.1, 0.46, 0.05, x, 0.08, d / 2 + 0.02); k.box('wood', w, 0.4, 0.06, x, 0.08, d / 2 + 0.025); k.box('woodDark', 0.04, 0.4, 0.07, x, 0.08, d / 2 + 0.03); };
  const trough = (k, x, z, len = 0.7) => { k.box('woodDark', 0.22, 0.06, len, x, 0.28, z); k.box('glass', 0.16, 0.04, len, x, 0.31, z); };
  // stage0
  let k = new Kit();
  body(k, 1.0, 0.85, 0.7, 0.4); door(k, -0.15, 0.36, 0.85);
  chimney(k, -0.28, -0.22, 0.55, 0.8);
  k.box('woodLight', 0.5, 0.05, 0.05, 0.6, 0.35, 0.0); // axle bracket
  wheel(k, 0.62, 0.4, 0.0, 0.32); trough(k, 0.62, -0.1, 0.5); k.box('woodLight', 0.2, 0.15, 0.2, 0.15, 0.08, 0.62, 0.3);
  let s = mesh('stage0', k, dummyMat); root.add(s);
  // stage1
  k = new Kit();
  body(k, 1.15, 0.9, 0.8, 0.45); door(k, -0.2, 0.4, 0.9);
  k.box('stone', 0.5, 0.5, 0.5, -0.4, 0.08, -0.7); k.gableX('team', 0.62, 0.3, 0.62, -0.4, 0.58, -0.7);
  chimney(k, -0.3, -0.1, 0.6, 0.85); chimney(k, 0.2, -0.2, 0.62, 0.65);
  wheel(k, 0.75, 0.46, 0.05, 0.4); trough(k, 0.75, -0.1, 0.6);
  k.box('woodLight', 0.2, 0.2, 0.2, 0.3, 0.08, 0.7, 0.3); k.box('woodDark', 0.2, 0.2, 0.2, 0.52, 0.08, 0.68, 0.9);
  s = mesh('stage1', k, dummyMat); root.add(s);
  // stage2
  k = new Kit();
  body(k, 1.25, 0.95, 0.95, 0.5); door(k, -0.25, 0.44, 0.95);
  k.box('stone', 0.5, 0.6, 0.55, -0.55, 0.08, -0.75); k.gableX('team', 0.66, 0.34, 0.66, -0.55, 0.68, -0.75);
  chimney(k, -0.4, -0.05, 0.75, 0.9); chimney(k, 0.05, -0.25, 0.77, 0.7); chimney(k, 0.45, -0.1, 0.72, 0.55);
  wheel(k, 0.85, 0.52, 0.05, 0.48, 10); trough(k, 0.85, -0.1, 0.8);
  // crane
  k.cyl('woodDark', 0.04, 0.05, 0.9, -0.62, 0.08, 0.7, 5); k.box('woodDark', 0.55, 0.05, 0.05, -0.4, 0.95, 0.7, 0, 0, -0.2); k.box('dark', 0.015, 0.3, 0.015, -0.15, 0.62, 0.7); k.box('woodLight', 0.14, 0.14, 0.14, -0.15, 0.5, 0.7);
  k.box('woodLight', 0.2, 0.2, 0.2, 0.3, 0.08, 0.78, 0.3); k.box('woodDark', 0.2, 0.2, 0.2, 0.52, 0.08, 0.76, 0.9); k.box('woodLight', 0.2, 0.2, 0.2, 0.4, 0.28, 0.77, 0.1);
  s = mesh('stage2', k, dummyMat); root.add(s);
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0), empty('UIPosition', -0.2, 1, 0.3));
  return { root };
}

export function tower() {
  const root = new T.Group(); root.name = 'tower';
  const shaft = (k, r0, r1, h, y0 = 0.08) => {
    k.cyl('stone', r1, r0, h, 0, y0, 0, 10);
    for (let i = 1; i < 3; i++) k.cyl('stoneDark', r0 + (r1 - r0) * (i / 3) + 0.015, r0 + (r1 - r0) * (i / 3) + 0.015, 0.05, 0, y0 + h * i / 3, 0, 10);
  };
  const top = (k, r, y, big = 0) => {
    k.cyl('stoneDark', r + 0.1, r + 0.05, 0.1, 0, y, 0, 10);
    k.cyl('team', r + 0.11, r + 0.11, 0.07, 0, y - 0.0, 0, 10);                 // team glaze band
    k.cyl('team', r + 0.04, r + 0.04, 0.05, 0, y + 0.1, 0, 10); k.cyl('woodLight', r * 0.45, r * 0.45, 0.06, 0, y + 0.1, 0, 8); // deck
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; k.box('stoneLight', 0.16, 0.16, 0.12, Math.sin(a) * (r + 0.04), y + 0.15, Math.cos(a) * (r + 0.04), a); if (i % 2) k.cyl('team', 0.1, 0.1, 0.03, Math.sin(a) * (r + 0.14), y + 0.1, Math.cos(a) * (r + 0.14), 8, a, Math.PI / 2, 0); }
  };
  const ballista = (k, y, big = 1) => {
    k.box('woodDark', 0.3 * big, 0.08, 0.3 * big, 0, y, -0.02);
    k.box('wood', 0.1 * big, 0.1, 0.62 * big, 0, y + 0.08, 0.1);
    k.box('woodLight', 0.62 * big, 0.06, 0.07, 0, y + 0.14, 0.34 * big);
    k.box('woodLight', 0.2 * big, 0.06, 0.07, -0.37 * big, y + 0.14, 0.38 * big, 0.5); k.box('woodLight', 0.2 * big, 0.06, 0.07, 0.37 * big, y + 0.14, 0.38 * big, -0.5);
    k.box('dark', 0.74 * big, 0.015, 0.015, 0, y + 0.17, 0.25 * big);
    k.box('steelLight', 0.04, 0.04, 0.5 * big, 0, y + 0.19, 0.4 * big); k.cone('steelLight', 0.045, 0.14, 0, y + 0.19, 0.7 * big, 4, 0);
  };
  // stage0: h 1.5
  let k = new Kit();
  k.cyl('stoneDark', 0.62, 0.66, 0.08, 0, 0, 0, 10);
  shaft(k, 0.5, 0.58, 1.3); top(k, 0.5, 1.38); ballista(k, 1.5);
  k.cyl('woodDark', 0.02, 0.025, 0.7, -0.35, 1.5, -0.1, 5); k.prism('team', [[0, 0], [0.4, 0.13], [0, 0.26]], 0.03, -0.33, 2.0, -0.1, 0, 0);
  k.box('dark', 0.12, 0.3, 0.05, 0, 0.1, 0.53);
  let s = mesh('stage0', k, dummyMat); root.add(s);
  // stage1: h 2.1
  k = new Kit();
  k.cyl('stoneDark', 0.7, 0.74, 0.08, 0, 0, 0, 10);
  shaft(k, 0.5, 0.64, 1.9); top(k, 0.5, 1.98); ballista(k, 2.1, 1.12);
  k.cyl('woodDark', 0.02, 0.025, 0.7, -0.35, 2.1, -0.1, 5); k.prism('team', [[0, 0], [0.46, 0.14], [0, 0.28]], 0.03, -0.33, 2.6, -0.1, 0, 0);
  k.box('dark', 0.14, 0.34, 0.05, 0, 0.1, 0.6); k.box('woodDark', 0.1, 0.1, 0.5, 0.0, 1.1, 0.0); for (const a of [0.6, 2.2, 3.8, 5.4]) k.box('dark', 0.07, 0.2, 0.05, Math.sin(a) * 0.55, 1.2, Math.cos(a) * 0.55, a);
  s = mesh('stage1', k, dummyMat); root.add(s);
  // stage2: h 2.7 + cannon
  k = new Kit();
  k.cyl('stoneDark', 0.8, 0.84, 0.1, 0, 0, 0, 10);
  shaft(k, 0.52, 0.72, 2.45); top(k, 0.54, 2.53);
  // cannon on carriage
  k.box('woodDark', 0.4, 0.08, 0.5, 0, 2.66, -0.05); k.box('wood', 0.07, 0.16, 0.5, -0.16, 2.66, -0.02); k.box('wood', 0.07, 0.16, 0.5, 0.16, 2.66, -0.02);
  k.cyl('steelDark', 0.1, 0.13, 0.7, 0, 2.78, 0.2, 8, 0, Math.PI / 2); k.cyl('steelDark', 0.14, 0.14, 0.07, 0, 2.78, -0.15, 8, 0, Math.PI / 2); k.cyl('brass', 0.115, 0.115, 0.05, 0, 2.78, 0.55, 8, 0, Math.PI / 2);
  k.axle('woodDark', 0.12, 0.06, -0.24, 2.7, -0.02, 8); k.axle('woodDark', 0.12, 0.06, 0.24, 2.7, -0.02, 8);
  k.cyl('woodDark', 0.02, 0.025, 0.8, -0.4, 2.6, -0.2, 5); k.prism('team', [[0, 0], [0.5, 0.15], [0, 0.3]], 0.03, -0.38, 3.15, -0.2, 0, 0);
  k.cyl('woodDark', 0.02, 0.025, 0.7, 0.4, 2.6, -0.3, 5); k.prism('team', [[0, 0], [0.4, 0.12], [0, 0.24]], 0.03, 0.42, 3.05, -0.3, 0, 0);
  k.box('dark', 0.16, 0.38, 0.05, 0, 0.1, 0.66); for (const a of [0.6, 2.2, 3.8, 5.4]) { k.box('dark', 0.07, 0.22, 0.05, Math.sin(a) * 0.65, 1.2, Math.cos(a) * 0.65, a); k.box('dark', 0.07, 0.22, 0.05, Math.sin(a + 0.4) * 0.6, 2.0, Math.cos(a + 0.4) * 0.6, a + 0.4); }
  k.cyl('stoneDark', 0.7, 0.7, 0.07, 0, 1.45, 0, 10); k.cyl('team', 0.71, 0.71, 0.05, 0, 1.45, 0, 10);
  s = mesh('stage2', k, dummyMat); root.add(s);
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0), empty('UIPosition', 0, 2.24, 0), empty('BulletPosition', 0, 2.4, 0));
  return { root };
}

export function soldier(detail = 1) {
  const sg = detail ? [8, 5] : [5, 3], HIP = [0, 0.42, 0];
  const body = new Kit();
  body.frustum('cloth', 0.3, 0.2, 0.36, 0.38, 0.24, 0, 0.42);
  body.box('team', 0.26, 0.34, 0.24, 0, 0.3, 0.0);                             // tabard drape
  body.box('woodDark', 0.34, 0.05, 0.25, 0, 0.4, 0);                            // belt
  body.box('wood', 0.24, 0.26, 0.1, 0, 0.45, -0.17);                            // pack/cloak roll
  body.box('stoneDark', 0.16, 0.05, 0.16, 0, 0.7, 0);                           // collar
  body.sphere('skin', 0.1, 0, 0.89, 0.0, ...sg);
  body.sphere('steelLight', 0.125, 0, 0.9, 0, sg[0], sg[1], 1, 1.0, 1.05, true); // helm
  body.box('steel', 0.05, 0.12, 0.05, 0, 0.9, 0.12);                           // nasal
  if (detail) { body.box('team', 0.05, 0.06, 0.28, 0, 1.0, -0.02); body.box('team', 0.04, 0.12, 0.04, 0, 1.03, -0.08); }
  const arm = () => { const k = new Kit(); k.box('cloth', 0.09, 0.26, 0.1, 0, -0.26, 0); k.box('skin', 0.075, 0.07, 0.08, 0, -0.33, 0); return k; };
  const armL = arm(); // shield arm
  armL.cyl('steelLight', 0.2, 0.2, 0.05, 0.06, -0.3, 0.1, detail ? 10 : 8, 0, Math.PI / 2, 0);
  armL.cyl('team', 0.17, 0.17, 0.03, 0.06, -0.3, 0.13, detail ? 10 : 8, 0, Math.PI / 2, 0);
  armL.cone('steel', 0.06, 0.06, 0.06, -0.3, 0.16, 6);
  const armR = arm(); // spear
  armR.cyl('wood', 0.018, 0.018, 1.0, 0, -0.34, 0.12, 4, 0, Math.PI / 2 - 0.35);
  armR.cone('steelLight', 0.035, 0.12, 0, -0.15, 0.63, 4);
  const leg = () => { const k = new Kit(); k.box('woodDark', 0.12, 0.34, 0.13, 0, -0.34, 0); k.box('black', 0.13, 0.09, 0.18, 0, -0.42, 0.03); return k; };
  const parts = [
    { name: 'body', kit: body, pivot: HIP }, { name: 'armL', kit: armL, pivot: [0.22, 0.8, 0], local: true }, { name: 'armR', kit: armR, pivot: [-0.22, 0.8, 0], local: true },
    { name: 'legL', kit: leg(), pivot: [0.09, 0.42, 0], local: true }, { name: 'legR', kit: leg(), pivot: [-0.09, 0.42, 0], local: true },
  ];
  const g = rig('soldier', parts);
  const D = 0.55, times = [0, D / 4, D / 2, 3 * D / 4, D];
  const swing = (amp, shift, off = 0) => [0, 1, 2, 3, 4].map(i => Q(off + amp * Math.sin(((i + shift) / 4) * Math.PI * 2)));
  const run = new T.AnimationClip('Run', D, [
    qTrack('legL', times, swing(0.7, 0)), qTrack('legR', times, swing(0.7, 2)),
    qTrack('armL', times, swing(0.25, 2)), qTrack('armR', times, swing(0.3, 0, -0.1)),
    qTrack('body', times, swing(0.03, 1, 0.1)),
    pTrack('body', times, [0, 1, 2, 3, 4].map(i => [0, HIP[1] + 0.035 * Math.abs(Math.sin(i / 4 * Math.PI * 2)), 0])),
  ]);
  const flail = { armL: k => -1.0 * Math.sin(k * 3), armR: k => 1.2 * Math.sin(k * 2.5), legL: k => 0.5 * k, legR: k => -0.3 * k };
  const death = deathClip(parts.map(p => ({ name: p.name, pivot: p.pivot, flail: flail[p.name] })), HIP, { dur: 0.7, ang: -1.45, drop: 0.3 });
  return { root: g, animations: [run, death] };
}

export function tank() {
  const hull = new Kit(), wheels = ['wheelFL', 'wheelFR', 'wheelBL', 'wheelBR'];
  hull.box('woodDark', 0.56, 0.1, 1.0, 0, 0.14, 0);                                  // chassis
  hull.box('wood', 0.62, 0.3, 0.9, 0, 0.2, -0.04);                                 // plank box
  for (const sz of [-1, 1]) for (let i = 0; i < 3; i++) hull.box('steelDark', 0.64, 0.04, 0.06, 0, 0.26 + i * 0.1, -0.04 + sz * 0.28 * 0 + (i - 1) * 0.3); // iron straps
  hull.gable('team', 0.74, 0.3, 0.86, 0, 0.5, -0.04);                              // canvas/armoured roof
  hull.box('woodDark', 0.03, 0.04, 0.9, 0, 0.78, -0.04);
  for (const sx of [-1, 1]) hull.box('steel', 0.04, 0.2, 0.7, sx * 0.34, 0.3, -0.04);   // iron plates (side armour)
  hull.prism('steelDark', [[-0.31, 0], [0.31, 0], [0, 0.18]], 0.1, 0, 0.2, 0.52);          // prow wedge top
  hull.box('steelDark', 0.4, 0.22, 0.14, 0, 0.14, 0.52); hull.cone('steelLight', 0.07, 0.3, 0, 0.18, 0.74, 4);
  hull.box('woodLight', 0.5, 0.05, 0.05, 0, 0.14, -0.55); hull.cyl('woodDark', 0.03, 0.03, 0.22, 0, 0.5, -0.05, 4);
  const mkW = () => { const k = new Kit(); k.axle('woodDark', 0.17, 0.1, 0, 0, 0, 8); k.axle('steelLight', 0.07, 0.13, 0, 0, 0, 6); k.axle('woodLight', 0.12, 0.11, 0, 0, 0, 8); return k; };
  const pos = { wheelFL: [0.36, 0.17, 0.33], wheelFR: [-0.36, 0.17, 0.33], wheelBL: [0.36, 0.17, -0.38], wheelBR: [-0.36, 0.17, -0.38] };
  const parts = [{ name: 'hull', kit: hull, pivot: [0, 0, 0] }, ...wheels.map(n => ({ name: n, kit: mkW(), pivot: pos[n], local: true }))];
  const g = rig('tank', parts);
  const D = 0.6, n = 8, times = Array.from({ length: n + 1 }, (_, i) => i * D / n);
  const spin = Array.from({ length: n + 1 }, (_, i) => Q(i / n * Math.PI * 2));
  const run = new T.AnimationClip('Run', D, [
    ...wheels.map(w => qTrack(w, times, spin)),
    pTrack('hull', times, times.map((_, i) => [0, 0.014 * Math.abs(Math.sin(i / n * Math.PI * 2)), 0])),
    qTrack('hull', times, times.map((_, i) => Q(0.01 * Math.sin(i / n * Math.PI * 4)))),
  ]);
  const death = deathClip(parts.map(p => ({ name: p.name, pivot: p.pivot, flail: p.name === 'hull' ? undefined : k => 2 * k })), [0, 0.2, 0], { dur: 0.8, ang: 0.55, drop: 0.12, axis: 'z' });
  return { root: g, animations: [run, death] };
}
