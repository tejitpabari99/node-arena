import { test, expect } from './fixtures';
import { startServer } from '../../server/dist/main.js';
import { parseConfig } from '../../server/dist/config.js';
import { loadServerContent } from '../../server/dist/content.js';

// Real handshake with an isolated, bumped server; no production version override.
test('version mismatch reloads the document, disables online play if still mismatched, and preserves campaign', async ({ page }) => {
  const config = parseConfig({ PORT: '0', HOST: '127.0.0.1', ALLOWED_ORIGINS: 'http://127.0.0.1:4173', LOG_LEVEL: 'error' });
  const content = loadServerContent(config.contentDir);
  const original = content.versions.rules;
  content.versions.rules = '999.0.0';
  const server = await startServer(config, { content });
  try {
    await page.goto(`/?server=ws://127.0.0.1:${server.port}`);
    await page.getByTestId('pvp-play').click();
    await page.getByTestId('pvp-nick').fill('Mismatch');
    await page.getByTestId('pvp-create').click();
    await expect(page.getByTestId('pvp-error')).toContainText('A newer version of Node Arena is available - reload');
    // A new document (rather than rerender/retry) must result from Reload.
    await page.evaluate(() => { (window as unknown as { beforeReload: boolean }).beforeReload = true; });
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Reload', exact: true }).click(),
    ]);
    expect(await page.evaluate(() => 'beforeReload' in window)).toBe(false);
    expect(await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type)).toBe('reload');
    await page.getByTestId('pvp-play').click();
    await expect(page.getByTestId('pvp-error')).toContainText('PvP unavailable: this build differs from the server');
    await page.getByTestId('pvp-code-input').fill('ZZZZ');
    await expect(page.getByTestId('pvp-create')).toBeDisabled();
    await expect(page.getByTestId('pvp-join')).toBeDisabled();
    await page.getByTestId('pvp-back').click();
    await page.getByRole('button', { name: 'Campaign', exact: true }).click();
    await page.locator('[data-level-id]').first().click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __na?: { screen: string; view?: { tick: number } } }).__na?.screen), { timeout: 20_000 }).toBe('playing');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __na?: { view?: { tick: number } } }).__na?.view?.tick ?? 0)).toBeGreaterThan(0);
    // Once server compatibility returns, the same tab/build must recover too.
    content.versions.rules = original;
    await page.reload();
    await page.getByTestId('pvp-play').click();
    await expect(page.getByTestId('pvp-create')).toBeEnabled();
    await page.getByTestId('pvp-create').click();
    await expect(page.getByTestId('lobby-code')).toBeVisible();
  } finally {
    await server.close();
  }
});
