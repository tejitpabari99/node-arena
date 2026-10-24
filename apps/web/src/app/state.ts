import { loadContent, type ContentFiles, type CompiledLevel, type ManifestV2, type LoadedContent } from '@node-arena/content';
import { TICK_RATE, type SimView } from '@node-arena/sim';
import { GameDriver, type FrameUpdate, type TickUpdate, type GameDriverOptions } from '../driver';
import { loadManifest } from '../manifest/load';
import { createSaveStore, type SaveData, type SaveSettings, type SaveStore } from '../save';
/** Presentation-only pause between the sim reporting game over and showing the result popup. */
export const RESULT_DELAY_MS = 1250;
export type Screen = 'boot' | 'picker' | 'playing' | 'result' | 'error';
export interface CampaignLevel { id: string; position: number; number: number; name: string }
export interface AppSnapshot {
  screen: Screen; loading: boolean; restartPopup: boolean; levels: readonly CampaignLevel[]; customLevels: readonly CampaignLevel[];
  levelId: string | null; save: SaveData; notices: readonly string[]; error: unknown;
  result: SimView['over']; remainingSeconds: number;
  /** Close camera zoom; reset to false per app load, kept across level restarts. */
  zoomed: boolean;
}
export interface LevelRuntime {
  readonly inspection?: unknown;
  frame(update: FrameUpdate): void; tick(update: TickUpdate): void;
  refresh(): void; cancel(): boolean; dispose(): void; setZoom?(zoomed: boolean): void;
}
export interface RuntimeContext { level: CompiledLevel; manifest: ManifestV2; driver: GameDriver; enabled(): boolean; zoomed: boolean }
export interface AppOptions {
  files: ContentFiles; campaignId?: string; loadManifest?: () => Promise<ManifestV2>; save?: SaveStore;
  autoStart?: boolean; resultDelayMs?: number; createSim?: GameDriverOptions['createSim']; createBotDriver?: GameDriverOptions['createBotDriver'];
  environment?: GameDriverOptions['environment']; createRuntime?: (context: RuntimeContext) => LevelRuntime | Promise<LevelRuntime>;
}
export function isLevelUnlocked(state: Pick<AppSnapshot,'levels'|'customLevels'|'save'>, id: string): boolean {
  if(state.customLevels.some(l=>l.id===id))return true;
  const i=state.levels.findIndex(l=>l.id===id);
  return i===0 || i>0 && Object.hasOwn(state.save.completed,state.levels[i-1]!.id);
}
/** Level resources have generation-scoped ownership, including asynchronous renderer construction. */
export function createAppController(options: AppOptions) {
  const save=options.save??createSaveStore(), listeners=new Set<()=>void>(),events=new Set<(u:TickUpdate)=>void>();
  let state: AppSnapshot={screen:'boot',loading:true,restartPopup:false,levels:[],customLevels:[],levelId:null,save:save.snapshot(),notices:[],error:null,result:null,remainingSeconds:0,zoomed:false};
  let loaded: LoadedContent|undefined, manifest: ManifestV2|undefined,driver:GameDriver|null=null,runtime:LevelRuntime|undefined;
  let lastSeed=1;
  let finishing: ReturnType<typeof setTimeout>|null=null,finishingOn=false;
  let generation=0,disposed=false,lastPublication=-Infinity;
  const publish=()=>{ if(disposed)return; const notices=[...state.notices];let notice;while((notice=save.consumeNotice()))notices.push(notice.message);state={...state,save:save.snapshot(),notices};listeners.forEach(fn=>fn()); };
  const clear=()=>{if(finishing!==null)clearTimeout(finishing);finishing=null;finishingOn=false;const oldRuntime=runtime;runtime=undefined;driver?.dispose();driver=null;oldRuntime?.dispose();};
  const fail=(error:unknown)=>{clear();state={...state,screen:'error',loading:false,restartPopup:false,error};publish();};
  const api={
    kaneMode:options.campaignId==='kane',
    snapshot:()=>state,
    subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
    subscribeEvents(fn:(u:TickUpdate)=>void){events.add(fn);return()=>{events.delete(fn);};},
    get driver(){return driver;},get runtime(){return runtime;},get manifest(){return manifest;},
    async boot(){const token=++generation;clear();state={...state,screen:'boot',loading:true,error:null};publish();try{
      const next=await(options.loadManifest??loadManifest)();if(disposed||token!==generation)return;
      const content=loadContent(options.files,{themes:Object.keys(next.themes),colorKeys:Object.keys(next.palettes)});
      const campaign=content.catalog.campaigns[options.campaignId==='kane'?'kane':'common'];if(!campaign||!content.catalog.campaigns[options.campaignId??'common'])throw Error('Campaign not found');
      const levels=[...campaign.entries].sort((a,b)=>a.position-b.position).map(e=>({id:e.level,position:e.position,number:e.position-3,name:`Level ${e.position-3}`}));
      const customLevels=[...(options.campaignId==='kane'?[]:content.catalog.campaigns.custom?.entries??[])].sort((a,b)=>a.position-b.position).map(e=>({id:e.level,position:e.position,number:e.position,name:content.levels[e.level]!.level.name}));
      if(!levels.length)throw Error('Empty campaign');loaded=content;manifest=next;
      state={...state,screen:'picker',loading:false,levels,customLevels,error:null};publish();
    }catch(error){if(!disposed&&token===generation)fail(error);}},
    async startLevel(id:string,seed=1){if(disposed||!loaded||!manifest||!isLevelUnlocked(state,id))return;
      const level=loaded.compiled[id];if(!level)return;lastSeed=seed;const token=++generation;clear();
      state={...state,screen:'boot',loading:true,levelId:id,result:null,restartPopup:false,error:null};publish();
      let owned:GameDriver|undefined,created:LevelRuntime|undefined;
      try{
        owned=new GameDriver({level,matchSeed:seed,autoStart:false,
          ...(options.createSim?{createSim:options.createSim}:{}),...(options.createBotDriver?{createBotDriver:options.createBotDriver}:{}),...(options.environment?{environment:options.environment}:{}),
          onFrame:update=>{if(token===generation&&!disposed){try{runtime?.frame(update);}catch(error){fail(error);}}},
          onTick:update=>{if(token!==generation||disposed)return;try{
            runtime?.tick(update);events.forEach(fn=>fn(update));
            state={...state,remainingSeconds:Math.ceil(Math.max(0,update.sim.view.timeLimitTicks-update.tick)/TICK_RATE)};
            if(update.sim.view.over){if(finishingOn)return;const result=update.sim.view.over;save.recordResult(id,{winner:result.winner,human:update.sim.view.players.findIndex(p=>p.kind==='human')});runtime?.cancel();
              const show=()=>{finishing=null;finishingOn=false;if(token!==generation||disposed)return;state={...state,screen:'result',restartPopup:false,result};publish();};
              const delay=options.resultDelayMs??RESULT_DELAY_MS;
              if(delay<=0)show();else{finishingOn=true;finishing=setTimeout(show,delay);publish();}}
            else if(update.tick-lastPublication>=TICK_RATE/10){lastPublication=update.tick;publish();}
          }catch(error){fail(error);}},
          onPauseChange:reason=>{if(reason&&token===generation&&state.screen==='playing'&&!finishingOn){state={...state,restartPopup:state.restartPopup||!(api.kaneMode&&reason==='hidden')};runtime?.cancel();publish();}},
        });
        driver=owned;
        created=await options.createRuntime?.({level,manifest,driver:owned,enabled:()=>state.screen==='playing'&&!state.restartPopup&&!finishingOn,zoomed:state.zoomed});
        if(disposed||token!==generation){created?.dispose();owned.dispose();return;}
        if(api.kaneMode&&owned.pauseReason==='hidden'&&!owned.sim.view.over)owned.resume();
        runtime=created;lastPublication=-Infinity;save.setLastLevel(id);
        state={...state,screen:'playing',loading:false,restartPopup:owned.paused&&!(api.kaneMode&&owned.pauseReason==='hidden'),remainingSeconds:Math.ceil(owned.sim.view.timeLimitTicks/TICK_RATE)};
        runtime?.frame({sim:owned.sim,alpha:0,steps:0,paused:owned.paused});publish();if(options.autoStart!==false)owned.start();
      }catch(error){created?.dispose();owned?.dispose();if(!disposed&&token===generation)fail(error);}
    },
    openPicker(){if(disposed)return;++generation;clear();state={...state,screen:loaded?'picker':'error',loading:false,restartPopup:false,result:null};publish();},
    pause(){if(state.screen!=='playing'||finishingOn)return;runtime?.cancel();driver?.pause();},
    resume(){if(state.screen!=='playing'||(!state.restartPopup&&!(api.kaneMode&&driver?.pauseReason==='hidden')))return;driver?.resume();if(driver&&!driver.paused){state={...state,restartPopup:false};runtime?.refresh();publish();}},
    escape(){if(finishingOn)return;if(state.restartPopup)api.resume();else if(state.screen==='playing'&&!runtime?.cancel())api.pause();},
    restart(){return state.levelId?api.startLevel(state.levelId,lastSeed):Promise.resolve();},
    next(){const levels=state.customLevels.some(l=>l.id===state.levelId)?state.customLevels:state.levels;const i=levels.findIndex(l=>l.id===state.levelId),next=levels[i+1];return next?api.startLevel(next.id):Promise.resolve();},
    retry(){return state.levelId&&loaded?api.restart():api.boot();},
    toggleZoom(){state={...state,zoomed:!state.zoomed};runtime?.setZoom?.(state.zoomed);publish();},
    updateSettings(patch:Partial<SaveSettings>){save.updateSettings(patch);publish();},
    dismissNotices(){state={...state,notices:[]};publish();},
    step(count=1){return driver?.step(count)??0;},
    dispose(){if(disposed)return;disposed=true;++generation;clear();listeners.clear();events.clear();},
  };
  return api;
}
export type AppController=ReturnType<typeof createAppController>;
