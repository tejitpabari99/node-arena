import type { ComponentChildren } from 'preact';
import { NICK_MAX } from '../../net/identity';
import type { MenuView, PvpRole } from '../../pvp/controller';
export interface PvpMenuProps { view:MenuView; joinRole:PvpRole; nick:string; code:string; error:string|null; unavailable?:boolean; reload?:boolean; children?:ComponentChildren; onNick(v:string):void; onCode(v:string):void; onGoCreate():void; onGoJoin():void; onRole(r:PvpRole):void; onJoin(code:string,role:PvpRole):void; onBack():void; onDismissError():void }
const TITLES:Record<MenuView,string>={home:'Play online','join-role':'Join a match','join-form':'Join a match',create:'Create a room'};
export const nickValid=(nick:string)=>nick.trim().length>=1&&nick.trim().length<=NICK_MAX;
export function NickField({nick,onNick}:{nick:string;onNick(v:string):void}){
  return <label class="pvp-field">Nickname<input data-testid="pvp-nick" type="text" maxLength={NICK_MAX} value={nick} onInput={e=>onNick((e.currentTarget as HTMLInputElement).value)}/></label>;
}
export function PvpMenu({view,joinRole,nick,code,error,unavailable=false,reload=false,children,onNick,onCode,onGoCreate,onGoJoin,onRole,onJoin,onBack,onDismissError}:PvpMenuProps){
  const blocked=unavailable||reload,canJoin=!blocked&&nickValid(nick)&&code.trim().length>0;
  return <section class="picker panel pvp-panel" aria-label="Play online">
    <header><h1>{TITLES[view]}</h1></header>
    <button class="text-button back-button" data-testid="pvp-back" onClick={onBack}>Back</button>
    {error&&<p class="pvp-error" role="alert" data-testid="pvp-error">{error} {reload?<button class="text-button" data-testid="pvp-reload" onClick={()=>location.reload()}>Reload</button>:!unavailable&&<button class="text-button" onClick={onDismissError}>Dismiss</button>}</p>}
    {view==='home'&&<div class="menu-stack">
      <button class="level-card menu-tile" data-testid="pvp-create-tile" disabled={blocked} onClick={onGoCreate}><span>Create a room</span></button>
      <button class="level-card menu-tile" data-testid="pvp-join-tile" disabled={blocked} onClick={onGoJoin}><span>Join a match</span></button>
    </div>}
    {view==='join-role'&&<div class="menu-stack">
      <button class="level-card menu-tile" data-testid="pvp-role-play" onClick={()=>onRole('play')}><span>Participant</span></button>
      <button class="level-card menu-tile" data-testid="pvp-role-watch" onClick={()=>onRole('watch')}><span>Spectate</span></button>
    </div>}
    {view==='join-form'&&<form class="pvp-form" onSubmit={e=>{e.preventDefault();if(canJoin)onJoin(code,joinRole);}}>
      {NickField({nick,onNick})}
      <label class="pvp-field">Room code<input data-testid="pvp-code-input" type="text" autoCapitalize="characters" value={code} onInput={e=>onCode((e.currentTarget as HTMLInputElement).value.toUpperCase())}/></label>
      <button class="level-card menu-button" type="submit" data-testid="pvp-join" disabled={!canJoin}><span>Join</span></button>
    </form>}
    {view==='create'&&children}
  </section>;
}
