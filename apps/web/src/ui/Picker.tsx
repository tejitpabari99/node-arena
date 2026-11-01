import { useEffect, useState } from 'preact/hooks';
import { isLevelUnlocked, type AppSnapshot, type PickerView } from '../app/state';
import { uiSprites } from './assets';
import type { LevelThumbnailService } from '../render/level-thumbnail';
export interface PickerProps { state: AppSnapshot; onStart(id:string):void; onMute():void; onCredits():void; onPlayOnline?():void; thumbs?:LevelThumbnailService; onView?(view:PickerView):void }
// Literal import.meta.env.DEV lets production builds drop Custom (and the string) entirely.
const TITLES:Record<PickerView,string>={main:'Choose your battle',campaign:'Campaign',custom:import.meta.env.DEV?'Custom levels':'Choose your battle'};
/** Map thumbnail for a custom level; neutral placeholder until the service has (or if it failed to make) one. Name stays in the card's aria-label. */
export function LevelThumb({thumbs,id}:{thumbs?:LevelThumbnailService|undefined;id:string}){
  const [,bump]=useState(0);
  useEffect(()=>{if(!thumbs)return;const off=thumbs.subscribe(()=>bump(n=>n+1));thumbs.request(id);return off;},[thumbs,id]);
  const url=thumbs?.get(id);
  return url?<img class="level-thumb" src={url} alt="" draggable={false}/>:<i class="level-thumb placeholder" aria-hidden="true"/>;
}
export function Picker({state,onStart,onMute,onCredits,onPlayOnline,thumbs,onView=()=>undefined}:PickerProps) {
  const muted=state.save.settings.musicMute&&state.save.settings.sfxMute;
  const view=!import.meta.env.DEV&&state.pickerView==='custom'?'main':state.pickerView;
  const focus=[...state.levels,...state.customLevels].find(l=>l.id===state.save.lastLevel&&isLevelUnlocked(state,l.id))?.id??state.levels[0]?.id;
  const edit=(id:string)=>import.meta.env.DEV&&<a class="level-edit" aria-label={`Edit ${id}`} href={`/editor.html?level=${encodeURIComponent(id)}`}>Edit</a>;
  return <section class="picker panel" aria-label={view==='main'?'Main menu':TITLES[view]}>
    <header><h1>{TITLES[view]}</h1><button class="mute-button" aria-label={muted?'Unmute sound':'Mute sound'} aria-pressed={muted} onClick={onMute}><img src={uiSprites[muted?'soundOff':'soundOn']} alt=""/></button></header>
    {view!=='main'&&<button class="text-button back-button" onClick={()=>onView('main')}>Back</button>}
    {view==='main'&&<div class="menu-stack"><button class="level-card menu-tile" onClick={()=>onView('campaign')}><span>Campaign</span></button>{import.meta.env.DEV&&<button class="level-card menu-tile" onClick={()=>onView('custom')}><span>Custom</span></button>}{onPlayOnline&&<button class="level-card menu-tile" data-testid="pvp-play" onClick={onPlayOnline}><span>Play online</span></button>}</div>}
    {view==='campaign'&&<div class="level-grid campaign">{state.levels.map(level=>{
      const completed=Object.hasOwn(state.save.completed,level.id),unlocked=isLevelUnlocked(state,level.id);
      return <div key={level.id} class="level-choice"><button class="level-card" data-level-id={level.id} data-state={completed?'completed':unlocked?'unlocked':'locked'} disabled={!unlocked}
        aria-label={`${level.name}${completed?', completed':unlocked?'':', locked'}`}
        ref={level.id===focus?(node:HTMLButtonElement|null)=>node?.focus():null} onClick={()=>onStart(level.id)}>
        <span>{level.number}</span><small>{completed?'✓':unlocked?'Play':'Locked'}</small>
      </button></div>;
    })}</div>}
    {view==='custom'&&import.meta.env.DEV&&<div class="level-grid custom">{state.customLevels.map(level=>{
      const completed=Object.hasOwn(state.save.completed,level.id);
      return <div key={level.id} class="level-choice"><button class="level-card custom-card" data-level-id={level.id} data-state={completed?'completed':'unlocked'}
        aria-label={`${level.name}${completed?', completed':''}`} title={level.name} disabled={false}
        ref={level.id===focus?(node:HTMLButtonElement|null)=>node?.focus():null} onClick={()=>onStart(level.id)}>
        <LevelThumb thumbs={thumbs} id={level.id}/><small>{completed?'✓':'Play'}</small>
      </button>{edit(level.id)}</div>;
    })}{import.meta.env.DEV&&<div class="level-choice"><a class="level-card create-card" href="/editor.html?create=1"><span>Create custom level</span></a></div>}</div>}
    <footer><button class="text-button" onClick={onCredits}>Credits</button></footer>
  </section>;
}
