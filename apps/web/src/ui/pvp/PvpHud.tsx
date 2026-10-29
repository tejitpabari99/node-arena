import { TICK_RATE } from '@node-arena/sim';
import type { PauseReason } from '@node-arena/net';
import type { PauseView } from '../../pvp/pause';
import { BattlePopup } from '../PausePopup';
import { OwnershipBar } from '../OwnershipBar';
import type { OwnershipSegment } from '../ownership';
import { SeatLegend, type SeatLegendProps } from './SeatLegend';
export function formatTimer(ticksLeft:number):string{
  const s=Math.ceil(Math.max(0,ticksLeft)/TICK_RATE);
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}
export interface PauseHoldUi { player:number; nick:string; reason:PauseReason; /** null = unlimited / bot: no countdown. */ remainingMs:number|null }
export interface PauseUi { paused:boolean; unlimited:boolean; holds:PauseHoldUi[]; /** Seat owns a hold (may Resume). */ ownHold:boolean; /** Pause button enabled. */ canPause:boolean }
export const formatMs=(ms:number)=>formatTimer(Math.ceil(Math.max(0,ms)/1000)*TICK_RATE);
/** Pure view-model from the controller pause snapshot; `remaining` = ctl.pauseRemaining(). Spectators never get ownHold/canPause. */
export function buildPauseUi(p:PauseView|null,remaining:readonly (number|null)[],seat:number|null,nicks:Readonly<Record<number,string>>,eliminated:boolean):PauseUi{
  const holds=(p?.paused?p.holds:[]).map(h=>({player:h.player,nick:nicks[h.player]??`Player ${h.player+1}`,reason:h.reason,remainingMs:p!.unlimited?null:(remaining[h.player]??null)}));
  const own=seat!==null&&holds.some(h=>h.player===seat),mine=seat===null?null:(remaining[seat]??null);
  return {paused:!!p?.paused,unlimited:!!p?.unlimited,holds,ownHold:own,canPause:seat!==null&&!eliminated&&!own&&(mine===null||mine>0)};
}
export interface PvpHudProps { segments:readonly OwnershipSegment[]; palettes:Readonly<Record<string,string>>; ticksLeft:number; seat:number|null; menuOpen:boolean; onLeave():void; catchup?:number|null; legend?:Omit<SeatLegendProps,'palettes'|'seat'>|undefined; pause?:PauseUi|undefined; onPause?():void; onResume?():void; confirmQuit?:boolean; onQuitYes?():void; onQuitNo?():void }
/** Pause/Resume/Quit are requests to the server (it decides); spectators (seat null) get no controls. */
export function PvpHud({segments,palettes,ticksLeft,seat,menuOpen,onLeave,legend,catchup,pause,onPause,onResume,confirmQuit,onQuitYes,onQuitNo}:PvpHudProps){
  return <>
    <div id="game-hud" class="pvp-hud" aria-label="Battle controls" aria-hidden={menuOpen}>
      <div class="battle-ownership"><OwnershipBar segments={segments} palettes={palettes} teams={legend?.seats.reduce<number[]>((t,x)=>{t[x.player]=x.team;return t;},[])}/>
        <p class="battle-level"><span data-testid="match-timer">{formatTimer(ticksLeft)}</span>{seat===null&&<span class="pvp-spectating" data-testid="pvp-spectating"> Spectating</span>}</p>
        {seat!==null&&onPause&&<button class="battle-action secondary pvp-pause-btn" data-testid="pvp-pause" disabled={!pause?.canPause} onClick={onPause}>Pause</button>}
        {legend&&<SeatLegend {...legend} palettes={palettes} seat={seat}/>}
      </div>
    </div>
    {catchup!=null&&<p class="pvp-catchup" role="status" data-testid="catchup-progress">Catching up {Math.min(100,Math.floor(catchup*100))}%</p>}
    {pause?.paused&&<BattlePopup title="Paused">
      <ul class="pvp-pause-holds" data-testid="pvp-pause-overlay">{pause.holds.map(h=><li key={h.player} data-testid={`pvp-pause-hold-${h.player}`}>
        <span>{h.nick}</span> <span>{h.reason==='manual'?'paused':'disconnected'}</span>{h.remainingMs!==null&&<> <span data-testid={`pvp-pause-remaining-${h.player}`}>{formatMs(h.remainingMs)}</span></>}</li>)}</ul>
      {pause.ownHold&&onResume&&<button class="battle-action primary" data-testid="pvp-resume" onClick={onResume}>Resume</button>}
    </BattlePopup>}
    {confirmQuit&&<BattlePopup title="Quit match?">
      <p data-testid="pvp-quit-text">Leaving forfeits the match.</p>
      <button class="battle-action secondary" data-testid="pvp-quit-yes" onClick={onQuitYes}>Yes, forfeit</button>
      <button class="battle-action primary" data-testid="pvp-quit-no" onClick={onQuitNo}>No</button>
    </BattlePopup>}
    {menuOpen&&<BattlePopup title="Menu"><button class="battle-action secondary" data-testid="pvp-leave" onClick={onLeave}>Leave</button></BattlePopup>}
  </>;
}
