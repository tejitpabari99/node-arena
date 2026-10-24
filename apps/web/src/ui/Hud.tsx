import type { AppController,AppSnapshot } from '../app/state';
import { uiSprites } from './assets';
import { ownership } from './ownership';
import { OwnershipBar } from './OwnershipBar';
import { PausePopup } from './PausePopup';
import { ResultPopup } from './ResultPopup';
/** State publications are tick-throttled by the controller; the canvas never awaits Preact. */
export function Hud({state,app,onMute}:{state:AppSnapshot;app:AppController;onMute():void}){
  const view=app.driver?.sim.view;
  const muted=state.save.settings.musicMute&&state.save.settings.sfxMute;
  const levels=state.customLevels.some(l=>l.id===state.levelId)?state.customLevels:state.levels;
  const levelIndex=levels.findIndex(l=>l.id===state.levelId);
  const level=levels[levelIndex];
  const hasNext=levelIndex>=0&&levelIndex<levels.length-1;
  const human=view?.players.findIndex(p=>p.kind==='human')??-1;
  const won=human>=0&&state.result?.winner===human;
  const modal=state.restartPopup||state.screen==='result';
  return <>
    <div id="game-hud" aria-label="Battle controls" aria-hidden={modal}>
      <button class="battle-back" aria-label="Pause" onClick={()=>app.pause()}><svg viewBox="0 0 58 58" aria-hidden="true" focusable="false"><circle cx="29" cy="29" r="27" class="pause-disc"/><rect x="19" y="16" width="7" height="26" rx="2.5"/><rect x="32" y="16" width="7" height="26" rx="2.5"/></svg></button>
      <button class="battle-zoom" aria-label={state.zoomed?'Zoom out':'Zoom in'} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();app.toggleZoom();}}><svg viewBox="0 0 58 58" aria-hidden="true" focusable="false"><circle cx="29" cy="29" r="27" class="pause-disc"/><rect x="16" y="25.5" width="26" height="7" rx="2.5"/>{!state.zoomed&&<rect x="25.5" y="16" width="7" height="26" rx="2.5"/>}</svg></button>
      <div class="battle-ownership"><OwnershipBar segments={view?ownership(view):[]} palettes={app.manifest?.palettes??{}}/><p class="battle-level">{level?.name}</p></div>
      <button class="mute-button battle-mute" aria-label={muted?'Unmute sound':'Mute sound'} aria-pressed={muted} onClick={onMute}><img src={uiSprites[muted?'soundOff':'soundOn']} alt=""/></button>
    </div>
    {state.restartPopup&&<PausePopup onResume={()=>app.resume()} onRestart={()=>{void app.restart();}} onLevels={()=>app.openPicker()}/>}
    {state.screen==='result'&&<ResultPopup won={won} hasNext={hasNext} onNext={()=>{void app.next();}} onReplay={()=>{void app.restart();}} onLevels={()=>app.openPicker()}/>}
  </>;
}
