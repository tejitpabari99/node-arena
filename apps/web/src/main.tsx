import { contentFiles } from './app/boot';
import { createAppController } from './app/state';
import { createBrowserRuntime } from './app/runtime';
import { createInputController } from './input';
import { mountApp } from './ui/App';
import { connectAppAudio } from './audio/app';
import { createPvpController } from './pvp/controller';
import type { WebSocketLike } from './net/connection';
import { createIdentity } from './net/identity';
import { currentServerUrl } from './net/server-url';
import { parseRoomLink } from './net/links';
import { webVersions } from './net/versions';
import { loadManifest } from './manifest/load';
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
  const createRuntime:NonNullable<Parameters<typeof createAppController>[0]['createRuntime']>=context=>createBrowserRuntime(context,arena,(ctx,stage)=>createInputController({canvas:stage.canvas,sim:ctx.driver.sim,camera:stage.camera,world:stage.world,worldRoot:stage.worldRoot,scene:stage.scene,driver:ctx.driver,seat:ctx.seat,isEnabled:()=>ctx.enabled()&&!ctx.driver.paused}));
  const app=createAppController({files,...harness?.options,createRuntime});
  let pvpManifest:Awaited<ReturnType<typeof loadManifest>>|undefined;
  void loadManifest().then(m=>{pvpManifest=m;}).catch(()=>undefined);
  const pvp=createPvpController({identity:createIdentity(),serverUrl:currentServerUrl(),versions:webVersions(),createSocket:url=>new WebSocket(url) as unknown as WebSocketLike,files,manifest:()=>pvpManifest,createRuntime});
  const sync=()=>{const state=app.snapshot(),p=pvp.snapshot().screen,pvpShown=(p==='countdown'||p==='playing'||p==='result')&&!!pvp.driver;arena.hidden=p!=='idle'?!pvpShown:state.screen!=='playing'&&state.screen!=='result'&&!app.driver;};
  const unsubscribe=[app.subscribe(sync),pvp.subscribe(sync)];
  const unmount=mountApp(app,root,undefined,pvp),audio=connectAppAudio(app);
  if(harness){harness.applyPvp(pvp);window.__na=harness.connect(app,pvp);}
  await app.boot();
  const query=new URLSearchParams(location.search);
  if(query.get('view')==='custom')app.setPickerView('custom');
  // Play links are part of the M1 room flow; spectator links arrive in M2.
  if(query.has('room')&&!query.has('watch'))pvp.openLink(parseRoomLink(location.search));
  else await harness?.autoLoad(app);
  if(import.meta.hot)import.meta.hot.dispose(()=>{window.__na?.dispose();delete window.__na;audio.dispose();unsubscribe.forEach(u=>u());unmount();pvp.dispose();app.dispose();arena.remove();});
}
void main();
