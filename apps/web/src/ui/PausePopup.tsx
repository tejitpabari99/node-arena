import type { ComponentChildren } from 'preact';
import { useLayoutEffect,useRef } from 'preact/hooks';
/** Keep keyboard focus inside an open battle dialog and return it to its trigger. */
export function BattlePopup({title,children}:{title:string;children:ComponentChildren}){
  const ref=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    const previous=document.activeElement;
    const panel=ref.current!;
    const buttons=()=>Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    buttons()[0]?.focus();
    const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const controls=buttons(),first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){event.preventDefault();first?.focus();}};
    document.addEventListener('keydown',trap);
    return()=>{document.removeEventListener('keydown',trap);if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
  },[]);
  return <div class="battle-scrim"><section ref={ref} class="battle-popup" role="dialog" aria-modal="true" aria-label={title}>
    <h1>{title}</h1><div class="battle-actions">{children}</div>
  </section></div>;
}
export function PausePopup({onResume,onRestart,onLevels}:{onResume():void;onRestart():void;onLevels():void}){
  return <BattlePopup title="Paused">
    <button class="battle-action primary" onClick={onResume}>Resume</button>
    <button class="battle-action secondary" onClick={onRestart}>Restart</button>
    <button class="battle-action secondary" onClick={onLevels}>Levels</button>
  </BattlePopup>;
}
