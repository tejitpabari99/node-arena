import { TICK_RATE, checked, compareRationalSquares, idiv, isqrt, mulDiv } from './math.js';

/** 32 CORDIC rotation angles, atan(2^-i) in nearest nanodegrees.
 * Offline constants; runtime uses only exact safe integers. Q40 vectors
 * leave ample headroom before final Q20 rounding. */
const CORDIC_ANGLES = [45000000000,26565051177,14036243468,7125016349,3576334375,1789910608,895173710,447614171,223810500,111905677,55952892,27976453,13988227,6994114,3497057,1748528,874264,437132,218566,109283,54642,27321,13660,6830,3415,1708,854,427,213,107,53,27] as const;
const CORDIC_GAIN_Q40 = 667681663043;
export const AXIS_SCALE = 1048576;
export interface Point { x: number; z: number }
/** World coordinates are milli; length and parameters are ENGINE progress
 * (milli * 20). Rational point = a + (b-a)*progress/length, without rounding.
 * The floored length does not give a unit vector: do not use a normalized
 * (s-proj)^2+perp² identity. */
export interface Lane { a: Point; b: Point; dx: number; dz: number; length: number }
export type Shape = ({ shape: 'circle'; radius: number } | { shape: 'box'; w: number; d: number; yawMilliDeg?: number }) & Point;
/** Inclusive integer engine-progress bounds; empty if no integer point lies inside. */
export type Interval = [number, number];
export interface DistanceSq { x: number; z: number; denominator: number }

export function makeLane(a: Point, b: Point, lengthProgress?: number): Lane {
  checked(a.x); checked(a.z); checked(b.x); checked(b.z);
  const dx = checked(b.x - a.x), dz = checked(b.z - a.z);
  const x = checked(dx * TICK_RATE), z = checked(dz * TICK_RATE);
  const length = lengthProgress ?? isqrt(checked(checked(x * x) + checked(z * z)));
  checked(length);
  if (length < 0 || (length === 0 && (dx !== 0 || dz !== 0))) throw new RangeError('Invalid lane length');
  return { a: { ...a }, b: { ...b }, dx, dz, length };
}
/** Integer world point with signed truncation, identical to troopPosition. */
export function lanePoint(lane: Lane, progress: number, out: Point = { x: 0, z: 0 }): Point {
  checked(progress);
  out.x = lane.length ? checked(lane.a.x + mulDiv(lane.dx, progress, lane.length)) : lane.a.x;
  out.z = lane.length ? checked(lane.a.z + mulDiv(lane.dz, progress, lane.length)) : lane.a.z;
  return out;
}
/** Exact projection in engine-progress: numerator * scale / denominator.
 * Keep the factors separate: their product need not be a safe Number. */
export function proj(lane: Lane, point: Point): { numerator: number; scale: number; denominator: number } {
  const x = checked(point.x - lane.a.x), z = checked(point.z - lane.a.z);
  return { numerator: checked(checked(x * lane.dx) + checked(z * lane.dz)), scale: lane.length,
    denominator: checked(checked(lane.dx * lane.dx) + checked(lane.dz * lane.dz)) || 1 };
}
/** Exact perpendicular world milli² distance: cross² / denominator.
 * Degenerate lane uses distanceSq(lane,point,0) instead (no direction). */
export function perpSq(lane: Lane, point: Point): { cross: number; denominator: number } {
  const x = checked(point.x - lane.a.x), z = checked(point.z - lane.a.z);
  if (!lane.length) throw new RangeError('Degenerate lane has no perpendicular');
  return { cross: checked(checked(x * lane.dz) - checked(z * lane.dx)),
    denominator: checked(checked(lane.dx * lane.dx) + checked(lane.dz * lane.dz)) };
}
/** Squared world distance = (x²+z²)/denominator². Number-only hot path.
 * Coordinates within +/-500000 and full lane progress <=28284271 are tested.
 * All scalar intermediates checked; large squared products use Number limbs. */
export function distanceSq(lane: Lane, point: Point, progress: number): DistanceSq {
  checked(progress);
  const denominator = lane.length || 1;
  return { x: checked(checked(checked(lane.a.x - point.x) * denominator) + checked(lane.dx * progress)),
    z: checked(checked(checked(lane.a.z - point.z) * denominator) + checked(lane.dz * progress)), denominator };
}
export function compareDistanceSq(a: DistanceSq, b: DistanceSq): number {
  return compareRationalSquares(a.x, a.z, a.denominator, b.x, b.z, b.denominator);
}
export function compareRadiusSq(distance: DistanceSq, radius: number): number {
  checked(radius);
  if (radius < 0) throw new RangeError('Negative radius');
  return compareDistanceSq(distance, { x: radius, z: 0, denominator: 1 });
}
/** Content yaw is an integer milli-degree (all fx3 values supported).
 * Positive yaw rotates local +x toward world -z (Unity/Three +Y).
 * Returned sin is world-z component, not mathematical sin(yaw).
 * CORDIC component error <1/Q20, including final rounding: residual angle
 * <= 44 nanodegrees (<0.001 Q20 units), Q40 vector error <0.001 Q20 units,
 * plus <=0.5 Q20 rounding. Cardinals are exact; represented axes are rational.
 */
export function yawAxes(yawMilliDeg: number): { cos: number; sin: number } {
  checked(yawMilliDeg);
  const yaw = ((yawMilliDeg % 360000) + 360000) % 360000;
  const quadrant = idiv(yaw, 90000), remainder = yaw % 90000;
  let cos: number, sin: number;
  if (remainder === 0) { cos = AXIS_SCALE; sin = 0; }
  else {
    let x = CORDIC_GAIN_Q40, y = 0, angle = remainder * 1000000, power = 1;
    for (const delta of CORDIC_ANGLES) {
      const direction = angle >= 0 ? 1 : -1;
      const nextX = checked(x - direction * idiv(y, power));
      y = checked(y + direction * idiv(x, power));
      x = nextX; angle -= direction * delta; power *= 2;
    }
    cos = idiv(x + 524288, AXIS_SCALE);
    sin = idiv(y + 524288, AXIS_SCALE);
  }
  const normalize = (n: number): number => n === 0 ? 0 : n;
  if (quadrant === 0) return { cos, sin: normalize(-sin) };
  if (quadrant === 1) return { cos: normalize(-sin), sin: -cos };
  if (quadrant === 2) return { cos: -cos, sin };
  return { cos: sin, sin: cos };
}
const abs = (n: bigint): bigint => n < 0n ? -n : n;
function validateShape(shape: Shape, pad: number): void {
  checked(shape.x); checked(shape.z); checked(pad);
  if (pad < 0) throw new RangeError('Negative pad');
  for (const n of shape.shape === 'circle' ? [shape.radius] : [shape.w, shape.d]) {
    checked(n); if (n < 0) throw new RangeError('Negative shape size');
  }
}

/** COLD ONLY. Convex rounded-shape intersection sampled at integer progress.
 * Euclidean padding for boxes (rounded corners), never inflated AABB corners.
 * Use strict=true to exclude boundary (e.g. inner annulus). Blocking must use
 * corridorOverlaps: a continuous overlap can fall between integer samples. */
export function laneIntervals(lane: Lane, shape: Shape, pad = 0, strict = false): Interval[] {
  validateShape(shape, pad);
  const L = BigInt(lane.length || 1), dx = BigInt(lane.dx), dz = BigInt(lane.dz);
  const ox = BigInt(lane.a.x - shape.x) * L, oz = BigInt(lane.a.z - shape.z) * L;
  let score: (p: number) => bigint;
  let threshold: bigint;
  let contains: ((p: number) => boolean) | undefined;
  if (shape.shape === 'circle') {
    score = p => { const x = ox + dx * BigInt(p), z = oz + dz * BigInt(p); return x*x + z*z; };
    threshold = (BigInt(shape.radius + pad) * L) ** 2n;
  } else {
    const axes = yawAxes(shape.yawMilliDeg ?? 0), c = BigInt(axes.cos), s = BigInt(axes.sin), Q = BigInt(AXIS_SCALE), N = c*c+s*s;
    const excess = (p: number): [bigint,bigint] => {
      const x=ox+dx*BigInt(p),z=oz+dz*BigInt(p);
      return [abs(2n*Q*(c*x+s*z))-BigInt(shape.w)*N*L, abs(2n*Q*(-s*x+c*z))-BigInt(shape.d)*N*L];
    };
    score = p => { const [x,z] = excess(p); return (x>0n?x*x:0n)+(z>0n?z*z:0n); };
    threshold = 4n*N*Q*Q*L*L*BigInt(pad)**2n;
    if (strict && pad === 0) contains = p => { const [x,z]=excess(p); return x<0n&&z<0n; };
  }
  const inside = contains ?? (p => strict ? score(p) < threshold : score(p) <= threshold);
  // Discrete convex minimizer; the rightmost point on a flat minimum also
  // permits strict zero-pad box tests to find their open interior.
  let low = 0, high = lane.length;
  while (low < high) { const mid = idiv(low+high,2); if(score(mid)<score(mid+1)) high=mid; else low=mid+1; }
  let minimum=low;
  if (!inside(minimum) && contains) {
    // A zero-distance plateau includes the boundary: locate its midpoint.
    let lo=0,hi=minimum;
    while(lo<hi){const mid=idiv(lo+hi,2);if(score(mid)===0n)hi=mid;else lo=mid+1;}
    minimum=idiv(lo+minimum,2);
  }
  if (!inside(minimum)) return [];
  low=0; high=minimum;
  while(low<high){const mid=idiv(low+high,2);if(inside(mid))high=mid;else low=mid+1;}
  const start=low;
  low=minimum; high=lane.length;
  while(low<high){const mid=idiv(low+high+1,2);if(inside(mid))low=mid;else high=mid-1;}
  return [[start,low]];
}

export type BigPoint = { x: bigint; z: bigint };
export interface Polygon { vertices: BigPoint[]; denominator: bigint }
function boxPolygon(shape: Extract<Shape,{shape:'box'}>): Polygon {
  const {cos,sin}=yawAxes(shape.yawMilliDeg??0),c=BigInt(cos),s=BigInt(sin),q=2n*BigInt(AXIS_SCALE);
  const vertices:BigPoint[]=[];
  for(const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
    const x=BigInt(u!)*BigInt(shape.w),z=BigInt(v!)*BigInt(shape.d);
    vertices.push({x:BigInt(shape.x)*q+c*x-s*z,z:BigInt(shape.z)*q+s*x+c*z});
  }
  return {vertices,denominator:q};
}
function corridorPolygon(lane: Lane,width:number,extension:number): Polygon {
  const l=BigInt(lane.length||TICK_RATE),q=l,dx=BigInt(lane.length?lane.dx*TICK_RATE:TICK_RATE),dz=BigInt(lane.length?lane.dz*TICK_RATE:0);
  const a={x:BigInt(lane.a.x)*q-dx*BigInt(extension),z:BigInt(lane.a.z)*q-dz*BigInt(extension)};
  const b={x:BigInt(lane.b.x)*q+dx*BigInt(extension),z:BigInt(lane.b.z)*q+dz*BigInt(extension)};
  const w=BigInt(width);
  return {vertices:[{x:a.x+dz*w,z:a.z-dx*w},{x:b.x+dz*w,z:b.z-dx*w},{x:b.x-dz*w,z:b.z+dx*w},{x:a.x-dz*w,z:a.z+dx*w}],denominator:q};
}
/** COLD ONLY. Strict SAT against exact rational polygon vertices. */
export function polygonsOverlap(a: Polygon,b:Polygon):boolean {
  for(const polygon of [a,b])for(let i=0;i<polygon.vertices.length;i++){
    const p=polygon.vertices[i]!,q=polygon.vertices[(i+1)%polygon.vertices.length]!,nx=p.z-q.z,nz=q.x-p.x;
    if(nx===0n&&nz===0n)continue;
    const range=(poly:Polygon):[bigint,bigint]=>{
      const values=poly.vertices.map(v=>v.x*nx+v.z*nz);
      return [values.reduce((x,y)=>x<y?x:y),values.reduce((x,y)=>x>y?x:y)];
    };
    const [al,ah]=range(a),[bl,bh]=range(b);
    if(ah*b.denominator<=bl*a.denominator||bh*a.denominator<=al*b.denominator)return false;
  }
  return true;
}
function polygonCircleOverlap(poly:Polygon,shape:Extract<Shape,{shape:'circle'}>):boolean {
  const Q=poly.denominator,point={x:BigInt(shape.x)*Q,z:BigInt(shape.z)*Q},r2=(BigInt(shape.radius)*Q)**2n;
  let inside=true;
  for(let i=0;i<poly.vertices.length;i++){
    const a=poly.vertices[i]!,b=poly.vertices[(i+1)%poly.vertices.length]!,dx=b.x-a.x,dz=b.z-a.z,x=point.x-a.x,z=point.z-a.z;
    const cross=dx*z-dz*x;
    if(cross<0n)inside=false;
    const length=dx*dx+dz*dz,dot=x*dx+z*dz;
    if(dot<=0n){if(x*x+z*z<r2)return true;}
    else if(dot>=length){const bx=point.x-b.x,bz=point.z-b.z;if(bx*bx+bz*bz<r2)return true;}
    else if(cross*cross<r2*length)return true;
  }
  return inside && shape.radius>0;
}
/** COLD ONLY. Oriented swept rectangle; tangent contact does not block.
 * Corridor transverse/extension vectors = (dx,dz)*20/engineLength,
 * preserving engine floor-length normalization (error <1/engineLength).
 * Zero-length lanes use axis-aligned +/-extension x +/-halfWidth. */
export function corridorOverlaps(lane:Lane,shape:Shape,halfWidth=190,endExtension=190):boolean {
  validateShape(shape,halfWidth); checked(endExtension);
  if(endExtension<0)throw new RangeError('Negative extension');
  const corridor=corridorPolygon(lane,halfWidth,endExtension);
  return shape.shape==='circle'?polygonCircleOverlap(corridor,shape):polygonsOverlap(corridor,boxPolygon(shape));
}
