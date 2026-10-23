import type { OwnershipSegment } from './ownership';
export interface OwnershipBarProps { segments:readonly OwnershipSegment[]; palettes:Readonly<Record<string,string>> }
export function OwnershipBar({segments,palettes}:OwnershipBarProps){
  return <div class="ownership-bar" role="img" aria-label={`Control share: ${segments.length?segments.map(s=>`${s.colorKey} ${s.permille/10}%`).join(', '):'no controlled buildings'}`}>
    {segments.map(s=><span key={s.player} data-ownership-player={s.player} data-permille={s.permille} style={{width:`${s.permille/10}%`,backgroundColor:palettes[s.colorKey]}}/>)}
  </div>;
}
