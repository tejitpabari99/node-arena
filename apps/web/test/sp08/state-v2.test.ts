import { it,expect,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { create, TICK_RATE } from '@node-arena/sim';
import { createAppController, isLevelUnlocked } from '../../src/app/state';
import { createSaveStore } from '../../src/save';
import { withCustomLevels, withoutCustomLevels } from './custom-content';
import type { LevelRuntime } from '../../src/app/state';
const files=Object.fromEntries(globSync('packages/content/data/**/*.json',{cwd:'../..'}).map(p=>[p.slice('packages/content/'.length),readFileSync('../../'+p,'utf8')]));
const manifest=JSON.parse(readFileSync('assets/manifest.json','utf8'));
const runtime=():LevelRuntime=>({frame:vi.fn(),tick:vi.fn(),refresh:vi.fn(),cancel:()=>false,dispose:vi.fn()});
const setup=(extra:Partial<Parameters<typeof createAppController>[0]>={})=>createAppController({files,loadManifest:async()=>manifest,save:createSaveStore({storage:null}),autoStart:false,resultDelayMs:0,createBotDriver:()=>({commands:()=>[]}),createRuntime:async()=>runtime(),...extra});
it('boots to ordered 20-card picker, only first open, ignores other content levels',async()=>{const app=setup({files:withoutCustomLevels(files)});expect(app.snapshot().customLevels).toEqual([]);await app.boot();const s=app.snapshot();expect(s.customLevels).toEqual([]);expect(s.error).toBeNull();expect(s.screen).toBe('picker');expect(s.levels.map(l=>l.number)).toEqual(Array.from({length:20},(_,i)=>i+1));expect(s.levels.map(l=>isLevelUnlocked(s,l.id))).toEqual([true,...Array(19).fill(false)]);await app.startLevel(s.levels[1]!.id);expect(app.driver).toBeNull();app.dispose();});
it('AI winner never completes; human win unlocks next; overlay pauses without screen change',async()=>{let winner=1;const app=setup({createSim:(level,seed)=>{const sim=create(level,seed);return {...sim,step:()=>{sim.view.over={outcome:'won',winner};return [];}};}});await app.boot();const id=app.snapshot().levels[0]!.id;await app.startLevel(id);app.pause();expect(app.snapshot().restartPopup).toBe(true);expect(app.snapshot().screen).toBe('playing');expect(app.step()).toBe(0);app.resume();app.step();expect(app.snapshot().screen).toBe('result');expect(app.snapshot().save.completed[id]).toBeUndefined();winner=0;await app.restart();app.step();expect(app.snapshot().save.completed[id]).toBeDefined();expect(isLevelUnlocked(app.snapshot(),app.snapshot().levels[1]!.id)).toBe(true);app.dispose();});
it('superseded async runtime is disposed and cannot resurrect a cancelled level',async()=>{let resolve!:(r:LevelRuntime)=>void;const app=setup({createRuntime:()=>new Promise(r=>{resolve=r;})});await app.boot();const loading=app.startLevel(app.snapshot().levels[0]!.id);app.openPicker();const stale=runtime();resolve(stale);await loading;expect(stale.dispose).toHaveBeenCalledOnce();expect(app.snapshot().screen).toBe('picker');expect(app.driver).toBeNull();app.dispose();});
it('runtime failure is recoverable, and disposing while loading cleans late resources',async()=>{const app=setup({createRuntime:async()=>{throw Error('assets failed');}});await app.boot();await app.startLevel(app.snapshot().levels[0]!.id);expect(app.snapshot().screen).toBe('error');expect(app.driver).toBeNull();app.openPicker();expect(app.snapshot().screen).toBe('picker');app.dispose();let resolve!:(r:LevelRuntime)=>void;const second=setup({createRuntime:()=>new Promise(r=>{resolve=r;})});await second.boot();const loading=second.startLevel(second.snapshot().levels[0]!.id);second.dispose();const late=runtime();resolve(late);await loading;expect(late.dispose).toHaveBeenCalledOnce();});
it('driver publishes public view tick and opted-in sim events',async()=>{const step=vi.fn();const app=setup({createSim:(level,seed)=>{const sim=create(level,seed);return {...sim,step:(commands,options)=>{step(commands,options);return sim.step(commands,options);}};}});await app.boot();await app.startLevel(app.snapshot().levels[0]!.id);const updates:number[]=[];app.subscribeEvents(u=>updates.push(u.tick));app.step(3);expect(updates).toEqual([1,2,3]);expect(step.mock.calls[0]![1]).toEqual({events:true});app.dispose();});
it('restart replaces a pending generation without disposing its successor',async()=>{const pending:((r:LevelRuntime)=>void)[]=[];const app=setup({createRuntime:()=>new Promise(r=>pending.push(r))});await app.boot();const first=app.startLevel(app.snapshot().levels[0]!.id);const second=app.restart();const fresh=runtime(),stale=runtime();pending[1]!(fresh);await second;pending[0]!(stale);await first;expect(app.runtime).toBe(fresh);expect(stale.dispose).toHaveBeenCalledOnce();expect(fresh.dispose).not.toHaveBeenCalled();expect(app.snapshot().screen).toBe('playing');app.dispose();expect(fresh.dispose).toHaveBeenCalledOnce();});
it('publishes ordinary HUD ticks at no more than 10 Hz',async()=>{const app=setup();await app.boot();await app.startLevel(app.snapshot().levels[0]!.id);const ticks:number[]=[];app.subscribe(()=>ticks.push(app.driver!.sim.view.tick));app.step(20);expect(ticks.length).toBeGreaterThan(0);for(let i=1;i<ticks.length;i++)expect(ticks[i]!-ticks[i-1]!).toBeGreaterThanOrEqual(TICK_RATE/10);app.dispose();});
it('zoom toggle defaults off, forwards to runtime, and survives restart',async()=>{
  const setZoom=vi.fn();const ctxs:boolean[]=[];
  const app=setup({createRuntime:async(c)=>{ctxs.push(c.zoomed);return {...runtime(),setZoom};}});
  await app.boot();expect(app.snapshot().zoomed).toBe(false);
  await app.startLevel(app.snapshot().levels[0]!.id);
  app.toggleZoom();expect(app.snapshot().zoomed).toBe(true);expect(setZoom).toHaveBeenLastCalledWith(true);
  await app.restart();expect(ctxs).toEqual([false,true]);
  app.toggleZoom();expect(app.snapshot().zoomed).toBe(false);expect(setZoom).toHaveBeenLastCalledWith(false);
});

it('loads custom names in position order without changing Common numbering or unlocks',async()=>{
  const app=setup({files:withCustomLevels(files)});await app.boot();const state=app.snapshot();
  expect(state.error).toBeNull();expect(state.levels).toHaveLength(20);
  expect(state.levels.map(l=>l.number)).toEqual(Array.from({length:20},(_,i)=>i+1));
  expect(state.customLevels).toEqual([{id:'na-first',position:2,number:2,name:'First custom battle'},{id:'na-last',position:8,number:8,name:'Last custom battle'}]);
  expect(isLevelUnlocked(state,'na-first')).toBe(true);expect(isLevelUnlocked(state,'na-last')).toBe(true);
  expect(isLevelUnlocked(state,state.levels[1]!.id)).toBe(false);expect(isLevelUnlocked(state,'unknown')).toBe(false);
  await app.startLevel('na-last');expect(app.snapshot().screen).toBe('playing');app.dispose();
});
it('custom wins save normally and Next follows custom order, stopping at the last entry',async()=>{
  const app=setup({files:withCustomLevels(files),createSim:(level,seed)=>{const sim=create(level,seed);return {...sim,step:()=>{sim.view.over={outcome:'won',winner:0};return [];}};}});
  await app.boot();await app.startLevel('na-first');app.step();expect(app.snapshot().save.completed['na-first']).toBeDefined();
  await app.next();expect(app.snapshot().levelId).toBe('na-last');const driver=app.driver;
  await app.next();expect(app.driver).toBe(driver);expect(app.snapshot().levelId).toBe('na-last');
  expect(isLevelUnlocked(app.snapshot(),app.snapshot().levels[1]!.id)).toBe(false);app.dispose();
});
it('Common Next stays in Common when custom entries exist',async()=>{
  const save=createSaveStore({storage:null});save.recordResult('levelview-1',{winner:0,human:0});
  const app=setup({files:withCustomLevels(files),save});await app.boot();await app.startLevel('levelview-1');await app.next();
  expect(app.snapshot().levelId).toBe('levelview-2-ab');app.dispose();
});
it('editor Play can select a synthetic custom campaign and start its overlaid level',async()=>{
  const app=setup({files:withCustomLevels(files),campaignId:'custom'});await app.boot();
  expect(app.snapshot().error).toBeNull();expect(app.snapshot().levels).toHaveLength(20);
  await app.startLevel('na-first',42);expect(app.snapshot().screen).toBe('playing');expect(app.snapshot().levelId).toBe('na-first');expect(app.driver).not.toBeNull();app.dispose();
});

it('last Common entry never advances into custom entries',async()=>{
  const save=createSaveStore({storage:null}),common=JSON.parse(files['data/campaigns/common.json']!);
  for(const entry of common.entries)save.recordResult(entry.level,{winner:0,human:0});
  const app=setup({files:withCustomLevels(files),save});await app.boot();await app.startLevel('levelview-100-es');const driver=app.driver;
  await app.next();expect(app.snapshot().levelId).toBe('levelview-100-es');expect(app.driver).toBe(driver);app.dispose();
});

it('Kane campaign excludes custom levels and refuses direct custom loads',async()=>{
  const app=setup({campaignId:'kane'});
  try {
    await app.boot();expect(app.snapshot().error).toBeNull();
    expect(app.snapshot().levels.map(l=>l.id)).toEqual(['na-kane']);
    for(const id of ['na-trial','na-showcase-green','na-showcase-snow']) {
      await app.startLevel(id);expect(app.snapshot().screen).toBe('picker');expect(app.driver).toBeNull();
      expect(isLevelUnlocked(app.snapshot(),id)).toBe(false);
    }
    expect(app.snapshot().customLevels).toEqual([]);
    await app.startLevel('na-kane');expect(app.snapshot().screen).toBe('playing');
    const driver=app.driver;
    await app.startLevel('na-trial');expect(app.snapshot().levelId).toBe('na-kane');expect(app.driver).toBe(driver);
  } finally {app.dispose();}
});
