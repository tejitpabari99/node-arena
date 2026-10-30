import type { SeatKind } from '@node-arena/net';
import type { PauseView } from '../../pvp/pause';
export type LegendStatus='eliminated'|'bot'|'away'|'paused'|'';
export interface LegendSeat { player:number; kind:SeatKind; team:number; nick:string }
export interface LegendEntry { player:number; nick:string; team:number; color:string|undefined; you:boolean; ally:boolean; status:LegendStatus; label:string }
export interface SeatLegendProps {
  seats:readonly LegendSeat[]; colorKeys:readonly string[]; palettes:Readonly<Record<string,string>>; seat:number|null;
  /** Per-seat elimination tick; -1 = alive (sim `eliminatedAt`). */
  eliminatedAt?:readonly number[]|undefined;
  /** Latest `pause.state` view: a disconnect hold with `connected:false` = Away, a manual hold = Paused. */
  pause?:PauseView|null|undefined;
  /** Remaining ms per seat (`pauseRemaining`, local display countdown); null = unlimited / bot. */
  remaining?:readonly (number|null)[]|undefined;
}
const LABEL:Record<LegendStatus,string>={eliminated:'Eliminated',bot:'Bot',away:'Away',paused:'Paused',''  :''};
const clock=(ms:number):string=>{const s=Math.ceil(Math.max(0,ms)/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
export function legendEntries({seats,colorKeys,palettes,seat,eliminatedAt,pause,remaining}:SeatLegendProps):LegendEntry[]{
  const myTeam=seat===null?undefined:seats.find(s=>s.player===seat)?.team;
  return [...seats].sort((a,b)=>a.player-b.player).map(s=>{
    const hold=pause?.holds.find(h=>h.player===s.player);
    const status:LegendStatus=(eliminatedAt?.[s.player]??-1)>=0?'eliminated':s.kind==='bot'?'bot':hold===undefined?'':hold.reason==='disconnect'&&!hold.connected?'away':hold.reason==='manual'?'paused':'';
    const left=remaining?.[s.player]??null;
    const label=status==='away'&&left!==null?`${LABEL.away} ${clock(left)}`:LABEL[status];
    const key=colorKeys[s.player];
    return {player:s.player,nick:s.nick,team:s.team,color:key===undefined?undefined:palettes[key],you:s.player===seat,ally:s.player!==seat&&myTeam!==undefined&&s.team===myTeam,status,label};
  });
}
export function SeatLegend(p:SeatLegendProps){
  return <ul class="seat-legend" aria-label="Players">
    {legendEntries(p).map(e=><li key={e.player} class="seat-legend-item" data-testid={`seat-legend-${e.player}`} data-you={e.you?'true':'false'} data-ally={e.ally?'true':'false'} data-team={e.team} data-status={e.status||'active'}>
      <span class="seat-dot" style={e.color?{backgroundColor:e.color}:undefined}/>
      <span class="seat-legend-nick">{e.nick}{e.you?' (you)':''}</span>
      <small class="seat-team-badge" data-testid={`seat-legend-team-${e.player}`}>{`T${e.team+1}`}</small>
      {e.status&&<small class="seat-legend-status" data-testid={`seat-legend-status-${e.player}`}>{e.label}</small>}
    </li>)}
  </ul>;
}
