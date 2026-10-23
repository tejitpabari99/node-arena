import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';

/** Produces the level-number label texture: white number, black outline, `stage` pips under it (validation.md). */
export interface LabelPainter {
  /** `stageIndex` is 0-based (view stage - 1); pips drawn = stageIndex + 1. Textures are cached per (level, stageIndex). */
  texture(level: number, stageIndex: number): Texture;
  dispose(): void;
}

export const LABEL_FONT_FAMILY = 'Coiny';
export const LABEL_FONT_FILE = 'fonts/Coiny-Regular.ttf';
/** Outline: black, alpha 0.55, width 0.18 x font size (validation.md). */
export const LABEL_OUTLINE = { color: 'rgba(0,0,0,0.55)', width: 0.18 } as const;
const SIZE = 128, FONT_PX = 64;

/** Registers Coiny Regular (SIL OFL 1.1, assets/fonts) with document.fonts; resolves quietly (fallback sans-serif) when unavailable. */
export async function loadLabelFont(baseURL = '/'): Promise<boolean> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
  try {
    const face = new FontFace(LABEL_FONT_FAMILY, `url(${baseURL.replace(/\/$/, '')}/${LABEL_FONT_FILE})`);
    document.fonts.add(await face.load());
    return true;
  } catch { return false; }
}

export type CanvasFactory = () => HTMLCanvasElement;

export function createCanvasLabelPainter(makeCanvas: CanvasFactory = () => document.createElement('canvas')): LabelPainter {
  const cache = new Map<string, CanvasTexture>();
  return {
    texture(level, stageIndex) {
      const key = `${level}:${stageIndex}`;
      let t = cache.get(key);
      if (!t) { t = new CanvasTexture(paint(makeCanvas(), level, stageIndex)); t.colorSpace = SRGBColorSpace; cache.set(key, t); }
      return t;
    },
    dispose() { for (const t of cache.values()) t.dispose(); cache.clear(); },
  };
}

function paint(canvas: HTMLCanvasElement, level: number, stageIndex: number): HTMLCanvasElement {
  canvas.width = SIZE; canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  g.clearRect(0, 0, SIZE, SIZE);
  g.font = `${FONT_PX}px ${LABEL_FONT_FAMILY}, "Arial Black", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.strokeStyle = LABEL_OUTLINE.color; g.lineWidth = LABEL_OUTLINE.width * FONT_PX; g.fillStyle = '#fff';
  const cy = SIZE * 0.44;
  g.strokeText(String(level), SIZE / 2, cy); g.fillText(String(level), SIZE / 2, cy);
  const pips = stageIndex + 1, r = 6, gap = 18, y = SIZE * 0.82;
  for (let i = 0; i < pips; i++) {
    const x = SIZE / 2 + (i - (pips - 1) / 2) * gap;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.lineWidth = LABEL_OUTLINE.width * FONT_PX * 0.6; g.stroke(); g.fill();
  }
  return canvas;
}
