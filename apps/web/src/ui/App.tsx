import { render } from 'preact';
import { useEffect,useLayoutEffect,useState } from 'preact/hooks';
import type { AppController } from '../app/state';
import { Picker } from './Picker';
import { Credits } from './Credits';
import { Hud } from './Hud';
import { PvpLayer } from './pvp/PvpLayer';
import type { PvpController } from '../pvp/controller';
export function App({app,onEditLevel,pvp}:{app:AppController;onEditLevel?:(()=>void)|undefined;pvp?:PvpController|undefined}){
  const [state,setState]=useState(app.snapshot()),[credits,setCredits]=useState(false),[pvpScreen,setPvpScreen]=useState(pvp?.snapshot().screen??'idle');
  useLayoutEffect(()=>app.subscribe(()=>setState(app.snapshot())),[app]);
  useLayoutEffect(()=>pvp?.subscribe(()=>setPvpScreen(pvp.snapshot().screen)),[pvp]);
  const pvpActive=pvpScreen!=='idle';
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape')app.escape();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[app]);
  const mute=()=>{const muted=state.save.settings.musicMute&&state.save.settings.sfxMute;app.updateSettings({musicMute:!muted,sfxMute:!muted});};
  return <>
    {state.screen==='boot'&&<section class="panel loading" role="status">Loading battle…</section>}
    {state.screen==='picker'&&!pvpActive&&(credits?<Credits onBack={()=>setCredits(false)}/>:<Picker state={state} onView={v=>app.setPickerView(v)} onStart={id=>{void app.startLevel(id);}} onMute={mute} onCredits={()=>setCredits(true)} {...(pvp&&pvp.snapshot().serverUrl?{onPlayOnline:()=>pvp.open()}:{})}/>)}
    {pvp&&pvpActive&&<PvpLayer pvp={pvp}/>}
    {(state.screen==='playing'||state.screen==='result')&&!pvpActive&&<Hud state={state} app={app} onMute={mute} onEditLevel={onEditLevel}/>}
    {state.screen==='error'&&<section class="panel error" role="alert"><h1>Could not load battle</h1><p>{state.error instanceof Error?state.error.message:String(state.error)}</p><button onClick={()=>{void app.retry();}}>Retry</button><button onClick={()=>app.openPicker()}>Levels</button></section>}
    {!!state.notices.length&&<aside class="notice" role="status">{state.notices.map(n=><p key={n}>{n}</p>)}<button onClick={()=>app.dismissNotices()}>Dismiss</button></aside>}
  </>;
}
export function mountApp(app:AppController,parent:HTMLElement,onEditLevel?:(()=>void)|undefined,pvp?:PvpController){render(<App app={app} onEditLevel={onEditLevel} pvp={pvp}/>,parent);return()=>render(null,parent);}
