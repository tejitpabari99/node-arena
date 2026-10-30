import { NICK_MAX } from '../../net/identity';
export interface PvpMenuProps { nick:string; code:string; error:string|null; unavailable?:boolean; reload?:boolean; onNick(v:string):void; onCode(v:string):void; onCreate():void; onJoin():void; onWatch():void; onBack():void; onDismissError():void }
export function PvpMenu({nick,code,error,unavailable=false,reload=false,onNick,onCode,onCreate,onJoin,onWatch,onBack,onDismissError}:PvpMenuProps){
  const nickOk=nick.trim().length>=1&&nick.trim().length<=NICK_MAX,codeOk=code.trim().length>0;
  return <section class="picker panel pvp-panel" aria-label="Play online">
    <header><h1>Play online</h1></header>
    <button class="text-button back-button" data-testid="pvp-back" onClick={onBack}>Back</button>
    {error&&<p class="pvp-error" role="alert" data-testid="pvp-error">{error} {reload?<button class="text-button" data-testid="pvp-reload" onClick={()=>location.reload()}>Reload</button>:!unavailable&&<button class="text-button" onClick={onDismissError}>Dismiss</button>}</p>}
    <label class="pvp-field">Nickname<input data-testid="pvp-nick" type="text" maxLength={NICK_MAX} value={nick} onInput={e=>onNick((e.currentTarget as HTMLInputElement).value)}/></label>
    <div class="pvp-actions"><button class="level-card menu-button" data-testid="pvp-create" disabled={unavailable||reload||!nickOk} onClick={onCreate}><span>Create room</span></button></div>
    <div class="pvp-join">
      <label class="pvp-field">Room code<input data-testid="pvp-code-input" type="text" autoCapitalize="characters" value={code} onInput={e=>onCode((e.currentTarget as HTMLInputElement).value.toUpperCase())}/></label>
      <button class="level-card menu-button" data-testid="pvp-join" disabled={unavailable||reload||!nickOk||!codeOk} onClick={onJoin}><span>Join</span></button>
      <button class="level-card menu-button" data-testid="pvp-watch" disabled={unavailable||reload||!nickOk||!codeOk} onClick={onWatch}><span>Watch</span></button>
    </div>
  </section>;
}
