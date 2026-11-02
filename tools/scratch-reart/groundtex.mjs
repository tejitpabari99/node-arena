// SCRATCH: procedural 256px RGBA ground textures. Alpha = 255 - 127*glow (art.ts reads it as emissive mask).
import { png } from './lib.mjs';
const S = 256;
const h2 = (x, y, s = 0) => { let n = (x * 374761393 + y * 668265263 + s * 1274126177) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const sm = t => t * t * (3 - 2 * t);
function vnoise(u, v, g, s) { // periodic value noise, u,v in [0,1)
  const x = u * g, y = v * g, i = Math.floor(x), j = Math.floor(y), fx = sm(x - i), fy = sm(y - j);
  const a = h2(i % g, j % g, s), b = h2((i + 1) % g, j % g, s), c = h2(i % g, (j + 1) % g, s), d = h2((i + 1) % g, (j + 1) % g, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const fbm = (u, v, s) => (vnoise(u, v, 4, s) * 0.5 + vnoise(u, v, 8, s + 1) * 0.3 + vnoise(u, v, 16, s + 2) * 0.2);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const smooth = (a, b, x) => sm(clamp((x - a) / (b - a)));

function render(fn) {
  const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const [c, glow] = fn(x, y, x / S, y / S);
    const p = (y * S + x) * 4; buf[p] = clamp(c[0], 0, 255); buf[p + 1] = clamp(c[1], 0, 255); buf[p + 2] = clamp(c[2], 0, 255); buf[p + 3] = 255 - Math.round(clamp(glow) * 127);
  }
  return png(S, S, 6, buf);
}

/** Map 3: tech-plating deck: 8x8 panels/tile, cyan seams on 4-panel super-grid, dust drifts. */
export function deck() {
  return render((x, y, u, v) => {
    const P = 16, pi = Math.floor(x / P), pj = Math.floor(y / P), lx = x % P, ly = y % P;
    const pv = h2(pi, pj, 3);
    let c = [34 + pv * 9, 42 + pv * 9, 54 + pv * 10], glow = 0;
    const n = fbm(u, v, 7); c = c.map(q => q + (n - 0.5) * 16);
    const e = Math.min(lx, ly, P - 1 - lx, P - 1 - ly);
    if (e === 0) c = [18, 23, 31]; else if (e === 1) c = (lx < 3 || ly < 3) ? [62, 74, 90] : [26, 33, 43];
    // rivets
    if ((lx === 2 || lx === P - 3) && (ly === 2 || ly === P - 3)) c = [92, 106, 124];
    // panel inset detail: every ~9th panel has a vent or glow tile
    const k = h2(pi, pj, 9);
    if (k > 0.88 && lx > 4 && lx < 12 && ly > 4 && ly < 12) { if (ly % 2 < 1) c = [14, 18, 24]; else c = [40, 50, 64]; }
    else if (k < 0.04 && lx > 5 && lx < 10 && ly > 5 && ly < 10) { c = [70, 220, 245]; glow = 0.5; }
    // super-grid glow seams (every 4 panels), 2px
    const sx = x % 128, sy = y % 128, d = Math.min(sx, 127 - sx, sy, 127 - sy);
    if (d === 0) { c = [70, 190, 215]; glow = 0.42; }
    else if (d === 1) { c = [34, 90, 108]; glow = 0.12; }
    // dark centre cross-hatch plates on super tiles
    // dust drifts
    const dn = fbm(u, v, 21) * 0.5 + vnoise(u, v, 3, 40) * 0.5, dust = smooth(0.5, 0.62, dn);
    if (dust > 0) { const g = h2(x, y, 5) * 14; c = mix(c, [112 + g, 94 + g, 68 + g * 0.6], dust * 0.85); glow *= 1 - dust; }
    return [c, glow];
  });
}

/** Map 19: ice-world colony: frosted hex plates, cyan hex seams, pale ice drifts. 6x10 hexes per tile. */
export function iceHex() {
  const Nx = 9, Ny = 16, X = 3 * Nx, Y = Math.sqrt(3) * Ny, R3 = Math.sqrt(3);
  return render((x, y, u, v) => {
    const hx = u * X, hy = v * Y;
    let best = 9, bd = null, bi = 0, bj = 0;
    const i0 = Math.floor(hx / 1.5);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let jj = -1; jj <= 1; jj++) {
      const j = Math.floor(hy / R3) + jj, cx = 1.5 * i, cy = R3 * (j + (((i % 2) + 2) % 2) * 0.5), dx = hx - cx, dy = hy - cy, dist = dx * dx + dy * dy;
      if (dist < best) { best = dist; bd = [dx, dy]; bi = ((i % (2 * Nx)) + 2 * Nx) % (2 * Nx); bj = ((j % Ny) + Ny) % Ny; }
    }
    const qx = Math.abs(bd[0]), qy = Math.abs(bd[1]), hd = Math.max(qy, qx * R3 / 2 + qy * 0.5), ed = R3 / 2 - hd; // distance to edge (hex units)
    const pv = h2(bi, bj, 4), n = fbm(u, v, 3), frost = smooth(0.5, 0.64, fbm(u, v, 11));
    let c = [28 + pv * 10, 52 + pv * 10, 76 + pv * 12], glow = 0;
    c = c.map(q => q + (n - 0.5) * 14);
    const inner = ed > 0.22 && ed < 0.3 && pv > 0.35;
    if (ed < 0.16) c = mix(c, [16, 28, 42], 0.8);                       // groove
    if (ed < 0.08) { c = [90, 220, 245]; glow = 0.4; } else if (ed < 0.14) { c = [36, 110, 140]; glow = 0.1; }
    else if (ed > 0.16 && ed < 0.22) c = mix(c, [92, 124, 150], 0.45);  // bevel highlight
    if (pv > 0.86 && ed > 0.32) { c = [80, 210, 240]; glow = 0.55; }      // lit core hex
    if (inner) { c = mix(c, [70, 100, 125], 0.5); }
    const drift = smooth(0.0, 1, frost) * 0.75;
    if (drift > 0) { const g = h2(x, y, 6) * 12; c = mix(c, [98 + g, 134 + g, 160 + g * 0.5], drift * (ed > 0.1 ? 0.8 : 0.5)); glow *= 1 - drift * 0.8; }
    return [c, glow];
  });
}
