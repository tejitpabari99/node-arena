import { chromium } from '/root/projects/node-arena/.worktrees/feat/menu-online-flow-sp01/apps/web/node_modules/@playwright/test/index.mjs';
const b=await chromium.launch();const p=await b.newPage();
await p.goto('http://127.0.0.1:4181/?view=custom');await p.getByRole('heading',{name:'Choose your battle'}).waitFor();
console.log('buttons',await p.getByRole('button').allTextContents(), 'custom text:', await p.getByText('Custom').count());await b.close();
