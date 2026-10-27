/** Task 6: run from repository root with the dev server on 4174. No repository content writes. */
import { createRequire } from 'node:module';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire(`${process.cwd()}/apps/web/package.json`);
const { chromium } = require('@playwright/test');
const f = 'docs/agent_files/feat-editor-chrome-polish-20261026-1553';
const dest = `${f}/01-theme-tokens/screens`;
await mkdir(dest, { recursive: true }); await mkdir(`${f}/after`, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const base = process.env.EDITOR_VERIFY_URL || 'http://127.0.0.1:4174';
page.on('dialog', d => d.accept());
await page.route('**/__editor/status', r => r.fulfill({ json: { unfinalized: false, output: '' } }));
await page.route('**/__editor/save', r => r.fulfill({ json: { level: r.request().postDataJSON().level, warnings: [] } }));
const shot = async name => { await page.locator('.ed-library-tile img').evaluateAll(images => Promise.all(images.map(im => im.complete ? Promise.resolve() : new Promise(resolve => { im.onload = resolve; im.onerror = resolve; })))); await page.screenshot({ path: `${dest}/${name}.png`, animations: 'disabled' }); await copyFile(`${dest}/${name}.png`, `${f}/after/${name}.png`); };
await page.goto(`${base}/editor.html`); await page.getByRole('button', { name: 'Create blank', exact: true }).waitFor();
await page.getByLabel('New level id').fill('na-custom-1');
await shot('0-start-modal');
await page.getByRole('button', { name: 'Create blank', exact: true }).click();
await page.getByLabel('Level name', { exact: true }).waitFor(); await page.locator('.ed-library-tile img').first().waitFor(); await shot('1-default');
await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByTestId('save-popover').waitFor(); await shot('2-save-popover');
await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Check details', exact: true }).click(); await page.getByTestId('check-popover').waitFor(); await shot('3-check-popover');
await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Finalize details', exact: true }).click(); await page.getByTestId('lock-status').filter({ hasText: 'Content locks current' }).waitFor(); await shot('4-finalize-popover');
await page.keyboard.press('Escape'); await page.getByTestId('level-name').click(); await page.getByRole('dialog').waitFor(); await page.getByLabel('New level id').fill('na-custom-2'); await shot('5-file-modal');
await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'AI1 card', exact: true }).click(); await shot('6-level-box-player-card');
await page.goto(`${base}/editor.html`); await page.getByLabel('Copy level').selectOption('levelview-1'); await page.getByLabel('New level id').fill('na-custom-1'); await page.getByLabel('Copy level').focus(); await page.keyboard.press('Space'); await shot('7-copied-level'); await page.keyboard.press('Escape');
await page.goto(`${base}/editor.html?level=na-trial`); await page.getByTestId('viewport-status').filter({ hasText: 'Ready' }).waitFor();
await page.getByLabel('Selected item', { exact: true }).selectOption('building:home');
await page.locator('[data-section=selection] summary', { hasText: 'Owner and level' }).click(); await page.locator('[data-section=selection] summary', { hasText: 'Parameters' }).click(); await page.getByLabel('Owner', { exact: true }).scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await shot('8-building-selected-level-box');
// Real tab navigation through native button and field, then disposable future-consumer primitives.
await page.getByRole('button', { name: 'Save', exact: true }).focus(); await page.keyboard.press('Tab');
const focus = async () => page.evaluate(() => { const el = document.activeElement, c = getComputedStyle(el); return { tag: el.tagName, outline: c.outline, offset: c.outlineOffset, visible: el.matches(':focus-visible') }; });
const actualFocus = await focus(); assert.equal(actualFocus.visible, true); assert.match(actualFocus.outline, /2px/);
await page.evaluate(() => { const host = document.createElement('div'); host.id = 'theme-probe'; host.style = 'position:fixed;left:320px;top:100px;z-index:100;background:white;padding:20px'; host.className = 'editor-shell'; host.innerHTML = '<div class="ed-menu"><button class="ed-menu-item">Probe menu item <kbd class="ed-menu-kbd">⌘Z</kbd></button><div class="ed-menu-sep"></div><button class="ed-menu-item" disabled>Disabled</button></div><div class="ed-popover"><h3 class="ed-popover-title">Share</h3><div class="ed-row">Link<button class="ed-btn-ghost">Copy</button></div><div class="ed-row">Code<button class="ed-btn-icon" aria-label="Icon">+</button></div></div><div class="ed-panel"><h3 class="ed-section-title">Panel</h3><label>Probe field<input id="probe-field"></label><p class="ed-field-hint">Helper</p><span class="ed-status" data-state="saved">Saved</span></div><div class="ed-toast ed-toast-success">Toast text<button class="ed-toast-action">Undo</button></div>'; document.body.append(host); });
await page.locator('#probe-field').focus(); await page.keyboard.press('Shift+Tab'); const menuFocus = await focus();
await page.locator('#theme-probe .ed-menu-item').first().focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); const itemFocus = await focus();
await page.locator('#probe-field').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); const fieldFocus = await focus();
for (const item of [itemFocus, fieldFocus]) { assert.equal(item.visible, true); assert.match(item.outline, /2px/); }
await shot('9-primitives-focus');
const rendered = await page.locator('#theme-probe').evaluate(host => {
 const prop = (s, ps) => { const c = getComputedStyle(host.querySelector(s)); return Object.fromEntries(ps.map(p => [p,c[p]])); };
 const c = getComputedStyle(host); return { font: c.fontFamily, text: c.color, muted: prop('.ed-field-hint', ['color']), saved: prop('.ed-status', ['color']), toast: prop('.ed-toast', ['color','backgroundColor']), menu: prop('.ed-menu', ['borderRadius','boxShadow']), item: prop('.ed-menu-item', ['height']), icon: prop('.ed-btn-icon', ['width','height']), row: prop('.ed-row + .ed-row', ['borderTopWidth']), action: prop('.ed-toast-action', ['color']) };
});
assert(!rendered.font.includes('Coiny')); assert.equal(rendered.menu.borderRadius, '8px'); assert.equal(rendered.row.borderTopWidth, '1px');
const colors = await page.locator('.ed-shell').evaluate(el => { const c=getComputedStyle(el); return Object.fromEntries(['--ed-text','--ed-muted','--ed-accent','--ed-success','--ed-g-0','--ed-g-50','--ed-g-100','--ed-g-900','--ed-accent-soft'].map(k=>[k,c.getPropertyValue(k).trim()])); });
function luminance(color) { const v = color.replace('#',''); const full=v.length===3?v.split('').map(x=>x+x).join(''):v; return [0,2,4].map(i=>parseInt(full.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0); }
const pairs = [['body','--ed-text','--ed-g-0'],['body grey50','--ed-text','--ed-g-50'],['muted','--ed-muted','--ed-g-0'],['muted grey100','--ed-muted','--ed-g-100'],['white accent','--ed-g-0','--ed-accent'],['saved green','--ed-success','--ed-g-0'],['toast','--ed-g-0','--ed-g-900'],['toast action','--ed-accent-soft','--ed-g-900']].map(([name,a,b])=>{ const x=luminance(colors[a]),y=luminance(colors[b]); const ratio=(Math.max(x,y)+.05)/(Math.min(x,y)+.05); assert(ratio>=4.5, `${name}: ${ratio}`); return {name,foreground:colors[a],background:colors[b],ratio:Number(ratio.toFixed(3))}; });
await page.locator('#theme-probe').evaluate(el=>el.remove());
const invariants = await page.evaluate(()=>({ top: document.querySelector('.ed-top').getBoundingClientRect().height, left: document.querySelector('.ed-left').getBoundingClientRect().width, touch: getComputedStyle(document.querySelector('.ed-library-tile')).touchAction }));
assert.deepEqual(invariants,{top:56,left:300,touch:'none'});
const oldCss=execFileSync('git',['show','81e6768^:apps/web/src/editor/style.css'],{encoding:'utf8'});
// Pause browser time so CSS-only comparison captures the identical game frame.
await page.getByRole('button', {name:'Play',exact:true}).click(); await page.getByRole('button', {name:'Pause',exact:true}).waitFor(); await page.waitForTimeout(500); await page.getByRole('button', {name:'Pause',exact:true}).click(); await page.getByRole('dialog', {name:'Paused',exact:true}).waitFor(); await page.clock.install(); await page.clock.pauseAt(new Date());
async function protectedShot(name) {
 await shot(name); const styles=page.locator('style[data-vite-dev-id$="/src/editor/style.css"]'); const hasStyle=await styles.count(); const current=hasStyle ? await styles.textContent() : ''; const extra=hasStyle ? null : await page.addStyleTag({content:' '}); const target=hasStyle ? styles : extra;
 await target.evaluate((el,css)=>{el.textContent=css},oldCss); await page.screenshot({path:`${dest}/${name}-baseline.png`,animations:'disabled'}); await target.evaluate((el,css)=>{el.textContent=css},current); if(extra) await extra.evaluate(el=>el.remove());
 const equal=(await readFile(`${dest}/${name}.png`)).equals(await readFile(`${dest}/${name}-baseline.png`)); assert(equal,`${name} differs from pre-SP01 CSS`); return equal;
}
const protectedPlay = await protectedShot('10-play-overlay');
await page.getByRole('button',{name:'Back to editor',exact:true}).click(); assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(248, 249, 250)');
await page.goto(`${base}/`); await page.getByRole('button',{name:'Campaign',exact:true}).waitFor(); await page.clock.runFor(1000);
const protectedGame = await protectedShot('11-game-home');
const results={pairs,invariants,focus:{actualFocus,itemFocus,fieldFocus},rendered,protectedPlay,protectedGame};
await writeFile(`${f}/01-theme-tokens/verification-results.json`,JSON.stringify(results,null,2)+'\n'); console.log(JSON.stringify(results,null,2)); await browser.close();
