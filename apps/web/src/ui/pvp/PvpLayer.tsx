import { useLayoutEffect, useState } from 'preact/hooks';
import type { PvpController } from '../../pvp/controller';
import { Lobby } from './Lobby';
import { PvpMenu } from './PvpMenu';
const pretty=(id:string)=>id.replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
export function PvpLayer({pvp}:{pvp:PvpController}){
  const [s,setS]=useState(pvp.snapshot()),[code,setCode]=useState('');
  useLayoutEffect(()=>pvp.subscribe(()=>setS(pvp.snapshot())),[pvp]);
  if(s.screen==='menu'||s.screen==='connecting')return <PvpMenu nick={s.nick} code={code} error={s.error} onNick={v=>pvp.setNick(v)} onCode={setCode} onCreate={()=>pvp.create()} onJoin={()=>pvp.join(code)} onBack={()=>pvp.close()} onDismissError={()=>pvp.dismissError()}/>;
  if(s.screen==='lobby'){
    const level=s.lobby?pvp.level(s.lobby.levelId):undefined,palettes=(pvp.options.manifest?.()?.palettes??{}) as Record<string,string>;
    return <Lobby code={s.code} lobby={s.lobby} seat={s.seat} host={s.host} conn={s.conn} error={s.error} levelName={s.lobby?pretty(s.lobby.levelId):''}
      seatColors={(level?.players??[]).map(p=>palettes[p.colorKey])} onReady={()=>pvp.ready()} onStart={()=>pvp.start()} onLeave={()=>{pvp.leave();pvp.close();}} onRetry={()=>pvp.retry()} onDismissError={()=>pvp.dismissError()}/>;
  }
  if(s.screen==='countdown')return <p class="pvp-countdown" role="status" data-testid="pvp-countdown">Get ready</p>;
  return null;
}
