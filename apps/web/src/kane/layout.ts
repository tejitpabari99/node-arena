/** Fixed panel size in CSS pixels; shared by the overlay and camera. */
export function panelHeight(viewportH: number): number {
  return Math.min(220, Math.max(140, .22 * viewportH));
}
