import type { PvpMapInfo } from '@node-arena/content';
import type { LobbyStateMsg } from '@node-arena/net';
import type { LevelThumbnailService } from '../../render/level-thumbnail';
import { LevelThumb } from '../Picker';
import { NickField, nickValid } from './PvpMenu';
import { botLabels, canCreate, lastRowHeld, playersMax, teamsMax, MIN_PLAYERS, MIN_TEAMS, type CreateDraft, type DraftRow, type RoomType } from '../../pvp/room-draft';
export const DIFFICULTIES=['easy','normal','hard'] as const;
/** Live-room view of the form: seats carry occupants; non-host viewers are read-only. */
export interface LiveRoom { lobby:LobbyStateMsg; seat:number|null; editable:boolean; colors?:ReadonlyArray<string|undefined> }
export interface RoomFormProps {
  live?:LiveRoom;
  nick:string; draft:CreateDraft; maps:readonly PvpMapInfo[]; thumbs?:LevelThumbnailService|undefined; unavailable?:boolean;
  /** Pre-room only (live rooms show a read-only nickname). */
  onNick?(v:string):void; onType(t:RoomType):void; onMap(id:string):void; onPlayers(n:number):void; onTeams(n:number):void; onRow(i:number,patch:Partial<DraftRow>):void; onCreate?():void;
}
function Stepper({id,label,value,min,max,onChange,readOnly=false,minusLocked=false}:{id:string;label:string;value:number;min:number;max:number;onChange(n:number):void;readOnly?:boolean;minusLocked?:boolean}){
  return <div class="pvp-field pvp-stepper" role="group" aria-label={label}><span>{label}</span>
    <button type="button" class="text-button" data-testid={`${id}-minus`} aria-label={`Fewer ${label.toLowerCase()}`} disabled={readOnly||minusLocked||value<=min} onClick={()=>onChange(value-1)}>−</button>
    <output data-testid={`${id}-value`}>{value}</output>
    <button type="button" class="text-button" data-testid={`${id}-plus`} aria-label={`More ${label.toLowerCase()}`} disabled={readOnly||value>=max} onClick={()=>onChange(value+1)}>+</button>
  </div>;
}
export function RoomForm({live,nick,draft,maps,thumbs,unavailable=false,onNick,onType,onMap,onPlayers,onTeams,onRow,onCreate}:RoomFormProps){
  const map=maps.find(m=>m.id===draft.mapId),team=draft.type==='team',bots=botLabels(draft.rows);
  const teamSelect=(i:number,r:DraftRow)=><select data-testid={`seat-team-${i}`} aria-label={`Player ${i+1} team`} value={String(r.team)} onChange={e=>onRow(i,{team:Number((e.currentTarget as HTMLSelectElement).value)})}>
    {Array.from({length:draft.teams},(_,t)=><option key={t} value={String(t)}>{`Team ${t+1}`}</option>)}</select>;
  const ro=!!live&&!live.editable,lseats=live?.lobby.seats??[],locked=!!live&&lastRowHeld(lseats);
  const ok=!unavailable&&nickValid(nick)&&canCreate(draft);
  return <form class="pvp-form room-form" onSubmit={e=>{e.preventDefault();if(ok)onCreate?.();}}>
    {live?<p class="pvp-field" data-testid="pvp-nick-label"><span>Nickname</span><strong>{nick}</strong></p>:NickField({nick,onNick:onNick??(()=>{})})}
    <div class="pvp-field"><span>Type</span><div class="type-tiles">
      <button type="button" class="level-card menu-button" data-testid="type-pvp" disabled={ro} aria-pressed={!team} onClick={()=>onType('pvp')}><span>PvP</span></button>
      <button type="button" class="level-card menu-button" data-testid="type-team" disabled={ro} aria-pressed={team} onClick={()=>onType('team')}><span>Team</span></button>
    </div></div>
    <div class="pvp-field"><span>Map</span><div class="level-grid map-grid">{maps.map(m=>
      <div key={m.id} class="level-choice"><button type="button" class="level-card custom-card" data-testid={`map-${m.id}`} aria-label={m.name} title={m.name} aria-pressed={m.id===draft.mapId} disabled={ro} onClick={()=>onMap(m.id)}>
        <LevelThumb thumbs={thumbs} id={m.id}/></button></div>)}</div></div>
    {Stepper({id:"players",label:"Players",value:draft.players,min:MIN_PLAYERS,max:map?playersMax(map):MIN_PLAYERS,onChange:onPlayers,readOnly:ro,minusLocked:locked})}
    {locked&&!ro&&<p class="lobby-reason" data-testid="players-hint">A player holds the last row</p>}
    {team&&Stepper({id:"teams",label:"Teams",value:draft.teams,min:MIN_TEAMS,max:teamsMax(draft.players),onChange:onTeams,readOnly:ro})}
    <ul class="seat-list">{draft.rows.map((r,i)=>{
      const ls=lseats[i],occ=ls?.occupant,you=live?i===live.seat:i===0,away=!!occ&&r.kind==='human'&&occ.status!=='connected';
      const label=i===0?(live&&occ?`Player 1 · ${occ.nick}`:'Player 1'):live&&occ?occ.nick:bots[i]??'Open';
      const state=!live||!occ?'':away?'Not connected':i===live.lobby.host?'Host':occ.ready?'Ready':'Not ready';
      const editRow=!ro&&i>0;
      return <li key={i} class="seat-row" data-testid={`lobby-seat-${i}`} data-you={you?'true':'false'} data-seat-open={live?(occ?'false':'true'):undefined} data-away={away?'true':'false'}>
        {live&&<span class="seat-swatch" style={live.colors?.[i]?{backgroundColor:live.colors[i]}:undefined}/>}
        <span class="seat-name">{label}{you?' (you)':''}</span>{state&&<small class="seat-state">{state}</small>}
        {editRow&&<select data-testid={`seat-kind-${i}`} aria-label={`Player ${i+1} type`} value={r.kind} onChange={e=>onRow(i,{kind:(e.currentTarget as HTMLSelectElement).value as DraftRow['kind']})}>
          <option value="human">Human</option><option value="bot">Bot</option></select>}
        {editRow&&r.kind==='bot'&&<select data-testid={`seat-difficulty-${i}`} aria-label={`Player ${i+1} difficulty`} value={r.difficulty} onChange={e=>onRow(i,{difficulty:(e.currentTarget as HTMLSelectElement).value as DraftRow['difficulty']})}>
          {DIFFICULTIES.map(d=><option key={d} value={d}>{d}</option>)}</select>}
        {!ro&&team&&teamSelect(i,r)}
        {ro&&<small class="seat-team" data-testid={`seat-team-label-${i}`}>{`Team ${r.team+1}`}{r.kind==='bot'?` · ${r.difficulty}`:''}</small>}
      </li>;})}</ul>
    {!live&&<button class="level-card menu-button" type="submit" data-testid="pvp-create" disabled={!ok}><span>Create room</span></button>}
  </form>;
}
