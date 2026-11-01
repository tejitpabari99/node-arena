import type { PvpMapInfo } from '@node-arena/content';
import type { LevelThumbnailService } from '../../render/level-thumbnail';
import { LevelThumb } from '../Picker';
import { DIFFICULTIES } from './SeatRow';
import { NickField, nickValid } from './PvpMenu';
import { botLabels, canCreate, playersMax, teamsMax, MIN_PLAYERS, MIN_TEAMS, type CreateDraft, type DraftRow, type RoomType } from '../../pvp/room-draft';
export interface RoomFormProps {
  nick:string; draft:CreateDraft; maps:readonly PvpMapInfo[]; thumbs?:LevelThumbnailService|undefined; unavailable?:boolean;
  onNick(v:string):void; onType(t:RoomType):void; onMap(id:string):void; onPlayers(n:number):void; onTeams(n:number):void; onRow(i:number,patch:Partial<DraftRow>):void; onCreate():void;
}
function Stepper({id,label,value,min,max,onChange}:{id:string;label:string;value:number;min:number;max:number;onChange(n:number):void}){
  return <div class="pvp-field pvp-stepper" role="group" aria-label={label}><span>{label}</span>
    <button type="button" class="text-button" data-testid={`${id}-minus`} aria-label={`Fewer ${label.toLowerCase()}`} disabled={value<=min} onClick={()=>onChange(value-1)}>−</button>
    <output data-testid={`${id}-value`}>{value}</output>
    <button type="button" class="text-button" data-testid={`${id}-plus`} aria-label={`More ${label.toLowerCase()}`} disabled={value>=max} onClick={()=>onChange(value+1)}>+</button>
  </div>;
}
export function RoomForm({nick,draft,maps,thumbs,unavailable=false,onNick,onType,onMap,onPlayers,onTeams,onRow,onCreate}:RoomFormProps){
  const map=maps.find(m=>m.id===draft.mapId),team=draft.type==='team',bots=botLabels(draft.rows);
  const teamSelect=(i:number,r:DraftRow)=><select data-testid={`seat-team-${i}`} aria-label={`Player ${i+1} team`} value={String(r.team)} onChange={e=>onRow(i,{team:Number((e.currentTarget as HTMLSelectElement).value)})}>
    {Array.from({length:draft.teams},(_,t)=><option key={t} value={String(t)}>{`Team ${t+1}`}</option>)}</select>;
  const ok=!unavailable&&nickValid(nick)&&canCreate(draft);
  return <form class="pvp-form room-form" onSubmit={e=>{e.preventDefault();if(ok)onCreate();}}>
    {NickField({nick,onNick})}
    <div class="pvp-field"><span>Type</span><div class="type-tiles">
      <button type="button" class="level-card menu-button" data-testid="type-pvp" aria-pressed={!team} onClick={()=>onType('pvp')}><span>PvP</span></button>
      <button type="button" class="level-card menu-button" data-testid="type-team" aria-pressed={team} onClick={()=>onType('team')}><span>Team</span></button>
    </div></div>
    <div class="pvp-field"><span>Map</span><div class="level-grid map-grid">{maps.map(m=>
      <div key={m.id} class="level-choice"><button type="button" class="level-card custom-card" data-testid={`map-${m.id}`} aria-label={m.name} title={m.name} aria-pressed={m.id===draft.mapId} onClick={()=>onMap(m.id)}>
        <LevelThumb thumbs={thumbs} id={m.id}/></button></div>)}</div></div>
    {Stepper({id:"players",label:"Players",value:draft.players,min:MIN_PLAYERS,max:map?playersMax(map):MIN_PLAYERS,onChange:onPlayers})}
    {team&&Stepper({id:"teams",label:"Teams",value:draft.teams,min:MIN_TEAMS,max:teamsMax(draft.players),onChange:onTeams})}
    <ul class="seat-list">{draft.rows.map((r,i)=><li key={i} class="seat-row" data-testid={`lobby-seat-${i}`} data-you={i===0?'true':'false'}>
      <span class="seat-name">{i===0?'Player 1 (you)':bots[i]??'Open'}</span>
      {i>0&&<select data-testid={`seat-kind-${i}`} aria-label={`Player ${i+1} type`} value={r.kind} onChange={e=>onRow(i,{kind:(e.currentTarget as HTMLSelectElement).value as DraftRow['kind']})}>
        <option value="human">Human</option><option value="bot">Bot</option></select>}
      {i>0&&r.kind==='bot'&&<select data-testid={`seat-difficulty-${i}`} aria-label={`Player ${i+1} difficulty`} value={r.difficulty} onChange={e=>onRow(i,{difficulty:(e.currentTarget as HTMLSelectElement).value as DraftRow['difficulty']})}>
        {DIFFICULTIES.map(d=><option key={d} value={d}>{d}</option>)}</select>}
      {team&&teamSelect(i,r)}
    </li>)}</ul>
    <button class="level-card menu-button" type="submit" data-testid="pvp-create" disabled={!ok}><span>Create room</span></button>
  </form>;
}
