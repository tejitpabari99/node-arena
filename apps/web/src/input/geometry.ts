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

/** World-unit margin around each building footprint; projected picks have a 22 CSS px floor. */
export const PICK_MARGIN = .35;
interface PickAnchor { readonly pos: { readonly x: number; readonly z: number }; readonly radius: number }
interface ScreenAnchor extends Point2 { readonly radius: number }
/** Ground fallback after mesh picking; projected center distance resolves overlapping touch floors. */
export function pickBuilding(ground: { x: number; z: number }, pointer: Point2, anchors: readonly (PickAnchor | undefined)[], screens: readonly ScreenAnchor[]): number | null {
  let nearest = Infinity, building: number | null = null;
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i], screen = screens[i];
    if (!anchor || !screen) continue;
    const radius = anchor.radius + PICK_MARGIN;
    const projectedRadius = screen.radius * radius / anchor.radius;
    const screenDistance2 = (pointer.x - screen.x) ** 2 + (pointer.y - screen.y) ** 2;
    const inside = projectedRadius < 22 ? screenDistance2 <= 22 ** 2
      : (ground.x - anchor.pos.x) ** 2 + (ground.z - anchor.pos.z) ** 2 <= radius ** 2;
    if (inside && screenDistance2 < nearest) { nearest = screenDistance2; building = i; }
  }
  return building;
}
