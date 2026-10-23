import { BattlePopup } from './RestartPopup';
export interface ResultPopupProps { won:boolean; hasNext:boolean; onNext():void; onReplay():void; onLevels():void }
export function ResultPopup({won,hasNext,onNext,onReplay,onLevels}:ResultPopupProps){
  return <BattlePopup title={won?(hasNext?'Victory!':'All levels complete!'):'Defeat'}>
    {won&&hasNext&&<button class="battle-action primary" onClick={onNext}>Next level</button>}
    <button class={`battle-action ${won&&hasNext?'secondary':'primary'}`} onClick={onReplay}>{won?'Replay':'Retry'}</button>
    <button class="battle-action secondary" onClick={onLevels}>Levels</button>
  </BattlePopup>;
}
