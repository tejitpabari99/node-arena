import { CanvasTexture, LinearMipmapLinearFilter, LinearFilter, SRGBColorSpace } from 'three';

/** Roof decal atlas (SP03 R7): one 512x512 canvas, 4x4 cells of 128x128, one cell per tower (<= 16 towers).
 * A cell is redrawn only when its (text, dots, glyph) state changes; the whole atlas is re-uploaded once per flush. */
export const ATLAS_SIZE = 512, CELL = 128, GRID = ATLAS_SIZE / CELL, MAX_TOWERS = GRID * GRID;
export type DotState = 'free' | 'used';
export interface RoofState { text: string; dots: readonly DotState[]; /** colourblind shape glyph, or '' */ glyph: string }

/** Dot count = slots; the last `lines` (clamped) dots are in use (dim), the rest free (bright). */
export function dotStates(slots: number, lines: number): DotState[] {
  const n = Math.max(0, Math.floor(slots)), used = Math.max(0, Math.min(n, Math.floor(lines)));
  return Array.from({ length: n }, (_, i) => (i < n - used ? 'free' : 'used'));
}
/** Roof text: "Max" at cap, else the integer count. */
export function roofText(count: number, cap: number | null | undefined): string {
  return cap && cap > 0 && count >= cap ? 'Max' : String(Math.max(0, Math.floor(count)));
}
export const stateKey = (s: RoofState) => `${s.text}|${s.dots.map(d => (d === 'free' ? 'f' : 'u')).join('')}|${s.glyph}`;

export const NUMBER_PX = 40, STROKE_PX = 16, FATTEN_PX = 3, LETTER_GAP_PX = 7, NUMBER_Y = 33, DOT_R = 10, DOT_PITCH = 28, DOT_Y = 75, GLYPH_PX = 34;
export const NUMBER_FILL = '#ffffff', NUMBER_OUTLINE = '#000000';
export const BRIGHT_DOT = 'rgba(255,255,255,1)', DIM_DOT = 'rgba(255,255,255,.5)';

/** Draw one tower's decal into a 128x128 region at (ox, oy). Pure canvas calls, no clock or randomness. */
export function drawRoof(ctx: CanvasRenderingContext2D, ox: number, oy: number, state: RoofState): void {
  ctx.clearRect(ox, oy, CELL, CELL);
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  // Number: bold white fill, black outline; shrink to fit the cell ("Max", 3 digits).
  // Letter gap keeps adjacent digit fills from merging into one blob after the outline/fatten strokes (and after minification).
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${LETTER_GAP_PX}px`;
  ctx.font = `bold ${NUMBER_PX}px sans-serif`;
  const fit = Math.min(1, (CELL - STROKE_PX - 24) / Math.max(1, ctx.measureText(state.text).width));
  ctx.font = `bold ${Math.round(NUMBER_PX * fit)}px sans-serif`;
  ctx.lineWidth = STROKE_PX; ctx.strokeStyle = NUMBER_OUTLINE; ctx.strokeText(state.text, ox + CELL / 2 + LETTER_GAP_PX / 2, oy + NUMBER_Y);
  // Fill = glyph + a thin same-colour stroke: stems stay white (not grey) after mip minification on small towers.
  ctx.fillStyle = NUMBER_FILL; ctx.fillText(state.text, ox + CELL / 2 + LETTER_GAP_PX / 2, oy + NUMBER_Y);
  ctx.lineWidth = FATTEN_PX; ctx.strokeStyle = NUMBER_FILL; ctx.strokeText(state.text, ox + CELL / 2 + LETTER_GAP_PX / 2, oy + NUMBER_Y);
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
  // Slot dots: bright opaque white = free slot, dim translucent = slot in use.
  const n = state.dots.length, x0 = ox + CELL / 2 - (n - 1) * DOT_PITCH / 2;
  state.dots.forEach((d, i) => {
    ctx.beginPath(); ctx.arc(x0 + i * DOT_PITCH, oy + DOT_Y, DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = d === 'free' ? BRIGHT_DOT : DIM_DOT; ctx.fill();
  });
  // Colourblind glyph: top-left, ~25% of the cell.
  if (state.glyph) {
    ctx.font = `bold ${GLYPH_PX}px sans-serif`; ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.strokeText(state.glyph, ox + 20, oy + 20);
    ctx.fillStyle = '#fff'; ctx.fillText(state.glyph, ox + 20, oy + 20);
  }
  ctx.restore();
}

export interface RoofAtlas {
  readonly texture: CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  /** Cell origin (u, v in atlas UV, v up) for tower `index`. */
  cell(index: number): { u: number; v: number };
  /** Redraw tower `index`'s cell iff its state differs from the last one drawn; returns true when redrawn. */
  set(index: number, state: RoofState): boolean;
  /** Upload the atlas if any cell changed since the last flush. */
  flush(): boolean;
  /** Number of cell redraws so far (test hook). */
  readonly redraws: number;
  dispose(): void;
}
export function createRoofAtlas(towers: number, canvas: HTMLCanvasElement = document.createElement('canvas')): RoofAtlas {
  if (towers > MAX_TOWERS) throw new Error(`Roof atlas supports at most ${MAX_TOWERS} towers (got ${towers})`);
  canvas.width = canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Roof decals require a 2D canvas');
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter; texture.anisotropy = 4;
  const keys = new Array<string | undefined>(towers).fill(undefined);
  let dirty = false, redraws = 0;
  const cell = (i: number) => ({ u: (i % GRID) / GRID, v: 1 - (Math.floor(i / GRID) + 1) / GRID });
  return {
    texture, canvas, cell,
    set(i, state) {
      const key = stateKey(state); if (keys[i] === key) return false;
      keys[i] = key; drawRoof(ctx, (i % GRID) * CELL, Math.floor(i / GRID) * CELL, state); dirty = true; redraws++; return true;
    },
    flush() { if (!dirty) return false; dirty = false; texture.needsUpdate = true; return true; },
    get redraws() { return redraws; },
    dispose() { texture.dispose(); },
  };
}
