import { lanePoint, makeLane, type Interval, type Lane, type Point } from './geometry.js';
import { checked, compareSumProducts, idiv } from './math.js';
import type { Channel, SimState } from './types.js';

export interface CrossingPair { readonly a: number; readonly b: number; readonly laneA: Lane; readonly laneB: Lane; readonly windowA: Interval; readonly windowB: Interval; readonly denominator: number; readonly ax: number; readonly az: number; readonly bx: number; readonly bz: number }
interface Cache { pairs: CrossingPair[]; active: CrossingPair[]; keys: Set<number> }
const caches = new WeakMap<SimState, Cache>();

type Fraction = { n: bigint; d: bigint };
/** Cold exact point-to-segment distance, with a rational point. */
function segmentDistance(x: bigint, z: bigint, denominator: bigint, lane: Lane): Fraction {
  const dx=BigInt(lane.dx), dz=BigInt(lane.dz), norm=dx*dx+dz*dz;
  const ox=x-BigInt(lane.a.x)*denominator, oz=z-BigInt(lane.a.z)*denominator;
  const dot=ox*dx+oz*dz;
  if (dot<=0n || norm===0n) return {n:ox*ox+oz*oz,d:denominator*denominator};
  if (dot>=norm*denominator) { const ex=x-BigInt(lane.b.x)*denominator,ez=z-BigInt(lane.b.z)*denominator; return {n:ex*ex+ez*ez,d:denominator*denominator}; }
  const cross=ox*dz-oz*dx;
  return {n:cross*cross,d:norm*denominator*denominator};
}
function compare(a: Fraction,b: Fraction): number { const d=a.n*b.d-b.n*a.d; return d<0n?-1:d>0n?1:0; }
function segmentsTouch(a: Lane,b: Lane,radius: number): boolean {
  const cross=(x:bigint,z:bigint,u:bigint,v:bigint):bigint=>x*v-z*u;
  const dx=BigInt(b.a.x-a.a.x),dz=BigInt(b.a.z-a.a.z), ax=BigInt(a.dx),az=BigInt(a.dz),bx=BigInt(b.dx),bz=BigInt(b.dz);
  let denominator=cross(ax,az,bx,bz),s=cross(dx,dz,bx,bz),u=cross(dx,dz,ax,az);
  if(denominator<0n){denominator=-denominator;s=-s;u=-u;}
  if(denominator>0n&&s>=0n&&s<=denominator&&u>=0n&&u<=denominator)return true;
  const r={n:BigInt(radius)**2n,d:1n};
  return [segmentDistance(BigInt(a.a.x),BigInt(a.a.z),1n,b),segmentDistance(BigInt(a.b.x),BigInt(a.b.z),1n,b),segmentDistance(BigInt(b.a.x),BigInt(b.a.z),1n,a),segmentDistance(BigInt(b.b.x),BigInt(b.b.z),1n,a)].some(d=>compare(d,r)<=0);
}
/** Conservative integer envelope of continuous contact. One world milli of
 * padding covers sub-progress-unit tangencies; the narrow phase is exact. */
function window(a: Lane,b: Lane,radius: number): Interval {
  const L=BigInt(a.length||1),dx=BigInt(a.dx),dz=BigInt(a.dz),x=BigInt(a.a.x)*L,z=BigInt(a.a.z)*L;
  const score=(p:number):Fraction=>segmentDistance(x+dx*BigInt(p),z+dz*BigInt(p),L,b);
  const r={n:BigInt(radius+1)**2n,d:1n};
  let lo=0,hi=a.length;
  while(lo<hi){const mid=idiv(lo+hi,2);if(compare(score(mid),score(mid+1))<0)hi=mid;else lo=mid+1;}
  const minimum=lo;
  lo=0;hi=minimum;
  while(lo<hi){const mid=idiv(lo+hi,2);if(compare(score(mid),r)<=0)hi=mid;else lo=mid+1;}
  const start=Math.max(0,lo-1);
  lo=minimum;hi=a.length;
  while(lo<hi){const mid=idiv(lo+hi+1,2);if(compare(score(mid),r)<=0)lo=mid;else hi=mid-1;}
  return [start,Math.min(a.length,lo+1)];
}
/** All geometry (including rarely drawn lanes) is compiled at create, never
 * in commands or ticks. Cache is derived and deliberately absent from hashes. */
function rationalDirections(a: Lane,b: Lane): Pick<CrossingPair,'denominator'|'ax'|'az'|'bx'|'bz'> {
  const div=(a:bigint,b:bigint):bigint=>BigInt(idiv(checked(Number(a)),checked(Number(b))));
  const gcd=(a:bigint,b:bigint):bigint=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){const r=a%b;a=b;b=r;}return a;};
  const reduce=(l:Lane):{x:bigint;z:bigint;d:bigint}=>{const d=BigInt(l.length||1),x=BigInt(l.dx),z=BigInt(l.dz),g=gcd(gcd(x,z),d);return {x:div(x,g),z:div(z,g),d:div(d,g)};};
  const A=reduce(a),B=reduce(b),D=div(A.d,gcd(A.d,B.d))*B.d;
  return {denominator:checked(Number(D)),ax:checked(Number(A.x*div(D,A.d))),az:checked(Number(A.z*div(D,A.d))),bx:checked(Number(B.x*div(D,B.d))),bz:checked(Number(B.z*div(D,B.d)))};
}
export function createCrossings(state: SimState): void {
  const roads:{key:number;lane:Lane}[]=[],n=state.buildings.n,pairs:CrossingPair[]=[];
  for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)roads.push({key:a*n+b,lane:makeLane(state.level.buildings[a]!,state.level.buildings[b]!)});
  for(let i=0;i<roads.length;i++)for(let j=i+1;j<roads.length;j++){
    const a=roads[i]!,b=roads[j]!;
    if(!segmentsTouch(a.lane,b.lane,state.level.rules.contactDistance))continue;
    const wa=window(a.lane,b.lane,state.level.rules.contactDistance),wb=window(b.lane,a.lane,state.level.rules.contactDistance);
    for(const reverseA of [false,true])for(const reverseB of [false,true]){
      const orient=(road:typeof a,w:Interval,reverse:boolean):{key:number;lane:Lane;window:Interval}=>reverse?{key:(road.key%n)*n+idiv(road.key,n),lane:makeLane(road.lane.b,road.lane.a,road.lane.length),window:[road.lane.length-w[1],road.lane.length-w[0]]}:{...road,window:w};
      const A=orient(a,wa,reverseA),B=orient(b,wb,reverseB),[first,second]=A.key<B.key?[A,B]:[B,A];
      pairs.push({a:first.key,b:second.key,laneA:first.lane,laneB:second.lane,windowA:first.window,windowB:second.window,...rationalDirections(first.lane,second.lane)});
    }
  }
  pairs.sort((a,b)=>a.a-b.a||a.b-b.b);
  caches.set(state,{pairs,active:[],keys:new Set()});
  refreshCrossings(state);
}
export function refreshCrossings(state: SimState): void {
  const cache=caches.get(state); if(!cache)return;
  const keys=new Set([...state.channels.values()].filter(ch=>ch.drawn||ch.troops.len).map(ch=>ch.key));
  if(keys.size===cache.keys.size&&[...keys].every(key=>cache.keys.has(key)))return;
  cache.keys=keys;
  cache.active=cache.pairs.filter(pair=>cache.keys.has(pair.a)&&cache.keys.has(pair.b));
}
export function activeCrossings(state: SimState): readonly CrossingPair[] {
  const cache=caches.get(state);if(!cache)throw new Error('Crossing cache not initialized');
  // Death/arrival can drain a cut channel without a line hook.
  if([...cache.keys].some(key=>{const ch=state.channels.get(key);return !ch||(!ch.drawn&&!ch.troops.len);}))refreshCrossings(state);
  return cache.active;
}

// Signed factored polynomials. Small ordinary lanes collapse to scalar
// operations; large rational products fall back to exact Number limbs.
type Terms = number[][];
function compact(terms:Terms):Terms {
  let sum=0;
  for(const factors of terms){let p=1;for(const v of factors){p*=v;if(!Number.isSafeInteger(p))return terms;}sum+=p;if(!Number.isSafeInteger(sum))return terms;}
  return sum===0?[]:[[sum]];
}
const plus=(a:Terms,b:Terms):Terms=>compact([...a,...b]);
const times=(a:Terms,b:Terms):Terms=>compact(a.flatMap(x=>b.map(y=>[...x,...y])));
const scale=(a:Terms,...factors:number[]):Terms=>times(a,[factors]);
function sign(a:Terms,b:Terms=[]):number {
  const left=compact(a),right=compact(b);
  if(left.length<=1&&right.length<=1&&(left[0]?.length??0)<=1&&(right[0]?.length??0)<=1){const x=left[0]?.[0]??0,y=right[0]?.[0]??0;return x<y?-1:x>y?1:0;}
  return compareSumProducts(left,right);
}
interface Time { n:number; d:number }
interface Motion { p:number; v:number }
function motion(state:SimState,ch:Channel,i:number,out:Motion={p:0,v:0}):Motion {
  const t=ch.troops.t0[i]!,speed=state.level.units[ch.troops.kind[i]!]!.speed;
  // A troop born in phase 5 exists at progress zero, not one speed behind it.
  out.p=checked(ch.troops.p0[i]!+Math.max(0,state.tick-1-t)*speed);out.v=t>=state.tick?0:speed;return out;
}
/** Exact swept minimum for the small, rounded world-coordinate trajectory.
 * Unsafe scalar coefficients defer to the full rational solver. Products in the
 * discriminant stay factored for exact Number-limb comparison. */
function roundedSweep(rx:number,rz:number,vx:number,vz:number,radius:number):boolean|undefined {
  const values=[rx*rx,rz*rz,vx*vx,vz*vz,rx*vx,rz*vz,radius*radius];
  if(!values.every(Number.isSafeInteger))return undefined;
  const aa=values[2]!+values[3]!,bb=values[4]!+values[5]!,cc=values[0]!+values[1]!-values[6]!;
  const end=cc+2*bb+aa;
  if(![aa,bb,cc,end,cc+2*bb,2*bb,bb+aa,values[0]!+values[1]!].every(Number.isSafeInteger))return undefined;
  if(cc<=0||end<=0)return true;
  return bb<0&&bb+aa>0&&compareSumProducts([[cc,aa]],[[bb,bb]])<=0;
}
/** Exact continuous distance over a tick, split at physical endpoints.
 * Certified bounds account for rounding; ambiguous cases use the rational
 * polynomial. No BigInt or floating-point distance enters the tick path. */
interface PreparedSweep { readonly motion:Motion; readonly start:Point; readonly end:Point }
function prepareSweep(state:SimState,ch:Channel,i:number,lane:Lane):PreparedSweep {
  const m=motion(state,ch,i);
  return {motion:m,start:lanePoint(lane,Math.max(0,Math.min(lane.length,m.p))),
    end:lanePoint(lane,Math.max(0,Math.min(lane.length,checked(m.p+m.v))))};
}
/** Coordinate truncation has <2 milli relative error per axis. */
export function sweepsMayTouch(a:PreparedSweep,b:PreparedSweep,r:number):boolean {
  return !(Math.max(a.start.x,a.end.x)+r+2<Math.min(b.start.x,b.end.x)||
    Math.max(b.start.x,b.end.x)+r+2<Math.min(a.start.x,a.end.x)||
    Math.max(a.start.z,a.end.z)+r+2<Math.min(b.start.z,b.end.z)||
    Math.max(b.start.z,b.end.z)+r+2<Math.min(a.start.z,a.end.z));
}
export function sweepCrossed(state:SimState,pair:CrossingPair,A:Channel,ia:number,B:Channel,ib:number):boolean {
  return sweepPrepared(state,pair,prepareSweep(state,A,ia,pair.laneA),prepareSweep(state,B,ib,pair.laneB));
}
/** Prepared trajectories stay valid for this crossing pass: combat only removes
 * rows. Callers still recheck sequence liveness before applying an exchange. */
export function sweepPrepared(state:SimState,pair:CrossingPair,A:PreparedSweep,B:PreparedSweep):boolean {
  const ma=A.motion,mb=B.motion,a=pair.laneA,b=pair.laneB,r=state.level.rules.contactDistance;
  const a0=A.start,a1=A.end,b0=B.start,b1=B.end;
  if(!sweepsMayTouch(A,B,r))return false;
  // Only an unclamped tick is linear between these rounded endpoints. Each
  // endpoint has <1 milli error per coordinate per troop. Interpolation keeps
  // relative error <2 per axis, hence Euclidean error <sqrt(8)<3 milli at every
  // time. Inner/outer certificates preserve the exact r boundary; only the
  // three-milli uncertainty band pays for the rational polynomial below.
  if(ma.p>=0&&ma.p+ma.v<=a.length&&mb.p>=0&&mb.p+mb.v<=b.length) {
    const rx=a0.x-b0.x,rz=a0.z-b0.z,vx=a1.x-a0.x-b1.x+b0.x,vz=a1.z-a0.z-b1.z+b0.z;
    if(r>=3&&roundedSweep(rx,rz,vx,vz,r-3)===true)return true;
    if(roundedSweep(rx,rz,vx,vz,r+3)===false)return false;
  }
  const timesList:Time[]=[{n:0,d:1},{n:1,d:1}];
  for(const [m,L] of [[ma,a.length],[mb,b.length]] as const)if(m.v>0)for(const edge of [0,L]){const n=edge-m.p;if(n>0&&n<m.v)timesList.push({n,d:m.v});}
  timesList.sort((x,y)=>sign([[x.n,y.d]],[[y.n,x.d]]));
  const D=[pair.denominator];
  for(let k=1;k<timesList.length;k++){
    const lo=timesList[k-1]!,hi=timesList[k]!;
    if(sign([[lo.n,hi.d]],[[hi.n,lo.d]])===0)continue;
    // Determine the linear branch at the right endpoint, choosing the moving
    // branch when it first reaches an endpoint (the preceding interval).
    const branch=(m:Motion,L:number):Motion=>{
      if(sign([[m.p,lo.d],[m.v,lo.n]],[[L,lo.d]])>=0)return {p:L,v:0};
      if(sign([[m.p,hi.d],[m.v,hi.n]])<=0)return {p:0,v:0};
      return m;
    };
    const x=branch(ma,a.length),y=branch(mb,b.length);
    const coord=(axis:'x'|'z'):Terms=>compact([[checked(a.a[axis]-b.a[axis]),...D],[axis==='x'?pair.ax:pair.az,x.p],[-(axis==='x'?pair.bx:pair.bz),y.p]]);
    const velocity=(axis:'x'|'z'):Terms=>compact([[axis==='x'?pair.ax:pair.az,x.v],[-(axis==='x'?pair.bx:pair.bz),y.v]]);
    const rx=coord('x'),rz=coord('z'),vx=velocity('x'),vz=velocity('z');
    const aa=plus(times(vx,vx),times(vz,vz)),bb=plus(times(rx,vx),times(rz,vz));
    const cc=plus(plus(times(rx,rx),times(rz,rz)),[[-r,r,...D,...D]]);
    const at=(t:Time):Terms=>plus(plus(scale(cc,t.d,t.d),scale(bb,2,t.n,t.d)),scale(aa,t.n,t.n));
    if(sign(at(lo))<=0||sign(at(hi))<=0)return true;
    if(sign(plus(scale(bb,lo.d),scale(aa,lo.n)))<0&&sign(plus(scale(bb,hi.d),scale(aa,hi.n)))>0&&sign(times(cc,aa),times(bb,bb))<=0)return true;
  }
  return false;
}
/** One immutable motion row per live troop, rebuilt after head-on combat each tick.
 * Sequence order survives deaths during the crossing pass; consumers recheck liveness. */
export interface CrossingRow { seq:number; start:number; end:number; owner:number; readonly motion:Motion; readonly sweep:PreparedSweep; ready:boolean }
export interface CrossingScratch { readonly rows:CrossingRow[]; readonly pool:CrossingRow[]; start:number; end:number; owner:number|undefined }
export function createCrossingScratch():CrossingScratch { return {rows:[],pool:[],start:0,end:0,owner:undefined}; }
/** Scratch is private to its owning contact pass. Overwrite after head-on;
 * previous rows and endpoint projections must never survive into a new tick. */
export function fillCrossingScratch(state:SimState,ch:Channel,scratch:CrossingScratch):void {
  const {rows,pool}=scratch;rows.length=ch.troops.len;
  let ordered=true,start=ch.length,end=0,owner:number|undefined=ch.troops.owner[0];
  for(let i=0;i<ch.troops.len;i++) {
    let row=pool[i];
    if(!row) {
      const m={p:0,v:0};row={seq:0,start:0,end:0,owner:0,motion:m,ready:false,sweep:{motion:m,start:{x:0,z:0},end:{x:0,z:0}}};pool[i]=row;
    }
    const m=motion(state,ch,i,row.motion);
    row.seq=ch.troops.seq[i]!;row.owner=ch.troops.owner[i]!;row.ready=false;
    row.start=Math.max(0,Math.min(ch.length,m.p));row.end=Math.max(0,Math.min(ch.length,checked(m.p+m.v)));
    rows[i]=row;
    start=Math.min(start,row.start);end=Math.max(end,row.end);
    if(row.owner!==owner)owner=undefined;
    if(i>0&&row.seq<rows[i-1]!.seq)ordered=false;
  }
  if(!ordered)rows.sort((a,b)=>a.seq-b.seq);
  scratch.start=start;scratch.end=end;scratch.owner=owner;
}
/** Independent allocating wrapper for internal consumers outside the hot pass. */
export function crossingRows(state:SimState,ch:Channel):CrossingRow[] {
  const scratch=createCrossingScratch();fillCrossingScratch(state,ch,scratch);return scratch.rows;
}
/** Project only rows entering a crossing window, into reusable point storage. */
export function prepareCrossingRow(row:CrossingRow,lane:Lane):PreparedSweep {
  if(!row.ready) { lanePoint(lane,row.start,row.sweep.start);lanePoint(lane,row.end,row.sweep.end);row.ready=true; }
  return row.sweep;
}
/** Mixed speeds require testing every row; progress order need not be monotone. */
export function crossingCandidates(state:SimState,ch:Channel,range:Interval):number[] {
  return crossingRows(state,ch).filter(row=>row.end>=range[0]&&row.start<=range[1]).map(row=>row.seq);
}
