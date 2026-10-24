import { expect, test } from '@playwright/test';

test('source heading keeps its accessible name as the troop count grows', async ({ page }) => {
  await page.goto('/?kane=1&test=1');
  const panel = page.getByRole('region', { name: 'Outgoing routes', exact: true });
  const group = panel.getByRole('group', { name: 'House A outgoing routes', exact: true });
  const heading = group.getByRole('heading', { name: 'House A routes', exact: true });
  await expect(panel).toBeVisible();
  await expect(group).toBeVisible();
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(/^A \(blue \d+\)$/);
  const before = (await heading.textContent())!;
  await expect(heading).toHaveAccessibleDescription(before);

  await page.evaluate(() => window.__na!.step(100));

  await expect(heading).not.toHaveText(before);
  await expect(heading).toHaveText(/^A \(blue \d+\)$/);
  const after = (await heading.textContent())!;
  expect(Number(after.match(/\d+/)![0])).toBeGreaterThan(Number(before.match(/\d+/)![0]));
  await expect(panel).toHaveAccessibleName('Outgoing routes');
  await expect(group).toHaveAccessibleName('House A outgoing routes');
  await expect(heading).toHaveAccessibleName('House A routes');
  await expect(heading).toHaveAccessibleDescription(after);
});
