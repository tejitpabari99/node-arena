import { expect, type Page } from '@playwright/test';
export async function openLevel(page: Page, level=1, fixture?:'win'|'loss') {
  await page.goto(`/?test=1&level=${level}${fixture?`&fixture=${fixture}`:''}`);
  await expect.poll(()=>page.evaluate(()=>window.__na?.screen),{timeout:20000}).toBe('playing');
  await expect(page.locator('#arena canvas')).toBeVisible();
}
export async function legalPair(page: Page) {
  await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  return page.evaluate(()=>{
    const api=window.__na!,v=api.view!,buildings=api.visualProbe().buildings;
    const human=0; // All authored common campaign seats put the human first.
    for(let from=0;from<buildings.length;from++) for(let to=0;to<buildings.length;to++) {
      if(v.buildings.owner[from]===human&&from!==to&&api.legality(from,to).reason===null)
        return {from,to,player:human,a:api.project(buildings[from]!.id),b:api.project(buildings[to]!.id)};
    }
    throw Error('No legal human draw');
  });
}
export async function draw(page: Page) {
  const pair=await legalPair(page);
  await page.mouse.move(pair.a.x,pair.a.y);await page.mouse.down();
  await page.mouse.move(pair.b.x,pair.b.y,{steps:8});await page.mouse.up();
  await page.evaluate(()=>window.__na!.step());
  const cmd={type:'DrawLine',player:pair.player,from:pair.from,to:pair.to};
  expect(await page.evaluate(()=>window.__na!.commandLog)).toContainEqual({tick:0,cmd});
  return pair;
}
/** Accept every dialog (e.g. the editor's beforeunload guard) so page.goto never blocks on a dirty document. */
export function acceptDialogs(page: Page) { page.on('dialog', dialog => { void dialog.accept(); }); }
