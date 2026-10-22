const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const g = require('../src/geometry.ts');
const root = n => { let x=n, y=(x+1n)/2n; while(y<x){x=y;y=(x+n/x)/2n;} return x; };
let seed=82374; const rand=n => {seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
function oracle(lane,shape,p,pad=0,strict=false){
  const L=BigInt(lane.length||1), t=BigInt(p), x=BigInt(lane.a.x-shape.x)*L+BigInt(lane.dx)*t,z=BigInt(lane.a.z-shape.z)*L+BigInt(lane.dz)*t;
  let left,right;
  if(shape.shape==='circle'){left=x*x+z*z;right=(BigInt(shape.radius+pad)*L)**2n;}
  else {const {cos,sin}=g.yawAxes(shape.yawMilliDeg||0),c=BigInt(cos),s=BigInt(sin),q=1048576n,n=c*c+s*s;
    const abs=x=>x<0n?-x:x,ex=abs(2n*q*(c*x+s*z))-BigInt(shape.w)*n*L,ez=abs(2n*q*(-s*x+c*z))-BigInt(shape.d)*n*L;
    left=(ex>0n?ex:0n)**2n+(ez>0n?ez:0n)**2n; right=4n*n*q*q*L*L*BigInt(pad)**2n;
    if(pad===0&&strict) return ex<0n&&ez<0n;
  }
  return strict?left<right:left<=right;
}
test('geometry intervals match independent exhaustive BigInt oracle, circles, boxes, yaw and pad',()=>{
 for(let i=0;i<160;i++){
  const a={x:rand(41)-20,z:rand(41)-20},b={x:rand(41)-20,z:rand(41)-20},lane=g.makeLane(a,b);
  assert.equal(lane.length,Number(root(BigInt((b.x-a.x)*20)**2n+BigInt((b.z-a.z)*20)**2n)));
  const shape=i%2?{shape:'circle',x:rand(31)-15,z:rand(31)-15,radius:rand(10)}:{shape:'box',x:rand(31)-15,z:rand(31)-15,w:rand(20)+1,d:rand(20)+1,yawMilliDeg:(rand(721)-360)*1000};
  const pad=rand(5),strict=!!(i%3),expected=[];
  for(let p=0;p<=lane.length;p++)if(oracle(lane,shape,p,pad,strict))expected.push(p);
  const intervals=g.laneIntervals(lane,shape,pad,strict),actual=[];
  for(const [lo,hi] of intervals)for(let p=lo;p<=hi;p++)actual.push(p);
  assert.deepEqual(actual,expected,JSON.stringify({a,b,shape,pad,strict}));
 }
});
test('tangency, inner strict radius, zero lanes and exact oriented corridor corners',()=>{
 const lane=g.makeLane({x:0,z:0},{x:1000,z:0});
 assert.deepEqual(g.laneIntervals(lane,{shape:'circle',x:500,z:100,radius:100}),[[10000,10000]]);
 assert.deepEqual(g.laneIntervals(lane,{shape:'circle',x:500,z:100,radius:100},0,true),[]);
 assert.deepEqual(g.laneIntervals(g.makeLane({x:-1,z:-1},{x:-1,z:-1}),{shape:'circle',x:-1,z:-1,radius:0}),[[0,0]]);
 assert.equal(g.corridorOverlaps(lane,{shape:'box',x:500,z:200,w:100,d:20},190,190),false);
 assert.equal(g.corridorOverlaps(lane,{shape:'box',x:500,z:199,w:100,d:20},190,190),true);
 assert.equal(g.corridorOverlaps(lane,{shape:'circle',x:-290,z:0,radius:100}),false);
 assert.equal(g.corridorOverlaps(lane,{shape:'circle',x:-289,z:0,radius:100}),true);
 const diagonal=g.makeLane({x:0,z:0},{x:1000,z:1000});
 assert.equal(g.corridorOverlaps(diagonal,{shape:'box',x:0,z:1000,w:10,d:10}),false);
 assert.equal(g.corridorOverlaps(diagonal,{shape:'box',x:500,z:500,w:10,d:10,yawMilliDeg:45000}),true);
 assert.deepEqual(g.yawAxes(-90000),{cos:0,sin:1048576});
 assert.throws(()=>g.yawAxes(1),RangeError);
});
test('Number rational distances and projections agree with BigInt at campaign limits',()=>{
 for(let i=0;i<3000;i++){
  const lane=g.makeLane({x:rand(1000001)-500000,z:rand(1000001)-500000},{x:rand(1000001)-500000,z:rand(1000001)-500000});
  const point={x:rand(1000001)-500000,z:rand(1000001)-500000},p=rand(lane.length+1),q=rand(lane.length+1);
  const a=g.distanceSq(lane,point,p),b=g.distanceSq(lane,point,q);
  const exact=d=>BigInt(d.x)**2n+BigInt(d.z)**2n;
  const diff=exact(a)*BigInt(b.denominator)**2n-exact(b)*BigInt(a.denominator)**2n;
  assert.equal(g.compareDistanceSq(a,b),diff<0n?-1:diff>0n?1:0);
  const radius=rand(1000000),rd=exact(a)-BigInt(radius*a.denominator)**2n;
  assert.equal(g.compareRadiusSq(a,radius),rd<0n?-1:rd>0n?1:0);
  const projection=g.proj(lane,point),perp=g.perpSq(lane,point);
  assert.equal(projection.numerator,(point.x-lane.a.x)*lane.dx+(point.z-lane.a.z)*lane.dz);
  assert.equal(perp.cross,(point.x-lane.a.x)*lane.dz-(point.z-lane.a.z)*lane.dx);
 }
 assert.throws(()=>g.distanceSq(g.makeLane({x:0,z:0},{x:1,z:0}),{x:Number.MAX_SAFE_INTEGER,z:0},20),RangeError);
});
test('corridor SAT matches independent rational BigInt separating-axis oracle on fuzzed yaw boxes',()=>{
 function vertices(lane,shape){
  const L=BigInt(lane.length||20),dx=BigInt(lane.length?lane.dx*20:20),dz=BigInt(lane.length?lane.dz*20:0),Q=2097152n;
  const ends=[lane.a,lane.b],poly=[];
  for(const [end,along,side] of [[0,-1,-1],[1,1,-1],[1,1,1],[0,-1,1]]){
   const e=ends[end];poly.push([BigInt(e.x)*L*Q+BigInt(along)*dx*190n*Q-BigInt(side)*dz*190n*Q,BigInt(e.z)*L*Q+BigInt(along)*dz*190n*Q+BigInt(side)*dx*190n*Q]);
  }
  const {cos,sin}=g.yawAxes(shape.yawMilliDeg),c=BigInt(cos),s=BigInt(sin),box=[];
  for(const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]])box.push([BigInt(shape.x)*L*Q+(BigInt(u*shape.w)*c-BigInt(v*shape.d)*s)*L,BigInt(shape.z)*L*Q+(BigInt(u*shape.w)*s+BigInt(v*shape.d)*c)*L]);
  return [poly,box];
 }
 for(let i=0;i<300;i++){
  const lane=g.makeLane({x:rand(2001)-1000,z:rand(2001)-1000},{x:rand(2001)-1000,z:rand(2001)-1000});
  const box={shape:'box',x:rand(2001)-1000,z:rand(2001)-1000,w:rand(800)+1,d:rand(800)+1,yawMilliDeg:(rand(721)-360)*1000};
  const polys=vertices(lane,box),axes=polys.flatMap(poly=>poly.map((p,i)=>{const q=poly[(i+1)%4];return [q[1]-p[1],p[0]-q[0]];}));
  const expected=axes.every(([nx,nz])=>{
   const values=polys.map(poly=>poly.map(([x,z])=>x*nx+z*nz));
   return values[0].some(a=>values[1].some(b=>a>b))&&values[1].some(b=>values[0].some(a=>b>a));
  });
  assert.equal(g.corridorOverlaps(lane,box),expected,JSON.stringify({lane,box}));
 }
});
test('distance comparisons support unlike denominators through the full safe scalar range',()=>{
 for(let i=0;i<500;i++){
  const make=()=>({x:rand(4294967295)*2097152+rand(2097152),z:rand(4294967295)*2097152+rand(2097152),denominator:rand(4294967295)+1});
  const a=make(),b=make(),n=v=>BigInt(v.x)**2n+BigInt(v.z)**2n;
  const d=n(a)*BigInt(b.denominator)**2n-n(b)*BigInt(a.denominator)**2n;
  assert.equal(g.compareDistanceSq(a,b),d<0n?-1:d>0n?1:0);
 }
});
test('checked Number sum-of-products comparator handles signed swept discriminant factors exactly',()=>{
 const {compareSumProducts}=require('../src/math.ts');
 for(let i=0;i<800;i++){
  const terms=()=>Array.from({length:rand(5)},()=>Array.from({length:rand(5)},()=> (rand(10000000)+1)*(rand(2)?-1:1)));
  const a=terms(),b=terms(),sum=terms=>terms.reduce((sum,t)=>sum+t.reduce((v,f)=>v*BigInt(f),1n),0n),d=sum(a)-sum(b);
  assert.equal(compareSumProducts(a,b),d<0n?-1:d>0n?1:0);
 }
 assert.throws(()=>compareSumProducts([[Number.MAX_SAFE_INTEGER+1]],[]),RangeError);
});
test('content yaw follows Unity +Y: non-square 30/150-degree boxes rotate +x toward -z',()=>{
 const point=(x,z)=>g.makeLane({x,z},{x,z});
 assert.deepEqual(g.laneIntervals(point(100,-58),{shape:'box',x:0,z:0,w:400,d:20,yawMilliDeg:30000}),[[0,0]]);
 assert.deepEqual(g.laneIntervals(point(100,58),{shape:'box',x:0,z:0,w:400,d:20,yawMilliDeg:30000}),[]);
 assert.deepEqual(g.laneIntervals(point(-100,-58),{shape:'box',x:0,z:0,w:400,d:20,yawMilliDeg:150000}),[[0,0]]);
 assert.deepEqual(g.laneIntervals(point(-100,58),{shape:'box',x:0,z:0,w:400,d:20,yawMilliDeg:150000}),[]);
});
