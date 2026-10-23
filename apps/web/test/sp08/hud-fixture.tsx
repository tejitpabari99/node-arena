/** Isolated browser fixture; never imported by the application or bundled entrypoint. */
import { create } from '@node-arena/sim';
import { contentFiles } from '../../src/app/boot';
import { createAppController } from '../../src/app/state';
import { createSaveStore } from '../../src/save';
import { mountApp } from '../../src/ui/App';
import '../../src/style.css';
const params=new URLSearchParams(location.search),mode=params.get('outcome');
const manifest=await fetch('/manifest.json').then(r=>r.json());
const save=createSaveStore({storage:localStorage});
const app=createAppController({files:contentFiles(),loadManifest:async()=>manifest,save,autoStart:false,createBotDriver:()=>({commands:()=>[]}),createSim:(level,seed)=>{
  const sim=create(level,seed);
  if(!mode)return sim;
  return {...sim,step:()=>{sim.view.over={outcome:mode==='timeout'?'timeout':'won',winner:mode==='win'?sim.view.players.findIndex(p=>p.kind==='human'):mode==='loss'?sim.view.players.findIndex(p=>p.kind==='ai'):null};return [];}};
}});
mountApp(app,document.getElementById('app')!);await app.boot();
Object.assign(window,{hudTest:{step:(count=1)=>app.step(count),snapshot:()=>app.snapshot(),tick:()=>app.driver?.sim.view.tick,paused:()=>app.driver?.paused}});
