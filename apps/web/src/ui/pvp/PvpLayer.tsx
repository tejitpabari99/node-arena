import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ownership } from '../ownership';
import { PvpHud, buildPauseUi } from './PvpHud';
import { DESYNC_TOAST, Toast } from './Toast';
import { SYNC_LOST_STRING, type PvpController } from '../../pvp/controller';
import { shareLinks } from '../../net/links';
import { Lobby } from './Lobby';
import { PvpMenu } from './PvpMenu';
import { PvpResult } from './PvpResult';
import { ConnBanner } from './ConnBanner';
import { DrainBanner } from './DrainBanner';
const pretty=(id:string)=>id.replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
export function PvpLayer({pvp}:{pvp:PvpController}){
  const [s,setS]=useState(pvp.snapshot()),[code,setCode]=useState(pvp.snapshot().code??'');
  useLayoutEffect(()=>pvp.subscribe(()=>setS(pvp.snapshot())),[pvp]);
  if(s.screen==='menu'||s.screen==='connecting')return <PvpMenu nick={s.nick} code={code} error={s.error} unavailable={s.pvpUnavailable||s.screen==='connecting'} reload={s.conn==='refused'&&!s.pvpUnavailable} onNick={v=>pvp.setNick(v)} onCode={setCode} onCreate={()=>pvp.create()} onJoin={()=>pvp.join(code)} onWatch={()=>pvp.watch(code)} onBack={()=>pvp.close()} onDismissError={()=>pvp.dismissError()}/>;
  if(s.screen==='restarted')return <section class="picker panel pvp-panel" aria-label="Server restarted">
    <p class="pvp-error" role="alert" data-testid="pvp-restarted">{s.error}</p>
    <button class="level-card menu-button" data-testid="pvp-restarted-menu" onClick={()=>pvp.backToMenu()}>Back to menu</button>
  </section>;
  if(s.screen==='lobby'){
    const maps=pvp.maps(),level=s.lobby?pvp.level(s.lobby.levelId):undefined,palettes=(pvp.options.manifest?.()?.palettes??{}) as Record<string,string>;
    return <Lobby code={s.code} lobby={s.lobby} seat={s.seat} host={s.host} conn={s.conn} error={s.error} levelName={s.lobby?(maps.find(m=>m.id===s.lobby!.levelId)?.name??pretty(s.lobby.levelId)):''}
      maps={maps} links={s.code&&typeof location!=='undefined'?shareLinks(location.origin,location.pathname,s.code):null}
      onMap={id=>pvp.updateLobby(id,[])} onSeat={seats=>s.lobby&&pvp.updateLobby(s.lobby.levelId,seats)} onCopy={t=>{try{void navigator.clipboard?.writeText(t);}catch{/* clipboard unavailable */}}}
      seatColors={(level?.players??[]).map(p=>palettes[p.colorKey])} draining={!!s.draining} onReady={()=>pvp.ready()} onStart={()=>pvp.start()} onLeave={()=>pvp.leave()} onRetry={()=>pvp.retry()} onDismissError={()=>pvp.dismissError()}/>;
  }
  if((s.screen==='countdown'||s.screen==='playing')&&s.error===SYNC_LOST_STRING)return <section class="picker panel pvp-panel" aria-label="Connection interrupted">
    <p class="pvp-error" role="alert" data-testid="toast-sync-lost">{s.error}</p>
    <button class="level-card menu-button" data-testid="pvp-sync-leave" onClick={()=>pvp.leave()}>Leave</button>
  </section>;
  if(s.screen==='countdown')return <><ConnBanner conn={s.conn} onRetry={()=>pvp.retry()}/>{s.draining&&<DrainBanner deadlineAt={s.draining.deadlineAt} mode="match" now={()=>pvp.options.now?.()??performance.now()}/>}<p class="pvp-countdown" role="status" data-testid="pvp-countdown">Get ready</p></>;
  if(s.screen==='playing')return <PvpPlaying pvp={pvp}/>;
  if(s.screen==='result'&&s.end)return <><ConnBanner conn={s.conn} onRetry={()=>pvp.retry()}/><PvpResult outcome={s.end.outcome} seat={s.seat} ranking={s.ranking} seats={s.start?.seats} draining={!!s.draining} onLeave={()=>pvp.leave()} onRematch={()=>pvp.rematch()}/></>;
  return null;
}
export const TOAST_MS=5000;
/** Leave asks for quit confirmation only for a seat still in the match; spectators and eliminated seats leave directly. */
export const leaveNeedsConfirm=(seat:number|null,eliminated:boolean):boolean=>seat!==null&&!eliminated;
function PvpPlaying({pvp}:{pvp:PvpController}){
  const [,bump]=useState(0),[menu,setMenu]=useState(false),[toast,setToast]=useState(false),[confirm,setConfirm]=useState(false);
  useLayoutEffect(()=>pvp.subscribeEvents(u=>{if(u.tick%5===0)bump(n=>n+1);}),[pvp]);
  const confirmRef=useRef(false);confirmRef.current=confirm;
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(e.key!=='Escape')return;if(confirmRef.current)setConfirm(false);else setMenu(m=>!m);};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[]);
  const live=pvp.snapshot().pause;
  useEffect(()=>{ // display-only countdown tick while a limited hold is open
    if(!live?.paused||live.unlimited)return;
    const id=setInterval(()=>bump(n=>n+1),250);return()=>clearInterval(id);
  },[live?.paused,live?.epoch,live?.unlimited]);
  useEffect(()=>{
    let t:ReturnType<typeof setTimeout>|undefined;
    const off=pvp.subscribePvpEvents(e=>{if(e.t!=='resync')return;setToast(true);clearTimeout(t);t=setTimeout(()=>setToast(false),TOAST_MS);});
    return()=>{off();clearTimeout(t);};
  },[pvp]);
  const s=pvp.snapshot(),view=pvp.driver?.sim.view;
  const eliminated=((view?.eliminatedAt as ArrayLike<number>|undefined)?.[s.seat??-1]??-1)>=0;
  return <>
    <ConnBanner conn={s.conn} onRetry={()=>pvp.retry()}/>
    {s.draining&&<DrainBanner deadlineAt={s.draining.deadlineAt} mode="match" now={()=>pvp.options.now?.()??performance.now()}/>}
    <PvpHud segments={view?ownership(view):[]} palettes={(pvp.manifest?.palettes??{}) as Record<string,string>} ticksLeft={(s.start?.timeLimitTicks??0)-(view?.tick??0)} seat={s.seat} menuOpen={menu&&!confirm} pause={buildPauseUi(s.pause,pvp.pauseRemaining(),s.seat,Object.fromEntries((s.start?.seats??[]).map(x=>[x.player,x.nick])),eliminated)} onPause={()=>pvp.pause()} onResume={()=>pvp.resume()} confirmQuit={confirm} onQuitYes={()=>{setConfirm(false);pvp.quit();}} onQuitNo={()=>setConfirm(false)} catchup={pvp.driver?.catchupProgress??null} onLeave={()=>{if(!leaveNeedsConfirm(s.seat,eliminated))pvp.leave();else{setMenu(false);setConfirm(true);}}} legend={s.start&&view?{seats:s.start.seats,colorKeys:(view.players??[]).map(p=>p.colorKey),eliminatedAt:view.eliminatedAt?Array.from(view.eliminatedAt as ArrayLike<number>):undefined,seatStatus:s.seatStatus}:undefined}/>
    {toast&&<Toast message={DESYNC_TOAST} testId="toast-desync"/>}
  </>;
}
