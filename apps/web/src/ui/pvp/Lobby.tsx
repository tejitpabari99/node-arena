import type { LobbyStateMsg } from '@node-arena/net';
import type { ConnState } from '../../net/connection';
import type { PvpMapInfo } from '@node-arena/content';
import type { LevelThumbnailService } from '../../render/level-thumbnail';
import { RoomForm } from './RoomForm';
import { DrainBanner } from './DrainBanner';
import { Toast } from './Toast';
import { draftToSeats, seatsToDraft, setMap, setPlayers, setRow, setTeams, setType, clampDraft, type CreateDraft, type DraftRow, type RoomType } from '../../pvp/room-draft';
/** Host-local type/teams memory: the server only stores seats, and 2-player Team is indistinguishable from PvP. */
export interface TypeHint { type:RoomType; teams:number }
export interface LobbyProps {
  code:string|null; lobby:LobbyStateMsg|null; seat:number|null; host:boolean; conn:ConnState|null; error:string|null;
  nick:string; seatColors:ReadonlyArray<string|undefined>;
  maps?:PvpMapInfo[]; thumbs?:LevelThumbnailService|undefined; hint?:TypeHint|null; onHint?(h:TypeHint|null):void;
  links?:{play:string;watch:string}|null; onUpdate?(levelId:string,seats:ReturnType<typeof draftToSeats>):void; onCopy?(text:string):void;
  /** SP09: server restart notice received; Start is disabled. */
  draining?:boolean; toast?:string|null;
  onReady():void; onStart():void; onLeave():void; onRetry():void; onDismissError():void;
}
/** Why the host cannot start yet; null = can start. */
export function startBlocker(lobby:LobbyStateMsg|null):string|null{
  if(!lobby)return 'Waiting for lobby';
  const humans=lobby.seats.filter(s=>s.kind==='human');
  if(humans.some(s=>!s.occupant))return 'Waiting for opponent';
  if(humans.some(s=>s.occupant&&s.occupant.status!=='connected'))return 'Waiting for player to reconnect';
  if(humans.some(s=>s.occupant&&!s.occupant.ready&&lobby.seats.indexOf(s)!==lobby.host))return 'Waiting for ready';
  if(new Set(lobby.seats.map(s=>s.team)).size<2)return 'Need at least 2 teams';
  return null;
}
/** Draft shown in the live form: lobby seats, with the host's local type/teams memory applied. */
export function liveDraft(lobby:LobbyStateMsg,map:PvpMapInfo,hint:TypeHint|null|undefined):CreateDraft{
  const d=seatsToDraft(lobby,map);
  return hint?clampDraft({...d,type:hint.type,teams:hint.type==='team'?hint.teams:d.teams},map):d;
}
export function Lobby({code,lobby,seat,host,conn,error,nick,seatColors,draining=false,toast=null,maps=[],thumbs,hint,onHint,links=null,onUpdate,onCopy,onReady,onStart,onLeave,onRetry,onDismissError}:LobbyProps){
  const blocker=host?startBlocker(lobby):null,mine=seat!==null?lobby?.seats[seat]?.occupant?.ready??false:false;
  const lost=conn==='lost';
  const map=lobby&&maps.find(m=>m.id===lobby.levelId),draft=lobby&&map?liveDraft(lobby,map,hint):null;
  const apply=(f:(d:CreateDraft,m:PvpMapInfo)=>CreateDraft)=>{
    if(!lobby||!map||!draft)return;
    const next=f(draft,map),nm=maps.find(m=>m.id===next.mapId)??map;
    onHint?.({type:next.type,teams:next.teams});
    onUpdate?.(next.mapId,draftToSeats(next,nm));
  };
  return <section class="picker panel pvp-panel" aria-label="Lobby">
    <header><h1>Lobby</h1><span class="conn-chip" data-testid="conn-state" data-state={conn??'none'}>{conn??'offline'}</span></header>
    <button class="text-button back-button" data-testid="lobby-leave" onClick={onLeave}>Leave</button>
    {draining&&<DrainBanner deadlineAt={0} mode="lobby"/>}
    {error&&<p class="pvp-error" role="alert" data-testid="pvp-error">{error} <button class="text-button" onClick={onDismissError}>Dismiss</button></p>}
    {lost&&<button class="text-button" data-testid="conn-retry" onClick={onRetry}>Retry connection</button>}
    <p class="lobby-code-line">Room code <strong data-testid="lobby-code">{code??''}</strong></p>
    {links&&<div class="lobby-links">
      <button class="text-button" data-testid="copy-play-link" onClick={()=>onCopy?.(links.play)}>Copy play link</button>
      <button class="text-button" data-testid="copy-watch-link" onClick={()=>onCopy?.(links.watch)}>Copy watch link</button>
    </div>}
    {lobby&&draft&&<RoomForm live={{lobby,seat,editable:host,colors:seatColors}} nick={nick} draft={draft} maps={maps} thumbs={thumbs}
      onType={(t:RoomType)=>apply((d,m)=>setType(d,t,m))} onMap={id=>{const m=maps.find(x=>x.id===id);if(m)apply(d=>setMap(d,m));}}
      onPlayers={n=>apply((d,m)=>setPlayers(d,n,m))} onTeams={n=>apply((d,m)=>setTeams(d,n,m))} onRow={(i:number,p:Partial<DraftRow>)=>apply((d,m)=>setRow(d,i,p,m))}/>}
    {toast&&<Toast message={toast} testId="toast-moved"/>}
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
