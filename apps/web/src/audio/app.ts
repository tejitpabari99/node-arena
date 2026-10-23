import type { ManifestV2 } from '@node-arena/content';
import type { AppController } from '../app/state';
import { createAudio, type AudioOptions } from './index';
export interface BrowserAudioOptions extends AudioOptions {
  fetcher?: typeof fetch;
  /** Testable decoder; browser default uses a short-lived decode-only AudioContext. */
  decode?: (data:ArrayBuffer)=>Promise<AudioBuffer>;
}
/** Fetches only manifest audio paths. Decode contexts close after loading; playback context is gesture-owned. */
export async function loadAudioBuffers(manifest:ManifestV2,signal:AbortSignal,options:BrowserAudioOptions={}) {
  const paths=[...new Set([...Object.values(manifest.events),...Object.values(manifest.visuals)].flatMap(v=>v.sfx?[v.sfx]:[]))];
  const buffers=new Map<string,AudioBuffer>();if(!paths.length)return buffers;
  let context:AudioContext|undefined;
  try {
    const decode=options.decode??(async(data:ArrayBuffer)=>{context??=new AudioContext();return context.decodeAudioData(data);});
    await Promise.all(paths.map(async path=>{try{const response=await(options.fetcher??fetch)(`/${path}`,{signal});if(!response.ok)return;const buffer=await decode(await response.arrayBuffer());if(!signal.aborted)buffers.set(path,buffer);}catch{/* Optional sound must not prevent play. */}}));
  }finally{if(context)await context.close().catch(()=>{});}
  return buffers;
}
/** Audio follows the driver lifetime. No AssetSession/v1 renderer dependencies. Manifest v2 has no music entry. */
export function connectAppAudio(app:AppController,options:BrowserAudioOptions={}) {
  const audio=createAudio(options);let driver:AppController['driver']=null,abort:AbortController|undefined,disposed=false;
  function sync(){
    audio.settings(app.snapshot().save.settings);
    if(driver===app.driver)return;
    driver=app.driver;abort?.abort();audio.clearLevel();
    if(!driver||!app.manifest)return;
    const current=driver,manifest=app.manifest,controller=new AbortController();abort=controller;
    void loadAudioBuffers(manifest,controller.signal,options).then(buffers=>{if(!disposed&&!controller.signal.aborted&&driver===current)audio.setLevel(manifest,buffers);});
  }
  const unsubscribe=app.subscribe(sync),unsubscribeEvents=app.subscribeEvents(update=>audio.consumeEvents(update.events,update.sim.view));sync();
  return {audio,dispose(){disposed=true;abort?.abort();unsubscribe();unsubscribeEvents();audio.dispose();}};
}
