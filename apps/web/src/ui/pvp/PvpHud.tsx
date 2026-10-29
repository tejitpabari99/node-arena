import { TICK_RATE } from '@node-arena/sim';
import { BattlePopup } from '../PausePopup';
import { OwnershipBar } from '../OwnershipBar';
import type { OwnershipSegment } from '../ownership';
import { SeatLegend, type SeatLegendProps } from './SeatLegend';
export function formatTimer(ticksLeft:number):string{
  const s=Math.ceil(Math.max(0,ticksLeft)/TICK_RATE);
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}
export interface PvpHudProps { segments:readonly OwnershipSegment[]; palettes:Readonly<Record<string,string>>; ticksLeft:number; seat:number|null; menuOpen:boolean; onLeave():void; legend?:Omit<SeatLegendProps,'palettes'|'seat'>|undefined }
/** No pause control: the match is server-paced. Esc menu (owned by the layer) never pauses. */
export function PvpHud({segments,palettes,ticksLeft,seat,menuOpen,onLeave,legend}:PvpHudProps){
  return <>
    <div id="game-hud" class="pvp-hud" aria-label="Battle controls" aria-hidden={menuOpen}>
      <div class="battle-ownership"><OwnershipBar segments={segments} palettes={palettes} teams={legend?.seats.reduce<number[]>((t,x)=>{t[x.player]=x.team;return t;},[])}/>
        <p class="battle-level"><span data-testid="match-timer">{formatTimer(ticksLeft)}</span>{seat===null&&<span class="pvp-spectating" data-testid="pvp-spectating"> Spectating</span>}</p>
        {legend&&<SeatLegend {...legend} palettes={palettes} seat={seat}/>}
      </div>
    </div>
    {menuOpen&&<BattlePopup title="Menu"><button class="battle-action secondary" data-testid="pvp-leave" onClick={onLeave}>Leave</button></BattlePopup>}
  </>;
}
