import { test, expect as browserExpect, expect } from '@playwright/test';

const development = process.env.WEB_TEST_SERVER === 'dev';
/** Replacing a dirty document asks first; accept it when shown. */
async function discardIfAsked(page: import('@playwright/test').Page) {
  const discard = page.getByRole('button', { name: 'Discard and continue', exact: true });
  if (await discard.waitFor({ timeout: 1500 }).then(() => true, () => false)) await discard.click();
}
test('starts blank drafts and copies without retaining source identity', async ({ page }) => {
  test.skip(!development, 'Editor filesystem API is dev-only');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor.html');
  await browserExpect(page.getByRole('dialog')).toBeVisible();
  await browserExpect(page.getByTestId('level-name')).toHaveCount(0);
  await page.getByLabel('New level id').fill('bad-id');
  await page.getByRole('button', { name: 'Create blank' }).click();
  await browserExpect(page.getByRole('alert')).toContainText('na-');
  await page.getByLabel('New level id').fill('na-blank');
  await page.getByLabel('Theme').selectOption('snow');
  await page.getByLabel('Size').selectOption('large');
  await page.getByRole('button', { name: 'Create blank' }).click();
  await browserExpect(page.getByTestId('level-name')).toHaveAttribute('title', 'na-blank');
  await browserExpect(page.getByLabel('Level theme', { exact: true })).toHaveValue('snow');
  await browserExpect(page.locator('.ed-shell')).toHaveAttribute('data-players', '2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await browserExpect(page.getByTestId('save-chip')).toContainText("Can't save");
  await browserExpect(page.getByTestId('save-popover')).toContainText('/buildings');
  await browserExpect(page.getByTestId('save-popover')).toContainText('must NOT have fewer than 1 items');
  await page.getByTestId('level-name').click();
  await page.getByLabel('Copy level').selectOption('levelview-1');
  await page.getByLabel('New level id').fill('levelview-1');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await browserExpect(page.getByRole('dialog').getByRole('alert')).toContainText('new id');
  await page.getByLabel('New level id').fill('na-copy');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await discardIfAsked(page);
  await browserExpect(page.getByTestId('level-name')).toHaveAttribute('title', 'na-copy');
  await browserExpect(page.locator('.ed-shell')).toHaveAttribute('data-buildings', /^\d+$/);
  await page.getByTestId('level-name').click();
  await page.getByLabel('Open level').selectOption('na-trial');
  await page.getByRole('button', { name: 'Open level', exact: true }).click();
  await discardIfAsked(page);
  await browserExpect(page.getByTestId('level-name')).toHaveAttribute('title', 'na-trial');
  await page.getByTestId('level-name').click();
  await page.getByLabel('Copy level').selectOption('na-trial');
  await page.getByLabel('New level id').fill('na-trial');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await browserExpect(page.getByRole('dialog').getByRole('alert')).toContainText('new id');
  await page.getByLabel('New level id').fill('na-trial-copy');
  await page.getByRole('button', { name: 'Copy level', exact: true }).click();
  await discardIfAsked(page);
  await browserExpect(page.getByTestId('level-name')).toHaveAttribute('title', 'na-trial-copy');
  expect(errors).toEqual([]);
});

test('test-hooks preview includes the editor shell without filesystem middleware', async ({ page, request }) => {
  test.skip(development, 'Preview gate check');
  await page.goto('/editor.html');
  await expect(page.getByRole('dialog')).toBeVisible();
  const api = await request.get('/__editor/levels');
  expect(api.headers()['content-type']).not.toContain('application/json');
});

for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`shell has no page scroll, scrolling left panel and filling canvas at ${size.width}x${size.height}`, async ({ page }) => {
    test.skip(!development, 'Editor filesystem API is dev-only');
    await page.setViewportSize(size);
    await page.goto('/editor.html?template=levelview-1');
    await expect(page.getByTestId('viewport-status')).toContainText('Ready');
    const m = await page.evaluate(() => {
      const el = document.documentElement, left = document.querySelector('.ed-left')!, canvas = document.querySelector('.ed-canvas')!.getBoundingClientRect(), top = document.querySelector('.ed-top')!.getBoundingClientRect();
      return { sw: el.scrollWidth, sh: el.scrollHeight, cw: el.clientWidth, ch: el.clientHeight, leftScrolls: left.scrollHeight > left.clientHeight, leftW: left.getBoundingClientRect().width, topH: top.height, canvas: { x: canvas.x, y: canvas.y, w: canvas.width, h: canvas.height } };
    });
    expect(m.sw).toBeLessThanOrEqual(m.cw); expect(m.sh).toBeLessThanOrEqual(m.ch);
    expect(m.leftScrolls).toBe(true); expect(m.leftW).toBe(300); expect(m.topH).toBe(56);
    expect(m.canvas).toEqual({ x: 300, y: 56, w: size.width - 300, h: size.height - 56 });
    const host = await page.getByLabel('Edit viewport').boundingBox();
    expect(host!.width).toBeCloseTo(size.width - 300, 0); expect(host!.height).toBeCloseTo(size.height - 56, 0);
  });
}
