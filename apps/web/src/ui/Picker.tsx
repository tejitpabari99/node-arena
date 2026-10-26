import { isLevelUnlocked, type AppSnapshot, type PickerView } from '../app/state';
import { uiSprites } from './assets';
export interface PickerProps { state: AppSnapshot; onStart(id:string):void; onMute():void; onCredits():void; onView?(view:PickerView):void }
const TITLES:Record<PickerView,string>={main:'Choose your battle',campaign:'Campaign',custom:'Custom levels'};
export function Picker({state,onStart,onMute,onCredits,onView=()=>undefined}:PickerProps) {
  const muted=state.save.settings.musicMute&&state.save.settings.sfxMute;
  const view=state.pickerView;
  const focus=[...state.levels,...state.customLevels].find(l=>l.id===state.save.lastLevel&&isLevelUnlocked(state,l.id))?.id??state.levels[0]?.id;
  const edit=(id:string)=>import.meta.env.DEV&&<a class="level-edit" aria-label={`Edit ${id}`} href={`/editor.html?level=${encodeURIComponent(id)}`}>Edit</a>;
  return <section class="picker panel" aria-label={view==='main'?'Main menu':TITLES[view]}>
    <header><h1>{TITLES[view]}</h1><button class="mute-button" aria-label={muted?'Unmute sound':'Mute sound'} aria-pressed={muted} onClick={onMute}><img src={uiSprites[muted?'soundOff':'soundOn']} alt=""/></button></header>
    {view!=='main'&&<button class="text-button back-button" onClick={()=>onView('main')}>Back</button>}
    {view==='main'&&<div class="level-grid menu"><button class="level-card menu-button" onClick={()=>onView('campaign')}><span>Campaign</span></button><button class="level-card menu-button" onClick={()=>onView('custom')}><span>Custom</span></button></div>}
    {view==='campaign'&&<div class="level-grid campaign">{state.levels.map(level=>{
      const completed=Object.hasOwn(state.save.completed,level.id),unlocked=isLevelUnlocked(state,level.id);
      return <div key={level.id} class="level-choice"><button class="level-card" data-level-id={level.id} data-state={completed?'completed':unlocked?'unlocked':'locked'} disabled={!unlocked}
        aria-label={`${level.name}${completed?', completed':unlocked?'':', locked'}`}
        ref={level.id===focus?(node:HTMLButtonElement|null)=>node?.focus():null} onClick={()=>onStart(level.id)}>
        <span>{level.number}</span><small>{completed?'✓':unlocked?'Play':'Locked'}</small>
      </button></div>;
    })}</div>}
    {view==='custom'&&<div class="level-grid custom">{state.customLevels.map(level=>{
      const completed=Object.hasOwn(state.save.completed,level.id);
      return <div key={level.id} class="level-choice"><button class="level-card" data-level-id={level.id} data-state={completed?'completed':'unlocked'}
        aria-label={`${level.name}${completed?', completed':''}`} disabled={false}
        ref={level.id===focus?(node:HTMLButtonElement|null)=>node?.focus():null} onClick={()=>onStart(level.id)}>
        <span>{level.name}</span><small>{completed?'✓':'Play'}</small>
      </button>{edit(level.id)}</div>;
    })}{import.meta.env.DEV&&<div class="level-choice"><a class="level-card create-card" href="/editor.html?create=1"><span>Create custom level</span></a></div>}</div>}
    <footer><button class="text-button" onClick={onCredits}>Credits</button></footer>
  </section>;
}
