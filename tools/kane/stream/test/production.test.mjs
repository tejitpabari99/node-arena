import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { access, readdir } from 'node:fs/promises';
import { createStreamServer } from '../server.mjs';

const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

test('hosted production root plays the normal game, strips hooks and keeps both viewer routes credit-free', async t => {
  await access(new URL('../../../../apps/web/dist/index.html', import.meta.url));
  let starts = 0;
  const run = Object.assign(new EventEmitter(), {
    snapshot: viewers => ({ state: 'idle', runId: null, attemptId: null, viewers }),
    start: async () => { starts++; return { status: 503 }; }, close: async () => {},
  });
  const cast = Object.assign(new EventEmitter(), {
    start: async () => {}, stop: async () => {}, addClient: () => true, removeClient: () => {},
  });
  const app = await createStreamServer({ port: 0, env: {}, runController: run, screencast: cast, handleSignals: false });
  await app.listen();
  t.after(() => app.close());
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  t.after(() => browser.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [], failures = [], loaded = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400) failures.push([path, response.status()]);
    else loaded.push(path);
  });
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
  });
  for (const path of ['/', '/?kane=1']) {
    await page.goto(base + path);
    await page.locator('.level-grid.campaign .level-card').first().waitFor().catch(async error => {
      throw new Error(`${error.message}; errors=${JSON.stringify(errors)}; failures=${JSON.stringify(failures)}; body=${await page.locator('body').innerText()}; CSP=${JSON.stringify(await page.evaluate(() => window.cspViolations))}`);
    });
    assert.equal(await page.title(), 'Node Arena');
    assert.equal(await page.locator('.level-grid.campaign .level-card').count(), 20);
    assert.equal(await page.evaluate(() => typeof window.__na), 'undefined');
    assert.equal(await page.locator('[data-testid="kane-overlay"]').count(), 0);
    await page.locator('.level-card:not(:disabled)').first().click();
    await page.locator('#arena canvas').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.waitForFunction(() => document.fonts.check('16px Coiny'));
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('dialog', { name: 'Paused' }).waitFor();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.evaluate(() => typeof window.__na), 'undefined');
    await page.screenshot({ path: path === '/' ? '/tmp/kane-route-game.png' : '/tmp/kane-route-game-query.png' });
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
  }
  assert(loaded.some(path => path.startsWith('/textures/tw/')), 'real game textures load');
  assert(loaded.some(path => path.startsWith('/models/tw/')), 'real game models load');
  assert(loaded.some(path => path.startsWith('/audio/')), 'real game audio loads');
  assert(loaded.includes('/fonts/Coiny-Regular.ttf'), 'game font loads');
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  for (const path of ['/kane-cli', '/kane-cli/']) {
    await page.goto(base + path);
    await page.waitForFunction(() => document.getElementById('status')?.textContent === 'idle');
    assert.equal(await page.title(), 'Kane plays Node Arena');
    assert.equal(await page.locator('#start').isEnabled(), true);
    assert.match(await page.locator('#start').evaluate(el => getComputedStyle(el).fontFamily), /.+/);
    assert.equal(await page.locator('script').getAttribute('src'), '/kane-cli/app.js');
    assert.equal(await page.locator('link[rel="stylesheet"]').getAttribute('href'), '/kane-cli/style.css');
    assert.equal(await page.evaluate(() => typeof window.__na), 'undefined');
    await page.screenshot({ path: '/tmp/kane-route-viewer.png' });
  }
  assert.equal(starts, 0);
  assert.deepEqual(errors, []);
  // The viewer intentionally probes the optional, unbundled backup with HEAD.
  assert.deepEqual(failures.filter(([path, status]) => path !== '/kane-cli/backup.mp4' || status !== 404), []);
  assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
  // Every committed production asset must fit the HTTP path allowlist and MIME map.
  async function checkAssets(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.name.startsWith('.')) {
        assert.equal((await fetch(base + '/' + path, { method: 'HEAD' })).status, 404, path);
        continue;
      }
      if (entry.isDirectory()) await checkAssets(new URL(entry.name + '/', directory), path + '/');
      else {
        const response = await fetch(base + '/' + (path === 'index.html' ? '' : path), { method: 'HEAD' });
        assert.equal(response.status, 200, path);
      }
    }
  }
  await checkAssets(new URL('../../../../apps/web/dist/', import.meta.url));
});
