import type { LobbyStateMsg, SeatConfig } from '@node-arena/net';
import type { ConnState } from '../../net/connection';
import type { PvpMapInfo } from '@node-arena/content';
import { SeatRow } from './SeatRow';
import { DrainBanner } from './DrainBanner';
export interface LobbyProps {
  code:string|null; lobby:LobbyStateMsg|null; seat:number|null; host:boolean; conn:ConnState|null; error:string|null;
  levelName:string; seatColors:ReadonlyArray<string|undefined>;
  maps?:PvpMapInfo[]; links?:{play:string;watch:string}|null; onMap?(levelId:string):void; onSeat?(seats:SeatConfig[]):void; onCopy?(text:string):void;
  /** SP09: server restart notice received; Start is disabled. */
  draining?:boolean;
  onReady():void; onStart():void; onLeave():void; onRetry():void; onDismissError():void;
}
/** Why the host cannot start yet; null = can start. */
export function startBlocker(lobby:LobbyStateMsg|null):string|null{
  if(!lobby)return 'Waiting for lobby';
  const humans=lobby.seats.filter(s=>s.kind==='human');
  if(humans.some(s=>!s.occupant))return 'Waiting for opponent';
  if(humans.some(s=>s.occupant&&s.occupant.status!=='connected'))return 'Waiting for player to reconnect';
  if(humans.some(s=>s.occupant&&!s.occupant.ready&&lobby.seats.indexOf(s)!==lobby.host))return 'Waiting for ready';
  return null;
}
export function Lobby({code,lobby,seat,host,conn,error,levelName,seatColors,draining=false,maps=[],links=null,onMap,onSeat,onCopy,onReady,onStart,onLeave,onRetry,onDismissError}:LobbyProps){
  const blocker=host?startBlocker(lobby):null,mine=seat!==null?lobby?.seats[seat]?.occupant?.ready??false:false;
  const lost=conn==='lost';
  const cfg=(lobby?.seats??[]).map(({kind,team,difficulty}):SeatConfig=>difficulty===undefined?{kind,team}:{kind,team,difficulty});
  const teamCount=Math.max(2,cfg.length);
  const change=(i:number,patch:Partial<SeatConfig>)=>{
    const next=cfg.map((c,j)=>{
      if(j!==i)return c;
      const m:SeatConfig={...c,...patch};
      if(m.kind==='bot')m.difficulty=m.difficulty??'normal';else delete m.difficulty;
      return m;
    });
    onSeat?.(next);
  };
  return <section class="picker panel pvp-panel" aria-label="Lobby">
    <header><h1>Lobby</h1><span class="conn-chip" data-testid="conn-state" data-state={conn??'none'}>{conn??'offline'}</span></header>
    <button class="text-button back-button" data-testid="lobby-leave" onClick={onLeave}>Leave</button>
    {draining&&<DrainBanner deadlineAt={0} mode="lobby"/>}
    {error&&<p class="pvp-error" role="alert" data-testid="pvp-error">{error} <button class="text-button" onClick={onDismissError}>Dismiss</button></p>}
    {lost&&<button class="text-button" data-testid="conn-retry" onClick={onRetry}>Retry connection</button>}
    <p class="lobby-code-line">Room code <strong data-testid="lobby-code">{code??''}</strong></p>
    <p class="lobby-map" data-testid="lobby-map">Map: {levelName}</p>
    {maps.length>0&&<ul class="map-list" aria-label="Maps">{maps.map(m=><li key={m.id}>
      <button class="level-card menu-button" data-testid={`lobby-map-${m.id}`} aria-pressed={m.id===lobby?.levelId} disabled={!host} onClick={()=>onMap?.(m.id)}>
        <span>{m.name}</span><small>{m.seats} seats</small>
      </button></li>)}</ul>}
    <ul class="seat-list">{(lobby?.seats??[]).map((s,i)=><SeatRow key={i} index={i} seat={s} color={seatColors[i]} you={i===seat} host={i===lobby?.host} teamCount={teamCount} editable={host} onChange={change}/>)}</ul>
    {links&&<div class="lobby-links">
      <button class="text-button" data-testid="copy-play-link" onClick={()=>onCopy?.(links.play)}>Copy play link</button>
      <button class="text-button" data-testid="copy-watch-link" onClick={()=>onCopy?.(links.watch)}>Copy watch link</button>
    </div>}
    <p class="lobby-spectators" data-testid="lobby-spectators">Spectators: {lobby?.spectators??0}</p>
    <div class="pvp-actions">
      {host?<>
        <button class="level-card menu-button" data-testid="lobby-start" disabled={!!blocker||draining} onClick={onStart}><span>Start</span></button>
        {blocker&&<p class="lobby-reason" data-testid="lobby-reason">{blocker}</p>}
      </>:seat!==null&&<button class="level-card menu-button" data-testid="lobby-ready" aria-pressed={mine} onClick={onReady}><span>{mine?'Not ready':'Ready'}</span></button>}
      {!host&&seat===null&&<p class="lobby-reason">Spectating</p>}
    </div>
  </section>;
}
