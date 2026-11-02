import { expect, type NewPlayerPage } from './fixtures';
import type { Page } from '@playwright/test';

/** Home -> Create a room -> (optional form edits) -> Create room; returns the room code from the live lobby. */
export async function createRoom(page: Page, nick: string, edit?: (page: Page) => Promise<void>): Promise<string> {
  await page.goto('/');
  await page.getByTestId('pvp-play').click();
  await page.getByTestId('pvp-create-tile').click();
  await page.getByTestId('pvp-nick').fill(nick);
  if (edit) await edit(page);
  await page.getByTestId('pvp-create').click();
  await expect(page.getByTestId('lobby-code')).toBeVisible();
  const code = ((await page.getByTestId('lobby-code').textContent()) ?? '').trim();
  expect(code).toMatch(/^[A-Z0-9]{4}$/);
  return code;
}

/** Home -> Join a match -> role -> nick + code -> Join. */
export async function joinRoom(page: Page, code: string, nick: string, role: 'play' | 'watch' = 'play', expectLobby = true): Promise<void> {
  await page.goto('/');
  await page.getByTestId('pvp-play').click();
  await page.getByTestId('pvp-join-tile').click();
  await page.getByTestId(role === 'play' ? 'pvp-role-play' : 'pvp-role-watch').click();
  await page.getByTestId('pvp-nick').fill(nick);
  await page.getByTestId('pvp-code-input').fill(code);
  await page.getByTestId('pvp-join').click();
  if (expectLobby) await expect(page.getByTestId('lobby-code')).toHaveText(code); // mid-match joins skip the lobby
}

export async function setBot(page: Page, seat: number, difficulty: 'easy' | 'normal' | 'hard' = 'easy'): Promise<void> {
  await page.getByTestId(`seat-kind-${seat}`).selectOption('bot');
  await page.getByTestId(`seat-difficulty-${seat}`).selectOption(difficulty);
  await expect(page.getByTestId(`seat-kind-${seat}`)).toHaveValue('bot');
  await expect(page.getByTestId(`seat-difficulty-${seat}`)).toHaveValue(difficulty);
}

export async function openMatch(newPlayerPage: NewPlayerPage): Promise<{ a: Page; b: Page; code: string }> {
  const a = await newPlayerPage();
  const b = await newPlayerPage();
  const code = await createRoom(a, 'Alice');
  await expect(a.getByTestId('map-na-pvp-duel-s')).toHaveAttribute('aria-pressed', 'true');
  await joinRoom(b, code, 'Bob');
  await expect(a.getByTestId('lobby-seat-1')).toContainText('Bob');
  await b.getByTestId('lobby-ready').click();
  await expect(a.getByTestId('lobby-start')).toBeEnabled();
  await a.getByTestId('lobby-start').click();
  await expect.poll(() => a.evaluate(() => (window as any).__na.screen), { timeout: 8_000 }).not.toBe('lobby');
  return { a, b, code };
}
