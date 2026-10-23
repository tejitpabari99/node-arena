import { expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { loadContent } from '@node-arena/content';
import { GameDriver } from '../../src/driver';
import { testHookRequest } from '../../src/test-harness/gate';
import { createFixtureSim } from '../../src/test-harness/fixtures';
const files=Object.fromEntries(globSync('packages/content/data/**/*.json',{cwd:'../..'}).map(p=>[p.slice('packages/content/'.length),readFileSync('../../'+p,'utf8')]));
const level=Object.values(loadContent(files).compiled)[0]!;
it('gates level, seed, speed and fixtures; only explicit test disables animation',()=>{
 expect(testHookRequest('?level=20&seed=7&speed=2',true)).toMatchObject({level:'20',seed:7,speed:2,testing:false});
 expect(testHookRequest('?test=1&fixture=win',true)).toMatchObject({testing:true,fixture:'win'});
 expect(testHookRequest('?test=1&level=20&seed=7&speed=2',false)).toEqual({testing:false,fixture:null,level:null,seed:1,speed:1});
 expect(testHookRequest('?seed=NaN&speed=5',true)).toMatchObject({seed:1,speed:1});
});
it('driver ownership is pure passthrough and accelerated frames preserve hashes at equal ticks',()=>{
 const a=new GameDriver({level,matchSeed:1,autoStart:false,createBotDriver:()=>({commands:()=>[]})});
 const b=new GameDriver({level,matchSeed:1,autoStart:false,createBotDriver:()=>({commands:()=>[]})});
 b.setSpeed(2);a.advanceFrame(0);b.advanceFrame(0);a.advanceFrame(100);b.advanceFrame(50);
 expect(a.sim.hash()).toBe(b.sim.hash());expect(a.ownership).toEqual(b.ownership);expect(a.ownership.length).toBeGreaterThan(0);a.dispose();b.dispose();
});
it('outcome fixture changes only its public view after a valid human command',()=>{
 const sim=createFixtureSim('win')(level,1);sim.step([],{events:true});expect(sim.view.over).toBeNull();
 const human=sim.view.players.findIndex(p=>p.kind==='human');let pair:number[]=[];
 for(let from=0;from<level.buildings.length&&!pair.length;from++)for(let to=0;to<level.buildings.length;to++)if(sim.canDraw(human,from,to)===null){pair=[from,to];break;}
 expect(pair).toHaveLength(2);const events=sim.step([{type:'DrawLine',player:human,from:pair[0]!,to:pair[1]!}],{events:true});
 expect(sim.view.over).toEqual({outcome:'won',winner:human});expect(events.at(-1)).toEqual({type:'MatchOver',outcome:'won',winner:human});
 expect(sim.snapshot().over).toEqual(sim.view.over);
});
import { createTestHarness } from '../../src/test-harness';
import { createAppController } from '../../src/app/state';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { projectAnchor } from '../../src/test-harness/probe';
const manifest=JSON.parse(readFileSync('assets/manifest.json','utf8'));
it('URL autoload uses isolated completion, applies speed and logs stamped commands; restart keeps seed',async()=>{
 const harness=createTestHarness(files,testHookRequest('?test=1&level=20&seed=73&speed=2',true));
 const app=createAppController({files,...harness.options,loadManifest:async()=>manifest,createBotDriver:()=>({commands:()=>[]})});
 const api=harness.connect(app);await app.boot();await harness.autoLoad(app);
 expect(app.snapshot().levelId).toBe(app.snapshot().levels[19]!.id);expect(app.driver!.speed).toBe(2);
 expect(app.driver!.sim.snapshot().seed).toBe(73);await api.restart();expect(app.driver!.sim.snapshot().seed).toBe(73);
 const sim=app.driver!.sim,human=sim.view.players.findIndex(p=>p.kind==='human');let pair:number[]=[];
 for(let f=0;f<sim.view.ids.buildings.length&&!pair.length;f++)for(let t=0;t<sim.view.ids.buildings.length;t++)if(sim.canDraw(human,f,t)===null){pair=[f,t];break;}
 const submitted=api.submit({type:'DrawLine',player:human,from:pair[0]!,to:pair[1]!});api.step();expect(api.commandLog).toContainEqual(submitted);
 expect(api.hud().ownership).toEqual(app.driver!.ownership);api.dispose();app.dispose();
});
it('anchor projection applies the mirrored world matrix before the camera',()=>{
 const scene=new Scene(),worldRoot=new Group(),camera=new PerspectiveCamera(45,1,.1,100);worldRoot.scale.x=-1;scene.add(worldRoot);camera.position.set(0,5,10);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
 const stage={scene,worldRoot,camera,world:{anchors:{building:()=>({pos:new Vector3(2,0,0),labelPos:new Vector3(2,1,0),radius:1})}},canvas:{getBoundingClientRect:()=>({left:50,top:20,width:1000,height:1000})}} as unknown as Parameters<typeof projectAnchor>[0];
 expect(projectAnchor(stage,'a').x).toBeLessThan(550);expect(projectAnchor(stage,'a',true).y).toBeLessThan(projectAnchor(stage,'a').y);
});
