// Pixel metrics (PRD SP01 "Metrics"): pure functions over decoded RGBA images ({ width, height, data }).
// Probe rects are only locators; every pass/fail value here comes from pixels classified by the Colour spec.
// Shared by visual:check (captures) and visual:calibrate (ref JPEG crops). Unit-tested in test/visual-metrics.test.ts.
import {
  isGrass, isGround, isMagenta, isRock, isSand, isSaturated, isTeamSat, isTreeGreen, isWhite, isGrey, paletteClass, PALETTE_CLASSES, rgbToHsv, TEAM_HUES,
} from './color.mjs';

/** Tower foreground: not ground-masked and V >= .35 (dark door/slit/outline pixels are excluded from fg; calibrated on tw01 grey25). */
export const FG_MIN_V = 0.35;
/**
 * Roof number (M02/M16/M19), calibrated in T8 on towerwar_01 + towerwar_yt1 (JPEG/video-soft digits):
 * white fill S <= .25, V >= .70; outline ring (within 2 px of the fill boundary) = V <= .25, or darker than the roof plate
 * around it by >= .20 (yt1 "44": fill V .7-.9, ring V .6-.7 on a V ~.95 blue roof; tw01 ring V .3-.6). A slot dot has no
 * such ring (its surround is the roof itself), so it is never taken for the digit.
 */
export const DIGIT = { maxS: 0.25, minV: 0.70, outlineV: 0.25, outlineContrast: 0.20, outlineRadius: 2, minOutlineShare: 0.5, minPixels: 4 };
/** Size-dependent pixel metrics (M02, M16, M19, M20) on ref crops run after rescaling the tower bbox to this width (PRD step 4a). */
export const REF_TOWER_WIDTH = 75;

/** Precomputes HSV planes once per image. */
export function toHsv(img) {
  const n = img.width * img.height, h = new Float32Array(n), s = new Float32Array(n), v = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4, [hh, ss, vv] = rgbToHsv(img.data[i], img.data[i + 1], img.data[i + 2]);
    h[p] = hh; s[p] = ss; v[p] = vv;
  }
  return { width: img.width, height: img.height, h, s, v, data: img.data };
}

const clampRect = (img, r) => {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.ceil(r.x + r.w)), y1 = Math.min(img.height, Math.ceil(r.y + r.h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

/** RGBA crop (rect clamped to the image, integer px); null when empty. */
export function crop(img, rect) {
  const r = clampRect(img, rect); if (!r) return null;
  const data = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) data.set(img.data.subarray(((r.y + y) * img.width + r.x) * 4, ((r.y + y) * img.width + r.x + r.w) * 4), y * r.w * 4);
  return { width: r.w, height: r.h, data };
}

/** Bilinear resample to `width` (height keeps the aspect). */
export function resample(img, width) {
  const height = Math.max(1, Math.round(img.height * width / img.width)), data = new Uint8ClampedArray(width * height * 4);
  const sx = img.width / width, sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(img.width - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = img.data[(y0 * img.width + x0) * 4 + c], b = img.data[(y0 * img.width + x1) * 4 + c];
        const d = img.data[(y1 * img.width + x0) * 4 + c], e = img.data[(y1 * img.width + x1) * 4 + c];
        data[(y * width + x) * 4 + c] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty);
      }
    }
  }
  return { width, height, data };
}

/** 1 for pixels whose centre lies inside the polygon (even-odd rule). */
export function polygonMask(width, height, points) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5, xs = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if ((a.y <= cy) !== (b.y <= cy)) xs.push(a.x + (cy - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5)), to = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** Rect -> mask (used for ref play bands). */
export function rectMask(width, height, rect) {
  const mask = new Uint8Array(width * height), r = clampRect({ width, height }, rect);
  if (r) for (let y = r.y; y < r.y + r.h; y++) mask.fill(1, y * width + r.x, y * width + r.x + r.w);
  return mask;
}

/** M07: share of magenta (#FF00FF +-6) pixels in the magenta-clear pass. */
export function voidShare(img) {
  let n = 0; const total = img.width * img.height;
  for (let p = 0; p < total; p++) if (isMagenta(img.data[p * 4], img.data[p * 4 + 1], img.data[p * 4 + 2])) n++;
  return n / total;
}

/** M14: grass share of the whole frame. */
export function grassShare(hsv, mask = null, inside = true) {
  let n = 0, k = 0;
  for (let p = 0; p < hsv.h.length; p++) {
    if (mask && (mask[p] === 1) !== inside) continue;
    n++; if (isGrass(hsv.h[p], hsv.s[p], hsv.v[p])) k++;
  }
  return n ? k / n : null;
}

/** M09 grass share inside the play quad; M10 border (outside the quad): sand+rock share, grass share, border area share. */
export function playQuadShares(hsv, mask) {
  let inside = 0, insideGrass = 0, outside = 0, sandRock = 0, grassOut = 0;
  for (let p = 0; p < hsv.h.length; p++) {
    const h = hsv.h[p], s = hsv.s[p], v = hsv.v[p];
    if (mask[p]) { inside++; if (isGrass(h, s, v)) insideGrass++; }
    else { outside++; if (isSand(h, s, v) || isRock(h, s, v)) sandRock++; if (isGrass(h, s, v)) grassOut++; }
  }
  const total = hsv.h.length;
  return {
    grassInside: inside ? insideGrass / inside : null,
    border: { sandRock: outside ? sandRock / outside : null, grass: outside ? grassOut / outside : null, area: outside / total },
  };
}

function rectIndices(hsv, rect) {
  const r = clampRect(hsv, rect); if (!r) return [];
  const out = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(y * hsv.width + x);
  return out;
}

/** Tower fg pixel: not ground-masked and V >= FG_MIN_V. */
const isFg = (h, s, v) => v >= FG_MIN_V && !isGround(h, s, v);

/**
 * M11 tower paint inside `rect` (ground-masked). `team` = Colour-spec team name, or null for a neutral tower.
 * Owned: a = team-sat / saturated fg, b = team-sat / fg, c = white-body / fg. Neutral: sat = saturated / fg, greyWhite = (grey or white) / fg.
 */
export function towerPaint(hsv, rect, team) {
  let fg = 0, sat = 0, teamSat = 0, white = 0, greyWhite = 0;
  const hue = team ? TEAM_HUES[team] : null;
  for (const p of rectIndices(hsv, rect)) {
    const h = hsv.h[p], s = hsv.s[p], v = hsv.v[p];
    if (!isFg(h, s, v)) continue;
    fg++;
    if (isSaturated(h, s, v)) sat++;
    if (hue !== null && isTeamSat(h, s, v, hue)) teamSat++;
    if (isWhite(h, s, v)) white++;
    if (isWhite(h, s, v) || isGrey(h, s, v)) greyWhite++;
  }
  if (!fg) return null;
  return team ? { fg, a: sat ? teamSat / sat : null, b: teamSat / fg, c: white / fg } : { fg, sat: sat / fg, greyWhite: greyWhite / fg };
}

/** M18 class-share vector {grass, sand, rock, white, grey, teamSat, other} over a rect (whole image if null); `fgOnly` keeps tower fg pixels only. */
export function classVector(hsv, rect = null, { fgOnly = false } = {}) {
  const counts = new Array(PALETTE_CLASSES.length).fill(0);
  const indices = rect ? rectIndices(hsv, rect) : null, n = indices ? indices.length : hsv.h.length;
  let total = 0;
  for (let k = 0; k < n; k++) {
    const p = indices ? indices[k] : k, h = hsv.h[p], s = hsv.s[p], v = hsv.v[p];
    if (fgOnly && !isFg(h, s, v)) continue;
    counts[paletteClass(h, s, v)]++; total++;
  }
  return total ? counts.map(c => c / total) : null;
}

/** Total-variation distance between two share vectors. */
export const tvDistance = (a, b) => (a && b ? a.reduce((t, x, i) => t + Math.abs(x - b[i]), 0) / 2 : null);

/** 4-connected components of `pred(p)` pixels inside `rect`; returns [{ x0, y0, x1, y1, w, h, n, pixels }]. */
export function components(hsv, rect, pred) {
  const r = clampRect(hsv, rect); if (!r) return [];
  const seen = new Uint8Array(r.w * r.h), out = [];
  const local = (x, y) => (y - r.y) * r.w + (x - r.x);
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (seen[local(x, y)] || !pred(y * hsv.width + x)) continue;
    const pixels = [], stack = [[x, y]]; seen[local(x, y)] = 1;
    let x0 = x, y0 = y, x1 = x, y1 = y;
    while (stack.length) {
      const [cx, cy] = stack.pop(); pixels.push(cy * hsv.width + cx);
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < r.x || ny < r.y || nx >= r.x + r.w || ny >= r.y + r.h || seen[local(nx, ny)] || !pred(ny * hsv.width + nx)) continue;
        seen[local(nx, ny)] = 1; stack.push([nx, ny]);
      }
    }
    out.push({ x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n: pixels.length, pixels });
  }
  return out;
}

const isWhiteFill = hsv => p => hsv.s[p] <= DIGIT.maxS && hsv.v[p] >= DIGIT.minV;
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** Upper quartile V of the non-fill pixels within 5 px of a component's bbox: the plate it sits on (the ring itself is darker). */
export function plateV(hsv, comp) {
  const white = isWhiteFill(hsv), pad = DIGIT.outlineRadius + 3;
  const values = rectIndices(hsv, { x: comp.x0 - pad, y: comp.y0 - pad, w: comp.w + 2 * pad, h: comp.h + 2 * pad }).filter(p => !white(p)).map(p => hsv.v[p]).sort((x, y) => x - y);
  return values.length ? values[Math.floor(values.length * 0.75)] : null;
}

/**
 * Dark-outline ring of a fill component: boundary pixels with a dark pixel (V <= .25, or <= plate V - .20) within 2 px
 * (Chebyshev). Returns { share, gy0, gy1 }: share of ringed boundary pixels and the vertical extent of fill + ring pixels.
 */
export function outlineRing(hsv, comp, backV = null) {
  const inComp = new Set(comp.pixels), W = hsv.width, R = DIGIT.outlineRadius;
  const darkV = Math.max(DIGIT.outlineV, backV === null ? -1 : backV - DIGIT.outlineContrast);
  let boundary = 0, ringed = 0, gy0 = comp.y0, gy1 = comp.y1;
  for (const p of comp.pixels) {
    const x = p % W, y = (p - x) / W;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => inComp.has((y + dy) * W + x + dx))) continue;
    boundary++;
    let hit = false;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= hsv.height || hsv.v[ny * W + nx] > darkV) continue;
      hit = true; if (ny < gy0) gy0 = ny; if (ny > gy1) gy1 = ny;
    }
    if (hit) ringed++;
  }
  return { share: boundary ? ringed / boundary : 0, gy0, gy1 };
}

/** Share of a component's boundary pixels with a dark outline pixel within 2 px (see outlineRing). */
export const outlineShare = (hsv, comp, backV = null) => outlineRing(hsv, comp, backV).share;

/** Upper 45% of a tower rect: where the roof number and slot dots live (M19 locator). */
export const roofRegion = rect => ({ x: rect.x, y: rect.y, w: rect.w, h: rect.h * 0.45 });

/**
 * White-fill components in `rect`, with outline share and glyph extent (fill + outline ring: gy0, gy1, glyphH);
 * sorted tallest fill first.
 */
export function whiteBlobs(hsv, rect) {
  return components(hsv, rect, isWhiteFill(hsv)).filter(c => c.n >= DIGIT.minPixels)
    .map(c => { const plate = plateV(hsv, c), ring = outlineRing(hsv, c, plate); return { ...c, plate, outline: ring.share, gy0: ring.gy0, gy1: ring.gy1, glyphH: ring.gy1 - ring.gy0 + 1 }; })
    .sort((a, b) => b.h - a.h || b.n - a.n);
}

/** M02 pixel part: glyph height (px) of the outlined digit in the count locator, else the tallest white-fill height; null when none. */
export function digitHeight(hsv, locator) {
  const blobs = whiteBlobs(hsv, locator), digit = blobs.find(b => isGlyph(b, locator));
  return digit ? digit.glyphH : blobs.length ? blobs[0].h : null;
}

/**
 * Digit candidates: outlined, at most 0.3 of the locator width wide (a floor body is wider) and centred in the upper 60% of
 * the locator (the roof cap's top face; side bevels / the top floor body sit lower: tw01 grey25, yt1 "38"/"44"), on a lit
 * plate (upper-quartile surround V >= .45: refs .55 grey roof to ~.95 team roof; v1 DOM label cards are dark navy).
 */
export const GLYPH = { maxWidth: 0.3, maxCentreY: 0.6, minPlateV: 0.45 };
const isGlyph = (b, rect) => b.outline >= DIGIT.minOutlineShare && b.plate !== null && b.plate >= GLYPH.minPlateV && b.w <= GLYPH.maxWidth * rect.w && (b.y0 + b.y1 + 1) / 2 - rect.y <= GLYPH.maxCentreY * rect.h;

/** M16 / M19 digit: tallest glyph candidate (ties: closest to the locator's horizontal centre); null when none. */
export function outlinedDigit(hsv, locator) {
  const cx = locator.x + locator.w / 2, off = b => Math.abs((b.x0 + b.x1 + 1) / 2 - cx);
  const glyphs = whiteBlobs(hsv, locator).filter(b => isGlyph(b, locator)), digit = [...glyphs].sort((a, b) => b.glyphH - a.glyphH || off(a) - off(b))[0];
  if (!digit) return null;
  // The whole number = every glyph on the digit's row ("44", "Max"): its x extent centres the slot-dot row.
  const row = glyphs.filter(b => b.y0 <= digit.y1 && b.y1 >= digit.y0);
  return { ...digit, numberX0: Math.min(...row.map(b => b.x0)), numberX1: Math.max(...row.map(b => b.x1)) };
}

const isRound = c => c.w >= 2 && c.h >= 2 && c.w / c.h >= 0.5 && c.w / c.h <= 2 && c.n / (c.w * c.h) >= 0.5;

/**
 * M19 slot dots below the digit: bright (white-fill) or dim (roof-hued, clearly lighter/less saturated than the roof)
 * round blobs whose centre lies in the dot row under the number: from the glyph bottom down 1.3 glyph heights (end of the
 * roof region without a digit), within +-0.25 tower widths of the number's centre (tw01/yt1: dots sit centred under the number;
 * roof-edge bevel highlights are off to the side). Dots smaller than 4% of the tower width are noise.
 */
export function slotDotBlobs(hsv, towerRect, digit, team) {
  const roof = roofRegion(towerRect), top = digit ? (digit.gy1 ?? digit.y1) + 1 : roof.y;
  const region = { x: roof.x, y: top, w: roof.w, h: roof.y + roof.h - top };
  if (region.h <= 0) return [];
  const glyphH = digit ? (digit.glyphH ?? digit.h) : null;
  const rowEnd = digit ? top + 1.3 * glyphH : roof.y + roof.h, cx = digit ? (digit.numberX0 + digit.numberX1 + 1) / 2 : towerRect.x + towerRect.w / 2;
  const hue = team ? TEAM_HUES[team] : null, roofPx = [];
  for (const p of rectIndices(hsv, region)) {
    const h = hsv.h[p], s = hsv.s[p], v = hsv.v[p];
    if (hue !== null ? isTeamSat(h, s, v, hue) : (isGrey(h, s, v) && !isWhite(h, s, v))) roofPx.push(p);
  }
  const roofV = median(roofPx.map(p => hsv.v[p])), roofS = median(roofPx.map(p => hsv.s[p]));
  const white = isWhiteFill(hsv);
  const dot = p => {
    if (white(p)) return true;
    if (roofV === null || isGrass(hsv.h[p], hsv.s[p], hsv.v[p]) || isTreeGreen(hsv.h[p], hsv.s[p])) return false; // not isGround: a pale yellow dim dot is sand-hued
    const hueOk = hue === null ? hsv.s[p] <= 0.2 : Math.abs(((hsv.h[p] - hue + 540) % 360) - 180) <= 25;
    return hueOk && (hsv.v[p] - roofV >= 0.08 || roofS - hsv.s[p] >= 0.15);
  };
  const minSize = Math.max(2, towerRect.w * 0.04);
  return components(hsv, region, dot).filter(c => {
    const ccx = (c.x0 + c.x1 + 1) / 2, ccy = (c.y0 + c.y1 + 1) / 2;
    return isRound(c) && c.h >= minSize && c.w >= minSize && c.h <= towerRect.w * 0.3 && ccy <= rowEnd && Math.abs(ccx - cx) <= 0.25 * towerRect.w;
  });
}

/** M19 slot-dot count (see slotDotBlobs). */
export const slotDots = (hsv, towerRect, digit, team) => slotDotBlobs(hsv, towerRect, digit, team).length;

/** Bottom (exclusive) of the roof decal = number glyph + slot dots; M20 counts floor stripes below it. rect.y when no digit. */
export function decalBottom(hsv, towerRect, team) {
  const digit = outlinedDigit(hsv, roofRegion(towerRect)); if (!digit) return towerRect.y;
  return Math.max(digit.gy1, ...slotDotBlobs(hsv, towerRect, digit, team).map(c => c.y1)) + 1;
}

/**
 * M20 floor stripes along the vertical centre line (3-px majority) of the tower rect, below `fromY` (bottom of number/dots):
 * team-sat runs and white-body runs (>= 2 px). whiteRuns = gaps between consecutive team runs that contain a white run;
 * bands = team runs after the first one (roof cap). Owned towers only.
 */
export function floorStripes(hsv, rect, team, fromY = rect.y) {
  const hue = TEAM_HUES[team], r = clampRect(hsv, rect); if (!r || hue === undefined) return null;
  const cx = Math.round(r.x + r.w / 2), cls = [];
  for (let y = Math.max(r.y, Math.ceil(fromY)); y < r.y + r.h; y++) {
    const votes = [0, 0, 0];
    for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || x >= hsv.width) continue;
      const p = y * hsv.width + x, h = hsv.h[p], s = hsv.s[p], v = hsv.v[p];
      votes[isTeamSat(h, s, v, hue) ? 1 : isWhite(h, s, v) ? 2 : 0]++;
    }
    cls.push(votes[1] >= 2 ? 'team' : votes[2] >= 2 ? 'white' : 'other');
  }
  const runs = [];
  for (const c of cls) { const last = runs.at(-1); if (last && last.c === c) last.n++; else runs.push({ c, n: 1 }); }
  const kept = runs.filter(run => run.n >= 2 && run.c !== 'other');
  const teamIdx = kept.map((run, i) => (run.c === 'team' ? i : -1)).filter(i => i >= 0);
  let whiteRuns = 0;
  for (let k = 0; k + 1 < teamIdx.length; k++) if (kept.slice(teamIdx[k] + 1, teamIdx[k + 1]).some(run => run.c === 'white')) whiteRuns++;
  return { whiteRuns, bands: Math.max(0, teamIdx.length - 1), teamRuns: teamIdx.length };
}
