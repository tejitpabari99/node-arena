import { expect, type NewPlayerPage } from './fixtures';
import type { Page } from '@playwright/test';

export async function openMatch(newPlayerPage: NewPlayerPage): Promise<{ a: Page; b: Page; code: string }> {
  const a = await newPlayerPage();
  const b = await newPlayerPage();
  await a.goto('/?nick=Alice');
  await a.getByTestId('pvp-play').click();
  await a.getByTestId('pvp-create').click();
  const code = ((await a.getByTestId('lobby-code').textContent()) ?? '').trim();
  expect(code).not.toBe('');
  await expect(a.getByTestId('lobby-map')).toContainText('Duel S');
  await b.goto(`/?room=${code}&nick=Bob`);
  await expect(b.getByTestId('lobby-code')).toHaveText(code);
  await b.getByTestId('lobby-ready').click();
  await expect(a.getByTestId('lobby-start')).toBeEnabled();
  await a.getByTestId('lobby-start').click();
  await expect.poll(() => a.evaluate(() => (window as any).__na.screen), { timeout: 8_000 }).not.toBe('lobby');
  return { a, b, code };
}
