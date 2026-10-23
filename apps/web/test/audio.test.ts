import { expect,it,vi } from 'vitest';
import { contentFiles } from '../src/app/boot';
import { createAppController } from '../src/app/state';
import { createSaveStore,SAVE_KEY } from '../src/save';
import { createAudio } from '../src/audio';
import { connectAppAudio } from '../src/audio/app';
import manifestJson from '../assets/manifest.json';
import { parseManifest } from '../src/manifest/load';
function context(){
 const sources:{buffer:AudioBuffer|null;loop:boolean;onended:null|(()=>void);connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>}[]=[];
 const gains:{gain:{value:number};connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>}[]=[];
 const value={state:'running',currentTime:0,destination:{},close:vi.fn(async()=>{}),resume:vi.fn(async()=>{}),
 createGain:()=>{const g={gain:{value:1},connect:vi.fn(),disconnect:vi.fn()};gains.push(g);return g;},
 createBufferSource:()=>{const s={buffer:null as AudioBuffer|null,loop:false,onended:null as null|(()=>void),connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()};sources.push(s);return s;}};
 return {value:value as unknown as AudioContext,sources,gains,close:value.close};
}
it('v2 controller audio follows driver events, persisted mute and level disposal',async()=>{
 const ctx=context(),data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
 const app=createAppController({files:contentFiles(),loadManifest:async()=>parseManifest({...manifestJson,events:{...manifestJson.events,LineDrawn:{sfx:'audio/draw.wav'}}}),save:createSaveStore({storage}),autoStart:false,createBotDriver:()=>({commands:()=>[]})});
 const connector=connectAppAudio(app,{context:ctx.value,gestureTarget:new EventTarget(),fetcher:vi.fn(async()=>new Response(new ArrayBuffer(2))),decode:async()=>({} as AudioBuffer)});
 await app.boot();await app.startLevel(app.snapshot().levels[0]!.id);await vi.waitFor(()=>expect(connector.audio.activeVoices).toBe(0));
 // Audio fetching/decoding is asynchronous; wait for the real load's response jobs before submitting.
 await new Promise<void>(resolve=>setTimeout(resolve,0));
 const sim=app.driver!.sim;let pair:number[]=[];for(let from=0;from<sim.view.ids.buildings.length&&!pair.length;from++)for(let to=0;to<sim.view.ids.buildings.length;to++)if(sim.canDraw(0,from,to)===null){pair=[from,to];break;}
 app.driver!.submit({type:'DrawLine',player:0,from:pair[0]!,to:pair[1]!});app.step();expect(connector.audio.activeVoices).toBe(1);
 app.updateSettings({sfxMute:true});expect(ctx.gains[0]!.gain.value).toBe(0);expect(JSON.parse(data.get(SAVE_KEY)!).settings.sfxMute).toBe(true);
 await app.restart();expect(connector.audio.activeVoices).toBe(0);expect(ctx.sources[0]!.buffer).toBeNull();app.openPicker();connector.dispose();app.dispose();expect(ctx.close).not.toHaveBeenCalled();
});
it('gesture-created playback context is closed exactly once on disposal',()=>{
 const ctx=context(),target=new EventTarget(),audio=createAudio({createContext:()=>ctx.value,gestureTarget:target});target.dispatchEvent(new Event('pointerdown'));audio.dispose();audio.dispose();expect(ctx.close).toHaveBeenCalledOnce();
});
