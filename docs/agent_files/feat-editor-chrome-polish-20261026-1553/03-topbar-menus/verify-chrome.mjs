/** From repo root: start pnpm dev --port 4174, then node this file. No API writes. */
import { createRequire } from 'node:module';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(`${process.cwd()}/apps/web/package.json`);
const { chromium, expect } = require('@playwright/test');
const folder = 'docs/agent_files/feat-editor-chrome-polish-20261026-1553';
const dest = `${folder}/03-topbar-menus/screens`;
await mkdir(dest, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], states = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__editor/status', route => route.fulfill({ json: { unfinalized: false, output: '' } }));
  await page.route('**/__editor/save', route => route.fulfill({ json: { level: { ...route.request().postDataJSON().level, editorVersion: '0.0.7' }, warnings: [] } }));
  await page.route('**/__editor/solvable', route => route.fulfill({ contentType: 'application/x-ndjson', body: [
    { type: 'progress', run: { proxy: 'aggressive', seed: 1, outcome: 'won', winner: 0, ticks: 920 } },
    { type: 'result', report: { totalWins: 2, runs: 3, ok: true } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n' }));
  const base = process.env.EDITOR_VERIFY_URL || 'http://127.0.0.1:4174';
  const shot = async name => {
    await page.mouse.move(320, 880);
    await page.screenshot({ path: `${dest}/${name}.png`, animations: 'disabled' });
    await copyFile(`${dest}/${name}.png`, `${folder}/after/${name}.png`);
  };
  await page.goto(`${base}/editor.html`);
  await expect(page.locator('.ed-start-card')).toBeVisible();
  await shot('sp03-start-screen');
  await page.goto(`${base}/editor.html?template=levelview-1`);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
  await page.getByTestId('share-button').click();
  await page.getByTestId('share-panel').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-chip')).toHaveText('✓ Saved');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.fonts.ready);
  const style = await page.evaluate(() => {
    const css = element => { const c = getComputedStyle(element); return { font: c.fontFamily, fontSize: c.fontSize, background: c.backgroundColor, border: c.borderTopWidth, radius: c.borderRadius, shadow: c.boxShadow }; };
    return { leftWidth: document.querySelector('.ed-left').getBoundingClientRect().width, status: css(document.querySelector('[data-testid=save-chip]')), back: css(document.querySelector('[data-testid=back]')), shell: css(document.querySelector('.ed-shell')) };
  });
  assert.equal(style.leftWidth, 300); assert.equal(style.status.border, '0px'); assert.equal(style.status.background, 'rgba(0, 0, 0, 0)');
  assert.equal(style.shell.fontSize, '13px'); assert(!style.shell.font.includes('Coiny')); assert.equal(style.back.shadow, 'none');
  await shot('sp03-top-bar'); states.push({ name: 'toolbar', style });
  await page.getByTestId('file-menu-button').click(); await expect(page.getByTestId('file-menu')).toBeVisible(); await shot('sp03-file-menu');
  await page.getByTestId('menu-create').click(); await expect(page.getByTestId('create-confirm')).toBeVisible(); await shot('sp03-create-dialog');
  await page.keyboard.press('Escape'); await page.getByTestId('file-menu-button').click(); await page.getByTestId('menu-open').click();
  await expect(page.getByTestId('open-confirm')).toBeVisible(); await shot('sp03-open-dialog');
  await page.keyboard.press('Escape'); await page.getByTestId('share-button').click(); await expect(page.getByTestId('share-panel')).toBeVisible();
  await shot('sp03-share-panel');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByTestId('check-toast')).toContainText('Check: AI won 2/3');
  await page.getByTestId('check-toast').getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.getByTestId('check-popover')).toContainText('Proxy wins: 2/3');
  const geometry = await page.evaluate(() => {
    const measure = selector => {
      const element = document.querySelector(selector), r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, z: getComputedStyle(element).zIndex, onTop: element.contains(document.elementFromPoint(x, y)) };
    };
    return { share: measure('[data-testid=share-panel]'), flyout: measure('[data-testid=check-popover]'), controls: measure('[data-testid=canvas-controls]'), canvas: measure('.ed-canvas') };
  });
  for (const surface of [geometry.share, geometry.flyout]) {
    assert(surface.right <= 1440 - 56); assert(surface.right < geometry.controls.x); assert(surface.onTop); assert(Number(surface.z) > Number(geometry.controls.z));
    assert(surface.x >= geometry.canvas.x && surface.y >= geometry.canvas.y && surface.bottom < geometry.canvas.bottom);
  }
  assert(geometry.flyout.right < geometry.share.x);
  await shot('sp03-check-toast-flyout'); states.push({ name: 'share-and-check', geometry });
  await expect(page.getByTestId('check-toast')).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByTestId('check-popover')).toBeVisible();
  await shot('sp03-check-details');
  assert.deepEqual(errors, []);
  const results = { viewport: { width: 1440, height: 900 }, apiFixtures: 'Save/version/status and deterministic Check stream intercepted; reads and viewport use live editor.', states, pageErrors: errors };
  await writeFile(`${folder}/03-topbar-menus/verification-results.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
