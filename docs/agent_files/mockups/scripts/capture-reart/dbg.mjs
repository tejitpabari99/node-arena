import { chromium } from '/root/projects/node-arena/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await (await b.newContext({viewport:{width:1440,height:810}})).newPage();
p.on('console',m=>console.log(m.type(),m.text().slice(0,400)));p.on('pageerror',e=>console.log('ERR',String(e.stack).slice(0,600)));
await p.goto('http://127.0.0.1:4310/?level=3&art='+process.argv[2]);await p.waitForTimeout(6000);
console.log(await p.evaluate(()=>document.body.innerText.slice(0,300)));
await b.close();
