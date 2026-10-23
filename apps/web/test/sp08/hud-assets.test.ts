import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { uiSprites } from '../../src/ui/assets';
it('keeps source UI sprite URLs aligned with the locked public manifest',()=>{
  const manifest=JSON.parse(readFileSync('assets/ui/manifest.json','utf8'));
  expect(uiSprites).toEqual(Object.fromEntries(Object.entries(manifest.sprites).map(([key,value])=>[key,'/'+(value as {path:string}).path])));
});
