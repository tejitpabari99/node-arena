const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { compiledGolden, metadata } = require('./fixtures.cjs');
function level(points = [[-2000,0],[0,-2000],[2000,0],[0,2000],[3000,3000]]) {
  const l = compiledGolden();
  l.elements = [];
  l.buildings.forEach((b,i) => { [b.x,b.z] = points[i]; b.owner=i===1?1:0; b.modules = { level:{maxLevel:64}, drawsLines:{} }; b.level=30; });
  l.units = [{id:'soldier',visual:'unit.soldier',speed:5000,hp:1,attack:1,defense:1},{id:'tank',visual:'unit.tank',speed:5000,hp:2,attack:2,defense:1}];
  return l;
}
function state(l=level()) { const s=api.createState(l,3); s.events=[]; return s; }
function put(s,a,b,p,kind=0) { const seq=api.spawnTroop(s,a,b,kind), ch=api.getChannel(s,a,b); ch.troops.p0[ch.troops.indexOfSeq(seq)]=p; return seq; }
const clashes=s=>s.events.filter(e=>e.type==='Clash');
test('covers R-CMB-04: X crossing exchanges soldiers and tank vs soldier preserves tank hp 2 -> 1',()=>{
  for(const kind of [0,1]) { const s=state(); put(s,0,2,40000,kind); put(s,1,3,40000); api.crossingPass(s); assert.equal(clashes(s).length,1); assert.equal(clashes(s)[0].kind,'crossing'); assert.equal(api.getChannel(s,1,3).troops.len,0); const a=api.getChannel(s,0,2); assert.equal(a.troops.len,kind); if(kind) assert.equal(a.troops.hp[0],1); api.assertInvariants(s); }
});
test('covers R-CMB-04: fast tanks sweep through the crossing without tunnelling',()=>{
  const l=level(); l.units[1].speed=60000; const s=state(l); put(s,0,2,10000,1); put(s,1,3,10000,1); s.tick=1; api.crossingPass(s); assert.equal(s.counters.died,2); api.assertInvariants(s);
});
test('covers R-CMB-04: parallel lanes 500 milli apart fight; 701 do not; exact 700 tangent fights',()=>{
  for(const gap of [500,700,701]) { const s=state(level([[-2000,0],[-2000,gap],[2000,0],[2000,gap],[9000,9000]])); put(s,0,2,40000); put(s,1,3,40000); api.crossingPass(s); assert.equal(clashes(s).length,gap<=700?1:0); }
});
test('covers R-CMB-04: same troop owner ignores changed source ownership and hostile source does not override friendly troops',()=>{
 const s=state(); put(s,0,2,40000); put(s,1,3,40000); api.getChannel(s,1,3).troops.owner[0]=0; api.crossingPass(s); assert.equal(clashes(s).length,0); api.getChannel(s,1,3).troops.owner[0]=1; s.buildings.owner[1]=0; api.crossingPass(s); assert.equal(clashes(s).length,1);
});
test('covers R-CMB-04: cut lines retain combat; channel pair then seq ordering lets survivors continue',()=>{
 const s=state(); api.runCommands(s,[{type:'DrawLine',player:0,from:0,to:2}]); const a=put(s,0,2,40000,1), b=put(s,1,3,40000), c=put(s,1,3,40000); api.cutLine(s,0,2,'player'); s.events=[]; api.crossingPass(s); assert.deepEqual(clashes(s).map(e=>[e.a.seq,e.b.seq]),[[a,b],[a,c]]); assert.equal(s.counters.died,3); api.assertInvariants(s);
});
test('covers R-CMB-04: fresh spawns have no negative-progress sweep; shared endpoints still fight',()=>{
 const s=state(level([[0,0],[-2000,0],[2000,0],[-1000,-2000],[-1000,2000]])); s.buildings.owner[3]=1;
 s.tick=1; put(s,0,2,0); put(s,3,4,40000); api.crossingPass(s); assert.equal(clashes(s).length,0);
 const t=state(); t.tick=1; put(t,0,2,80000); t.buildings.owner[2]=1; put(t,2,3,0); api.crossingPass(t); assert.equal(clashes(t).length,1);
});

// Independent oracle: rational world vectors, direct BigInt quadratic. It
// enumerates ALL road/troop pairs without production windows or active lists.
function sweptOracle(s,A,ia,B,ib) {
 const motion=(ch,i)=>({p:BigInt(ch.troops.p0[i])+BigInt(Math.max(0,s.tick-1-ch.troops.t0[i]))*BigInt(s.level.units[ch.troops.kind[i]].speed),v:ch.troops.t0[i]>=s.tick?0n:BigInt(s.level.units[ch.troops.kind[i]].speed)});
 const ma=motion(A,ia),mb=motion(B,ib),LA=BigInt(A.length||1),LB=BigInt(B.length||1),D=LA*LB,r=BigInt(s.level.rules.contactDistance);
 const a=s.level.buildings[A.from],ae=s.level.buildings[A.to],b=s.level.buildings[B.from],be=s.level.buildings[B.to];
 const cuts=[[0n,1n],[1n,1n]];
 for(const [m,L] of [[ma,BigInt(A.length)],[mb,BigInt(B.length)]])if(m.v)for(const e of [0n,L]){const n=e-m.p;if(n>0n&&n<m.v)cuts.push([n,m.v]);}
 cuts.sort((x,y)=>x[0]*y[1]<y[0]*x[1]?-1:x[0]*y[1]>y[0]*x[1]?1:0);
 for(let k=1;k<cuts.length;k++){
  const [ln,ld]=cuts[k-1],[hn,hd]=cuts[k];if(ln*hd===hn*ld)continue;
  const branch=(m,L)=>m.p*ld+m.v*ln>=L*ld?{p:L,v:0n}:m.p*hd+m.v*hn<=0n?{p:0n,v:0n}:m;
  const x=branch(ma,BigInt(A.length)),y=branch(mb,BigInt(B.length));
  const R=['x','z'].map(c=>BigInt(a[c]-b[c])*D+BigInt(ae[c]-a[c])*x.p*LB-BigInt(be[c]-b[c])*y.p*LA);
  const V=['x','z'].map(c=>BigInt(ae[c]-a[c])*x.v*LB-BigInt(be[c]-b[c])*y.v*LA);
  const aa=V[0]**2n+V[1]**2n,bb=R[0]*V[0]+R[1]*V[1],cc=R[0]**2n+R[1]**2n-r*r*D*D;
  const at=(n,d)=>aa*n*n+2n*bb*n*d+cc*d*d;
  if(at(ln,ld)<=0n||at(hn,hd)<=0n)return true;
  if(bb*ld+aa*ln<0n&&bb*hd+aa*hn>0n&&cc*aa<=bb*bb)return true;
 }
 return false;
}
function brutePass(s) {
 const channels=api.liveChannels(s);
 for(let a=0;a<channels.length;a++)for(let b=a+1;b<channels.length;b++){
  const A=channels[a],B=channels[b];if(A.from===B.to&&A.to===B.from)continue;
  const seqA=Array.from(A.troops.seq.subarray(0,A.troops.len)).sort((a,b)=>a-b),seqB=Array.from(B.troops.seq.subarray(0,B.troops.len)).sort((a,b)=>a-b);
  for(const a of seqA)for(const b of seqB){const ia=A.troops.indexOfSeq(a),ib=B.troops.indexOfSeq(b);if(ia<0||ib<0||A.troops.owner[ia]===B.troops.owner[ib])continue;if(sweptOracle(s,A,ia,B,ib))api.exchange(s,A.key,a,B.key,b,'crossing');}
 }
}
test('covers R-CMB-04: exact swept brute-force all-pairs oracle matches 50 seeds, mixed speeds, cuts and capture',()=>{
 for(let seed=0;seed<50;seed++){
  const rng=new api.Sfc32(seed),points=Array.from({length:5},()=>[rng.below(10001)-5000,rng.below(10001)-5000]);
  const l=level(points);l.units[0].speed=1000+rng.below(150000);l.units[1].speed=1000+rng.below(150000);
  const s=state(l),ref=state(structuredClone(l));
  for(let a=0;a<5;a++)for(let b=0;b<5;b++)if(a!==b&&rng.below(3)===0){const kind=rng.below(2),p=rng.below(api.getChannel(s,a,b).length+1);put(s,a,b,p,kind);put(ref,a,b,p,kind);}
  for(let tick=0;tick<5;tick++){
   s.tick=ref.tick=tick;api.crossingPass(s);brutePass(ref);
   assert.deepEqual(s.events,ref.events,`events seed ${seed} tick ${tick}`);assert.equal(api.hashState(s),api.hashState(ref),`hash seed ${seed} tick ${tick}`);
   api.arrivalPass(s);api.arrivalPass(ref);api.assertInvariants(s);api.assertInvariants(ref);
  }
 }
});
test('covers R-CMB-04: replay-to-tick-N mid-fight rebuilds derived caches with event hash parity',()=>{
 const l=level();l.buildings[0].modules.spawns={troop:'soldier',spawnSpeed:1000,lineSpawnPenalty:0};l.buildings[1].modules.spawns={troop:'soldier',spawnSpeed:1000,lineSpawnPenalty:0};
 const rec=api.createReplayRecorder(l,77,metadata),silent=api.create(l,77); let fightCount=0;
 for(let tick=0;tick<60;tick++){
  const commands=tick===0?[{type:'DrawLine',player:0,from:0,to:2},{type:'DrawLine',player:1,from:1,to:3}]:tick===35?[{type:'CutLine',player:0,from:0,to:2}]:[];
  fightCount+=rec.step(commands,{events:true}).filter(e=>e.type==='Clash').length;silent.step(commands,{events:false});
  if(tick===30||tick===59){const record=rec.record(),replay=api.playReplay({metadata,level:l},record);assert.equal(replay.ok,true);assert.equal(replay.sim.hash(),rec.hash());assert.equal(silent.hash(),rec.hash());}
 }
 assert.ok(fightCount>0,'replay must include real crossing combat');
});
test('covers R-CMB-04: three lanes use channel-pair order and surviving troops continue',()=>{
 const s=state(level([[-2000,0],[0,-2000],[2000,0],[0,2000],[0,0]]));s.buildings.owner[4]=1;
 const tank=put(s,0,2,40000,1),soldier=put(s,1,3,40000),third=put(s,4,3,0);
 api.crossingPass(s);assert.deepEqual(clashes(s).map(e=>[e.a.seq,e.b.seq]),[[tank,soldier],[tank,third]]);assert.equal(s.counters.died,3);api.assertInvariants(s);
});
test('covers R-CMB-04: large oblique rational lanes match BigInt oracle; draw/cut/spawn/contact tick paths never call BigInt',()=>{
 const s=state(level([[-499999,-498733],[-498769,499999],[499999,498733],[498769,-499999],[0,0]]));
 s.level.units[1].speed=2147483647;
 put(s,0,2,0,1);put(s,1,3,0,1);s.tick=1;
 const pair=api.activeCrossings(s).find(p=>p.a===2&&p.b===8),A=api.getChannel(s,0,2),B=api.getChannel(s,1,3);
 assert.equal(api.sweepCrossed(s,pair,A,0,B,0),sweptOracle(s,A,0,B,0));
 const original=global.BigInt;
 try { global.BigInt=()=>{throw Error('BigInt on hot path');};api.runCommands(s,[{type:'DrawLine',player:0,from:0,to:2}]);api.cutLine(s,0,2,'player');put(s,0,3,0);api.crossingPass(s); } finally { global.BigInt=original; }
 api.assertInvariants(s);
});
