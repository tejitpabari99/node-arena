import { render, type ComponentChildren } from 'preact';
import { useEffect,useLayoutEffect,useState } from 'preact/hooks';
import type { AppController } from '../app/state';
import { Picker } from './Picker';
import { Credits } from './Credits';
import { Hud } from './Hud';
export function App({app,overlay}:{app:AppController;overlay?:ComponentChildren}){
  const [state,setState]=useState(app.snapshot()),[credits,setCredits]=useState(false);
  useLayoutEffect(()=>app.subscribe(()=>setState(app.snapshot())),[app]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape')app.escape();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[app]);
  const mute=()=>{const muted=state.save.settings.musicMute&&state.save.settings.sfxMute;app.updateSettings({musicMute:!muted,sfxMute:!muted});};
  return <>
    {import.meta.env.DEV&&<a class="editor-entry" aria-label="Edit level" href={state.levelId&&(state.screen==='playing'||state.screen==='result')?`/editor.html?level=${encodeURIComponent(state.levelId)}`:'/editor.html'}>Edit level</a>}
    {state.screen==='boot'&&<section class="panel loading" role="status">Loading battle…</section>}
    {state.screen==='picker'&&(credits?<Credits onBack={()=>setCredits(false)}/>:<Picker state={state} onStart={id=>{void app.startLevel(id);}} onMute={mute} onCredits={()=>setCredits(true)}/>)}
    {overlay}
    {(state.screen==='playing'||state.screen==='result')&&<Hud state={state} app={app} onMute={mute}/>}
    {state.screen==='error'&&<section class="panel error" role="alert"><h1>Could not load battle</h1><p>{state.error instanceof Error?state.error.message:String(state.error)}</p><button onClick={()=>{void app.retry();}}>Retry</button><button onClick={()=>app.openPicker()}>Levels</button></section>}
    {!!state.notices.length&&<aside class="notice" role="status">{state.notices.map(n=><p key={n}>{n}</p>)}<button onClick={()=>app.dismissNotices()}>Dismiss</button></aside>}
  </>;
}
export function mountApp(app:AppController,parent:HTMLElement,overlay?:ComponentChildren){render(<App app={app} overlay={overlay}/>,parent);return()=>render(null,parent);}
