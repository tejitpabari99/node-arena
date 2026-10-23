import { it,expect,vi } from 'vitest';
import { createBrowserRuntime } from '../../src/app/runtime';
import type { RuntimeContext } from '../../src/app/state';
const made=vi.hoisted(()=>({ready:Promise.resolve(),update:vi.fn(),render:vi.fn(),dispose:vi.fn()}));
vi.mock('../../src/render/scene',()=>({createLevelScene:()=>({...made})}));
const context=()=>({level:{rules:{aliveCap:720},buildings:[{kind:'house'},{kind:'house'},{kind:'tower'}]},driver:{sim:{view:{},readTroops:vi.fn(()=>3),towerRadiusMilli:vi.fn()}},enabled:()=>true}) as unknown as RuntimeContext;
it('waits for assets and reuses public troop frame while forwarding every event once',async()=>{const c=context(),r=await createBrowserRuntime(c,{} as HTMLElement);const events:[]=[];r.tick({sim:c.driver.sim,tick:1,events,submissions:[]});r.frame({sim:c.driver.sim,alpha:.5,steps:1,paused:false});const first=made.update.mock.calls.at(-1)!;expect(first[0].n).toBe(3);expect(first[0].troops.channel.length).toBe(1440);expect(first[0].alpha).toBe(.5);r.frame({sim:c.driver.sim,alpha:.75,steps:0,paused:false});expect(made.update.mock.calls.at(-1)![0]).toBe(first[0]);expect(c.driver.sim.readTroops).toHaveBeenCalledTimes(2);r.dispose();r.dispose();expect(made.dispose).toHaveBeenCalledOnce();});
it('disposes partially loaded renderer when ready rejects',async()=>{made.dispose.mockClear();made.ready=Promise.reject(Error('loading'));await expect(createBrowserRuntime(context(),{} as HTMLElement)).rejects.toThrow('loading');expect(made.dispose).toHaveBeenCalledOnce();made.ready=Promise.resolve();});
