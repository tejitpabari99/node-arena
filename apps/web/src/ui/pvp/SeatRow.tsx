import type { LobbySeat, SeatConfig, SeatKind } from '@node-arena/net';
export const DIFFICULTIES=['easy','normal','hard'] as const;
export interface SeatRowProps { index:number; seat:LobbySeat; color?:string|undefined; you:boolean; host:boolean; teamCount?:number; editable?:boolean; onChange?(index:number,patch:Partial<SeatConfig>):void }
export function SeatRow({index,seat,color,you,host,teamCount=2,editable=false,onChange}:SeatRowProps){
  const occ=seat.occupant;
  const label=occ?occ.nick:seat.kind==='bot'?'Bot':seat.kind==='empty'?'Empty':'Open';
  const away=!!occ&&seat.kind==='human'&&occ.status!=='connected';
  const state=occ?(away?'Not connected':host?'Host':occ.ready?'Ready':'Not ready'):'';
  const ed=editable&&onChange;
  return <li class="seat-row" data-testid={`lobby-seat-${index}`} data-seat-open={occ?'false':'true'} data-you={you?'true':'false'} data-away={away?'true':'false'}>
    <span class="seat-swatch" style={color?{backgroundColor:color}:undefined}/>
    <span class="seat-name">{label}{you?' (you)':''}</span><small class="seat-state">{state}</small>
    {ed?<>
      <select data-testid={`seat-kind-${index}`} aria-label={`Seat ${index+1} type`} value={seat.kind} disabled={host} onChange={e=>onChange(index,{kind:(e.currentTarget as HTMLSelectElement).value as SeatKind})}>
        <option value="human">Human</option><option value="bot">Bot</option><option value="empty">Empty</option>
      </select>
      {seat.kind==='bot'&&<select data-testid={`seat-difficulty-${index}`} aria-label={`Seat ${index+1} difficulty`} value={seat.difficulty??'normal'} onChange={e=>onChange(index,{difficulty:(e.currentTarget as HTMLSelectElement).value})}>
        {DIFFICULTIES.map(d=><option key={d} value={d}>{d}</option>)}
      </select>}
      <select data-testid={`seat-team-${index}`} aria-label={`Seat ${index+1} team`} value={String(seat.team)} onChange={e=>onChange(index,{team:Number((e.currentTarget as HTMLSelectElement).value)})}>
        {Array.from({length:teamCount},(_,t)=><option key={t} value={String(t)}>{`Team ${t+1}`}</option>)}
      </select>
    </>:<small class="seat-team" data-testid={`seat-team-label-${index}`}>{seat.kind==='empty'?'':`Team ${seat.team+1}`}{seat.kind==='bot'?` · ${seat.difficulty??'normal'}`:''}</small>}
  </li>;
}
