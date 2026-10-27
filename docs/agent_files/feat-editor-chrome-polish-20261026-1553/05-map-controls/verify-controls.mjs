/** Run from repository root; dev server defaults to http://127.0.0.1:4174. No content writes. */
import { createRequire } from 'node:module';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(`${process.cwd()}/apps/web/package.json`);
const { chromium } = require('@playwright/test');
const f = 'docs/agent_files/feat-editor-chrome-polish-20261026-1553';
const dest = `${f}/05-map-controls/screens`;
await mkdir(dest, { recursive: true });
await mkdir(`${f}/after`, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.EDITOR_VERIFY_URL || 'http://127.0.0.1:4174';
  const controls = page.getByTestId('canvas-controls');
  const button = name => controls.getByRole('button', { name, exact: true });
  const shot = async name => {
    await page.locator('.ed-library-tile img').first().waitFor();
    await page.locator('.ed-library-tile img').evaluateAll(images => Promise.all(images.map(im => im.complete ? Promise.resolve() : new Promise(resolve => { im.onload = resolve; im.onerror = resolve; }))));
    await page.mouse.move(310, 880);
    await page.screenshot({ path: `${dest}/${name}.png`, animations: 'disabled' });
    await copyFile(`${dest}/${name}.png`, `${f}/after/${name}.png`);
  };
  await page.goto(`${base}/editor.html`);
  await page.getByLabel('New level id').fill('na-custom-1');
  await page.getByRole('button', { name: 'Create blank', exact: true }).click();
  await page.getByTestId('viewport-status').filter({ hasText: 'Add a building' }).waitFor();
  await shot('1-default');
  await page.goto(`${base}/editor.html?level=na-trial`);
  await page.getByTestId('viewport-status').filter({ hasText: 'Ready' }).waitFor();
  await page.getByLabel('Selected item', { exact: true }).selectOption('building:home');
  await page.locator('[data-section=selection] summary', { hasText: 'Owner and level' }).click();
  await page.locator('[data-section=selection] summary', { hasText: 'Parameters' }).click();
  await page.getByLabel('Owner', { exact: true }).scrollIntoViewIfNeeded();
  await shot('8-building-selected-level-box');
  const geometry = await controls.evaluate(el => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const css = getComputedStyle(el);
    return { canvas: rect(document.querySelector('.ed-canvas')), controls: rect(el), cards: [...el.children].map(rect), z: css.zIndex, pointerEvents: css.pointerEvents, gutter: css.getPropertyValue('--ed-controls-gutter').trim(), popZ: css.getPropertyValue('--ed-z-pop').trim() };
  });
  assert.equal(geometry.z, '3'); assert.equal(geometry.gutter, '56px'); assert.equal(geometry.popZ, '5');
  assert.equal(geometry.pointerEvents, 'none');
  assert.equal(geometry.controls.y - geometry.canvas.y, 12);
  assert.equal(geometry.canvas.x + geometry.canvas.width - geometry.controls.x - geometry.controls.width, 12);
  await button('Hand').click(); await button('Show grid').click();
  const toggles = await controls.locator('[aria-pressed]').evaluateAll(els => els.map(el => ({ name: el.getAttribute('aria-label'), pressed: el.getAttribute('aria-pressed'), background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })));
  assert(toggles.every(t => t.pressed === 'true'));
  const tokens = await controls.evaluate(el => { const c = getComputedStyle(el); return { pressed: c.getPropertyValue('--ed-accent-soft').trim(), icon: c.getPropertyValue('--ed-accent').trim() }; });
  assert.equal(toggles[0].background, toggles[1].background);
  await shot('sp05-pressed-hand-grid');
  const disabled = [];
  for (const [name, limit] of [['Zoom in', 40], ['Zoom out', 80]]) {
    for (let i = 0; i < limit && await button(name).isEnabled(); i++) await button(name).click();
    assert(await button(name).isDisabled());
    const opacity = await button(name).evaluate(el => getComputedStyle(el).opacity);
    assert.equal(opacity, '0.35'); disabled.push({ name, opacity });
    await shot(name === 'Zoom in' ? 'sp05-zoom-max' : 'sp05-zoom-min');
  }
  await button('Fit area').click();
  if (await button('Zoom out').isDisabled()) await button('Zoom in').click();
  assert(await button('Zoom in').isEnabled()); assert(await button('Zoom out').isEnabled());
  // Enter the column using real Tab navigation; verify all six sequential native stops.
  await button('Zoom out').focus();
  await page.keyboard.press('Shift+Tab');
  const names = ['Zoom in', 'Zoom out', 'Fit area', 'Game camera', 'Hand', 'Show grid'];
  const focus = [];
  for (const [i, name] of names.entries()) {
    if (i > 0) await page.keyboard.press('Tab');
    const state = await page.evaluate(() => { const el = document.activeElement, c = getComputedStyle(el); return { name: el.getAttribute('aria-label'), visible: el.matches(':focus-visible'), outline: c.outline, offset: c.outlineOffset }; });
    assert.equal(state.name, name); assert(state.visible); assert.match(state.outline, /2px/); assert.equal(state.offset, '-2px');
    focus.push(state); await shot(`sp05-focus-${i + 1}`);
  }
  assert.deepEqual(errors, []);
  const results = { viewport: { width: 1440, height: 900 }, geometry, toggles, tokens, disabled, focus, pageErrors: errors, sp03GutterIntegration: 'Pending SP03 Share/Check implementation; no temporary UI created.' };
  await writeFile(`${f}/05-map-controls/verification-results.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
