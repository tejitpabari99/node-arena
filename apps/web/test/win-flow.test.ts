import { it,expect,vi } from 'vitest';
import { readFileSync,globSync } from 'node:fs';
import { createBotDriver,createSeatBot,guardBotContext,HUMAN_PROXY } from '@node-arena/bots';
import { createAppController } from '../src/app/state';
import { createSaveStore } from '../src/save';
import type { LevelRuntime } from '../src/app/state';
const files=Object.fromEntries(globSync('packages/content/data/**/*.json',{cwd:'../..'}).map(p=>[p.slice('packages/content/'.length),readFileSync('../../'+p,'utf8')]));
const manifest=JSON.parse(readFileSync('assets/manifest.json','utf8'));
const runtime=():LevelRuntime=>({frame:vi.fn(),tick:vi.fn(),refresh:vi.fn(),cancel:()=>false,dispose:vi.fn()});
/** Real sim + real AI opponents; the human seat is played by the default-AI human proxy. */
it('levelview-4 (UI Level 4): human win reaches result screen and is recorded completed',async()=>{
  const save=createSaveStore({storage:null});
  const app=createAppController({files,loadManifest:async()=>manifest,save,autoStart:false,createRuntime:async()=>runtime(),
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
