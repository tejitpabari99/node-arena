import { isLevelUnlocked, type AppSnapshot } from '../app/state';
import { uiSprites } from './assets';
export interface PickerProps { state: AppSnapshot; onStart(id:string):void; onMute():void; onCredits():void }
export function Picker({state,onStart,onMute,onCredits}:PickerProps) {
  const muted=state.save.settings.musicMute&&state.save.settings.sfxMute;
  const focus=[...state.levels,...state.customLevels].find(l=>l.id===state.save.lastLevel&&isLevelUnlocked(state,l.id))?.id??state.levels[0]?.id;
  return <section class="picker panel" aria-label="Campaign levels">
    <header><h1>Choose your battle</h1><button class="mute-button" aria-label={muted?'Unmute sound':'Mute sound'} aria-pressed={muted} onClick={onMute}><img src={uiSprites[muted?'soundOff':'soundOn']} alt=""/></button></header>
    <div class="level-grid campaign">{state.levels.map(level=>{
      const completed=Object.hasOwn(state.save.completed,level.id),unlocked=isLevelUnlocked(state,level.id);
      return <button key={level.id} class="level-card" data-level-id={level.id} data-state={completed?'completed':unlocked?'unlocked':'locked'} disabled={!unlocked}
        aria-label={`${level.name}${completed?', completed':unlocked?'':', locked'}`}
        ref={level.id===focus?(node:HTMLButtonElement|null)=>node?.focus():null} onClick={()=>onStart(level.id)}>
        <span>{level.number}</span><small>{completed?'✓':unlocked?'Play':'Locked'}</small>
      </button>;
    })}</div>
    {!!state.customLevels.length&&<section aria-label="Custom levels"><h2>Custom levels</h2>
      <div class="level-grid custom">{state.customLevels.map(level=>{
        const completed=Object.hasOwn(state.save.completed,level.id);
        return <button key={level.id} class="level-card" data-level-id={level.id} data-state={completed?'completed':'unlocked'}
          aria-label={`${level.name}${completed?', completed':''}`} disabled={false}
          ref={level.id===focus?(node:HTMLButtonElement|null)=>node?.focus():null} onClick={()=>onStart(level.id)}>
          <span>{level.name}</span><small>{completed?'✓':'Play'}</small>
        </button>;
      })}</div>
    </section>}
    <footer><button class="text-button" onClick={onCredits}>Credits</button></footer>
  </section>;
}
