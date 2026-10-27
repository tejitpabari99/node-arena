import { BattlePopup } from './PausePopup';
export interface ResultPopupProps { won:boolean; hasNext:boolean; custom?:boolean; onNext():void; onReplay():void; onLevels():void; onEditLevel?:(()=>void)|undefined }
export function ResultPopup({won,hasNext,custom=false,onNext,onReplay,onLevels,onEditLevel}:ResultPopupProps){
  return <BattlePopup title={won?(hasNext||custom?'Victory!':'All levels complete!'):'Defeat'}>
    {won&&hasNext&&<button class="battle-action primary" onClick={onNext}>Next level</button>}
    <button class={`battle-action ${won&&hasNext?'secondary':'primary'}`} onClick={onReplay}>{won?'Replay':'Retry'}</button>
    {onEditLevel?<button class="battle-action secondary" onClick={onEditLevel}>Edit level</button>:<button class="battle-action secondary" onClick={onLevels}>Levels</button>}
  </BattlePopup>;
}
