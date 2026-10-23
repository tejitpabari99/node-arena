#!/usr/bin/env node
// Actual web entrypoint captures; no production fixture or scene replacements.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const web=createRequire(path.join(root,'apps/web/package.json'));
const pw=await import(pathToFileURL(web.resolve('@playwright/test')).href);
const chromium=pw.chromium??pw.default.chromium;
const {createServer}=await import(pathToFileURL(web.resolve('vite')).href);
const out=path.join(root,'docs/agent_files/feat-sp08-web-client-20261023-0124/ref/out');
const ref=path.join(root,'docs/agent_files/feat-tower-war-port-20261022-0321/ref/tw-yt');
fs.mkdirSync(out,{recursive:true});
const server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),logLevel:'warn',server:{host:'127.0.0.1',port:0}});
await server.listen();
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  const base=server.resolvedUrls.local[0];
  const ready=()=>page.waitForFunction(()=>window.__na?.screen==='playing');
  const shot=async name=>{await page.waitForLoadState('networkidle');await page.evaluate(async()=>{await document.fonts.ready;window.__na?.render();});await page.screenshot({path:path.join(out,`task-10-${name}.png`)});};
  await page.goto(base+'?test=1');await page.getByRole('region',{name:'Campaign levels'}).waitFor();await shot('picker');
  for(const [width,height]of [[1280,720],[1600,900],[1920,1080],[1366,768],[2560,1080]]){
    await page.setViewportSize({width,height});await page.goto(base+'?test=1&level=1');await ready();
    await page.evaluate(()=>window.__na.render());await shot(`l4-hud-${width}x${height}`);
  }
  await page.setViewportSize({width:1600,height:900});await page.goto(base+'?test=1&level=1');await ready();
  await page.getByRole('button',{name:'Back to battle options'}).click();await page.getByRole('dialog').waitFor();await shot('restart');
  for(const [fixture,heading]of [['win','Victory!'],['loss','Defeat']]){
    await page.goto(base+`?test=1&level=1&fixture=${fixture}`);await ready();await page.evaluate(()=>{
      const api=window.__na,v=api.view,player=0;
      for(let from=0;from<v.buildings.owner.length;from++)for(let to=0;to<v.buildings.owner.length;to++)
        if(v.buildings.owner[from]===player&&from!==to&&api.legality(from,to).reason===null){api.submit({type:'DrawLine',player,from,to});api.step();return;}
      throw Error('No valid fixture draw');
    });
    await page.getByRole('heading',{name:heading,exact:true}).waitFor();await shot(fixture);
  }
  const uri=f=>`data:${f.endsWith('.png')?'image/png':'image/jpeg'};base64,${fs.readFileSync(f).toString('base64')}`;
  for(const [name,reference]of [['l4-hud-1600x900','L04.jpg'],['l4-hud-1600x900','d-hud-topbar-18.jpg'],['win','d-victory.jpg']]){
    const compare=await browser.newPage({viewport:{width:2120,height:900}});
    await compare.setContent(`<body style="margin:0;background:#222;display:flex"><img src="${uri(path.join(out,`task-10-${name}.png`))}" style="height:900px"><img src="${uri(path.join(ref,reference))}" style="width:520px;height:900px;object-fit:contain;margin-left:8px"></body>`);
    await compare.waitForFunction(()=>[...document.images].every(i=>i.complete));
    await compare.screenshot({path:path.join(out,`task-10-${name}-vs-${reference}.png`),fullPage:true});await compare.close();
  }
  assert.deepEqual(errors,[]);console.log('SP08 actual entrypoint: picker, five L4/HUD sizes, restart, victory, defeat and three reference comparisons captured; zero page errors.');
}finally{await browser.close();await server.close();}
