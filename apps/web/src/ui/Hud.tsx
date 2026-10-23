import type { AppController,AppSnapshot } from '../app/state';
import { uiSprites } from './assets';
import { ownership } from './ownership';
import { OwnershipBar } from './OwnershipBar';
import { RestartPopup } from './RestartPopup';
import { ResultPopup } from './ResultPopup';
/** State publications are tick-throttled by the controller; the canvas never awaits Preact. */
export function Hud({state,app,onMute}:{state:AppSnapshot;app:AppController;onMute():void}){
  const view=app.driver?.sim.view;
  const muted=state.save.settings.musicMute&&state.save.settings.sfxMute;
  const levelIndex=state.levels.findIndex(l=>l.id===state.levelId);
  const level=state.levels[levelIndex];
  const hasNext=levelIndex>=0&&levelIndex<state.levels.length-1;
  const human=view?.players.findIndex(p=>p.kind==='human')??-1;
  const won=human>=0&&state.result?.winner===human;
  const modal=state.restartPopup||state.screen==='result';
  return <>
    <div id="game-hud" aria-label="Battle controls" aria-hidden={modal}>
      <button class="battle-back" aria-label="Back to battle options" onClick={()=>app.pause()}><img src={uiSprites.back} alt=""/></button>
      <div class="battle-ownership"><OwnershipBar segments={view?ownership(view):[]} palettes={app.manifest?.palettes??{}}/><p class="battle-level">{level?.name}</p></div>
      <button class="mute-button battle-mute" aria-label={muted?'Unmute sound':'Mute sound'} aria-pressed={muted} onClick={onMute}><img src={uiSprites[muted?'soundOff':'soundOn']} alt=""/></button>
    </div>
    {state.restartPopup&&<RestartPopup onRestart={()=>{void app.restart();}} onContinue={()=>app.resume()} onLevels={()=>app.openPicker()}/>}
    {state.screen==='result'&&<ResultPopup won={won} hasNext={hasNext} onNext={()=>{void app.next();}} onReplay={()=>{void app.restart();}} onLevels={()=>app.openPicker()}/>}
  </>;
}
