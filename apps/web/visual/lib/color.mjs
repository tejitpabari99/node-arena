// Colour spec (PRD SP01 "Colour spec (B2)"): HSV from 8-bit sRGB (H degrees 0-360, S and V 0-1, same as
// Python colorsys.rgb_to_hsv) and the class table measured on the Tower War refs. HSL is not used.

/** Standard rgb->hsv; returns [h, s, v] with h in [0, 360). */
export function rgbToHsv(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const v = max, s = max === 0 ? 0 : d / max;
  if (d === 0) return [0, s, v];
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, v];
}

/** Team hues of the Colour spec (team-sat = within +-25 deg). */
export const TEAM_HUES = { blue: 212, red: 357, yellow: 44, green: 130 };
export const TEAM_TOLERANCE = 25;
export const hueDistance = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export const isGrass = (h, s, v) => h >= 55 && h <= 105 && s >= 0.40 && v >= 0.40;
export const isSand = (h, s, v) => h >= 25 && h <= 48 && s >= 0.20 && s <= 0.60 && v >= 0.85;
export const isRock = (h, s, v) => (h <= 22 || h >= 350) && s >= 0.30 && s <= 0.80 && v >= 0.40 && v <= 0.90;
export const isWhite = (h, s, v) => s <= 0.20 && v >= 0.60;
export const isGrey = (h, s, v) => s <= 0.20 && v >= 0.35 && v < 0.90;
export const isSaturated = (h, s, v) => s >= 0.45 && v >= 0.40;
export const isTreeGreen = (h, s) => h >= 105 && h <= 150 && s >= 0.35;
/** team-sat for one team hue (degrees). */
export const isTeamSat = (h, s, v, hue) => isSaturated(h, s, v) && hueDistance(h, hue) <= TEAM_TOLERANCE;
export const isAnyTeamSat = (h, s, v) => isSaturated(h, s, v) && Object.values(TEAM_HUES).some(t => hueDistance(h, t) <= TEAM_TOLERANCE);
/** Ground mask: grass or sand or rock or tree-green; excluded when measuring towers. */
export const isGround = (h, s, v) => isGrass(h, s, v) || isSand(h, s, v) || isRock(h, s, v) || isTreeGreen(h, s);

/** Nearest Colour-spec team for a hue (e.g. the probe's paintHue locator), or null. */
export function nearestTeam(hue) {
  if (typeof hue !== 'number' || !Number.isFinite(hue)) return null;
  let best = null, dist = Infinity;
  for (const [team, h] of Object.entries(TEAM_HUES)) { const d = hueDistance(hue, h); if (d < dist) { dist = d; best = team; } }
  return best;
}

/** M18 class-share vector order; each pixel gets exactly one class, first match wins in this order. */
export const PALETTE_CLASSES = ['grass', 'sand', 'rock', 'white', 'grey', 'teamSat', 'other'];
export function paletteClass(h, s, v) {
  if (isGrass(h, s, v)) return 0;
  if (isSand(h, s, v)) return 1;
  if (isRock(h, s, v)) return 2;
  if (isWhite(h, s, v)) return 3;
  if (isGrey(h, s, v)) return 4;
  if (isAnyTeamSat(h, s, v)) return 5;
  return 6;
}

/** Magenta void (M07): #FF00FF +-6 per channel. */
export const isMagenta = (r, g, b) => r >= 249 && g <= 6 && b >= 249;
