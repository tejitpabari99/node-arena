/** Test-only app fixture using normal content loading and sim/controller paths. */
import { create } from '@node-arena/sim';
import { contentFiles } from '../../src/app/boot';
import { createAppController } from '../../src/app/state';
import { createSaveStore } from '../../src/save';
import { mountApp } from '../../src/ui/App';
import { withCustomLevels,withoutCustomLevels } from './custom-content';
import '../../src/style.css';
const manifest=await fetch('/manifest.json').then(r=>r.json());
const files=new URLSearchParams(location.search).has('custom')?withCustomLevels(contentFiles()):withoutCustomLevels(contentFiles());
const app=createAppController({files,loadManifest:async()=>manifest,save:createSaveStore({storage:null}),autoStart:false,resultDelayMs:0,createBotDriver:()=>({commands:()=>[]}),createSim:(level,seed)=>{
  const sim=create(level,seed);return {...sim,step:()=>{sim.view.over={outcome:'won',winner:0};return [];}};
}});
mountApp(app,document.getElementById('app')!);await app.boot();
Object.assign(window,{customTest:{step:()=>app.step()}});
