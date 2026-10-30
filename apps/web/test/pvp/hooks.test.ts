import { expect, it, vi } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { createTestHarness } from '../../src/test-harness';
import { testHookRequest } from '../../src/test-harness/gate';
import { createAppController } from '../../src/app/state';
import type { PvpController } from '../../src/pvp/controller';

const files=Object.fromEntries(globSync('packages/content/data/**/*.json',{cwd:'../..'}).map(p=>[p.slice('packages/content/'.length),readFileSync('../../'+p,'utf8')]));
const manifest=JSON.parse(readFileSync('assets/manifest.json','utf8'));

it('covers R12: ?nick= honored only when hooks are enabled; hooks are build-gated in main.tsx',()=>{
  expect(testHookRequest('?nick=Ann',true).nick).toBe('Ann');
  expect(testHookRequest('?nick=%20%20',true).nick).toBeNull();
  expect(testHookRequest('?nick=Ann',false).nick).toBeNull();
  const main=readFileSync('src/main.tsx','utf8');
  expect(main).toContain("import.meta.env.DEV||import.meta.env.VITE_TEST_HOOKS==='1'");
  expect(main.match(/window\.__na=/g)).toHaveLength(1);
  expect(main.indexOf('window.__na=')).toBeGreaterThan(main.indexOf('if(harness)'));
});

it('covers R12: netplay re-points view/submit/hash/screen at the NetDriver and exposes __na.pvp',async()=>{
  const sim={hash:()=>'h200',snapshot:()=>({tick:200}),view:{tick:200}};
  const driver={sim,tick:200,queued:3,submit:vi.fn(()=>'wire')};
  let screen='idle';const options={serverUrl:'ws://a'};
  const subs=new Set<(u:{tick:number;sim:typeof sim})=>void>();
  const pvp={snapshot:()=>({screen,conn:'connected'}),driver,options,setNick:vi.fn(),open:vi.fn(),create:vi.fn(),join:vi.fn(),watch:vi.fn(),start:vi.fn(),ready:vi.fn(),leave:vi.fn(),close:vi.fn(),subscribePvpEvents:()=>()=>{},subscribeEvents:(f:(u:{tick:number;sim:typeof sim})=>void)=>{subs.add(f);return()=>subs.delete(f);}} as unknown as PvpController;
  const harness=createTestHarness(files,testHookRequest('?test=1&nick=Zed',true));
  const app=createAppController({files,...harness.options,loadManifest:async()=>manifest});
  harness.applyPvp(pvp);expect(pvp.setNick).toHaveBeenCalledWith('Zed');
  const api=harness.connect(app,pvp);await app.boot();
  expect(api.screen).toBe('picker');expect(api.hash()).toBeUndefined();expect(api.view).toBeUndefined();
  screen='lobby';expect(api.screen).toBe('lobby');
  screen='playing';expect(api.screen).toBe('playing');expect(api.hash()).toBe('h200');expect(api.view).toEqual({tick:200});
  const cmd={type:'DrawLine',player:0,from:1,to:2} as const;
  expect(api.submit(cmd)).toBe('wire');expect(driver.submit).toHaveBeenCalledWith(cmd);
  const p=api.pvp!;expect(p.tick()).toBe(200);expect(p.hash()).toBe('h200');expect(p.queued()).toBe(3);expect(p.connection()).toBe('connected');
  expect(p.submit(cmd)).toBe('wire');p.actions.create();expect(pvp.create).toHaveBeenCalled();
  p.setServer('ws://b');expect(options.serverUrl).toBe('ws://b');
  for(const f of subs)f({tick:200,sim});expect(p.hashAt(200)).toBe('h200');expect(p.hashAt(150)).toBeNull();
  api.dispose();app.dispose();
});

it('solo harness without pvp has no __na.pvp',async()=>{
  const harness=createTestHarness(files,testHookRequest('?test=1',true));
  const app=createAppController({files,...harness.options,loadManifest:async()=>manifest});
  const api=harness.connect(app);expect(api.pvp).toBeUndefined();api.dispose();app.dispose();
});
