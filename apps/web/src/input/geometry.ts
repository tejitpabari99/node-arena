export interface Point2 { readonly x: number; readonly y: number }
/** Euclidean distance in the caller's coordinates (input uses canvas CSS pixels). */
export function pointSegmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/length2));
  return Math.hypot(p.x-a.x-t*dx, p.y-a.y-t*dy);
}
export function segmentDistance(a: Point2, b: Point2, c: Point2, d: Point2): number {
  const cross = (p: Point2, q: Point2, r: Point2) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const ac = cross(a,b,c), ad = cross(a,b,d), ca = cross(c,d,a), cb = cross(c,d,b);
  if (((ac < 0 && ad > 0) || (ac > 0 && ad < 0)) && ((ca < 0 && cb > 0) || (ca > 0 && cb < 0))) return 0;
  // Endpoint distances also cover collinear overlap/touch, near-parallel and degenerate segments.
  return Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
}
/** Hit radii in CSS px for a lane with half width `halfLanePx`: right-click/hover vs swipe. */
export const hoverRadius = (halfLanePx: number) => Math.max(12, halfLanePx + 4);
export const swipeRadius = (halfLanePx: number) => Math.max(8, halfLanePx);
