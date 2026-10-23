import { expect,test } from '@playwright/test';
import { draw,openLevel } from './helpers';
test('campaign vertical slice loads art, accepts a gesture, presents win and opens next',async({page})=>{
 await openLevel(page,1,'win');expect(await page.evaluate(()=>window.__na!.renderInfo()!.triangles)).toBeGreaterThan(0);
 await draw(page);await expect(page.getByRole('dialog',{name:'Victory!'})).toBeVisible();await page.getByRole('button',{name:'Next level',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__na!.state().levelId)).toBe(await page.evaluate(()=>window.__na!.state().levels[1]!.id));
});
