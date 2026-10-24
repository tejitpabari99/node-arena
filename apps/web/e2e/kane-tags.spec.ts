import { expect, test, type Page } from '@playwright/test';

const tags = '[data-testid=kane-tag]';
async function positions(page: Page) {
  return page.locator(tags).evaluateAll(elements => elements.map(element => {
    const span = element as HTMLElement, rect = span.getBoundingClientRect();
    const point = window.__na!.project(span.dataset.buildingId!);
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, point };
  }));
}
async function followsBuildings(page: Page) {
  await expect.poll(async () => (await positions(page)).every(tag =>
    Math.abs(tag.x - tag.point.x + 32) < 1 && Math.abs(tag.y - tag.point.y) < 1,
  )).toBe(true);
}

test('five DOM building letters keep their JSON order across loads and stay outside common mode', async ({ page }) => {
  await page.goto('/?kane=1&test=1');
  await expect(page.locator(tags)).toHaveCount(5);
  const labels = () => page.locator(tags).evaluateAll(elements => elements.map(element => ({
    tag: element.tagName, text: element.textContent, letter: (element as HTMLElement).dataset.letter,
    index: (element as HTMLElement).dataset.index, buildingId: (element as HTMLElement).dataset.buildingId,
  })));
  const first = await labels();
  expect(first.map(({ tag, text, letter, index, buildingId }) => ({ tag, text, letter, index, buildingId }))).toEqual(
    ['A', 'B', 'C', 'D', 'E'].map((letter, index) => ({ tag: 'SPAN', text: letter, letter, index: String(index), buildingId: `b${index}` })),
  );
  await page.reload();
  await expect(page.locator(tags)).toHaveCount(5);
  expect(await labels()).toEqual(first);
  await page.goto('/?test=1&level=1');
  await expect(page.locator('#arena canvas')).toBeVisible();
  await expect(page.locator(tags)).toHaveCount(0);
});

test('tags follow building projection through zoom and viewport resize without intercepting input', async ({ page }) => {
  await page.goto('/?kane=1&test=1');
  await expect(page.locator(tags)).toHaveCount(5);
  await followsBuildings(page);
  const before = await positions(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await followsBuildings(page);
  expect(await positions(page)).not.toEqual(before);
  await page.setViewportSize({ width: 1366, height: 768 });
  await followsBuildings(page);
  expect(await page.locator(tags).first().evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
});

test('capturing a building updates its owner ring', async ({ page }) => {
  await page.goto('/?kane=1&test=1');
  const tag = page.locator(`${tags}[data-letter=C]`);
  await expect(tag).toBeVisible();
  const ring = () => tag.evaluate(element => getComputedStyle(element).borderColor);
  const neutral = await ring();
  await page.locator('[data-testid=kane-pair][data-from=A][data-to=C]').click();
  await page.evaluate(() => { for (let i = 0; i < 50 && window.__na!.view!.buildings.owner[2] !== 0; i++) window.__na!.step(10); });
  await expect.poll(ring).not.toBe(neutral);
  expect(await ring()).toBe(await page.locator(`${tags}[data-letter=A]`).evaluate(element => getComputedStyle(element).borderColor));
});

test('restart replaces tags and leaving the level removes the layer', async ({ page }) => {
  await page.goto('/?kane=1&test=1');
  await expect(page.locator(tags)).toHaveCount(5);
  for (let i = 0; i < 2; i++) {
    const previous = await page.locator(tags).elementHandles();
    await page.evaluate(() => window.__na!.restart());
    await expect(page.locator(tags)).toHaveCount(5);
    await followsBuildings(page);
    for (const element of previous) expect(await element.evaluate(node => node.isConnected)).toBe(false);
  }
  await page.evaluate(() => window.__na!.menu());
  await expect(page.locator(tags)).toHaveCount(0);
});
