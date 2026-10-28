import { contentFiles } from './app/boot';
import { createAppController } from './app/state';
import { createBrowserRuntime } from './app/runtime';
import { createInputController } from './input';
import { mountApp } from './ui/App';
import { connectAppAudio } from './audio/app';
import './style.css';
async function main(){
  const root=document.getElementById('app');if(!root)throw Error('Missing app root');
  const arena=document.createElement('div');arena.id='arena';arena.setAttribute('aria-label','Arena');document.body.prepend(arena);
  const files=contentFiles();
  let harness:ReturnType<typeof import('./test-harness').createTestHarness>|undefined;
  // Literal build constants let Rollup remove both dynamic imports from production.
  if(import.meta.env.DEV||import.meta.env.VITE_TEST_HOOKS==='1'){
    const [{testHookRequest},{createTestHarness}]=await Promise.all([import('./test-harness/gate'),import('./test-harness')]);
    harness=createTestHarness(files,testHookRequest(location.search,true));
  }
  const app=createAppController({files,...harness?.options,createRuntime:context=>createBrowserRuntime(context,arena,(ctx,stage)=>createInputController({canvas:stage.canvas,sim:ctx.driver.sim,camera:stage.camera,world:stage.world,worldRoot:stage.worldRoot,scene:stage.scene,driver:ctx.driver,seat:ctx.seat,isEnabled:()=>ctx.enabled()&&!ctx.driver.paused}))});
  const unsubscribe=app.subscribe(()=>{const state=app.snapshot();arena.hidden=state.screen!=='playing'&&state.screen!=='result'&&!app.driver;});
  const unmount=mountApp(app,root),audio=connectAppAudio(app);
  if(harness)window.__na=harness.connect(app);
  await app.boot();if(new URLSearchParams(location.search).get('view')==='custom')app.setPickerView('custom');await harness?.autoLoad(app);
  if(import.meta.hot)import.meta.hot.dispose(()=>{window.__na?.dispose();delete window.__na;audio.dispose();unsubscribe();unmount();app.dispose();arena.remove();});
}
void main();
