import { chromium } from '/root/projects/node-arena/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright/index.mjs';
const out='/tmp/claude-0/-root-projects-node-arena/81e69880-d03b-467f-b52a-81a00c29b2a1/scratchpad/shots/';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const mk=async()=>{const c=await b.newContext({viewport:{width:1440,height:810},deviceScaleFactor:1});return c.newPage();};
let p=await mk();
await p.goto('http://127.0.0.1:4300/');await p.waitForTimeout(5000);await p.screenshot({path:out+'menu.png'});
for(const [name,lvl] of [['grass',3],['snow',19]]){
 p=await mk();
 await p.goto(`http://127.0.0.1:4300/?level=${lvl}`);
 await p.waitForSelector('#arena canvas',{timeout:30000});
 await p.waitForTimeout(11000);
 await p.screenshot({path:out+name+'-battle.png'});
 await p.addStyleTag({content:'#game-hud,.mute-button,.battle-back,.battle-zoom,.battle-ownership{visibility:hidden!important}'});
 await p.waitForTimeout(300);
 await p.screenshot({path:out+name+'-clean.png'});
}
await b.close();
