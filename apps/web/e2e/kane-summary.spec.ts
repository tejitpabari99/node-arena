import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, query = '?kane=1') {
  await page.goto('/' + query);
  await expect.poll(() => page.evaluate(() => window.__na?.screen), { timeout: 20000 }).toBe('playing');
}
async function visibility(page: Page, hidden: boolean) {
  // Headless Chromium does not reliably emit background-tab visibility events.
  // Exercise the browser's actual document listeners with a controlled hidden value.
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('one CDP Runtime.evaluate returns JSON ground truth matching the Kane DOM', async ({ page }) => {
  await open(page);
  await page.getByTestId('kane-pair').filter({ hasText: 'A → C' }).click();
  await expect(page.getByTestId('kane-pair').filter({ hasText: 'A → C' })).toHaveAttribute('data-state', 'active');
  const cdp = await page.context().newCDPSession(page);
  const result = await cdp.send('Runtime.evaluate', { expression: 'window.__na.kane.summary()', returnByValue: true });
  expect(result.exceptionDetails).toBeUndefined();
  const summary = result.result.value;
  expect(Object.keys(summary).sort()).toEqual(['banner', 'human', 'letters', 'over', 'pairs', 'result', 'speed', 'tick']);
  expect(summary).toMatchObject({ speed: 0.25, over: null, result: null, banner: null, human: {
    drawn: 1, cut: 0, rejected: [], commands: [{ tick: expect.any(Number), cmd: { type: 'DrawLine', player: 0, from: 0, to: 2 } }],
  } });
  expect(summary.letters.map((row: {letter: string; index: number; id: string}) => ({ letter: row.letter, index: String(row.index), id: row.id })))
    .toEqual(await page.getByTestId('kane-tag').evaluateAll(tags => tags.map(tag => ({ letter: tag.getAttribute('data-letter'), index: tag.getAttribute('data-index'), id: tag.getAttribute('data-building-id') }))));
  expect(summary.pairs).toEqual(await page.getByTestId('kane-pair').evaluateAll(buttons => buttons.map(button => ({ from: button.getAttribute('data-from'), to: button.getAttribute('data-to'), state: button.getAttribute('data-state'), reason: button.getAttribute('data-reason') || null, text: button.textContent }))));
  await cdp.detach();
});
test('Kane hide/show resumes ticks with no stuck popup; manual pause remains paused', async ({ page }) => {
  await open(page);
  await visibility(page, true);
  expect(await page.evaluate(() => ({ paused: window.__na!.state().restartPopup, tick: window.__na!.view!.tick }))).toMatchObject({ paused: false });
  await visibility(page, false);
  await expect(page.getByTestId('kane-overlay')).toHaveAttribute('data-phase', 'playing');
  const tick = await page.evaluate(() => window.__na!.view!.tick);
  await expect.poll(() => page.evaluate(() => window.__na!.view!.tick)).toBeGreaterThan(tick);
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await visibility(page, true); await visibility(page, false);
  await expect(page.getByTestId('kane-overlay')).toHaveAttribute('data-phase', 'paused');
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeVisible();
});
test('common mode keeps its hidden-pause popup and requires explicit resume', async ({ page }) => {
  await open(page, '?level=1');
  expect(await page.evaluate(() => window.__na!.kane)).toBe(false);
  await visibility(page, true); await visibility(page, false);
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__na!.state().restartPopup)).toBe(true);
});
