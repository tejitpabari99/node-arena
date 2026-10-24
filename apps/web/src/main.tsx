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
  let kane:typeof import('./kane')|undefined;
  let controls:import('./kane').KaneControls|undefined;
  // Literal build constants let Rollup remove test-only dynamic imports from production.
  if(import.meta.env.DEV||import.meta.env.VITE_TEST_HOOKS==='1'){
    const [{testHookRequest},{createTestHarness}]=await Promise.all([import('./test-harness/gate'),import('./test-harness')]);
    const request=testHookRequest(location.search,true);
    if(request.kane){
      const [content,module]=await Promise.all([import('./test-harness/kane-files'),import('./kane')]);
      Object.assign(files,content.kaneContentFiles());kane=module;
    }
    harness=createTestHarness(files,request);
  }
  const app=createAppController({files,...harness?.options,createRuntime:context=>createBrowserRuntime(context,arena,(ctx,stage)=>{
    const input=createInputController({canvas:stage.canvas,sim:ctx.driver.sim,camera:stage.camera,world:stage.world,worldRoot:stage.worldRoot,scene:stage.scene,driver:ctx.driver,isEnabled:()=>ctx.enabled()&&!ctx.driver.paused});
    return controls?.wrapInput?.(input,ctx,stage)??input;
  })});
  const unsubscribe=app.subscribe(()=>{const state=app.snapshot();arena.hidden=state.screen!=='playing'&&state.screen!=='result'&&!app.driver;});
  if(harness)window.__na=harness.connect(app);
  if(kane&&window.__na)controls=kane.createKaneOverlay(app,window.__na);
  const unmount=mountApp(app,root,controls?.overlay),audio=connectAppAudio(app);
  await app.boot();await harness?.autoLoad(app);
  if(import.meta.hot)import.meta.hot.dispose(()=>{window.__na?.dispose();delete window.__na;audio.dispose();unsubscribe();unmount();app.dispose();arena.remove();});
}
void main();
