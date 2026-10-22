import { canDraw } from '../commands.js';
import { AXIS_SCALE, corridorOverlaps, lanePoint, makeLane, yawAxes } from '../geometry.js';
import type { Lane, Polygon, Shape } from '../geometry.js';
import { idiv } from '../math.js';
import type { CompiledLevel, DrawExplanation, SimModuleFor, SimState } from '../types.js';

/** Cold algebraic entry progress: (a - sqrt(b)) / d, d > 0. */
interface Entry { a: bigint; b: bigint; d: bigint }
const ZERO: Entry = { a: 0n, b: 0n, d: 1n };
const caches = new WeakMap<SimState, readonly (DrawExplanation | null)[]>();
const sign = (n: bigint): number => n < 0n ? -1 : n > 0n ? 1 : 0;

/** Sign of a + sqrt(y) - sqrt(x), using exact integer squaring. */
function radicalSign(a: bigint, x: bigint, y: bigint): number {
  if (a < 0n) return -radicalSign(-a, y, x);
  const c = a*a + y - x;
  if (c >= 0n) return c > 0n || a*a*y > 0n ? 1 : 0;
  return sign(4n*a*a*y - c*c);
}
function compareEntry(a: Entry, b: Entry): number {
  return radicalSign(a.a*b.d-b.a*a.d, a.b*b.d*b.d, b.b*a.d*a.d);
}

/** First overlap of the swept square with a box. SAT constraints give exact
 * rational entry times, including square corners and the endpoint extension.
 * Invoked only after full-corridor SAT has established strict overlap. */
function boxEntry(lane: Lane, shape: Extract<Shape, { shape: 'box' }>, width: number): Entry {
  const L=BigInt(lane.length), dx=BigInt(lane.dx), dz=BigInt(lane.dz), w=BigInt(width)*20n;
  const { cos, sin }=yawAxes(shape.yawMilliDeg ?? 0), c=BigInt(cos), s=BigInt(sin), Q=2n*BigInt(AXIS_SCALE);
  const square: Polygon={denominator:L,vertices:[]}, box: Polygon={denominator:Q,vertices:[]};
  for (const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
    const U=BigInt(u!),V=BigInt(v!);
    square.vertices.push({x:BigInt(lane.a.x)*L+dx*w*U-dz*w*V,z:BigInt(lane.a.z)*L+dz*w*U+dx*w*V});
    box.vertices.push({x:BigInt(shape.x)*Q+c*U*BigInt(shape.w)-s*V*BigInt(shape.d),z:BigInt(shape.z)*Q+s*U*BigInt(shape.w)+c*V*BigInt(shape.d)});
  }
  let entry=ZERO;
  for (const poly of [square,box]) for(let i=0;i<4;i++) {
    const p=poly.vertices[i]!,q=poly.vertices[(i+1)%4]!,nx=p.z-q.z,nz=q.x-p.x;
    const velocity=dx*nx+dz*nz;
    if(velocity===0n) continue;
    const range=(polygon:Polygon):[bigint,bigint]=>{
      const values=polygon.vertices.map(v=>v.x*nx+v.z*nz);
      return [values.reduce((a,b)=>a<b?a:b),values.reduce((a,b)=>a>b?a:b)];
    };
    const [al,ah]=range(square),[bl,bh]=range(box);
    const bound:Entry=velocity>0n ? {a:bl*L-ah*Q,b:0n,d:velocity*Q} : {a:al*Q-bh*L,b:0n,d:-velocity*Q};
    if(compareEntry(bound,entry)>0) entry=bound;
  }
  return entry;
}
function corridorEntry(lane: Lane, shape: Shape, width: number): Entry {
  if(!lane.length) return ZERO;
  if(shape.shape==='box') return boxEntry(lane,shape,width);
  const dx=BigInt(lane.dx),dz=BigInt(lane.dz),L=BigInt(lane.length),W=BigInt(width)*20n;
  const x=BigInt(shape.x-lane.a.x),z=BigInt(shape.z-lane.a.z),S=dx*dx+dz*dz;
  const cross=x*dz-z*dx;
  const gap=(cross<0n?-cross:cross)*L-W*S;
  const excess=gap>0n?gap:0n;
  const entry={a:(x*dx+z*dz)*L-W*S,b:BigInt(shape.radius)**2n*L*L*S-excess*excess,d:S};
  return compareEntry(entry,ZERO)>0 ? entry : ZERO;
}
function entryPoint(lane:Lane,entry:Entry): {x:number;z:number} {
  // First integer progress strictly after contact. Keep the clamped source for
  // initial overlap; display positions use the engine's signed truncation.
  let lo=0,hi=lane.length;
  if(compareEntry(entry,ZERO)===0) return lanePoint(lane,0);
  while(lo<hi){const mid=idiv(lo+hi,2);if(compareEntry(entry,{a:BigInt(mid),b:0n,d:1n})<0)hi=mid;else lo=mid+1;}
  return lanePoint(lane,lo);
}
function footprintShape(placement: CompiledLevel['elements'][number] | CompiledLevel['buildings'][number]): Shape {
  const f=placement.footprint;
  return f.shape==='circle' ? {shape:'circle',x:placement.x,z:placement.z,radius:f.radius!} :
    {shape:'box',x:placement.x,z:placement.z,w:f.w!,d:f.d!,yawMilliDeg:'yawMilliDeg' in placement ? placement.yawMilliDeg : 0};
}
function init(state:SimState):void {
  const { level }=state,n=level.buildings.length,width=level.rules.laneHalfWidth;
  const matrix:(DrawExplanation|null)[]=Array.from({length:n*n},()=>null);
  const obstacles=level.elements.filter(e=>e.modules['blocksLines']!==undefined);
  for(let from=0;from<n;from++) for(let to=0;to<n;to++) {
    if(from===to) continue;
    const lane=makeLane(level.buildings[from]!,level.buildings[to]!);
    let first:Entry|null=null, explanation:DrawExplanation|null=null;
    const consider=(placement:typeof obstacles[number]|typeof level.buildings[number],reason:'blocked-obstacle'|'blocked-building'):void=>{
      const shape=footprintShape(placement);
      if(!corridorOverlaps(lane,shape,width,width)) return;
      const entry=corridorEntry(lane,shape,width);
      const order=first===null?-1:compareEntry(entry,first);
      if(order<0 || (order===0 && placement.id<explanation!.ref)) {
        first=entry; explanation={reason,point:entryPoint(lane,entry),ref:placement.id};
      }
    };
    for(const obstacle of obstacles) consider(obstacle,'blocked-obstacle');
    for(let i=0;i<n;i++) if(i!==from&&i!==to) consider(level.buildings[i]!,'blocked-building');
    matrix[from*n+to]=explanation;
  }
  caches.set(state,matrix);
}

/** Static geometry is paid once at create; commands and previews only read. */
export const blocksLines: SimModuleFor<'blocksLines'> = {
  id: 'blocksLines', init,
  hooks: { validateDraw: (state,from,to) => caches.get(state)?.[from*state.buildings.n+to]?.reason ?? null },
};

/** Return a fresh explanation only when blocking is the actual draw rejection.
 * Delegating input validation preserves command precedence and never coerces
 * unknown values (including throwing proxies). No geometry runs on this path. */
export function explainDraw(state: SimState, player: unknown, from: unknown, to: unknown): DrawExplanation | null {
  const reason=canDraw(state,player,from,to);
  if(reason!=='blocked-obstacle'&&reason!=='blocked-building') return null;
  const found=caches.get(state)?.[(from as number)*state.buildings.n+(to as number)];
  return found ? {reason:found.reason,point:{...found.point},ref:found.ref} : null;
}
