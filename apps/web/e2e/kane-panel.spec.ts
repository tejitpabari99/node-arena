import { expect, test } from '@playwright/test';
import { legalPair } from './helpers';

const pairSelector = '[data-testid=kane-pair][data-from=A][data-to=C]';

test('pair click submits once, guards pending and fast double clicks, then cuts an old active line', async ({ page }) => {
  await page.goto('/?kane=1&test=1');
  const pair = page.locator(pairSelector);
  await expect(pair).toHaveAttribute('data-state', 'ready');
  // Pin the cut guard's wall clock: a slow browser IPC round trip must not
  // turn this deliberately fast gesture into a legitimate cut after 700ms.
  await page.evaluate(() => { performance.now = () => 0; });
  await pair.dblclick();
  await page.evaluate(() => window.__na!.step());
  await expect(pair).toHaveAttribute('data-state', 'active', { timeout: 1000 });
  expect(await page.evaluate(() => window.__na!.commandLog.filter(row => row.cmd.player === 0))).toEqual([
    { tick: 0, cmd: { type: 'DrawLine', player: 0, from: 0, to: 2 } },
  ]);
  await page.evaluate(() => { performance.now = () => 699; });
  await pair.dispatchEvent('dblclick');
  await page.evaluate(() => window.__na!.step());
  expect(await page.evaluate(() => window.__na!.events.filter(event => event.type === 'LineCut'))).toHaveLength(0);
  await page.evaluate(() => { performance.now = () => 700; });
  await pair.dblclick();
  await page.evaluate(() => window.__na!.step());
  await expect(pair).toHaveAttribute('data-state', 'ready');
  expect(await page.evaluate(() => window.__na!.events.filter(event => event.type === 'LineCut'))).toContainEqual({ type: 'LineCut', from: 0, to: 2, reason: 'player' });
});

test('unavailable pair explains the reason without a command; next click clears it; pause scrim intercepts', async ({ page }) => {
  await page.goto('/?kane=1&test=1');
  const pair = page.locator(pairSelector), banner = page.getByTestId('kane-banner');
  await expect(pair).toBeVisible();
  await pair.click();
  await page.evaluate(() => { for (let i = 0; i < 50 && window.__na!.view!.buildings.owner[2] !== 0; i++) window.__na!.step(10); });
  await page.locator('[data-testid=kane-pair][data-from=C][data-to=B]').click();
  await page.evaluate(() => { for (let i = 0; i < 50 && window.__na!.view!.buildings.owner[1] !== 0; i++) window.__na!.step(10); });
  await page.locator('[data-testid=kane-pair][data-from=B][data-to=C]').click();
  await page.evaluate(() => window.__na!.step());
  // B has one route slot; a geometry filter based on live canDraw would now
  // leak its blocked B -> A route because no-slot masks the blocker.
  expect(await page.evaluate(() => window.__na!.legality(1, 0).reason)).toBe('no-slot');
  await expect(page.locator('[data-testid=kane-pair][data-from=B][data-to=A]')).toHaveCount(0);
  await expect(page.locator('[data-testid=kane-pair][data-from=A][data-to=B], [data-testid=kane-pair][data-from=A][data-to=D]')).toHaveCount(0);
  const grey = page.locator('[data-testid=kane-pair][data-from=B][data-to=D]');
  await expect(grey).toHaveAttribute('data-reason', 'no-slot');
  await expect(grey).toHaveText('B → D · no free route');
  const count = await page.evaluate(() => window.__na!.commandLog.length);
  await grey.dblclick();
  await expect(banner).toHaveText('This building has no free routes.');
  await expect(banner).toHaveAttribute('role', 'alert');
  await page.waitForTimeout(1000);
  await expect(banner).toBeVisible();
  await page.evaluate(() => window.__na!.step());
  expect(await page.evaluate(() => window.__na!.commandLog.length)).toBe(count);
  await pair.click(); await expect(banner).toBeHidden();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(await pair.evaluate(button => { const r = button.getBoundingClientRect(); return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.battle-scrim'); })).toBe(true);
});

for (const [fixture, outcome, text, winner] of [['win', 'won', 'Victory!', '0'], ['loss', 'lost', 'Defeat', '1']] as const) {
  test(`match ${fixture} locks pairs and exposes result above the popup`, async ({ page }) => {
    await page.goto(`/?kane=1&test=1&fixture=${fixture}`);
    await page.locator(pairSelector).click(); await page.evaluate(() => window.__na!.step());
    const result = page.getByTestId('kane-result');
    await expect(result).toHaveText(text);
    await expect(result).toHaveAttribute('data-outcome', outcome);
    await expect(result).toHaveAttribute('data-winner', winner);
    await expect(page.getByTestId('kane-panel')).toHaveAttribute('data-locked', 'true');
    for (const button of await page.getByTestId('kane-pair').all()) await expect(button).toBeDisabled();
    await expect(page.getByTestId('kane-banner')).toHaveText('Game over');
    expect(await page.getByTestId('kane-banner').evaluate(el => { const r = el.getBoundingClientRect(); el.style.pointerEvents = 'auto'; const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); el.style.pointerEvents = ''; return top === el; })).toBe(true);
    expect(await result.evaluate(el => { const r = el.getBoundingClientRect(); el.style.pointerEvents = 'auto'; const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); el.style.pointerEvents = ''; return top === el; })).toBe(true);
  });
}

test('canvas drag still draws through the Kane overlay', async ({ page }) => {
  await page.goto('/?kane=1&test=1');
  await expect(page.locator(pairSelector)).toBeVisible();
  const pair = await legalPair(page);
  await page.mouse.move(pair.a.x, pair.a.y); await page.mouse.down();
  await page.mouse.move(pair.b.x, pair.b.y, { steps: 8 }); await page.mouse.up();
  await page.evaluate(() => window.__na!.step());
  await expect(page.locator(pairSelector)).toHaveAttribute('data-state', 'active');
});

test('automatic pair click draws and becomes active within one second', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/?kane=1');
  const pair = page.locator(pairSelector);
  await expect(pair).toHaveAttribute('data-state', 'ready');
  // Deliver one second of real driver animation callbacks without depending on
  // SwiftShader's wall-time frame throughput on a shared machine.
  await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
  const before = await page.evaluate(() => window.__na!.view!.tick);
  await pair.click();
  await page.clock.runFor(1000);
  await expect(pair).toHaveAttribute('data-state', 'active', { timeout: 1000 });
  expect(await page.evaluate(() => window.__na!.view!.tick) - before).toBe(5);
  expect(await page.evaluate(() => window.__na!.commandLog.filter(row => row.cmd.player === 0 && row.cmd.type === 'DrawLine'))).toHaveLength(1);
});

test('leaving Kane removes every play control and common mode never mounts them', async ({ page }) => {
  await page.goto('/?kane=1&test=1');
  await expect(page.getByTestId('kane-panel')).toBeVisible();
  await page.evaluate(() => window.__na!.menu());
  await expect(page.locator('.level-card')).toHaveCount(1);
  for (const id of ['kane-overlay', 'kane-panel', 'kane-pair', 'kane-tag', 'kane-speed', 'kane-banner', 'kane-result']) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
  await page.goto('/?test=1&level=1');
  await expect(page.locator('#game-hud')).toBeVisible();
  for (const id of ['kane-overlay', 'kane-panel', 'kane-pair', 'kane-tag', 'kane-speed', 'kane-banner', 'kane-result']) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
});
