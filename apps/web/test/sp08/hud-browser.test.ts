import { expect,it } from 'vitest';
import { chromium,expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync,readFileSync } from 'node:fs';
const output='../../docs/agent_files/feat-tower-war-port-20261022-0321/08-web-client/ref/out';
it('runs HUD pause, restart, mute, victory/next/replay and defeat/retry flows in Chromium',async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0},plugins:[{name:'hud-fixture',configureServer(s){s.middlewares.use('/__hud',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__hud','<!doctype html><html><body><main id="app"></main><script type="module" src="/test/sp08/hud-fixture.tsx"></script></body></html>'));});}}]});
  await server.listen();const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1600,height:900}}),errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.setDefaultTimeout(5000);
    const url=server.resolvedUrls!.local[0]+'__hud';
    const start=async(outcome='')=>{await page.goto(url+(outcome?'?outcome='+outcome:''));await page.getByRole('button',{name:/^Level 1(?:, completed)?$/}).click();await browserExpect(page.getByRole('button',{name:'Pause'})).toBeVisible();};
    const step=async(count=1)=>page.evaluate(n=>Reflect.get(window,'hudTest').step(n),count);
    await start();
    const segments=page.locator('[data-ownership-player]');expect(await segments.count()).toBe(2);
    expect(await segments.evaluateAll(nodes=>nodes.reduce((s,n)=>s+Number(n.getAttribute('data-permille')),0))).toBe(1000);
    expect(await segments.first().evaluate(n=>getComputedStyle(n).transitionDuration)).toBe('0.2s');
    await browserExpect(page.getByText('Level 1',{exact:true})).toBeVisible();
    mkdirSync(output,{recursive:true});await page.screenshot({path:output+'/task-5-hud.png'});
    await step(4);await page.getByRole('button',{name:'Pause'}).click();
    const dialog=page.getByRole('dialog');await browserExpect(dialog).toBeVisible();
    expect(await page.evaluate(()=>Reflect.get(window,'hudTest').paused())).toBe(true);
    const tick=await page.evaluate(()=>Reflect.get(window,'hudTest').tick());await step(10);expect(await page.evaluate(()=>Reflect.get(window,'hudTest').tick())).toBe(tick);
    await page.screenshot({path:output+'/task-5-restart.png'});
    await browserExpect(page.getByRole('button',{name:'Resume',exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');await browserExpect(dialog.getByRole('button',{name:'Levels'})).toBeFocused();
    await page.keyboard.press('Tab');await browserExpect(dialog.getByRole('button',{name:'Resume',exact:true})).toBeFocused();
    await page.getByRole('button',{name:'Resume'}).click();await browserExpect(dialog).toHaveCount(0);await step();expect(await page.evaluate(()=>Reflect.get(window,'hudTest').tick())).toBe(Number(tick)+1);
    await browserExpect(page.getByRole('button',{name:'Pause'})).not.toBeFocused();
    await page.getByRole('button',{name:'Mute sound'}).click();expect(await page.evaluate(()=>Reflect.get(window,'hudTest').snapshot().save.settings)).toMatchObject({musicMute:true,sfxMute:true});
    await page.getByRole('button',{name:'Pause'}).click();await page.getByRole('button',{name:'Restart',exact:true}).click();await browserExpect(dialog).toHaveCount(0);expect(await page.evaluate(()=>Reflect.get(window,'hudTest').tick())).toBe(0);
    await page.getByRole('button',{name:'Pause'}).click();await page.getByRole('button',{name:'Levels',exact:true}).click();await browserExpect(page.getByRole('region',{name:'Campaign levels'})).toBeVisible();
    await start('win');await step();await browserExpect(page.getByRole('heading',{name:'Victory!'})).toBeVisible();await page.screenshot({path:output+'/task-5-victory.png'});
    expect(await page.evaluate(()=>Object.keys(Reflect.get(window,'hudTest').snapshot().save.completed))).toHaveLength(1);
    await page.getByRole('button',{name:'Replay',exact:true}).click();await browserExpect(dialog).toHaveCount(0);await step();await page.getByRole('button',{name:'Next level',exact:true}).click();await browserExpect(page.getByText('Level 2',{exact:true})).toBeVisible();
    await step();await page.getByRole('button',{name:'Levels',exact:true}).click();await browserExpect(page.getByRole('button',{name:'Level 2, completed'})).toBeEnabled();
    for(const outcome of ['loss','timeout','draw']){await start(outcome);await step();await browserExpect(page.getByRole('heading',{name:'Defeat'})).toBeVisible();await browserExpect(page.getByRole('button',{name:'Next level'})).toHaveCount(0);await browserExpect(page.getByRole('button',{name:'Replay',exact:true})).toHaveCount(0);if(outcome==='loss')await page.screenshot({path:output+'/task-5-defeat.png'});await page.getByRole('button',{name:'Retry',exact:true}).click();await browserExpect(dialog).toHaveCount(0);expect(await page.evaluate(()=>Reflect.get(window,'hudTest').tick())).toBe(0);}
    await page.evaluate(()=>{const save=JSON.parse(localStorage.getItem('nodearena:save')!);const levels=Reflect.get(window,'hudTest').snapshot().levels;for(const l of levels)save.completed[l.id]={firstAt:'2026-10-23'};localStorage.setItem('nodearena:save',JSON.stringify(save));});
    await page.goto(url+'?outcome=win');await page.getByRole('button',{name:'Level 20, completed',exact:true}).click();await step();await browserExpect(page.getByRole('heading',{name:'All levels complete!'})).toBeVisible();await browserExpect(page.getByRole('button',{name:'Next level'})).toHaveCount(0);await browserExpect(page.getByRole('button',{name:'Replay',exact:true})).toBeVisible();await page.screenshot({path:output+'/task-5-complete.png'});
    for(const viewport of [{width:1280,height:720},{width:2560,height:1080}]){
      await page.setViewportSize(viewport);const box=await dialog.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);
    }
    await browserExpect(page.getByRole('button',{name:/speed|booster/i})).toHaveCount(0);
    const reference='../../docs/agent_files/feat-tower-war-port-20261022-0321/ref/tw-yt/';
    for(const [name,ref] of [['hud','d-hud-topbar-18.jpg'],['victory','d-victory.jpg']]){
      const compare=await browser.newPage({viewport:{width:2120,height:900}});
      const ours=readFileSync(output+'/task-5-'+name+'.png').toString('base64'),original=readFileSync(reference+ref).toString('base64');
      await compare.setContent(`<body style="margin:0;background:#222;display:flex"><img src="data:image/png;base64,${ours}" style="height:900px"><img src="data:image/jpeg;base64,${original}" style="width:520px;height:900px;object-fit:contain;margin-left:8px"></body>`);
      await compare.waitForFunction(()=>Array.from(document.images).every(i=>i.complete));await compare.screenshot({path:output+'/task-5-'+name+'.compare.png',fullPage:true});await compare.close();
    }
    expect(errors).toEqual([]);
  }finally{await browser.close();await server.close();}
},60000);
