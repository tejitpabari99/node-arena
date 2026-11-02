// SCRATCH: procedural 256px RGBA ground textures for the CHRISTMAS set. Alpha = 255 - 127*glow.
import { render, h2, vnoise, fbm, clamp, mix, smooth, S } from './groundtex.mjs';

/** periodic jittered-cell voronoi: returns [d1, d2, cellId] in cell units. g cells per tile. */
function voro(u, v, g, seed) {
  const x = u * g, y = v * g, ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, wx = ((cx % g) + g) % g, wy = ((cy % g) + g) % g;
    const px = cx + 0.18 + h2(wx, wy, seed) * 0.64, py = cy + 0.18 + h2(wx, wy, seed + 7) * 0.64;
    const d = Math.hypot(x - px, y - py);
    if (d < d1) { d2 = d1; d1 = d; id = h2(wx, wy, seed + 3); } else if (d < d2) d2 = d;
  }
  return [d1, d2, id];
}
const TAU = Math.PI * 2;
/** perpendicular-ish distance to a wavy band running along `axis` ('x': y = c + a sin(..x..)) in px, periodic. */
function wavy(x, y, axis, c, a, ph) {
  const t = axis === 'x' ? x : y, o = axis === 'x' ? y : x;
  const ctr = c + a * Math.sin(TAU * t / S + ph), slope = a * TAU / S * Math.cos(TAU * t / S + ph);
  let d = Math.abs(o - ctr); d = Math.min(d, S - d);
  return d / Math.sqrt(1 + slope * slope);
}
const bandD = (c, p) => { const d = Math.abs(p - c); return Math.min(d, S - d); }; // periodic distance to band centre

/** Map 3: snowy village square - fluffy snow with warm cobblestone streets (cross-shaped) and a round plaza. */
export function snowCobble() {
  return render((x, y, u, v) => {
    const sn = fbm(u, v, 5), g = (h2(x, y, 2) - 0.5) * 6;
    let c = mix([214, 226, 242], [176, 196, 224], smooth(0.35, 0.75, sn)).map(q => q + g);      // snow, blue shadows in the dips
    // streets: horizontal band (centre y=128) + vertical band (centre x=128), plaza disc at crossing
    const wob = (vnoise(u, v, 8, 21) - 0.5) * 16;
    const dh = wavy(x, y, 'x', 112, 30, 0) + wob * 0.6, dv = wavy(x, y, 'y', 176, 26, 1.3) + wob * 0.6, plaza = Math.hypot(bandD(56, x), bandD(196, y)) - 34 + wob;
    const edge = Math.min(dh - 17, dv - 13, plaza) ;       // <0 inside the street
    if (edge < 6) {
      const [d1, d2, id] = voro(u, v, 32, 11), m = d2 - d1;
      let st = [112 + id * 40, 106 + id * 34, 98 + id * 30];                                        // warm grey-brown stones
      if (id > 0.9) st = [140 + id * 14, 108, 92];                                                // a few reddish bricks
      const rim = smooth(0.0, 0.16, m);                                                            // 0 in mortar, 1 on stone centre
      st = mix([58, 52, 50], st, 0.35 + rim * 0.65).map(q => q * (0.88 + 0.22 * rim));
      const cover = smooth(0.55, 0.72, fbm(u, v, 31)) * 0.6 + smooth(-2, 6, edge) * 0.55;          // snow drifts creep over the street
      st = mix(st, [222, 234, 248], clamp(cover));
      c = mix(c, st, 1 - clamp(edge / 6));
    }
    // sparkle
    if (h2(x, y, 9) > 0.992) c = [255, 255, 255];
    return [c, 0];
  });
}

/** Map 19: North Pole - frozen lake with cracks, candy-stripe roads edged by coloured string lights (glow). */
export function candyIce() {
  const LC = [[255, 80, 80], [120, 255, 150], [255, 226, 120], [110, 190, 255]];
  return render((x, y, u, v) => {
    const n = fbm(u, v, 4);
    let c = mix([132, 186, 222], [88, 146, 190], smooth(0.3, 0.75, n)); let glow = 0;
    const [d1, d2] = voro(u, v, 5, 41), crack = d2 - d1;
    if (crack < 0.035) c = mix(c, [214, 236, 250], 0.75);                                         // pale fracture lines
    else if (crack < 0.07) c = mix(c, [60, 108, 150], 0.35);
    const frost = smooth(0.58, 0.74, fbm(u, v, 17)); c = mix(c, [226, 240, 250], frost * 0.7);    // frosty patches
    c = c.map(q => q + (h2(x, y, 3) - 0.5) * 7);
    const wob = (vnoise(u, v, 8, 51) - 0.5) * 4;
    const hh = wavy(x, y, 'x', 112, 30, 0) + wob, hv = wavy(x, y, 'y', 176, 26, 1.3) + wob;
    const road = (d, t, hw) => {                                                                  // d = across, t = along
      if (d > hw + 5) return null;
      if (d > hw + 2) return { c: [248, 252, 255], g: 0 };                                         // white kerb
      if (d > hw) return { c: [206, 70, 74], g: 0 };
      const s = (((Math.floor((t + d * 0.9) / 12)) % 2) + 2) % 2;                                  // diagonal candy stripes, period 32 | 256
      let col = s ? [240, 238, 242] : [198, 58, 70]; if (d > hw - 3) col = col.map(q => q * 0.92);
      return { c: col, g: 0 };
    };
    const r1 = road(hh, x, 11), r2 = road(hv, y, 9);
    const r = (r1 && (!r2 || hh - 11 < hv - 9)) ? r1 : r2;
    if (r) { c = r.c; glow = r.g; }
    // string lights along the kerbs
    const bulb = (d, t, hw) => Math.abs(d - (hw + 8)) < 2.2 && ((((t % 24) + 24) % 24) < 4.2);
    if (!r && bulb(hh, x, 11) && hv > 16) { c = LC[Math.floor(x / 24) % 4]; glow = 0.95; }
    else if (!r && bulb(hv, y, 9) && hh > 19) { c = LC[Math.floor(y / 24) % 4]; glow = 0.95; }
    if (h2(x, y, 9) > 0.992 && !r) c = [255, 255, 255];
    return [c, glow];
  });
}
