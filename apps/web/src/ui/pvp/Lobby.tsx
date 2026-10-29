import type { LobbyStateMsg } from '@node-arena/net';
import type { ConnState } from '../../net/connection';
import { SeatRow } from './SeatRow';
export interface LobbyProps {
  code:string|null; lobby:LobbyStateMsg|null; seat:number|null; host:boolean; conn:ConnState|null; error:string|null;
  levelName:string; seatColors:ReadonlyArray<string|undefined>;
  onReady():void; onStart():void; onLeave():void; onRetry():void; onDismissError():void;
}
/** Why the host cannot start yet; null = can start. */
export function startBlocker(lobby:LobbyStateMsg|null):string|null{
  if(!lobby)return 'Waiting for lobby';
  const humans=lobby.seats.filter(s=>s.kind==='human');
  if(humans.some(s=>!s.occupant))return 'Waiting for opponent';
  if(humans.some(s=>s.occupant&&!s.occupant.ready&&lobby.seats.indexOf(s)!==lobby.host))return 'Waiting for ready';
  return null;
}
export function Lobby({code,lobby,seat,host,conn,error,levelName,seatColors,onReady,onStart,onLeave,onRetry,onDismissError}:LobbyProps){
  const blocker=host?startBlocker(lobby):null,mine=seat!==null?lobby?.seats[seat]?.occupant?.ready??false:false;
  const lost=conn==='lost';
  return <section class="picker panel pvp-panel" aria-label="Lobby">
    <header><h1>Lobby</h1><span class="conn-chip" data-testid="conn-state" data-state={conn??'none'}>{conn??'offline'}</span></header>
    <button class="text-button back-button" data-testid="lobby-leave" onClick={onLeave}>Leave</button>
    {error&&<p class="pvp-error" role="alert" data-testid="pvp-error">{error} <button class="text-button" onClick={onDismissError}>Dismiss</button></p>}
    {lost&&<button class="text-button" data-testid="conn-retry" onClick={onRetry}>Retry connection</button>}
    <p class="lobby-code-line">Room code <strong data-testid="lobby-code">{code??''}</strong></p>
    <p class="lobby-map" data-testid="lobby-map">Map: {levelName}</p>
    <ul class="seat-list">{(lobby?.seats??[]).map((s,i)=><SeatRow key={i} index={i} seat={s} color={seatColors[i]} you={i===seat} host={i===lobby?.host}/>)}</ul>
    <div class="pvp-actions">
      {host?<>
        <button class="level-card menu-button" data-testid="lobby-start" disabled={!!blocker} onClick={onStart}><span>Start</span></button>
        {blocker&&<p class="lobby-reason" data-testid="lobby-reason">{blocker}</p>}
      </>:seat!==null&&<button class="level-card menu-button" data-testid="lobby-ready" aria-pressed={mine} onClick={onReady}><span>{mine?'Not ready':'Ready'}</span></button>}
      {!host&&seat===null&&<p class="lobby-reason">Spectating</p>}
    </div>
  </section>;
}
