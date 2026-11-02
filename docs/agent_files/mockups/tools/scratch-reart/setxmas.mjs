// Set XMAS "Candy Cane Lane" - gingerbread barracks, Santa's workshop, nutcracker/candy-cane towers, toy-train tank; team colour on roofs/coats/ribbons.
import { Kit, T, mesh, empty, dummyMat, rig, Q, qTrack, pTrack, deathClip } from './lib.mjs';

// [hex, mask(255 = team tinted), glow 0..1 (alpha -> emissive)]
export const SWATCHES = {
  team: [0xF4F4F4, 255, 0], teamDark: [0xBDBDBD, 255, 0], teamLight: [0xFFFFFF, 255, 0], teamGlow: [0xF4F4F4, 255, 0.35],
  snow: [0xF4F8FD, 0, 0], snowShade: [0xC3D4E8, 0, 0], icing: [0xFFF8EE, 0, 0], cream: [0xEFDDBB, 0, 0],
  ginger: [0xBF7A3F, 0, 0], gingerDark: [0x8A5530, 0, 0], gingerLight: [0xDDA163, 0, 0], choc: [0x4E2F1E, 0, 0],
  brick: [0xA64B37, 0, 0], brickDark: [0x6E3226, 0, 0],
  candyRed: [0xD8343C, 0, 0], candyWhite: [0xF7F1EA, 0, 0],
  pine: [0x2E6B46, 0, 0], pineDark: [0x1E4A33, 0, 0], pineLight: [0x4D9060, 0, 0],
  gold: [0xF0BE45, 0, 0.2], silver: [0xB9C5D2, 0, 0],
  win: [0xFFC76B, 0, 1], lRed: [0xFF4B4B, 0, 1], lGreen: [0x62F28F, 0, 1], lBlue: [0x5DB8FF, 0, 1], lYel: [0xFFE27A, 0, 1],
  gumRed: [0xE24A5A, 0, 0], gumGreen: [0x4FB86B, 0, 0], gumBlue: [0x4D86E0, 0, 0], gumYel: [0xF2C94C, 0, 0], gumPurple: [0x9A63D4, 0, 0],
  skin: [0xEFC29C, 0, 0], coal: [0x25262B, 0, 0], wood: [0x8A5A38, 0, 0], woodDark: [0x5A3A24, 0, 0], steel: [0x6C7683, 0, 0],
  smoke: [0xE3E6EA, 0, 0], ice: [0xA5D5EE, 0, 0], iceDark: [0x5F9FC8, 0, 0], iceLight: [0xD6EEFA, 0, 0.15],
  bauRed: [0xC9303A, 0, 0.25], bauBlue: [0x3F6FD0, 0, 0.25], bauGold: [0xF2C14E, 0, 0.35],
  gRed: [0xC8323B, 0, 0], gGreen: [0x2E8B57, 0, 0], gBlue: [0x3A74C8, 0, 0], gPurple: [0x8A55C4, 0, 0], gGold: [0xE3B23C, 0, 0],
  carrot: [0xF28A2E, 0, 0],
};
export const LABEL = { barracks: 1.8, factory: 1.5, tower: 2.1 };
const LIGHTS = ['lRed', 'lGreen', 'lYel', 'lBlue'];
const GIFT = ['gRed', 'gGreen', 'gBlue', 'gPurple', 'gGold'];

// ---- shared helpers (k = Kit; y = bottom for boxes/cyls)
const pad = (k, r, seg = 8) => { k.cyl('snowShade', r + 0.05, r + 0.07, 0.05, 0, 0, 0, seg); k.cyl('snow', r, r + 0.04, 0.09, 0, 0.04, 0, seg); };
/** sloped roof with team colour showing and a snow ridge cap. ridge along X (gableX) or Z. */
const roof = (k, w, h, len, x, y, z, alongX = true, sw = 'team') => {
  const g = alongX ? 'gableX' : 'gable';
  k[g](sw, w, h, len, x, y, z);
  const y0 = h * 0.62, b = (w / 2) * (1 - y0 / h) + 0.025;
  const pts = [[-b, y0 - 0.02], [b, y0 - 0.02], [0, h + 0.035]];
  k.prism('snow', pts, len + 0.06, x, y, z, alongX ? Math.PI / 2 : 0);
  // icing eave strips
  if (alongX) { k.box('icing', len + 0.06, 0.035, 0.05, x, y - 0.01, z + w / 2); k.box('icing', len + 0.06, 0.035, 0.05, x, y - 0.01, z - w / 2); }
  else { k.box('icing', 0.05, 0.035, len + 0.06, x + w / 2, y - 0.01, z); k.box('icing', 0.05, 0.035, len + 0.06, x - w / 2, y - 0.01, z); }
};
const windowAt = (k, x, y, z, s = 0.14) => { k.box('icing', s + 0.05, s + 0.05, 0.03, x, y - 0.025, z); k.box('win', s, s, 0.03, x, y, z + 0.012); };
const door = (k, x, y, z, w = 0.17, h = 0.27) => { k.box('icing', w + 0.07, h + 0.05, 0.03, x, y, z); k.box('woodDark', w, h, 0.04, x, y, z + 0.008); };
const chimney = (k, x, y, z, h, puffs = 3, w = 0.15) => {
  k.box('brick', w, h, w, x, y, z); k.box('snow', w + 0.04, 0.045, w + 0.04, x, y + h, z);
  for (let i = 0; i < puffs; i++) k.sphere('smoke', 0.06 + i * 0.022, x + 0.04 + i * 0.07, y + h + 0.13 + i * 0.13, z - i * 0.02, 5, 3);
};
const cane = (k, x, z, h = 0.34, y = 0.09, r = 0.026) => {
  const n = 3, sh = (h - 0.06) / n;
  for (let i = 0; i < n; i++) k.cyl(i % 2 ? 'candyWhite' : 'candyRed', r, r, sh, x, y + i * sh, z, 4);
  k.link('candyWhite', [x, y + h - 0.06, z], [x + 0.07, y + h, z], r, 4); k.link('candyRed', [x + 0.07, y + h, z], [x + 0.13, y + h - 0.1, z], r, 4);
};
const tree = (k, x, z, h = 0.5, y = 0.09, baubles = 5, star = true) => {
  k.cyl('woodDark', 0.03, 0.04, 0.08, x, y, z, 4);
  const rs = [0.2, 0.15, 0.1], ys = [0.06, 0.06 + h * 0.3, 0.06 + h * 0.58], hs = [h * 0.42, h * 0.38, h * 0.34];
  for (let i = 0; i < 3; i++) k.cone(i % 2 ? 'pineLight' : 'pine', rs[i] * (h / 0.5), hs[i], x, y + ys[i], z, 7);
  for (let i = 0; i < baubles; i++) { const a = i * 2.4, t = (i % 3), r = rs[t] * (h / 0.5) * 0.72; k.sphere(['bauRed', 'bauGold', 'bauBlue'][i % 3], 0.022, x + Math.cos(a) * r, y + ys[t] + 0.03, z + Math.sin(a) * r, 4, 2); }
  if (star) k.sphere('gold', 0.035, x, y + ys[2] + hs[2] + 0.02, z, 4, 2);
  
};
const gumdrop = (k, x, z, sw, r = 0.045) => k.sphere(sw, r, x, 0.09 + r * 0.7, z, 4, 3, 1, 0.8, 1, false);
const bulbs = (k, x0, x1, y, z, n, off = 0) => { for (let i = 0; i < n; i++) { const x = x0 + (x1 - x0) * (n === 1 ? 0.5 : i / (n - 1)); k.sphere(LIGHTS[(i + off) % 4], 0.032, x, y - 0.03 * Math.abs(Math.sin(i * 1.7)), z, 4, 2); } };
const gift = (k, x, y, z, s, sw, ry = 0, hAspect = 0.8, rib = 'team', bow = true) => {
  const h = s * hAspect;
  k.box(sw, s, h, s, x, y, z, ry); k.box(rib, s * 1.03, h * 1.03, s * 0.2, x, y - 0.0, z, ry); k.box(rib, s * 0.2, h * 1.04, s * 1.03, x, y, z, ry);
  if (bow) k.box(rib, s * 0.3, s * 0.16, s * 0.16, x, y + h, z, ry + 0.6);
};
const snowball = (k, x, y, z, r = 0.05) => k.sphere('snow', r, x, y + r, z, 5, 3);
const lamp = (k, x, z, h = 0.4) => { k.cyl('coal', 0.016, 0.022, h, x, 0.09, z, 4); k.sphere('win', 0.04, x, 0.09 + h + 0.03, z, 5, 3); };

// ================= BARRACKS: gingerbread barracks =================
export function barracks() {
  const root = new T.Group(); root.name = 'barracks';
  const build = lvl => {
    const k = new Kit(); pad(k, 0.82 + lvl * 0.04);
    // main gingerbread house
    k.box('ginger', 0.92, 0.42, 0.66, 0, 0.09, -0.04); k.box('gingerLight', 0.94, 0.04, 0.68, 0, 0.09, -0.04);
    roof(k, 0.92, 0.36, 1.0, 0, 0.51, -0.04, true);
    door(k, -0.2, 0.09, 0.3); windowAt(k, 0.25, 0.28, 0.3);
    gumdrop(k, 0.45, 0.5, 'gumRed'); gumdrop(k, -0.55, 0.5, 'gumYel');
    cane(k, -0.44, 0.45);
    tree(k, 0.55, 0.15, 0.42, 0.09, 4, true);
    if (lvl >= 1) {
      // side wing (team roof), chimney, wreath
      k.box('ginger', 0.46, 0.34, 0.5, 0.64, 0.09, -0.36); k.box('gingerLight', 0.48, 0.04, 0.52, 0.64, 0.09, -0.36);
      roof(k, 0.5, 0.28, 0.58, 0.64, 0.43, -0.36, false);
      chimney(k, -0.28, 0.7, -0.2, 0.28, 3);
      k.torus('pine', 0.075, 0.028, -0.2, 0.3, 0.325, 3, 8, 0); k.box('team', 0.06, 0.05, 0.03, -0.2, 0.355, 0.345);
      bulbs(k, -0.45, 0.45, 0.52, 0.31, 6);
      gumdrop(k, 0.2, 0.55, 'gumGreen');
    }
    if (lvl >= 2) {
      // gumdrop tower with team cone + star, second chimney, more lights/lamps
      k.cyl('gingerLight', 0.2, 0.22, 0.62, -0.58, 0.09, -0.34, 7); k.cyl('icing', 0.23, 0.23, 0.04, -0.58, 0.62, -0.34, 7);
      k.cone('team', 0.27, 0.36, -0.58, 0.71, -0.34, 7); k.cone('snow', 0.12, 0.12, -0.58, 0.95, -0.34, 7); k.sphere('gold', 0.045, -0.58, 1.11, -0.34, 4, 3);
      windowAt(k, -0.58, 0.4, -0.12, 0.09);
      chimney(k, 0.25, 0.68, -0.15, 0.22, 2, 0.13);
      bulbs(k, -0.8, -0.35, 0.63, -0.14, 4, 2); bulbs(k, 0.42, 0.88, 0.45, -0.1, 3, 1);
      lamp(k, 0.82, 0.42, 0.34); cane(k, 0.7, 0.4, 0.3);
    }
    return k;
  };
  for (let i = 0; i < 3; i++) root.add(mesh('stage' + i, build(i), dummyMat));
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0.2), empty('UIPosition', 0, 1.6, 0));
  return { root };
}

// ================= FACTORY: Santa's toy workshop =================
export function factory() {
  const root = new T.Group(); root.name = 'factory';
  const build = lvl => {
    const k = new Kit(); k.box('snowShade', 1.72, 0.05, 1.42, 0, 0, 0); k.box('snow', 1.66, 0.07, 1.36, 0, 0.04, 0);
    // workshop hall: red-brick walls, white trim, team roof
    k.box('brick', 1.2, 0.46, 0.7, 0, 0.09, -0.3); k.box('brickDark', 1.22, 0.04, 0.72, 0, 0.09, -0.3);
    k.box('icing', 1.22, 0.035, 0.74, 0, 0.55, -0.3);
    roof(k, 0.92, 0.4, 1.3, 0, 0.57, -0.3, true);
    // front dormer gable over the doors with gold star
    k.box('brick', 0.62, 0.3, 0.2, 0, 0.55, 0.0); roof(k, 0.5, 0.26, 0.64, 0, 0.85, 0.0, false); k.box('win', 0.1, 0.1, 0.03, 0, 0.62, 0.105); k.sphere('gold', 0.04, 0, 1.18, 0.0, 4, 3);
    // big workshop doors with warm light, sign board with star
    k.box('icing', 0.52, 0.34, 0.03, 0, 0.09, 0.055); k.box('win', 0.44, 0.28, 0.03, 0, 0.1, 0.07);
    k.box('woodDark', 0.46, 0.07, 0.04, 0, 0.46, 0.06); k.box('gold', 0.3, 0.03, 0.02, 0, 0.48, 0.085);
    windowAt(k, -0.45, 0.3, 0.056, 0.14);
    chimney(k, -0.38, 0.8, -0.38, 0.34, 3, 0.17);
    // conveyor belt with presents
    k.box('coal', 1.05, 0.05, 0.3, 0.05, 0.1, 0.5); k.box('steel', 1.08, 0.025, 0.04, 0.05, 0.15, 0.66); k.box('steel', 1.08, 0.025, 0.04, 0.05, 0.15, 0.34);
        
    const n = 3 + lvl;
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); gift(k, -0.42 + t * 0.9, 0.15, 0.5, 0.12 + (i % 2) * 0.03, GIFT[(i * 2) % 5], 0, 0.8, i % 2 ? 'team' : 'icing', false); }
    
    // trees + lamps
    tree(k, 0.72, -0.5, 0.5, 0.09, 4, true);
    if (lvl >= 1) {
      chimney(k, 0.3, 0.8, -0.48, 0.26, 2, 0.13);
      gift(k, -0.7, 0.09, 0.15, 0.2, 'gGreen', 0.3, 0.9, 'team'); gift(k, -0.62, 0.09, 0.34, 0.14, 'gRed', 0.9, 0.8, 'icing', false);
      bulbs(k, -0.6, 0.6, 0.56, 0.08, 6);
    }
    if (lvl >= 2) {
      chimney(k, 0.05, 0.88, -0.55, 0.3, 3, 0.15);
      gift(k, 0.72, 0.09, 0.2, 0.2, 'gBlue', 0.4, 0.9, 'team'); gift(k, 0.7, 0.09, 0.42, 0.14, 'gPurple', 1.0, 0.8, 'icing', false);
      // clock/bell turret on roof front with team cap + star
      k.cyl('icing', 0.1, 0.11, 0.2, 0.0, 0.93, -0.12, 6); k.cone('team', 0.14, 0.2, 0.0, 1.13, -0.12, 6); k.sphere('gold', 0.04, 0.0, 1.35, -0.12, 4, 3);
      bulbs(k, -0.5, 0.5, 0.64, 0.45, 5, 2);
      cane(k, -0.82, 0.3, 0.34);
    }
    return k;
  };
  for (let i = 0; i < 3; i++) root.add(mesh('stage' + i, build(i), dummyMat));
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0.2), empty('UIPosition', 0, 1.2, 0.2));
  return { root };
}

// ================= TOWER: candy-cane nutcracker watchtower with snowball cannon =================
export function tower() {
  const root = new T.Group(); root.name = 'tower';
  const build = lvl => {
    const k = new Kit(); pad(k, 0.5, 9);
    const segs = 4 + lvl, sh = 0.2, h0 = 0.09;
    for (let i = 0; i < segs; i++) { const r = 0.27 - i * 0.012; k.cyl(i % 2 ? 'candyWhite' : 'candyRed', r - 0.012, r, sh, 0, h0 + i * sh, 0, 8); }
    const top = h0 + segs * sh;                                                  // platform height
    k.cyl('gold', 0.34, 0.31, 0.06, 0, top, 0, 9); k.cyl('icing', 0.36, 0.36, 0.035, 0, top + 0.06, 0, 9);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.5; k.cyl('candyRed', 0.016, 0.016, 0.12, Math.sin(a) * 0.32, top + 0.06, Math.cos(a) * 0.32, 3); }
    // nutcracker hat in team colour at the back; grows each stage
    const hh = 0.28 + lvl * 0.1;
    k.cyl('team', 0.17, 0.2, hh, 0, top + 0.095, -0.07, 7); k.cyl('gold', 0.205, 0.205, 0.045, 0, top + 0.13, -0.07, 7); k.cyl('gold', 0.18, 0.18, 0.04, 0, top + 0.095 + hh - 0.1, -0.07, 7);
    k.cyl('teamDark', 0.15, 0.17, 0.05, 0, top + 0.095 + hh, -0.07, 7); k.sphere('icing', 0.055, 0, top + 0.095 + hh + 0.07, -0.07, 5, 3);
    k.box('win', 0.1, 0.1, 0.03, 0, top + 0.18, 0.12 - 0.07 + 0.045);
    if (lvl >= 1) { k.cyl('gold', 0.185, 0.185, 0.03, 0, top + 0.095 + hh * 0.55, -0.07, 7); }
    if (lvl >= 2) {
      k.cyl('gold', 0.015, 0.015, 0.18, 0, top + 0.095 + hh + 0.12, -0.07, 4);
      // star topper
      const sy = top + 0.095 + hh + 0.37; const R = 0.085, r = 0.04, pts = [];
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, rr = i % 2 ? r : R; pts.push([Math.sin(a) * rr, Math.cos(a) * rr]); }
      k.prism('lYel', pts, 0.04, 0, sy, -0.07, 0);
      bulbs(k, -0.28, 0.28, top + 0.22, 0.28, 6);
    }
    // snowball cannon: barrel along +z
    const cy = top + 0.16;
    k.cyl('woodDark', 0.075, 0.09, 0.46, 0, cy - 0.23 + 0.0, 0.2, 7, 0, Math.PI / 2); k.cyl('candyRed', 0.095, 0.095, 0.08, 0, cy - 0.04, 0.26, 7, 0, Math.PI / 2);
    k.cyl('gold', 0.105, 0.095, 0.06, 0, cy - 0.03, 0.44, 7, 0, Math.PI / 2); k.sphere('snow', 0.06, 0, cy, 0.42, 5, 3);
    k.box('wood', 0.2, 0.07, 0.08, 0, top + 0.095, 0.15);
    snowball(k, 0.22, top + 0.095, 0.08); snowball(k, 0.26, top + 0.095, 0.2, 0.04);
    if (lvl >= 1) cane(k, 0.4, 0.35, 0.34, 0.09);
    return { k, bullet: [0, cy, 0.5] };
  };
  const bullets = [];
  for (let i = 0; i < 3; i++) { const r = build(i); root.add(mesh('stage' + i, r.k, dummyMat)); bullets.push(r.bullet); }
  root.add(empty('WayPosition', 0, 0.1, 0), empty('SpawnPosition', 0, 0.34, 0), empty('UIPosition', 0, 1.9, 0), empty('BulletPosition', 0, 1.18, 0.5));
  return { root };
}

// ================= SOLDIER: nutcracker soldier =================
export function soldier(detail = 1) {
  const sg = detail ? [8, 5] : [5, 3], HIP = [0, 0.42, 0];
  const body = new Kit();
  body.frustum('team', 0.3, 0.2, 0.36, 0.4, 0.26, 0, 0.42);
  body.box('teamDark', 0.32, 0.05, 0.22, 0, 0.42, 0);                                // coat hem
  body.box('icing', 0.07, 0.3, 0.02, 0, 0.45, 0.125);                                // white front stripe
  for (let i = 0; i < 3; i++) body.box('gold', 0.04, 0.04, 0.03, 0, 0.5 + i * 0.08, 0.135);
  body.box('woodDark', 0.34, 0.04, 0.24, 0, 0.5 - 0.1, 0);
  body.box('gold', 0.09, 0.07, 0.04, 0, 0.35 + 0.0, 0.12);                           // buckle
  body.box('gold', 0.14, 0.04, 0.16, 0.2, 0.76, 0); body.box('gold', 0.14, 0.04, 0.16, -0.2, 0.76, 0); // epaulettes
  body.box('icing', 0.3, 0.05, 0.2, 0, 0.74, 0);                                      // collar
  body.box('gGreen', 0.2, 0.2, 0.1, 0, 0.47, -0.17); body.box('team', 0.04, 0.2, 0.11, 0, 0.47, -0.17); body.box('gold', 0.22, 0.03, 0.03, 0, 0.6, -0.17); // gift sack
  body.sphere('skin', 0.115, 0, 0.88, 0, sg[0], sg[1]);
  body.box('icing', 0.15, 0.04, 0.05, 0, 0.84, 0.1);                                  // moustache
  body.sphere('lRed', 0.025, 0, 0.88, 0.115, 4, 3);                                   // rosy nose
  body.cyl('team', 0.11, 0.115, 0.3, 0, 0.97, 0, 8);                                  // tall shako hat
  body.cyl('gold', 0.118, 0.118, 0.04, 0, 0.99, 0, 8); body.cyl('gold', 0.11, 0.11, 0.025, 0, 1.2, 0, 8);
  body.box('coal', 0.2, 0.03, 0.05, 0, 0.975, 0.1);                                   // chin-strap peak
  body.sphere('icing', 0.04, 0, 1.3, 0, 5, 3);
  const arm = () => { const k = new Kit(); k.box('team', 0.1, 0.22, 0.11, 0, -0.22, 0); k.box('icing', 0.11, 0.05, 0.12, 0, -0.27, 0); k.box('skin', 0.075, 0.07, 0.08, 0, -0.34, 0); return k; };
  const armL = arm(), armR = arm();
  // candy-cane rifle
  for (let i = 0; i < 5; i++) armR.box(i % 2 ? 'candyWhite' : 'candyRed', 0.055, 0.055, 0.1, 0, -0.35, 0.05 + i * 0.1);
  armR.box('gold', 0.06, 0.06, 0.04, 0, -0.35, 0.57); armR.box('lYel', 0.04, 0.04, 0.03, 0, -0.34, 0.6);
  const leg = () => { const k = new Kit(); k.box('icing', 0.12, 0.28, 0.13, 0, -0.28, 0); k.box('coal', 0.13, 0.11, 0.18, 0, -0.42, 0.03); k.box('gold', 0.04, 0.04, 0.02, 0, -0.31, 0.07); return k; };
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

// ================= TANK: toy train engine with cannon =================
export function tank() {
  const hull = new Kit(), WH = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5'];
  hull.box('coal', 0.5, 0.07, 1.04, 0, 0.1, 0);                                     // chassis
  hull.box('gold', 0.52, 0.025, 1.06, 0, 0.17, 0);
  hull.cyl('team', 0.2, 0.2, 0.62, 0, 0.19, 0.2, 8, 0, Math.PI / 2);                // boiler (team)
  hull.cyl('gold', 0.21, 0.21, 0.04, 0, 0.19, 0.22, 8, 0, Math.PI / 2); hull.cyl('gold', 0.21, 0.21, 0.04, 0, 0.19, 0.0, 8, 0, Math.PI / 2);
  hull.cyl('coal', 0.17, 0.17, 0.08, 0, 0.23, 0.55, 8, 0, Math.PI / 2);              // smokebox
  hull.sphere('win', 0.05, 0, 0.41, 0.6, 5, 4);                                       // headlamp
  hull.cyl('coal', 0.055, 0.085, 0.2, 0, 0.5, 0.4, 6); hull.cyl('gold', 0.095, 0.095, 0.03, 0, 0.7, 0.4, 6);
  hull.sphere('smoke', 0.085, 0.03, 0.9, 0.38, 5, 3); hull.sphere('smoke', 0.065, 0.11, 1.03, 0.34, 5, 3);
  hull.box('wood', 0.46, 0.34, 0.32, 0, 0.17, -0.36);                                // cab
  hull.box('icing', 0.52, 0.04, 0.4, 0, 0.51, -0.36); hull.box('team', 0.48, 0.03, 0.36, 0, 0.55, -0.36);
  hull.box('win', 0.07, 0.12, 0.2, 0.235, 0.3, -0.36); hull.box('win', 0.07, 0.12, 0.2, -0.235, 0.3, -0.36);
  hull.box('gGold', 0.14, 0.12, 0.14, 0, 0.58, -0.36); hull.box('team', 0.15, 0.03, 0.03, 0, 0.64, -0.36);
  hull.prism('candyRed', [[-0.2, 0], [0.2, 0], [0.0, 0.14]], 0.12, 0, 0.1, 0.62, 0, 0);       // cowcatcher
  hull.box('candyWhite', 0.34, 0.03, 0.04, 0, 0.14, 0.66);
    const tur = new Kit();
  tur.cyl('gold', 0.09, 0.1, 0.05, 0, 0, 0, 8);
  tur.cyl('woodDark', 0.055, 0.065, 0.36, 0, 0.1, 0.14, 7, 0, Math.PI / 2); tur.cyl('candyRed', 0.07, 0.07, 0.07, 0, 0.1, 0.12, 7, 0, Math.PI / 2); tur.cyl('gold', 0.08, 0.075, 0.04, 0, 0.1, 0.32, 7, 0, Math.PI / 2);
  tur.sphere('snow', 0.045, 0, 0.14, 0.33, 5, 3);
  const wheel = big => { const r = big ? 0.15 : 0.12, k = new Kit(); k.axle('candyRed', r, 0.06, 0, 0, 0, 8); k.axle('gold', r * 0.4, 0.075, 0, 0, 0, 5); k.box('icing', 0.07, r * 1.7, 0.03, 0, -r * 0.85, -0.015); return k; };
  const wp = { w0: [0.28, 0.15, 0.4, 1], w1: [-0.28, 0.15, 0.4, 1], w2: [0.28, 0.15, -0.0, 0], w3: [-0.28, 0.15, 0, 0], w4: [0.28, 0.15, -0.38, 1], w5: [-0.28, 0.15, -0.38, 1] };
  const parts = [{ name: 'hull', kit: hull, pivot: [0, 0, 0] }, { name: 'turret', kit: tur, pivot: [0, 0.45, 0.05], local: true }, ...WH.map(n => ({ name: n, kit: wheel(wp[n][3]), pivot: wp[n].slice(0, 3), local: true }))];
  const g = rig('tank', parts);
  const D = 0.6, n = 8, times = Array.from({ length: n + 1 }, (_, i) => i * D / n);
  const spin = Array.from({ length: n + 1 }, (_, i) => Q(-i / n * Math.PI * 2, 0, 0));
  const run = new T.AnimationClip('Run', D, [
    ...WH.map(w => qTrack(w, times, spin)),
    pTrack('hull', times, times.map((_, i) => [0, 0.018 * Math.sin(i / n * Math.PI * 4), 0])),
    qTrack('hull', times, times.map((_, i) => Q(0.01 * Math.sin(i / n * Math.PI * 2), 0, 0.012 * Math.sin(i / n * Math.PI * 4)))),
    qTrack('turret', times, times.map((_, i) => Q(0, 0.1 * Math.sin(i / n * Math.PI * 2), 0))),
    pTrack('turret', times, times.map((_, i) => [0, 0.45 + 0.018 * Math.sin(i / n * Math.PI * 4), 0.05])),
  ]);
  const death = deathClip(parts.map(p => ({ name: p.name, pivot: p.pivot, flail: p.name === 'hull' ? undefined : k => 2 * k })), [0, 0.2, 0], { dur: 0.8, ang: 0.55, drop: 0.12, axis: 'z' });
  return { root: g, animations: [run, death] };
}

// ================= PROJECTILE: team-colour ornament with snow trail =================
export function projectile() {
  const root = new T.Group(); root.name = 'projectile';
  const k = new Kit();
  k.sphere('team', 0.15, 0, 0, 0.0, 10, 7); k.cyl('gold', 0.06, 0.07, 0.07, 0, 0.13, 0.0, 6); k.torus('gold', 0.03, 0.01, 0, 0.23, 0, 3, 6, 0);
  k.sphere('teamLight', 0.05, 0.06, 0.05, 0.1, 5, 3);
  k.sphere('snow', 0.1, 0, 0, -0.26, 6, 4); k.sphere('snow', 0.075, 0, 0.02, -0.4, 5, 3); k.sphere('snow', 0.05, 0, 0.0, -0.52, 5, 3);
  const m = mesh('projectile_bolt', k, dummyMat); root.add(m); root.add(empty('Trail', 0, 0, -0.1));
  return { root };
}

// ================= OBSTACLES =================
/** theme 'green' (snowy village square): small = present pile, big = decorated fir. 'snow' (North Pole): small = snowman, big = ice rock + candy canes. */
export function obstacles(theme) {
  const root = new T.Group(); root.name = 'obstacle-' + theme;
  const small = new Kit(), big = new Kit();
  const lights = (k, y0, y1, r0, r1, n) => { for (let i = 0; i < n; i++) { const t = i / n, a = i * 2.2, y = y0 + (y1 - y0) * t, r = r0 + (r1 - r0) * t; k.sphere(LIGHTS[i % 4], 0.03, Math.cos(a) * r, y, Math.sin(a) * r, 4, 2); } };
  if (theme === 'green') {
    gift(small, 0, 0.0, 0, 0.3, 'gRed', 0.3, 0.8, 'icing'); gift(small, 0.2, 0.0, 0.14, 0.2, 'gGreen', 0.9, 0.9, 'team', false); gift(small, -0.04, 0.24, 0.0, 0.17, 'gGold', 0.5, 0.8, 'candyRed'); 
    big.cyl('woodDark', 0.06, 0.08, 0.14, 0, 0.0, 0, 5);
    const rs = [0.42, 0.33, 0.24, 0.15], ys = [0.1, 0.38, 0.63, 0.86], hs = [0.42, 0.38, 0.32, 0.28];
    for (let i = 0; i < 4; i++) big.cone(i % 2 ? 'pineLight' : 'pine', rs[i], hs[i], 0, ys[i], 0, 6);
    for (let i = 0; i < 4; i += 2) big.cone('snow', rs[i] * 0.55, 0.1, 0, ys[i] + hs[i] * 0.55, 0, 6);
    for (let i = 0; i < 9; i++) { const t = i / 9, a = i * 2.5, r = 0.34 * (1 - t) + 0.05, y = 0.18 + t * 0.85; big.sphere(['bauRed', 'bauGold', 'bauBlue'][i % 3], 0.038, Math.cos(a) * r, y, Math.sin(a) * r, 4, 2); }
    lights(big, 0.15, 1.0, 0.36, 0.06, 8);
    big.sphere('lYel', 0.06, 0, 1.16, 0, 5, 3);
  } else {
    // snowman
    small.sphere('snow', 0.19, 0, 0.17, 0, 6, 4); small.sphere('snow', 0.14, 0, 0.44, 0, 6, 4); small.sphere('snow', 0.1, 0, 0.64, 0, 6, 4);
    small.torus('team', 0.1, 0.03, 0, 0.55, 0, 3, 7, Math.PI / 2); small.box('team', 0.06, 0.14, 0.03, 0.06, 0.4, 0.1);
    small.cone('carrot', 0.022, 0.12, 0, 0.64, 0.12, 4, 0); small.cyl('coal', 0.08, 0.08, 0.1, 0, 0.7, 0, 5); small.cyl('coal', 0.12, 0.12, 0.02, 0, 0.7, 0, 5);
    small.box('coal', 0.02, 0.02, 0.02, 0.04, 0.68, 0.085); small.box('coal', 0.02, 0.02, 0.02, -0.04, 0.68, 0.085);
    // big: iceberg rocks + candy canes + glowing lantern crystal
    const rock = (x, z, r, h, sw, ry = 0) => big.cyl(sw, r * 0.45, r, h, x, 0, z, 6, ry);
    rock(0, 0, 0.32, 0.7, 'ice'); rock(0.28, 0.1, 0.22, 0.45, 'iceLight', 0.5); rock(-0.26, -0.05, 0.2, 0.5, 'iceDark', 1.0); 
    big.cone('iceLight', 0.14, 0.25, 0, 0.7, 0, 6); big.cone('snow', 0.2, 0.08, 0, 0.52, 0, 6);
    cane(big, 0.36, 0.3, 0.55, 0.0, 0.032); cane(big, -0.42, 0.22, 0.45, 0.0, 0.03);
    big.sphere('lGreen', 0.045, 0, 1.0, 0, 4, 3); big.sphere('lRed', 0.04, 0.25, 0.5, 0.2, 4, 2); big.sphere('lBlue', 0.04, -0.2, 0.42, 0.18, 4, 2);
  }
  const grp = new T.Group(); grp.name = 'obstacle-' + theme + '_1'; root.add(grp);
  const a = mesh('small', small, dummyMat), b = mesh('big', big, dummyMat); grp.add(a, b);
  return { root, grp, tris: { small: small.tris(), big: big.tris() } };
}

export function ground(theme, tex) {
  const root = new T.Group(); root.name = 'ground-' + theme;
  const node = new T.Object3D(); node.name = `ground-${theme}_1`;
  node.userData = { name: `ground-${theme}`, family: 'ground', theme, texture: tex, wrap: 'repeat', meshSize: 10, uvRepeat: [3, 5], uvOffset: [0, 0], source: 'scratch xmas' };
  const g = new T.PlaneGeometry(10, 10, 1, 1); g.rotateX(-Math.PI / 2);
  const m = new T.Mesh(g, dummyMat); m.name = 'ground'; m.scale.set(6, 1, 10); m.userData = { name: 'ground', prefabWorldPos: [0, 0, 0] };
  node.add(m); root.add(node);
  return { root, ground: true };
}
