/** From repo root; read-only intercepted fixtures. Start pnpm dev --port 4174 first. */
import { createRequire } from 'node:module';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(`${process.cwd()}/apps/web/package.json`);
const { chromium } = require('@playwright/test');
const folder = 'docs/agent_files/feat-editor-chrome-polish-20261026-1553';
const dest = `${folder}/04-left-panel/screens`;
await mkdir(dest, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], states = [];
  page.on('pageerror', error => errors.push(error.message));
  let override = false;
  await page.route('**/__editor/level/levelview-1', async route => {
    const doc = await (await route.fetch()).json();
    if (override) doc.buildings[0].params = { ...doc.buildings[0].params, spawns: { troop: 'tank' } };
    await route.fulfill({ json: doc });
  });
  const open = async () => {
    await page.goto(`${process.env.EDITOR_VERIFY_URL || 'http://127.0.0.1:4174'}/editor.html?template=levelview-1`);
    await page.getByTestId('viewport-status').filter({ hasText: 'Ready' }).waitFor();
    await page.locator('.ed-library-tile img').first().waitFor();
  };
  const shot = async name => {
    await page.mouse.move(320, 880);
    await page.screenshot({ path: `${dest}/${name}.png`, animations: 'disabled' });
    await copyFile(`${dest}/${name}.png`, `${folder}/after/${name}.png`);
  };
  await open();
  await page.getByRole('button', { name: 'AI1 card', exact: true }).click();
  await page.locator('.ed-left').evaluate(el => el.scrollTop = 0);
  const level = await page.getByLabel('Level id', { exact: true }).evaluate(el => ({ value: el.textContent, tag: el.tagName, color: getComputedStyle(el).color, userSelect: getComputedStyle(el).userSelect }));
  assert.equal(level.tag, 'OUTPUT'); assert.equal(level.userSelect, 'text');
  await shot('sp04-level-expanded');
  states.push({ name: 'level', level });
  const selectFirst = async () => {
    await page.locator('[data-section=level] > summary').click();
    await page.locator('[data-section=library] > summary').click();
    const selected = page.getByLabel('Selected item', { exact: true });
    await selected.selectOption(await selected.locator('option').nth(1).getAttribute('value'));
    await page.locator('[data-section=selection] summary', { hasText: 'Owner and level' }).click();
    await page.locator('[data-section=selection] summary', { hasText: 'Parameters' }).click();
    await page.locator('.ed-left').evaluate(el => el.scrollTop = 0);
  };
  await selectFirst();
  const form = page.getByRole('form', { name: 'Parameters', exact: true });
  const unit = form.locator('label').filter({ hasText: /^Unit produced/ });
  assert.equal(await unit.locator('input,select,textarea').count(), 0);
  assert.match(await unit.textContent(), /Soldier/);
  await shot('sp04-building-parameters');
  const primitives = await page.evaluate(() => {
    const css = selector => { const c = getComputedStyle(document.querySelector(selector)); return { font: c.fontFamily, height: c.height, background: c.backgroundColor, color: c.color, border: c.borderColor }; };
    return { leftWidth: document.querySelector('.ed-left').getBoundingClientRect().width, field: css('[aria-label="Parameters"] input'), primary: css('[aria-label="Apply parameters"]'), secondary: css('.ed-actions button'), tileTouch: getComputedStyle(document.querySelector('.ed-library-tile')).touchAction, tilePadding: getComputedStyle(document.querySelector('.ed-library-tile')).padding, labelFont: css('[aria-label="Parameters"] label').font };
  });
  assert.equal(primitives.leftWidth, 300); assert.equal(primitives.field.height, '28px'); assert.equal(primitives.tileTouch, 'none'); assert.equal(primitives.tilePadding, '4px');
  assert.equal(primitives.primary.background, 'rgb(37, 99, 201)'); assert.equal(primitives.secondary.background, 'rgb(255, 255, 255)');
  assert(!primitives.labelFont.includes('Coiny'));
  states.push({ name: 'parameters', unit: await unit.textContent(), primitives });
  override = true; await open(); await selectFirst();
  assert.match(await unit.textContent(), /Tank \(override\)/);
  await shot('sp04-troop-override');
  states.push({ name: 'override', unit: await unit.textContent(), tooltip: await unit.getByText('(override)', { exact: true }).getAttribute('title') });
  assert.deepEqual(errors, []);
  const results = { viewport: { width: 1440, height: 900 }, states, pageErrors: errors };
  await writeFile(`${folder}/04-left-panel/verification-results.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
