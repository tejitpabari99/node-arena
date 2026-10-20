/** HUD colour tokens (SP03 palette). Task 4 mirrors these in CSS `:root`. */
export const HUD_TOKENS = {
  blue: '#2E8BFF',
  sand: '#FFE1B3',
  grass: '#A3D419',
  /** Pill background: deep blue derived from the SP03 blue so white text keeps >= 4.5:1. */
  pillBg: '#1B5BC0',
  pillText: '#FFFFFF',
} as const;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
