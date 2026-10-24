import { it,expect,vi } from 'vitest';
import { readFileSync,globSync } from 'node:fs';
import { create } from '@node-arena/sim';
import { createBotDriver,createSeatBot,guardBotContext,HUMAN_PROXY } from '@node-arena/bots';
import { createAppController,RESULT_DELAY_MS } from '../src/app/state';
import { createSaveStore } from '../src/save';
import type { LevelRuntime } from '../src/app/state';
const files=Object.fromEntries(globSync('packages/content/data/**/*.json',{cwd:'../..'}).map(p=>[p.slice('packages/content/'.length),readFileSync('../../'+p,'utf8')]));
const manifest=JSON.parse(readFileSync('assets/manifest.json','utf8'));
const runtime=():LevelRuntime=>({frame:vi.fn(),tick:vi.fn(),refresh:vi.fn(),cancel:()=>false,dispose:vi.fn()});
/** Real sim + real AI opponents; the human seat is played by the default-AI human proxy. */
it('levelview-4 (UI Level 4): human win reaches result screen and is recorded completed',async()=>{
  const save=createSaveStore({storage:null});
  const app=createAppController({files,loadManifest:async()=>manifest,save,autoStart:false,resultDelayMs:0,createRuntime:async()=>runtime(),
    createBotDriver:(level,seed)=>{const base=createBotDriver(level,seed),me=createSeatBot(level,seed,0,HUMAN_PROXY);
      return {commands(sim){const c=[...base.commands(sim)];if(!sim.view.over)c.push(...me.decide(guardBotContext(sim),sim.view.tick));return c;}};}});
  await app.boot();
  const levels=app.snapshot().levels;expect(levels[3]).toMatchObject({id:'levelview-4',number:4});
  for(const l of levels.slice(0,3))save.recordResult(l.id,{winner:0,human:0});
  app.dismissNotices();
  await app.startLevel('levelview-4');
  expect(app.snapshot().screen).toBe('playing');
  for(let i=0;i<100&&app.snapshot().screen==='playing';i++)app.step(100);
  const s=app.snapshot();
  expect(s.screen).toBe('result');expect(s.result).toEqual({outcome:'won',winner:0});expect(s.levelId).toBe('levelview-4');
  expect(s.save.completed['levelview-4']).toBeDefined();
  app.dispose();
});

it('result popup is delayed by RESULT_DELAY_MS after game over; input disabled; progress saved immediately',async()=>{
  vi.useFakeTimers();
  try{
    const save=createSaveStore({storage:null});let enabled:(()=>boolean)|undefined;
    const app=createAppController({files,loadManifest:async()=>manifest,save,autoStart:false,createBotDriver:()=>({commands:()=>[]}),
      createSim:(level,seed)=>{const sim=create(level,seed);return {...sim,step:()=>{sim.view.over={outcome:'won',winner:0};return [];}};},
      createRuntime:async(ctx)=>{enabled=ctx.enabled;return runtime();}});
    await app.boot();const id=app.snapshot().levels[0]!.id;await app.startLevel(id);
    expect(enabled!()).toBe(true);
    app.step();
    expect(app.snapshot().screen).toBe('playing');expect(app.snapshot().result).toBeNull();
    expect(enabled!()).toBe(false);
    expect(app.snapshot().save.completed[id]).toBeDefined();
    app.pause();expect(app.snapshot().restartPopup).toBe(false);
    vi.advanceTimersByTime(RESULT_DELAY_MS-1);expect(app.snapshot().screen).toBe('playing');
    vi.advanceTimersByTime(1);expect(app.snapshot().screen).toBe('result');expect(app.snapshot().result).toEqual({outcome:'won',winner:0});
    app.dispose();
  }finally{vi.useRealTimers();}
});
