import type { SeatKind } from '@node-arena/net';
export type LegendStatus='eliminated'|'bot'|'disconnected'|'';
export interface LegendSeat { player:number; kind:SeatKind; team:number; nick:string }
export interface LegendEntry { player:number; nick:string; team:number; color:string|undefined; you:boolean; ally:boolean; status:LegendStatus }
export interface SeatLegendProps {
  seats:readonly LegendSeat[]; colorKeys:readonly string[]; palettes:Readonly<Record<string,string>>; seat:number|null;
  /** Per-seat elimination tick; -1 = alive (sim `eliminatedAt`). */
  eliminatedAt?:readonly number[]|undefined;
}
const LABEL:Record<LegendStatus,string>={eliminated:'Eliminated',bot:'Bot',disconnected:'Disconnected',''  :''};
export function legendEntries({seats,colorKeys,palettes,seat,eliminatedAt}:SeatLegendProps):LegendEntry[]{
  const myTeam=seat===null?undefined:seats.find(s=>s.player===seat)?.team;
  return [...seats].sort((a,b)=>a.player-b.player).map(s=>{
    const status:LegendStatus=(eliminatedAt?.[s.player]??-1)>=0?'eliminated':s.kind==='bot'?'bot':'';
    const key=colorKeys[s.player];
    return {player:s.player,nick:s.nick,team:s.team,color:key===undefined?undefined:palettes[key],you:s.player===seat,ally:s.player!==seat&&myTeam!==undefined&&s.team===myTeam,status};
  });
}
export function SeatLegend(p:SeatLegendProps){
  return <ul class="seat-legend" aria-label="Players">
    {legendEntries(p).map(e=><li key={e.player} class="seat-legend-item" data-testid={`seat-legend-${e.player}`} data-you={e.you?'true':'false'} data-ally={e.ally?'true':'false'} data-team={e.team} data-status={e.status||'active'}>
      <span class="seat-dot" style={e.color?{backgroundColor:e.color}:undefined}/>
      <span class="seat-legend-nick">{e.nick}{e.you?' (you)':''}</span>
      <small class="seat-team-badge" data-testid={`seat-legend-team-${e.player}`}>{`T${e.team+1}`}</small>
      {e.status&&<small class="seat-legend-status" data-testid={`seat-legend-status-${e.player}`}>{LABEL[e.status]}</small>}
    </li>)}
  </ul>;
}
