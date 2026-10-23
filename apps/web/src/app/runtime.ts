import { createTroopBuffer, type SimEvent } from '@node-arena/sim';
import type { LevelRuntime, RuntimeContext } from './state';
import { createLevelScene } from '../render/scene';
import type { WorldFrame } from '../render/world';
export interface RuntimeInput { refresh(): void; cancel(): boolean; dispose(): void }
export type AttachInput = (context: RuntimeContext, scene: ReturnType<typeof createLevelScene>) => RuntimeInput;
/** Async asset readiness belongs to the level generation; callers dispose a superseded result. */
export async function createBrowserRuntime(context: RuntimeContext,parent: HTMLElement,attachInput?: AttachInput): Promise<LevelRuntime> {
  const {level,manifest,driver}=context;
  const scene=createLevelScene({level,manifest,view:driver.sim.view,parent,zoomed:context.zoomed});
  let input:RuntimeInput|undefined,disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;input?.dispose();scene.dispose();};
  try {
    await scene.ready;
    input=attachInput?.(context,scene);
    const frame:WorldFrame={view:driver.sim.view,troops:createTroopBuffer(level.buildings.filter(b=>b.kind==='house').length*level.rules.aliveCap),n:0,alpha:0,towerRadiusMilli:driver.sim.towerRadiusMilli.bind(driver.sim)};
    const pending:SimEvent[]=[];
    let previous=performance.now();
    return {
      get inspection(){return scene;},
      frame(update){if(disposed)return;const now=performance.now(),dt=Math.max(0,now-previous);previous=now;
        frame.view=update.sim.view;frame.alpha=update.alpha;frame.n=update.sim.readTroops(frame.troops);
        scene.update(frame,pending,dt);pending.length=0;input?.refresh();scene.render();},
      tick(update){if(!disposed)pending.push(...update.events);},
      refresh(){if(!disposed)input?.refresh();},setZoom(zoomed){if(!disposed){scene.setZoom(zoomed);input?.refresh();}},cancel(){return input?.cancel()??false;},dispose,
    };
  }catch(error){dispose();throw error;}
}
