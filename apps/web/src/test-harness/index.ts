import { loadContent, type ContentFiles } from '@node-arena/content';
import type { Command, SimEvent } from '@node-arena/sim';
import type { AppController } from '../app/state';
import type { CommandSubmission, Speed } from '../driver';
import { createSaveStore, defaultSave, SAVE_KEY } from '../save';
import { createFixtureSim } from './fixtures';
import { buildVisualProbe, projectAnchor } from './probe';
import type { TestHookRequest } from './gate';
import type { KaneSnapshot } from '../kane/controller';
import { kaneSummary } from '../kane/summary';
/** The module is imported only behind the literal DEV / VITE_TEST_HOOKS build gate. */
export function createTestHarness(files:ContentFiles,request:TestHookRequest) {
  const content=loadContent(files),entries=[...content.catalog.campaigns.common!.entries].sort((a,b)=>a.position-b.position);
  const isolated=request.level!==null||request.fixture!==null||request.kane;
  const initial=defaultSave(),memory=new Map<string,string>();
  const resolve=(id:string)=>entries.find(e=>e.level===id||String(e.position-3)===id)?.level??id;
  const grant=(id:string)=>{const index=entries.findIndex(e=>e.level===resolve(id));for(let i=0;i<index;i++)initial.completed[entries[i]!.level]={firstAt:'2026-01-01T00:00:00.000Z'};};
  if(request.level)grant(request.level);
  memory.set(SAVE_KEY,JSON.stringify(initial));
  const save=isolated?createSaveStore({storage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>{memory.set(k,v);}}}):undefined;
  return {
    options:{autoStart:!request.testing,...(request.kane?{campaignId:'kane'}:{}),...(request.testing?{resultDelayMs:0}:{}),...(save?{save}:{}),...(request.fixture?{createSim:createFixtureSim(request.fixture),createBotDriver:()=>({commands:()=>[]})}:{})},
    connect(app:AppController,kaneSnapshot?:()=>KaneSnapshot|undefined){
      const events:SimEvent[]=[],commandLog:CommandSubmission[]=[];
      let driver=app.driver,currentSpeed=request.speed;
      const lineOwners=()=>new Map(driver?.sim.view.lines.map(line=>[`${line.from}>${line.to}`,line.owner]));
      let initialOwners=lineOwners();
      driver?.setSpeed(currentSpeed);
      const unsubscribe=app.subscribe(()=>{if(driver!==app.driver){driver=app.driver;events.length=0;commandLog.length=0;initialOwners=lineOwners();driver?.setSpeed(currentSpeed);}});
      const unsubscribeEvents=app.subscribeEvents(update=>{events.push(...update.events);commandLog.push(...update.submissions);});
      const inspect=()=>app.runtime?.inspection as ReturnType<typeof import('../render/scene').createLevelScene>|undefined;
      const api={
        kane:request.kane?{summary:()=>kaneSummary(app.driver?.sim.view,app.driver?.speed??currentSpeed,kaneSnapshot?.(),events,commandLog,initialOwners)}:false as const,
        setSpeed(speed:Speed){app.driver?.setSpeed(speed);currentSpeed=speed;},
        step:(n=1)=>app.step(n),hash:()=>app.driver?.sim.hash(),get view(){return app.driver?.sim.snapshot();},
        get events(){return events;},get commandLog(){return commandLog;},get screen(){return app.snapshot().screen;},
        state:()=>app.snapshot(),hud:()=>({state:app.snapshot(),ownership:app.driver?.ownership??[],tick:app.driver?.sim.view.tick??null}),
        async load(id:string|number,seed=request.seed){await app.startLevel(resolve(String(id)),seed);},
        menu:()=>app.openPicker(),submit:(cmd:Command)=>app.driver?.submit(cmd)??null,
        pause:()=>app.pause(),resume:()=>app.resume(),restart:()=>app.restart(),next:()=>app.next(),
        settings:(patch:Parameters<AppController['updateSettings']>[0])=>app.updateSettings(patch),
        render:()=>app.step(0),
        project(id:string,label=false){const scene=inspect();if(!scene)throw Error('No active scene');return projectAnchor(scene,id,label);},
        legality(from:number,to:number,player=app.driver?.sim.view.players.findIndex(p=>p.kind==='human')??-1){const sim=app.driver?.sim;return {reason:sim?.canDraw(player,from,to)??null,explanation:sim?.explainDraw(player,from,to)??null};},
        visualProbe(){return buildVisualProbe(app,inspect());},
        renderInfo(){const info=inspect()?.renderer.info.render;return info?{calls:info.calls,triangles:info.triangles}:null;},
        dispose(){unsubscribe();unsubscribeEvents();},
      };
      return api;
    },
    async autoLoad(app:AppController){if(request.kane)await app.startLevel('na-kane',request.seed);else if(request.level)await app.startLevel(resolve(request.level),request.seed);},
  };
}
export type TestApi=ReturnType<ReturnType<typeof createTestHarness>['connect']>;
declare global {interface Window {__na?:TestApi}}
