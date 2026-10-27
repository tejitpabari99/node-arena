import { render } from 'preact';
import { useEffect,useLayoutEffect,useState } from 'preact/hooks';
import type { AppController } from '../app/state';
import { Picker } from './Picker';
import { Credits } from './Credits';
import { Hud } from './Hud';
export function App({app,onEditLevel}:{app:AppController;onEditLevel?:(()=>void)|undefined}){
  const [state,setState]=useState(app.snapshot()),[credits,setCredits]=useState(false);
  useLayoutEffect(()=>app.subscribe(()=>setState(app.snapshot())),[app]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape')app.escape();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[app]);
  const mute=()=>{const muted=state.save.settings.musicMute&&state.save.settings.sfxMute;app.updateSettings({musicMute:!muted,sfxMute:!muted});};
  return <>
    {state.screen==='boot'&&<section class="panel loading" role="status">Loading battle…</section>}
    {state.screen==='picker'&&(credits?<Credits onBack={()=>setCredits(false)}/>:<Picker state={state} onView={v=>app.setPickerView(v)} onStart={id=>{void app.startLevel(id);}} onMute={mute} onCredits={()=>setCredits(true)}/>)}
    {(state.screen==='playing'||state.screen==='result')&&<Hud state={state} app={app} onMute={mute} onEditLevel={onEditLevel}/>}
    {state.screen==='error'&&<section class="panel error" role="alert"><h1>Could not load battle</h1><p>{state.error instanceof Error?state.error.message:String(state.error)}</p><button onClick={()=>{void app.retry();}}>Retry</button><button onClick={()=>app.openPicker()}>Levels</button></section>}
    {!!state.notices.length&&<aside class="notice" role="status">{state.notices.map(n=><p key={n}>{n}</p>)}<button onClick={()=>app.dismissNotices()}>Dismiss</button></aside>}
  </>;
}
export function mountApp(app:AppController,parent:HTMLElement,onEditLevel?:(()=>void)|undefined){render(<App app={app} onEditLevel={onEditLevel}/>,parent);return()=>render(null,parent);}
