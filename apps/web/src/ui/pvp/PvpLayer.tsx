import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { ownership } from '../ownership';
import { PvpHud } from './PvpHud';
import { DESYNC_TOAST, Toast } from './Toast';
import { SYNC_LOST_STRING, type PvpController } from '../../pvp/controller';
import { Lobby } from './Lobby';
import { PvpMenu } from './PvpMenu';
import { PvpResult } from './PvpResult';
const pretty=(id:string)=>id.replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
export function PvpLayer({pvp}:{pvp:PvpController}){
  const [s,setS]=useState(pvp.snapshot()),[code,setCode]=useState(pvp.snapshot().code??'');
  useLayoutEffect(()=>pvp.subscribe(()=>setS(pvp.snapshot())),[pvp]);
  if(s.screen==='menu'||s.screen==='connecting')return <PvpMenu nick={s.nick} code={code} error={s.error} onNick={v=>pvp.setNick(v)} onCode={setCode} onCreate={()=>pvp.create()} onJoin={()=>pvp.join(code)} onBack={()=>pvp.close()} onDismissError={()=>pvp.dismissError()}/>;
  if(s.screen==='lobby'){
    const level=s.lobby?pvp.level(s.lobby.levelId):undefined,palettes=(pvp.options.manifest?.()?.palettes??{}) as Record<string,string>;
    return <Lobby code={s.code} lobby={s.lobby} seat={s.seat} host={s.host} conn={s.conn} error={s.error} levelName={s.lobby?pretty(s.lobby.levelId):''}
      seatColors={(level?.players??[]).map(p=>palettes[p.colorKey])} onReady={()=>pvp.ready()} onStart={()=>pvp.start()} onLeave={()=>{pvp.leave();pvp.close();}} onRetry={()=>pvp.retry()} onDismissError={()=>pvp.dismissError()}/>;
  }
  if(s.screen==='countdown')return <p class="pvp-countdown" role="status" data-testid="pvp-countdown">Get ready</p>;
  if(s.screen==='playing')return <PvpPlaying pvp={pvp}/>;
  if(s.screen==='result'&&s.end)return <PvpResult outcome={s.end.outcome} seat={s.seat} onLeave={()=>pvp.leave()}/>;
  return null;
}
export const TOAST_MS=5000;
function PvpPlaying({pvp}:{pvp:PvpController}){
  const [,bump]=useState(0),[menu,setMenu]=useState(false),[toast,setToast]=useState(false),[lost,setLost]=useState(false);
  useLayoutEffect(()=>pvp.subscribeEvents(u=>{if(u.tick%5===0)bump(n=>n+1);}),[pvp]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(m=>!m);};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[]);
  useEffect(()=>{
    let t:ReturnType<typeof setTimeout>|undefined;
    const off=pvp.subscribePvpEvents(e=>{if(e.t==='sync-lost'){setLost(true);return;}if(e.t!=='desync')return;setToast(true);clearTimeout(t);t=setTimeout(()=>setToast(false),TOAST_MS);});
    return()=>{off();clearTimeout(t);};
  },[pvp]);
  const s=pvp.snapshot(),view=pvp.driver?.sim.view;
  return <>
    <PvpHud segments={view?ownership(view):[]} palettes={(pvp.manifest?.palettes??{}) as Record<string,string>} ticksLeft={(s.start?.timeLimitTicks??0)-(view?.tick??0)} seat={s.seat} menuOpen={menu} onLeave={()=>{pvp.leave();pvp.close();}}/>
    {lost&&<Toast message={SYNC_LOST_STRING} testId="toast-sync-lost"/>}
    {toast&&<Toast message={DESYNC_TOAST} testId="toast-desync"/>}
  </>;
}
