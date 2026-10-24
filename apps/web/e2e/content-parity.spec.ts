import { readFileSync,globSync } from 'node:fs';
import { expect,test } from '@playwright/test';
import { loadContent } from '@node-arena/content';
test('v2 simHash and per-seat botHash agree between a real browser and Node for all content',async({page})=>{
 const files=Object.fromEntries(globSync('packages/content/data/**/*.json',{cwd:'../..'}).filter(p=>!/\/(levels\/na-kane|campaigns\/kane)\.json$/.test(p)/* boot.ts excludes the kane files */).map(p=>[p.slice('packages/content/'.length),readFileSync(`../../${p}`,'utf8')]));
 const loaded=loadContent(files),expected=Object.fromEntries(Object.entries(loaded.compiled).map(([id,l])=>[id,{simHash:l.simHash,botHash:l.botHash}]));
 for(const entry of loaded.catalog.campaigns.common!.entries)expect(loaded.compiled[entry.level]!.players[0]!.kind).toBe('human');
 await page.goto('/e2e/content-parity.html');await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'contentIdentities'))).toBeTruthy();
 expect(await page.evaluate(()=>Reflect.get(window,'contentIdentities'))).toEqual(expected);expect(Object.keys(expected).length).toBeGreaterThanOrEqual(20);
});
