import type { EndOutcome } from '@node-arena/net';
import { BattlePopup } from '../PausePopup';
export function resultTitle(outcome: EndOutcome, seat: number | null): string {
  if (outcome.winner === null && outcome.winners.length === 0) return 'Draw';
  if (seat === null) return 'Match over';
  return outcome.winners.includes(seat) ? 'Victory!' : 'Defeat';
}
export function PvpResult({outcome,seat,onLeave}:{outcome:EndOutcome;seat:number|null;onLeave():void}){
  return <div data-testid="pvp-result"><BattlePopup title={resultTitle(outcome,seat)}>
    <button class="battle-action primary" data-testid="pvp-result-leave" onClick={onLeave}>Leave</button>
  </BattlePopup></div>;
}
