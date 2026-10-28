import type { LobbySeat } from '@node-arena/net';
export interface SeatRowProps { index:number; seat:LobbySeat; color?:string|undefined; you:boolean; host:boolean }
export function SeatRow({index,seat,color,you,host}:SeatRowProps){
  const occ=seat.occupant;
  const label=occ?occ.nick:seat.kind==='bot'?'Bot':'Open';
  const state=occ?(host?'Host':occ.ready?'Ready':'Not ready'):'';
  return <li class="seat-row" data-testid={`lobby-seat-${index}`} data-seat-open={occ?'false':'true'} data-you={you?'true':'false'}>
    <span class="seat-swatch" style={color?{backgroundColor:color}:undefined}/>
    <span class="seat-name">{label}{you?' (you)':''}</span><small class="seat-state">{state}</small>
  </li>;
}
