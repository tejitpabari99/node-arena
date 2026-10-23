import type { CompiledLevel } from '@node-arena/content';
import { create, type Sim, type SimView } from '@node-arena/sim';
/** A test double at the public Sim seam. The underlying engine is stepped normally and never mutated.
 * A valid human DrawLine triggers the requested result, making popup flows deterministic. */
export function createFixtureSim(mode: 'win'|'loss'): (level:CompiledLevel,seed:number)=>Sim {
  return (level,seed)=>{
    const real=create(level,seed),view:SimView={...real.view};
    let result:SimView['over']=null;
    const human=view.players.findIndex(p=>p.kind==='human');
    return {...real,view,
      step(commands,options){
        if(result)return [];
        const trigger=commands.some(c=>c.type==='DrawLine'&&c.player===human&&real.canDraw(c.player,c.from,c.to)===null);
        const events=real.step(commands,options);Object.assign(view,real.view);
        if(trigger){result={outcome:mode==='win'?'won':'lost',winner:mode==='win'?human:view.players.findIndex((_,i)=>i!==human)};view.over=result;
          if(options?.events)events.push({type:'MatchOver',...result});}
        return events;
      },
      snapshot:()=>({...real.snapshot(),over:result??real.view.over}),
    };
  };
}
