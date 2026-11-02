// Set FUTURE "Orbital Foundry" - gunmetal armour, cyan emissive seams, team colour on glow rings/panels/nose cones.
import { Kit, T, mesh, empty, dummyMat, rig, Q, qTrack, pTrack, deathClip } from './lib.mjs';

// [hex, mask(255 = team tinted), glow 0..1 (alpha channel -> emissive in art.ts)]
export const SWATCHES = {
  team: [0xF4F4F4, 255, 0], teamGlow: [0xF4F4F4, 255, 1], teamDark: [0xBDBDBD, 255, 0], teamSoft: [0xDADADA, 255, 0.3],
  hullLight: [0xA6B3C4, 0, 0], hullMid: [0x66748A, 0, 0], hullDark: [0x3A4455, 0, 0], gun: [0x2A313B, 0, 0], black: [0x12161C, 0, 0], navy: [0x1B2638, 0, 0],
  cyan: [0x3FE6FF, 0, 1], cyanDim: [0x1E98B5, 0, 0.55], white: [0xEAFBFF, 0, 1], amber: [0xFFB347, 0, 1], glass: [0x5FA8C8, 0, 0.3], visor: [0x2BD9F5, 0, 1],
  crystal: [0x7FE9FF, 0, 0.9], crystalDark: [0x2F9FC4, 0, 0.5], violet: [0xA284FF, 0, 0.85], violetDark: [0x5B45B8, 0, 0.4],
  cont1: [0xB5543C, 0, 0], cont2: [0x3C6E8F, 0, 0], cont3: [0xD0A33A, 0, 0], contDark: [0x2C3440, 0, 0],
  ice: [0xB9D6E6, 0, 0], iceDark: [0x6F95AD, 0, 0], sand: [0xA68D68, 0, 0], hazard: [0xE0B53A, 0, 0],
};
export const LABEL = { barracks: 1.7, factory: 1.5, tower: 2.0 };
const HEX = 6;

export function barracks() {
  const root = new T.Group(); root.name = 'barracks';
  const pad = (k, r) => {
    k.cyl('gun', r, r + 0.04, 0.08, 0, 0, 0, HEX);
    k.cyl('teamGlow', r - 0.04, r - 0.04, 0.045, 0, 0.08, 0, HEX);        // glowing hex rim
    k.cyl('teamSoft', r - 0.1, r - 0.1, 0.06, 0, 0.085, 0, HEX);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; k.box('cyan', 0.07, 0.03, 0.07, Math.sin(a) * (r - 0.18), 0.145, Math.cos(a) * (r - 0.18), a); }
  };
  const dome = (k, r, y) => {
    k.cyl('hullMid', r + 0.04, r + 0.07, 0.07, 0, y, 0, 10);
    k.sphere('glass', r, 0, y + 0.07, 0, 10, 4, 1, 0.95, 1, true);
    k.sphere('cyan', r * 0.3, 0, y + 0.12, 0, 6, 4);
    k.torus('hullLight', r * 0.9, 0.018, 0, y + 0.07 + r * 0.38, 0, 3, 12, Math.PI / 2);
  };
  const antenna = (k, x, z, h) => {
    k.cyl('hullMid', 0.014, 0.022, h, x, 0.14, z, 5); k.sphere('white', 0.04, x, 0.14 + h, z, 5, 3);
    k.box('hullLight', 0.16, 0.012, 0.012, x, 0.14 + h * 0.66, z); k.box('cyan', 0.03, 0.03, 0.03, x + 0.08, 0.14 + h * 0.66 - 0.01, z); k.box('cyan', 0.03, 0.03, 0.03, x - 0.08, 0.14 + h * 0.66 - 0.01, z);
  };
  const pod = (k, x, z, h = 0.42) => {
    k.box('gun', 0.26, 0.05, 0.26, x, 0.14, z);
    k.cyl('hullLight', 0.115, 0.14, h, x, 0.19, z, 6); k.cyl('teamGlow', 0.122, 0.122, 0.05, x, 0.19 + h * 0.55, z, 6);
    k.cone('team', 0.115, 0.2, x, 0.19 + h, z, 6); k.box('cyan', 0.05, 0.12, 0.02, x, 0.25, z + 0.13);
  };
  let k = new Kit(); pad(k, 0.78); dome(k, 0.4, 0.145); antenna(k, 0.46, -0.4, 0.6);
  k.box('hullDark', 0.3, 0.14, 0.18, -0.4, 0.145, -0.38); k.box('cyan', 0.2, 0.02, 0.02, -0.4, 0.22, -0.285); k.box('team', 0.34, 0.03, 0.22, -0.4, 0.285, -0.38);
  root.add(mesh('stage0', k, dummyMat));
  k = new Kit(); pad(k, 0.84); dome(k, 0.44, 0.145); antenna(k, 0.5, -0.42, 0.75); antenna(k, -0.5, -0.42, 0.55);
  pod(k, -0.5, 0.2); pod(k, 0.5, 0.2);
  k.box('hullDark', 0.4, 0.16, 0.2, 0, 0.145, -0.5); k.box('team', 0.44, 0.03, 0.24, 0, 0.305, -0.5); k.box('cyan', 0.3, 0.02, 0.02, 0, 0.22, -0.395);
  root.add(mesh('stage1', k, dummyMat));
  k = new Kit(); pad(k, 0.9); dome(k, 0.5, 0.145); antenna(k, 0.55, -0.45, 0.95); antenna(k, -0.55, -0.45, 0.7);
  pod(k, -0.55, 0.28, 0.5); pod(k, 0.55, 0.28, 0.5);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, x = Math.sin(a) * 0.82, z = Math.cos(a) * 0.82; k.cyl('hullMid', 0.025, 0.035, 0.95, x, 0.1, z, 4); k.box('white', 0.06, 0.06, 0.06, x, 1.03, z); }
  k.torus('cyan', 0.82, 0.02, 0, 0.95, 0, 3, 24, Math.PI / 2);                    // energy shield ring
  k.torus('teamGlow', 0.8, 0.028, 0, 0.55, 0, 3, 24, Math.PI / 2);
  root.add(mesh('stage2', k, dummyMat));
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0), empty('UIPosition', 0, 1.6, 0));
  return { root };
}

export function factory() {
  const root = new T.Group(); root.name = 'factory';
  const base = (k, w, d) => {
    k.box('gun', w + 0.1, 0.08, d + 0.1, 0, 0, 0);
    k.box('teamSoft', w, 0.06, d, 0, 0.08, 0);
    k.box('teamGlow', w + 0.02, 0.03, 0.03, 0, 0.1, d / 2 + 0.05); k.box('teamGlow', w + 0.02, 0.03, 0.03, 0, 0.1, -d / 2 - 0.05);
    k.box('hazard', 0.18, 0.02, 0.05, w / 2 - 0.15, 0.14, d / 2 - 0.06); k.box('hazard', 0.18, 0.02, 0.05, -w / 2 + 0.15, 0.14, d / 2 - 0.06);
  };
  const core = (k, r, h, rings = 1, y0 = 0.14) => {
    k.cyl('hullMid', r + 0.04, r + 0.07, 0.1, 0, y0, 0, 12);
    k.cyl('hullLight', r, r + 0.02, h, 0, y0 + 0.1, 0, 12);
    for (let i = 0; i < rings; i++) k.cyl('teamGlow', r + 0.035, r + 0.035, 0.065, 0, y0 + 0.1 + h * (0.35 + 0.35 * i), 0, 12);
    k.cyl('cyan', r * 0.72, r * 0.72, 0.05, 0, y0 + 0.1 + h, 0, 12);                      // reactor lid glow
    k.cyl('hullDark', r * 0.35, r * 0.4, 0.14, 0, y0 + 0.15 + h, 0, 8);
    k.sphere('white', r * 0.24, 0, y0 + 0.29 + h, 0, 6, 4);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.2; k.box('hullDark', 0.05, h * 0.8, 0.16, Math.sin(a) * (r + 0.1), y0 + 0.12, Math.cos(a) * (r + 0.1), a); } // cooling fins
  };
  const tower = (k, x, z, h) => { k.box('hullMid', 0.3, h, 0.3, x, 0.14, z); k.box('cyan', 0.05, h * 0.7, 0.02, x - 0.08, 0.2, z + 0.16); k.box('cyan', 0.05, h * 0.7, 0.02, x + 0.08, 0.2, z + 0.16); k.box('team', 0.34, 0.05, 0.34, x, 0.14 + h, z); k.box('gun', 0.18, 0.06, 0.18, x, 0.19 + h, z); };
  const arm = (k, x, z, s = 1) => {
    k.cyl('gun', 0.1, 0.12, 0.1, x, 0.14, z, 8); k.cyl('hullLight', 0.05, 0.06, 0.45, x, 0.24, z, 6);
    k.sphere('cyan', 0.06, x, 0.7, z, 6, 4); k.link('hullLight', [x, 0.7, z], [x * 0.35, 0.96, z * 0.35], 0.04, 6);
    k.sphere('cyan', 0.05, x * 0.35, 0.96, z * 0.35, 6, 4); k.link('hullMid', [x * 0.35, 0.96, z * 0.35], [x * 0.05, 0.62, z * 0.05 + 0.05 * Math.sign(z || 1)], 0.03, 5); k.cone('teamGlow', 0.04, 0.1, x * 0.05, 0.5, z * 0.05 + 0.05 * Math.sign(z || 1), 5);
  };
  let k = new Kit(); base(k, 1.15, 1.0); core(k, 0.3, 0.5, 1);
  k.box('hullMid', 0.3, 0.18, 0.26, -0.4, 0.14, -0.28); k.box('cyan', 0.18, 0.03, 0.02, -0.4, 0.22, -0.145); k.link('cyan', [-0.28, 0.3, -0.28], [-0.18, 0.5, -0.1], 0.02, 4);
  k.box('hullMid', 0.24, 0.12, 0.3, 0.42, 0.14, 0.3); k.box('team', 0.26, 0.03, 0.32, 0.42, 0.26, 0.3);
  root.add(mesh('stage0', k, dummyMat));
  k = new Kit(); base(k, 1.3, 1.05); core(k, 0.33, 0.65, 2); tower(k, -0.5, -0.32, 0.55); tower(k, 0.5, -0.32, 0.4);
  k.link('cyan', [-0.42, 0.55, -0.3], [-0.2, 0.6, -0.1], 0.025, 4); k.link('cyan', [0.42, 0.45, -0.3], [0.2, 0.6, -0.1], 0.025, 4);
  k.box('hullMid', 0.3, 0.14, 0.34, 0.45, 0.14, 0.32); k.box('team', 0.32, 0.03, 0.36, 0.45, 0.28, 0.32); k.box('cyan', 0.2, 0.02, 0.02, 0.45, 0.2, 0.495);
  root.add(mesh('stage1', k, dummyMat));
  k = new Kit(); base(k, 1.45, 1.1); core(k, 0.36, 0.8, 3); tower(k, -0.58, -0.34, 0.8); tower(k, 0.58, -0.34, 0.6);
  arm(k, -0.55, 0.3); arm(k, 0.55, 0.3);
  k.cyl('hullMid', 0.07, 0.09, 0.9, 0.02, 0.14, -0.42, 8); k.cyl('amber', 0.075, 0.075, 0.05, 0.02, 1.04, -0.42, 8); k.cyl('hullDark', 0.1, 0.1, 0.04, 0.02, 0.8, -0.42, 8); k.cyl('teamGlow', 0.1, 0.1, 0.04, 0.02, 0.6, -0.42, 8);
  k.link('cyan', [-0.5, 0.6, -0.34], [-0.2, 0.7, -0.15], 0.025, 4); k.link('cyan', [0.5, 0.5, -0.34], [0.2, 0.7, -0.15], 0.025, 4);
  root.add(mesh('stage2', k, dummyMat));
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0), empty('UIPosition', 0, 1.2, 0.2));
  return { root };
}

export function tower() {
  const root = new T.Group(); root.name = 'tower';
  const pylon = (k, h) => {
    k.cyl('gun', 0.52, 0.56, 0.08, 0, 0, 0, HEX); k.cyl('teamGlow', 0.46, 0.46, 0.04, 0, 0.08, 0, HEX); k.cyl('teamSoft', 0.4, 0.4, 0.06, 0, 0.1, 0, HEX);
    k.cyl('hullMid', 0.13, 0.22, h, 0, 0.14, 0, 8);
    for (let i = 0; i < 4; i++) { const t = (i + 0.7) / 4.4, r = 0.22 + (0.13 - 0.22) * t + 0.045; k.cyl('teamGlow', r, r, 0.045, 0, 0.14 + h * t, 0, 8); } // energy coil
    k.box('cyan', 0.03, h * 0.7, 0.03, 0, 0.22, 0.2);
  };
  const head = (k, y, twin = false, long = 0.5) => {
    k.cyl('hullDark', 0.19, 0.17, 0.08, 0, y, 0, 8);
    k.frustum('hullLight', 0.38, 0.34, 0.2, 0.3, 0.26, 0, y + 0.08, -0.02);
    k.box('team', 0.2, 0.03, 0.2, 0, y + 0.28, -0.04);
    const bar = x => { k.cyl('gun', 0.04, 0.05, long, x, y + 0.26 - long / 2 + 0.2, 0.08, 6, 0, Math.PI / 2); k.cyl('cyan', 0.052, 0.052, 0.06, x, y + 0.16 + 0.2 - 0.03, 0.08 + long / 2 - 0.02, 6, 0, Math.PI / 2); k.cyl('teamGlow', 0.058, 0.058, 0.04, x, y + 0.23, 0.18, 6, 0, Math.PI / 2); };
    if (twin) { bar(-0.09); bar(0.09); } else bar(0);
    k.box('visor', 0.16, 0.025, 0.02, 0, y + 0.2, 0.19);
  };
  const dish = (k, y) => {
    k.cyl('hullLight', 0.3, 0.05, 0.1, -0.02, y, -0.24, 10, 0, 0.5); k.cyl('cyan', 0.24, 0.04, 0.03, -0.02, y + 0.07, -0.26, 10, 0, 0.5);
    k.cyl('hullMid', 0.02, 0.02, 0.2, -0.02, y - 0.16, -0.22, 4); k.sphere('white', 0.04, -0.02, y + 0.14, -0.3, 5, 3);
  };
  let k = new Kit(); pylon(k, 0.85); head(k, 0.95);
  root.add(mesh('stage0', k, dummyMat));
  k = new Kit(); pylon(k, 1.0); head(k, 1.1, true, 0.6); k.torus('cyan', 0.34, 0.016, 0, 1.0, 0, 3, 20, Math.PI / 2);
  root.add(mesh('stage1', k, dummyMat));
  k = new Kit(); pylon(k, 1.15); head(k, 1.25, true, 0.7); dish(k, 1.46); k.torus('cyan', 0.38, 0.018, 0, 0.7, 0, 3, 24, Math.PI / 2); k.torus('teamGlow', 0.4, 0.02, 0, 1.15, 0, 3, 24, Math.PI / 2);
  for (const sx of [-1, 1]) { k.cyl('hullMid', 0.02, 0.025, 0.5, sx * 0.4, 0.14, 0.15, 5); k.sphere('white', 0.04, sx * 0.4, 0.66, 0.15, 5, 3); }
  root.add(mesh('stage2', k, dummyMat));
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0), empty('UIPosition', 0, 1.7, 0), empty('BulletPosition', 0, 1.35, 0.55));
  return { root };
}

export function soldier(detail = 1) {
  const sg = detail ? [8, 5] : [5, 3], HIP = [0, 0.42, 0];
  const body = new Kit();
  body.frustum('hullLight', 0.3, 0.2, 0.36, 0.4, 0.26, 0, 0.42);
  body.box('team', 0.22, 0.17, 0.05, 0, 0.6, 0.14);                                 // chest plate
  body.box('team', 0.11, 0.07, 0.15, 0.22, 0.76, 0), body.box('team', 0.11, 0.07, 0.15, -0.22, 0.76, 0); // shoulder pads
  body.box('gun', 0.34, 0.05, 0.24, 0, 0.4, 0);
  body.box('hullDark', 0.22, 0.28, 0.12, 0, 0.45, -0.17); body.box('cyan', 0.03, 0.2, 0.02, 0, 0.5, -0.235); // pack + energy cell
  body.box('gun', 0.16, 0.05, 0.16, 0, 0.74, 0);
  body.sphere('hullMid', 0.125, 0, 0.88, 0, sg[0], sg[1], 1, 1, 1.05);
  body.box('visor', 0.17, 0.06, 0.06, 0, 0.9, 0.1);                              // glowing visor
  if (detail) body.box('team', 0.04, 0.05, 0.22, 0, 1.0, -0.02);
  const arm = () => { const k = new Kit(); k.box('hullMid', 0.09, 0.26, 0.1, 0, -0.26, 0); k.box('gun', 0.075, 0.07, 0.08, 0, -0.33, 0); return k; };
  const armL = arm();
  const armR = arm();
  armR.box('gun', 0.06, 0.08, 0.5, 0, -0.34, 0.22); armR.box('cyan', 0.05, 0.05, 0.06, 0, -0.335, 0.5); armR.box('teamGlow', 0.065, 0.03, 0.14, 0, -0.29, 0.2);
  const leg = () => { const k = new Kit(); k.box('hullDark', 0.12, 0.34, 0.13, 0, -0.34, 0); k.box('gun', 0.13, 0.09, 0.18, 0, -0.42, 0.03); k.box('cyan', 0.02, 0.1, 0.02, 0.065, -0.28, 0.0); return k; };
  const parts = [
    { name: 'body', kit: body, pivot: HIP }, { name: 'armL', kit: armL, pivot: [0.22, 0.8, 0], local: true }, { name: 'armR', kit: armR, pivot: [-0.22, 0.8, 0], local: true },
    { name: 'legL', kit: leg(), pivot: [0.09, 0.42, 0], local: true }, { name: 'legR', kit: leg(), pivot: [-0.09, 0.42, 0], local: true },
  ];
  const g = rig('soldier', parts);
  const D = 0.55, times = [0, D / 4, D / 2, 3 * D / 4, D];
  const swing = (amp, shift, off = 0) => [0, 1, 2, 3, 4].map(i => Q(off + amp * Math.sin(((i + shift) / 4) * Math.PI * 2)));
  const run = new T.AnimationClip('Run', D, [
    qTrack('legL', times, swing(0.7, 0)), qTrack('legR', times, swing(0.7, 2)),
    qTrack('armL', times, swing(0.25, 2)), qTrack('armR', times, swing(0.15, 0, -0.5)),
    qTrack('body', times, swing(0.03, 1, 0.1)),
    pTrack('body', times, [0, 1, 2, 3, 4].map(i => [0, HIP[1] + 0.035 * Math.abs(Math.sin(i / 4 * Math.PI * 2)), 0])),
  ]);
  const flail = { armL: k => -1.0 * Math.sin(k * 3), armR: k => 1.2 * Math.sin(k * 2.5), legL: k => 0.5 * k, legR: k => -0.3 * k };
  const death = deathClip(parts.map(p => ({ name: p.name, pivot: p.pivot, flail: flail[p.name] })), HIP, { dur: 0.7, ang: -1.45, drop: 0.3 });
  return { root: g, animations: [run, death] };
}

export function tank() {
  const hull = new Kit(), pads = ['padFL', 'padFR', 'padBL', 'padBR'];
  hull.box('gun', 0.62, 0.1, 0.98, 0, 0.1, 0);                                              // skirt
  hull.side('hullLight', [[-0.5, 0], [0.5, 0], [0.5, 0.08], [0.22, 0.26], [-0.34, 0.26], [-0.5, 0.18]], 0.56, 0, 0.18, 0); // hull profile
  hull.box('team', 0.4, 0.02, 0.3, 0, 0.44, -0.2);                                        // deck panel
  for (const sx of [-1, 1]) { hull.box('teamGlow', 0.04, 0.04, 0.8, sx * 0.31, 0.24, 0.0); hull.box('hullDark', 0.1, 0.1, 0.5, sx * 0.34, 0.14, 0.0); }
  hull.box('cyan', 0.34, 0.025, 0.03, 0, 0.3, 0.52); hull.box('visor', 0.12, 0.04, 0.03, 0, 0.36, 0.34);
  for (const sx of [-1, 1]) { hull.cyl('gun', 0.07, 0.08, 0.16, sx * 0.18, 0.3, -0.56, 8, 0, Math.PI / 2); hull.cyl('cyan', 0.01, 0.06, 0.14, sx * 0.18, 0.3, -0.69, 8, 0, -Math.PI / 2); } // thrusters
  const tur = new Kit();
  tur.cyl('gun', 0.2, 0.22, 0.06, 0, 0, 0, 8); tur.sphere('hullMid', 0.19, 0, 0.06, 0, 8, 4, 1, 0.8, 1.1, true);
  tur.cyl('gun', 0.045, 0.055, 0.5, 0, 0.12, 0.3, 6, 0, Math.PI / 2); tur.cyl('teamGlow', 0.065, 0.065, 0.05, 0, 0.15, 0.2, 6, 0, Math.PI / 2); tur.cyl('cyan', 0.06, 0.06, 0.07, 0, 0.15, 0.56, 6, 0, Math.PI / 2);
  tur.box('visor', 0.12, 0.03, 0.03, 0, 0.14, 0.18); tur.box('team', 0.14, 0.02, 0.2, 0, 0.215, -0.04);
  const pad = () => { const k = new Kit(); k.cyl('hullDark', 0.13, 0.14, 0.04, 0, -0.02, 0, 8); k.cyl('cyan', 0.115, 0.115, 0.025, 0, -0.035, 0, 8); k.box('white', 0.04, 0.03, 0.05, 0.12, -0.02, 0); k.box('white', 0.04, 0.03, 0.05, -0.12, -0.02, 0); return k; };
  const pos = { padFL: [0.3, 0.09, 0.36], padFR: [-0.3, 0.09, 0.36], padBL: [0.3, 0.09, -0.32], padBR: [-0.3, 0.09, -0.32] };
  const parts = [{ name: 'hull', kit: hull, pivot: [0, 0, 0] }, { name: 'turret', kit: tur, pivot: [0, 0.46, -0.04], local: true }, ...pads.map(n => ({ name: n, kit: pad(), pivot: pos[n], local: true }))];
  const g = rig('tank', parts);
  const D = 0.6, n = 8, times = Array.from({ length: n + 1 }, (_, i) => i * D / n);
  const spin = Array.from({ length: n + 1 }, (_, i) => Q(0, i / n * Math.PI * 2, 0));
  const run = new T.AnimationClip('Run', D, [
    ...pads.map(w => qTrack(w, times, spin)),
    pTrack('hull', times, times.map((_, i) => [0, 0.02 * Math.sin(i / n * Math.PI * 2), 0])),
    qTrack('hull', times, times.map((_, i) => Q(0.012 * Math.sin(i / n * Math.PI * 2), 0, 0.01 * Math.sin(i / n * Math.PI * 4)))),
    qTrack('turret', times, times.map((_, i) => Q(0, 0.12 * Math.sin(i / n * Math.PI * 2), 0))),
    pTrack('turret', times, times.map((_, i) => [0, 0.46 + 0.02 * Math.sin(i / n * Math.PI * 2), -0.04])),
  ]);
  const death = deathClip(parts.map(p => ({ name: p.name, pivot: p.pivot, flail: p.name === 'hull' ? undefined : k => 2 * k })), [0, 0.2, 0], { dur: 0.8, ang: 0.55, drop: 0.12, axis: 'z' });
  return { root: g, animations: [run, death] };
}

export function projectile() {
  const root = new T.Group(); root.name = 'projectile';
  const k = new Kit();
  k.ellip('teamGlow', 0.1, 0.1, 0.26, 0, 0, 0.0, 10, 6); k.ellip('white', 0.055, 0.055, 0.27, 0, 0, 0.04, 8, 5);
  k.cyl('teamGlow', 0.0, 0.085, 0.38, 0, 0, -0.45, 8, 0, -Math.PI / 2);  // trailing taper (wide end toward bolt)
  const m = mesh('projectile_bolt', k, dummyMat); root.add(m); root.add(empty('Trail', 0, 0, -0.1));
  return { root };
}

/** Obstacle GLB (small + big meshes). theme 'green' = deck props (containers, mast); 'snow' = crystals. */
export function obstacles(theme) {
  const root = new T.Group(); root.name = 'obstacle-' + theme;
  const small = new Kit(), big = new Kit();
  if (theme === 'green') {
    // small: cargo container (stack of 1) with team-less accent
    small.box('contDark', 0.5, 0.05, 0.3, 0, 0.08, 0, 0.2); small.box('cont2', 0.46, 0.34, 0.26, 0, 0.13, 0, 0.2); small.box('contDark', 0.5, 0.03, 0.3, 0, 0.47, 0, 0.2);
    small.box('cyan', 0.03, 0.2, 0.02, 0.14, 0.2, 0.14, 0.2); small.box('hazard', 0.4, 0.02, 0.02, 0, 0.3, 0.14, 0.2);
    // big: antenna mast on a base with holo ring
    big.cyl('contDark', 0.3, 0.33, 0.1, 0, 0.08, 0, 8); big.cyl('hullDark', 0.22, 0.26, 0.2, 0, 0.18, 0, 8);
    big.box('cont1', 0.4, 0.3, 0.3, 0.0, 0.38, 0, 0.5); big.cyl('hullMid', 0.03, 0.05, 0.75, 0, 0.68, 0, 6);
    big.box('hullLight', 0.34, 0.025, 0.025, 0, 1.2, 0); big.box('hullLight', 0.025, 0.025, 0.28, 0, 1.0, 0); big.sphere('white', 0.05, 0, 1.43, 0, 6, 4);
    big.torus('cyan', 0.19, 0.012, 0, 0.95, 0, 3, 16, Math.PI / 2); big.box('cyan', 0.03, 0.15, 0.02, 0.0, 0.42, 0.16);
  } else {
    const shard = (k, x, z, h, r, tilt, sw = 'crystal', sw2 = 'crystalDark', ry = 0) => {
      k.cyl(sw2, r * 0.95, r, h * 0.55, x, 0.1, z, 5, ry, tilt, tilt * 0.6); k.cyl(sw, 0.0, r * 0.95, h * 0.45, x + Math.sin(tilt) * h * 0.55 * 0.5, 0.1 + h * 0.55 * 0.97, z, 5, ry, tilt, tilt * 0.6);
    };
    small.cyl('iceDark', 0.26, 0.3, 0.1, 0, 0.0, 0, 7); shard(small, 0, 0, 0.5, 0.1, 0.0); shard(small, 0.14, 0.06, 0.35, 0.07, 0.25, 'violet', 'violetDark'); shard(small, -0.12, -0.08, 0.3, 0.07, -0.3);
    big.cyl('iceDark', 0.34, 0.38, 0.12, 0, 0.0, 0, 7); big.cyl('cyanDim', 0.32, 0.32, 0.02, 0, 0.12, 0, 7);
    shard(big, 0, 0, 1.0, 0.15, 0.0); shard(big, 0.2, 0.1, 0.65, 0.1, 0.3); shard(big, -0.18, -0.1, 0.7, 0.1, -0.28, 'violet', 'violetDark'); shard(big, 0.05, -0.22, 0.4, 0.08, 0.2); shard(big, -0.22, 0.16, 0.38, 0.07, -0.35);
  }
  const grp = new T.Group(); grp.name = 'obstacle-' + theme + '_1'; root.add(grp);
  const a = mesh('small', small, dummyMat), b = mesh('big', big, dummyMat); grp.add(a, b);
  return { root, grp, tris: { small: small.tris(), big: big.tris() } };
}

export function ground(theme, tex) {
  const root = new T.Group(); root.name = 'ground-' + theme;
  const node = new T.Object3D(); node.name = `ground-${theme}_1`;
  node.userData = { name: `ground-${theme}`, family: 'ground', theme, texture: tex, wrap: 'repeat', meshSize: 10, uvRepeat: [3, 5], uvOffset: [0, 0], source: 'scratch future' };
  const g = new T.PlaneGeometry(10, 10, 1, 1); g.rotateX(-Math.PI / 2);
  const m = new T.Mesh(g, dummyMat); m.name = 'ground'; m.scale.set(6, 1, 10); m.userData = { name: 'ground', prefabWorldPos: [0, 0, 0] };
  node.add(m); root.add(node);
  return { root, ground: true };
}
