import { test, expect } from '@playwright/test';
import type { LevelDoc } from '../src/editor/document.js';

test('new → place → Save → real Play defeat → back → reload custom; main progress and mute stay untouched', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Dev editor');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let saved: LevelDoc | undefined;
  // Virtual authoring filesystem: neither this spec nor Play writes repository content.
  await page.route('**/__editor/save', async route => {
    saved = route.request().postDataJSON().level as LevelDoc;
    await route.fulfill({ json: { level: saved, warnings: [] } });
  });
  await page.route('**/__editor/levels', async route => {
    const items = await (await route.fetch()).json();
    await route.fulfill({ json: saved ? [...items, { id: saved.id, name: saved.name }] : items });
  });
  await page.route('**/__editor/level/na-play-browser', route => route.fulfill({ json: saved }));
  await page.route('**/src/app/boot.ts', async route => {
    const response = await route.fetch();
    const overlay = saved ? { [`data/levels/${saved.id}.json`]: JSON.stringify(saved), 'data/campaigns/custom.json': JSON.stringify({ $schema: '../../schemas/campaign.schema.json', schemaVersion: '2.0.0', id: 'custom', entries: [{ level: saved.id, position: 1 }] }) } : {};
    await route.fulfill({ response, body: `${await response.text()}\nconst shippedFiles = contentFiles; contentFiles = () => ({...shippedFiles(), ...${JSON.stringify(overlay)}});` });
  });
  await page.goto('/editor.html');
  const baseline = await page.evaluate(() => {
    const raw = JSON.stringify({ v: 2, completed: { 'levelview-1': { firstAt: '2026-01-01T00:00:00.000Z' } }, settings: { musicVol: .4, sfxVol: .5, musicMute: false, sfxMute: false }, lastLevel: 'levelview-1' });
    localStorage.setItem('nodearena:save', raw); localStorage.setItem('nodearena:save.bak', 'keep backup');
    return JSON.stringify({ ...localStorage });
  });
  await page.getByLabel('New level id').fill('na-play-browser');
  await page.getByRole('button', { name: 'Create blank', exact: true }).click();
  await expect(page.getByTestId('viewport-status')).toContainText('Add a building');
  for (const [index, fraction] of [[0, .4], [1, .6]]) {
    const button = page.getByRole('button', { name: 'Place house-wt1', exact: true });
    await button.scrollIntoViewIfNeeded();
    const source = (await button.boundingBox())!, target = (await page.getByLabel('Edit viewport', { exact: true }).boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
    await page.mouse.move(target.x + target.width * fraction!, target.y + target.height / 2, { steps: 8 }); await page.mouse.up();
    await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', String(index! + 1));
    await expect(page.getByTestId('viewport-status')).toContainText('Ready');
    await page.getByLabel('Selected item', { exact: true }).selectOption(`building:b${index}`);
    await page.getByLabel('Building owner', { exact: true }).selectOption('p2');
    await page.getByRole('button', { name: 'Apply building properties', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-chip')).toHaveText('Saved ✓');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.editor-play-arena canvas')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Defeat', exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
  await expect(page.locator('.editor-play-overlay')).toHaveCount(0);
  await expect(page.getByLabel('Selected item', { exact: true })).toHaveValue('building:b1');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Building owner', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Building owner', { exact: true })).toHaveValue('p2');
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '2');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(baseline);
  await page.reload();
  await page.getByLabel('Reopen level').selectOption('na-play-browser');
  await page.getByRole('button', { name: 'Reopen level', exact: true }).click();
  await expect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', '2');
  await page.goto('/');
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await expect(page.locator('.level-grid.campaign .level-card')).toHaveCount(20);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(page.locator('.level-grid.custom .level-card').filter({ hasText: 'na-play-browser' })).toBeEnabled();
  expect(errors).toEqual([]);
});

declare global {
  interface Window {
    __editorPlayTest: {
      play: ReturnType<typeof import('../src/editor/play.js').mountEditorPlay>;
      stage: ReturnType<typeof import('../src/render/scene.js').createLevelScene>;
      disposals: { runtime: number; driver: number; exited: number };
      doc: LevelDoc;
    };
  }
}

test('overlay uses real input, identical initial hash, private completions/mute, normal Esc and Levels, and releases resources', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Source fixture');
  await page.goto('/editor.html');
  const initial = await page.evaluate(async () => {
    const paths = ['/src/editor/play.ts', '/src/editor/play-content.ts', '/src/editor/document.ts', '/src/app/boot.ts', '/src/app/state.ts', '/src/manifest/load.ts', '/src/save/index.ts'];
    const [playModule, content, documents, boot, state, manifest, saves] = await Promise.all(paths.map(path => import(/* @vite-ignore */ path))) as [typeof import('../src/editor/play.js'), typeof import('../src/editor/play-content.js'), typeof import('../src/editor/document.js'), typeof import('../src/app/boot.js'), typeof import('../src/app/state.js'), typeof import('../src/manifest/load.js'), typeof import('../src/save/index.js')];
    const doc = documents.blankDocument('na-runtime-browser', 'green', 'medium');
    doc.buildings = [
      { id: 'b0', archetype: 'house-wt1', pos: { x: -3, z: 0 }, owner: 'p1', level: 1, ignoreForWin: false },
      { id: 'b1', archetype: 'house-wt1', pos: { x: 3, z: 0 }, owner: 'p2', level: 1, ignoreForWin: false },
    ];
    const files = boot.contentFiles(), options = content.editorPlayOptions(files, doc);
    const main = state.createAppController({ files: options.files, loadManifest: manifest.loadManifest, save: saves.createSaveStore({ storage: null }), autoStart: false });
    await main.boot(); await main.startLevel(doc.id, 1); const hash = main.driver!.sim.hash(); main.dispose();
    const disposals = { runtime: 0, driver: 0, exited: 0 };
    const play = playModule.mountEditorPlay(document.body, files, doc, () => { disposals.exited++; });
    await play.ready;
    const overlayHash = play.app.driver!.sim.hash();
    const runtime = play.app.runtime!, driver = play.app.driver!;
    const disposeRuntime = runtime.dispose.bind(runtime), disposeDriver = driver.dispose.bind(driver);
    runtime.dispose = () => { disposals.runtime++; disposeRuntime(); };
    driver.dispose = () => { disposals.driver++; disposeDriver(); };
    const stage = runtime.inspection as Window['__editorPlayTest']['stage'];
    window.__editorPlayTest = { play, stage, disposals, doc };
    return { hash, overlayHash, loadContentMs: play.loadContentMs };
  });
  expect(initial.overlayHash).toBe(initial.hash);
  expect(initial.loadContentMs).toBeLessThan(1000);
  console.log(`Editor Play loadContent: ${initial.loadContentMs.toFixed(1)} ms; initial hash: ${initial.hash}`);
  await page.getByRole('button', { name: 'Mute sound', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unmute sound', exact: true })).toBeVisible();
  const points = await page.evaluate(async () => {
    const path = '/src/test-harness/probe.ts'; const probe = await import(/* @vite-ignore */ path) as typeof import('../src/test-harness/probe.js');
    const { stage } = window.__editorPlayTest;
    return [probe.projectAnchor(stage, 'b0'), probe.projectAnchor(stage, 'b1')];
  });
  await page.mouse.move(points[0]!.x, points[0]!.y); await page.mouse.down();
  await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__editorPlayTest.play.app.driver!.sim.view.lines.length)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toHaveCount(0);
  // Finish through actual ticks after real input; no view/result mutation or simulation injection.
  await page.evaluate(() => {
    const app = window.__editorPlayTest.play.app;
    for (let i = 0; i < 100 && !app.driver!.sim.view.over; i++) app.step(100);
  });
  await expect(page.getByRole('dialog', { name: /Victory!|Defeat/ })).toBeVisible({ timeout: 20000 });
  const state = await page.evaluate(() => window.__editorPlayTest.play.app.snapshot());
  expect(state.result).toEqual({ outcome: 'won', winner: 0 });
  expect(state.save.completed['na-runtime-browser']).toBeDefined();
  expect(await page.evaluate(() => localStorage.getItem('nodearena:save'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('nodearena:save.bak'))).toBeNull();
  await page.getByRole('button', { name: 'Levels', exact: true }).click();
  await expect(page.locator('.editor-play-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => window.__editorPlayTest.disposals)).toEqual({ runtime: 1, driver: 1, exited: 1 });
  expect(await page.evaluate(() => window.__editorPlayTest.play.app.driver)).toBeNull();
  // A fresh unsaved Play also exits through the normal pause menu's picker transition.
  await page.evaluate(async () => {
    const path = '/src/editor/play.ts', bootPath = '/src/app/boot.ts';
    const { mountEditorPlay } = await import(/* @vite-ignore */ path) as typeof import('../src/editor/play.js');
    const { contentFiles } = await import(/* @vite-ignore */ bootPath) as typeof import('../src/app/boot.js');
    const fixture = window.__editorPlayTest;
    fixture.play = mountEditorPlay(document.body, contentFiles(), fixture.doc, () => { fixture.disposals.exited++; });
    await fixture.play.ready;
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Levels', exact: true }).click();
  await expect(page.locator('.editor-play-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => window.__editorPlayTest.disposals.exited)).toBe(2);
});
