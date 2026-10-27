import { expect, it } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';
import { blankDocument } from '../../src/editor/document.js';

it('creates, copies and opens levels with accessible reusable dialogs in Chromium', async () => {
  const server = await createServer({ cacheDir: 'node_modules/.vite-test-create-dialog', server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'create-dialog-fixture', configureServer(s) {
      s.middlewares.use('/__create-dialog', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await s.transformIndexHtml('/__create-dialog', '<!doctype html><html><body><div id="app"></div><script type="module" src="/test/editor/create-dialog-fixture.tsx"></script></body></html>'));
      });
    },
  }] });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const source = blankDocument('na-custom-1', 'snow', 'large');
    source.editorVersion = '0.0.7'; source.source = { game: 'test', gameVersion: '1', asset: 'level' };
    source.buildings = [{ id: 'source-building', archetype: 'soldier', owner: 'p1', pos: { x: 0, z: 0 }, level: 1, ignoreForWin: false, params: { units: 10 } }];
    let reads = 0, readFailure = false;
    await page.route('**/__editor/level/*', async route => {
      reads++;
      await route.fulfill(readFailure ? { status: 500, json: { error: 'Read failed' } } : { json: source });
    });
    await page.goto(server.resolvedUrls!.local[0] + '__create-dialog');
    const trigger = page.getByRole('button', { name: 'Show Create', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Create level', exact: true });
    const id = dialog.getByLabel('New level id', { exact: true });
    const create = dialog.getByTestId('create-confirm');
    await browserExpect(dialog).toHaveAttribute('aria-modal', 'true');
    await browserExpect(id).toHaveValue('na-custom-3'); await browserExpect(id).toBeFocused();
    await browserExpect(dialog.getByLabel('Copy existing level')).toHaveValue('');
    await page.keyboard.press('Shift+Tab'); await browserExpect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab'); await browserExpect(id).toBeFocused();
    await id.fill('na-custom-1'); await create.click();
    await browserExpect(dialog.getByRole('alert')).toHaveText('Choose a new id; that level already exists.'); expect(reads).toBe(0);
    await id.fill('na-custom-2'); await create.click();
    await browserExpect(dialog.getByRole('alert')).toHaveText('Choose a new id; that level already exists.');
    await id.fill('invalid'); await create.click(); await browserExpect(dialog.getByRole('alert')).toContainText('na-');
    await id.fill('na-new'); await dialog.getByLabel('Theme', { exact: true }).selectOption('snow');
    await dialog.getByLabel('Size', { exact: true }).selectOption('small'); await create.click();
    await browserExpect(page.getByTestId('result')).toContainText('na-new');
    let result = JSON.parse(await page.getByTestId('result').innerText());
    expect(result).toMatchObject({ saved: false, doc: { theme: 'snow', bounds: { maxX: 6 }, buildings: [{ owner: 'p1' }, { owner: 'p2' }] } });
    await dialog.getByLabel('Theme', { exact: true }).selectOption('green');
    await dialog.getByLabel('Copy existing level').selectOption('na-custom-1');
    await browserExpect(dialog.getByLabel('Theme', { exact: true })).toBeDisabled();
    await browserExpect(dialog.getByLabel('Size', { exact: true })).toBeDisabled();
    await browserExpect(dialog.getByText('Copied from na-custom-1; theme and size come from the source', { exact: true })).toBeVisible();
    await browserExpect(create).toHaveText('Create'); await create.click();
    await browserExpect(page.getByTestId('result')).toContainText('source-building');
    result = JSON.parse(await page.getByTestId('result').innerText());
    expect(result).toMatchObject({ saved: false, doc: { id: 'na-new', theme: 'snow', bounds: { maxX: 15 } } });
    expect(result.doc.source).toBeUndefined(); expect(result.doc.editorVersion).toBeUndefined();
    const expectedCopy = structuredClone(source); expectedCopy.id = 'na-new'; delete expectedCopy.source; delete expectedCopy.editorVersion;
    expect(result.doc).toEqual(expectedCopy);
    readFailure = true; await create.click();
    await browserExpect(dialog.getByRole('alert')).toHaveText('Read failed');
    expect(JSON.parse(await page.getByTestId('result').innerText())).toEqual(result);
    readFailure = false;
    await dialog.getByLabel('Copy existing level').selectOption('');
    await browserExpect(dialog.getByLabel('Theme', { exact: true })).toBeEnabled();
    await page.keyboard.press('Escape'); await browserExpect(dialog).toHaveCount(0); await browserExpect(trigger).toBeFocused();
    await trigger.click(); await page.mouse.click(1, 1);
    await browserExpect(dialog).toHaveCount(0); await browserExpect(trigger).toBeFocused();

    await page.getByLabel('Hold replacement').check(); await trigger.click(); await page.getByTestId('create-confirm').click();
    await browserExpect(page.getByTestId('create-confirm')).toBeDisabled();
    await page.keyboard.press('Escape'); await browserExpect(dialog).toBeVisible();
    await page.keyboard.press('Tab'); expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    await page.evaluate(() => Reflect.get(window, 'finishCreate')(false));
    await browserExpect(dialog.getByRole('alert')).toHaveText('Replacement failed');
    await browserExpect(page.getByTestId('create-confirm')).toBeEnabled();
    await page.keyboard.press('Escape'); await page.getByLabel('Hold replacement').uncheck();

    const openTrigger = page.getByRole('button', { name: 'Show Open', exact: true }); await openTrigger.click();
    const open = page.getByRole('dialog', { name: 'Open level', exact: true });
    await browserExpect(open.getByLabel('Open level')).toBeFocused();
    await browserExpect(open.getByRole('option')).toHaveCount(1);
    await open.getByTestId('open-confirm').click();
    await browserExpect(page.getByTestId('result')).toContainText('0.0.7');
    result = JSON.parse(await page.getByTestId('result').innerText()); expect(result).toEqual({ doc: source, saved: true });
    readFailure = true; await open.getByTestId('open-confirm').click();
    await browserExpect(open.getByRole('alert')).toHaveText('Read failed');
    await browserExpect(open.getByTestId('open-confirm')).toBeEnabled(); readFailure = false;
    await page.keyboard.press('Escape'); await browserExpect(openTrigger).toBeFocused();
    await page.getByLabel('Empty listings').check(); await page.getByLabel('Loading listings').check(); await openTrigger.click();
    await browserExpect(open.getByText('No custom levels yet.')).toHaveCount(0);
    await browserExpect(open.getByRole('status')).toHaveText('Loading levels…');
    await browserExpect(open.getByTestId('open-confirm')).toBeDisabled(); await page.keyboard.press('Escape');
    await page.getByLabel('Loading listings').uncheck(); await openTrigger.click();
    await browserExpect(open.getByText('No custom levels yet.')).toBeVisible(); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Show Start', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: 'Level editor', exact: true })).toBeVisible();
    await browserExpect(page.getByRole('link', { name: 'Back', exact: true })).toHaveAttribute('href', '/?view=custom');
    await browserExpect(page.getByTestId('create-confirm')).toBeVisible(); await browserExpect(page.getByTestId('open-confirm')).toBeVisible();
    await browserExpect(page.getByLabel('New level id')).toHaveValue('na-custom-1');
    await page.getByTestId('create-confirm').click();
    await browserExpect(page.getByTestId('result')).toContainText('na-custom-1');
    expect(JSON.parse(await page.getByTestId('result').innerText())).toMatchObject({ saved: false, doc: { theme: 'green', bounds: { maxX: 10 } } });
    await page.keyboard.press('Escape'); await browserExpect(page.getByRole('heading', { name: 'Level editor', exact: true })).toBeVisible();
    await browserExpect(page.getByRole('dialog')).toHaveCount(0); expect(errors).toEqual([]);
  } finally { await browser.close(); await server.close(); }
}, 60000);
