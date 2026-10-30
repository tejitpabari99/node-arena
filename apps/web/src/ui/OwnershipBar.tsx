import type { OwnershipSegment } from './ownership';
export interface OwnershipBarProps { segments:readonly OwnershipSegment[]; palettes:Readonly<Record<string,string>>; /** Team per player index; groups same-team segments adjacent with a thin gap between groups. */ teams?:readonly number[]|undefined }
export function OwnershipBar({segments,palettes,teams}:OwnershipBarProps){
  const list=teams?[...segments].sort((a,b)=>(teams[a.player]??0)-(teams[b.player]??0)):segments;
  return <div class="ownership-bar" role="img" aria-label={`Control share: ${list.length?list.map(s=>`${s.colorKey} ${s.permille/10}%`).join(', '):'no controlled buildings'}`}>
    {list.map((s,i)=>{
      const gap=!!teams&&i>0&&teams[list[i-1]!.player]!==teams[s.player];
      return <span key={s.player} class={gap?'team-gap':undefined} data-ownership-player={s.player} data-permille={s.permille} style={{width:`${s.permille/10}%`,backgroundColor:palettes[s.colorKey]}}/>;
    })}
  </div>;
}
