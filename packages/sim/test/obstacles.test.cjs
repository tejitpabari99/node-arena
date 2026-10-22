const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { compiledGolden } = require('./fixtures.cjs');
function level() {
  const l = compiledGolden();
  l.buildings = l.buildings.slice(0, 2);
  Object.assign(l.buildings[0], { x: 0, z: 0, owner: 0 });
  Object.assign(l.buildings[1], { x: 10000, z: 0, owner: 1 });
  l.elements = [];
  return l;
}
function obstacle(x, z, footprint = { shape: 'box', w: 1000, d: 1000 }, id = 'rock', yawMilliDeg = 0) {
  return { id, archetype: 'obstacle', x, z, yawMilliDeg, footprint, visual: 'rock', modules: { blocksLines: {} } };
}
const draw = (from = 0, to = 1, player = from) => ({ type: 'DrawLine', player, from, to });
test('covers R-OBS-01: strict corridor tangent, endpoints, third house and tower, obstacle module filter', () => {
  const cases = [
    [obstacle(5000, 1000, { shape: 'circle', radius: 810 }), null],
    [obstacle(5000, 1000, { shape: 'circle', radius: 820 }), 'blocked-obstacle'],
    [obstacle(5000, 690), null], [obstacle(5000, 689), 'blocked-obstacle'],
    [obstacle(0, 0), 'blocked-obstacle'], [obstacle(10689, 0), 'blocked-obstacle'],
    [obstacle(10690, 0), null],
  ];
  for (const [o, reason] of cases) {
    const l = level(); l.elements.push(o); const s = api.create(l, 1);
    assert.equal(s.canDraw(0, 0, 1), reason, JSON.stringify(o));
    const ev = s.step([draw()], { events: true });
    assert.equal(ev.some(e => e.type === 'LineDrawn'), reason === null);
  }
  for (const kind of ['house', 'tower']) {
    const l = level(); l.buildings.push({ ...l.buildings[1], id: 'third', kind, x: 5000, z: 0 });
    assert.equal(api.create(l, 1).canDraw(0, 0, 1), 'blocked-building');
  }
  const l = level(); const o = obstacle(5000, 0); o.modules = {}; l.elements.push(o);
  assert.equal(api.create(l, 1).canDraw(0, 0, 1), null);
});
test('covers R-OBS-01: nearest blocker is directional and explanations use the first corridor entry', () => {
  const l = level(); l.elements = [obstacle(8000, 0, undefined, 'far'), obstacle(3000, 0, undefined, 'near')];
  const s = api.create(l, 1);
  const f = s.explainDraw(0, 0, 1), r = s.explainDraw(1, 1, 0);
  assert.equal(f.ref, 'near'); assert.equal(r.ref, 'far');
  assert.equal(f.reason, 'blocked-obstacle');
  assert.ok(f.point.x >= 2310 && f.point.x <= 2311); assert.equal(f.point.z, 0);
  assert.ok(r.point.x >= 8689 && r.point.x <= 8690);
  const st = api.createState(l, 1); st.buildings.lines[0] = st.buildings.stage[0];
  assert.equal(api.canDraw(st, 0, 0, 1), 'no-slot');
  assert.equal(require('../src/modules/blocksLines.ts').explainDraw(st, 0, 0, 1), null);
  const evil = new Proxy({}, { get() { throw Error('unreadable'); } });
  for (const x of [undefined, null, NaN, Infinity, -1, 0.5, '0', evil, 99]) assert.doesNotThrow(() => assert.equal(s.explainDraw(x, x, x), null));
});
// Independent float SAT: world OBB vertices; no production geometry helpers.
function floatOverlap(a, b, o) {
  const dx = b.x-a.x, dz = b.z-a.z, len = Math.floor(Math.hypot(dx*20,dz*20));
  const ux = len ? dx*20/len : 1, uz = len ? dz*20/len : 0;
  const rect = [
    {x:a.x-190*ux+190*uz,z:a.z-190*uz-190*ux},
    {x:b.x+190*ux+190*uz,z:b.z+190*uz-190*ux},
    {x:b.x+190*ux-190*uz,z:b.z+190*uz+190*ux},
    {x:a.x-190*ux-190*uz,z:a.z-190*uz+190*ux},
  ];
  const yaw = o.yawMilliDeg*Math.PI/180000, c=Math.cos(yaw), s=-Math.sin(yaw);
  const box = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>({x:o.x+c*u*o.footprint.w/2-s*v*o.footprint.d/2,z:o.z+s*u*o.footprint.w/2+c*v*o.footprint.d/2}));
  for (const poly of [rect,box]) for(let i=0;i<4;i++) {
    const p=poly[i],q=poly[(i+1)%4],nx=p.z-q.z,nz=q.x-p.x;
    const ra=rect.map(v=>v.x*nx+v.z*nz),rb=box.map(v=>v.x*nx+v.z*nz);
    if(Math.max(...ra)<=Math.min(...rb)||Math.max(...rb)<=Math.min(...ra))return false;
  }
  return true;
}
test('covers R-OBS-01: 500 seeded cases match independent float OBB SAT and DrawLine acceptance', () => {
  let seed=7293; const rnd=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  let blocked=0;
  for(let i=0;i<500;i++) {
    const l=level(); Object.assign(l.buildings[0],{x:rnd(20001)-10000,z:rnd(20001)-10000});
    Object.assign(l.buildings[1],{x:rnd(20001)-10000,z:rnd(20001)-10000});
    const o=obstacle(rnd(20001)-10000,rnd(20001)-10000,{shape:'box',w:1+rnd(5000),d:1+rnd(5000)},'random',rnd(360001)); l.elements=[o];
    const expected=floatOverlap(...l.buildings,o); blocked+=Number(expected);
    const sim=api.create(l,1); assert.equal(sim.canDraw(0,0,1),expected?'blocked-obstacle':null,`seed case ${i}`);
    const ev=sim.step([draw()],{events:true}); assert.equal(ev.some(e=>e.type==='LineDrawn'),!expected,`command case ${i}`);
  }
  assert.ok(blocked>25 && blocked<450,`mixed outcomes ${blocked}`);
});
test('covers R-OBS-02: obstacles remain inert and unowned, outside win participants and snapshots', () => {
  const l=level(); l.elements=[obstacle(5000,0)]; const twin=level();
  const a=api.create(l,42),b=api.create(twin,42);
  for(let i=0;i<100;i++){a.step([]);b.step([]);}
  assert.equal(a.hash(),b.hash()); assert.deepEqual(a.snapshot(),b.snapshot());
  assert.equal(l.elements[0].owner,undefined); assert.equal(a.view.buildings.n,2);
});

test('covers R-OBS-01: square sweep entry orders circle edge contacts before rounded-padding approximations', () => {
  const l=level();
  l.elements=[obstacle(3045,0,{shape:'box',w:10,d:10},'box'),obstacle(3000,200,{shape:'circle',radius:20},'circle')];
  const sim=api.create(l,1),e=sim.explainDraw(0,0,1);
  assert.equal(e.ref,'circle'); assert.equal(e.point.x,2792); assert.equal(e.point.z,0);
  // Endpoint corner overlaps the square corridor, while a radius-190 capsule misses it.
  l.elements=[obstacle(10190,190,{shape:'box',w:2,d:2},'corner',45000)];
  const corner=api.create(l,1);
  assert.equal(corner.canDraw(0,0,1),'blocked-obstacle');
  assert.equal(corner.explainDraw(0,0,1).ref,'corner');
  assert.ok(corner.explainDraw(0,0,1).point.x>=9998);
});
test('covers R-OBS-01: blocker ties use stable ids, circle radicals order exactly, returned points cannot mutate cache', () => {
  const l=level();
  l.elements=[obstacle(3000,200,{shape:'circle',radius:20},'z'),obstacle(3000,-200,{shape:'circle',radius:20},'a')];
  let sim=api.create(l,1); assert.equal(sim.explainDraw(0,0,1).ref,'a');
  const e=sim.explainDraw(0,0,1); e.point.x=-100000; e.ref='changed';
  assert.equal(sim.explainDraw(0,0,1).ref,'a'); assert.equal(sim.explainDraw(0,0,1).point.x,2792);
  l.elements[0].footprint.radius=21;
  sim=api.create(l,1); assert.equal(sim.explainDraw(0,0,1).ref,'z');
  const third={...l.buildings[1],id:'building',x:4000,z:0,footprint:{shape:'box',w:1500,d:1500}};
  l.buildings.push(third); l.elements=[obstacle(8000,0)];
  sim=api.create(l,1); assert.equal(sim.explainDraw(0,0,1).reason,'blocked-building');
  assert.equal(sim.explainDraw(1,1,0).reason,'blocked-obstacle');
});
test('covers R-OBS-01: DrawLine, canDraw and explainDraw consume cold cache without BigInt or allocation leaks', () => {
  const l=level(); l.elements=[obstacle(5000,0)];
  const blocked=api.create(l,1),open=api.create(level(),1);
  const original=global.BigInt;
  try {
    global.BigInt=()=>{throw Error('BigInt on hot draw path');};
    assert.equal(blocked.canDraw(0,0,1),'blocked-obstacle');
    assert.equal(blocked.explainDraw(0,0,1).ref,'rock');
    assert.equal(blocked.step([draw()],{events:true})[0].reason,'blocked-obstacle');
    assert.equal(open.canDraw(0,0,1),null);
    assert.equal(open.step([draw()],{events:true})[0].type,'LineDrawn');
  } finally {global.BigInt=original;}
});
