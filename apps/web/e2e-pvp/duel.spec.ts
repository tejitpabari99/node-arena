import { expect, test, type Browser, type Page } from '@playwright/test';
import { runScriptedAttack } from './scripted-attack';

// Duel S 1v1 through the real input path (SP06 R5/D8): seat 0 runs a scripted attack, seat 1 idles; no time-limit override.
// MEASURED (local swiftshader chromium): play-to-result ~39 s (finalTick ~716 at ~20 ticks/s), whole test ~41 s, limit 150 s.
// FIXTURE DECISION: none needed (< ~90 s); no tiny e2e map, no lobby time-limit override.

const mkPage = async (browser: Browser): Promise<Page> => (await browser.newContext()).newPage();

async function openMatch(browser: Browser): Promise<{ a: Page; b: Page }> {
  const a = await mkPage(browser);
  const b = await mkPage(browser);
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
  return { a, b };
}

test('Duel S 1v1: scripted attack by seat 0 wins; both pages agree on result and final hash', async ({ browser }) => {
  test.setTimeout(150_000);
  const { a, b } = await openMatch(browser);
  const t0 = Date.now();
  await expect.poll(() => a.evaluate(() => (window as any).__na.pvp.tick()), { timeout: 30_000 }).toBeGreaterThan(0);
  const stop = await runScriptedAttack(a, 0);
  try {
    // `pvp-result` is a zero-size wrapper (the popup is positioned), so assert attached + the visible leave button.
    await expect(a.getByTestId('pvp-result')).toBeAttached({ timeout: 130_000 });
    await expect(b.getByTestId('pvp-result')).toBeAttached({ timeout: 20_000 });
    await expect(a.getByTestId('pvp-result-leave')).toBeVisible();
    await expect(b.getByTestId('pvp-result-leave')).toBeVisible();
  } finally { stop(); }
  const [sa, sb] = await Promise.all([a, b].map((p) => p.evaluate(() => (window as any).__na.pvp.state())));
  for (const s of [sa, sb]) {
    expect(s.end.outcome.outcome).toBe('victory');
    expect(s.end.outcome.winner).toBe(0);
  }
  expect(sa.end.finalHash).toBe(sb.end.finalHash);
  const [ha, hb] = await Promise.all([a, b].map((p) => p.evaluate(() => (window as any).__na.hash())));
  expect(ha).toBe(sa.end.finalHash);
  expect(hb).toBe(sa.end.finalHash);
  console.log(`[duel] play-to-result ms: ${Date.now() - t0}, finalTick ${sa.end.finalTick}`);
});


test('play link prompts a new visitor for a nickname with the room code filled', async ({ browser }) => {
  const a = await mkPage(browser), b = await mkPage(browser);
  await a.goto('/?nick=Alice');
  await a.getByTestId('pvp-play').click(); await a.getByTestId('pvp-create').click();
  const code = ((await a.getByTestId('lobby-code').textContent()) ?? '').trim();
  await b.goto(`/?room=${code.toLowerCase()}`);
  await expect(b.getByTestId('pvp-code-input')).toHaveValue(code);
  await expect(b.getByTestId('pvp-nick')).toHaveValue('');
  await expect(b.getByTestId('pvp-join')).toBeDisabled();
  await b.getByTestId('pvp-nick').fill('New player');
  await b.getByTestId('pvp-join').click();
  await expect(b.getByTestId('lobby-code')).toHaveText(code);
  await b.getByTestId('lobby-leave').click();
  await expect(b.getByTestId('pvp-create')).toBeVisible();
  // The persisted nickname lets a later play link join without another prompt.
  await b.goto(`/?room=${code}`);
  await expect(b.getByTestId('lobby-code')).toHaveText(code);
});

test('invalid and missing play links show an online menu error', async ({ page }) => {
  await page.goto('/?room=bad');
  await expect(page.getByTestId('pvp-error')).toContainText('Invalid room code');
  await page.getByTestId('pvp-back').click();
  await expect(page.getByTestId('pvp-play')).toBeVisible();
  await page.goto('/?room=ZZZZ&nick=Bob');
  await expect(page.getByTestId('pvp-error')).toContainText('Room not found');
});


test('reload during a match exposes sync loss and Leave returns to the online menu', async ({ browser }) => {
  const { a, b } = await openMatch(browser);
  await expect.poll(() => b.evaluate(() => (window as any).__na.pvp.tick())).toBeGreaterThan(2);
  // Same-tab reload retains the player token but M1 cannot recover missed ticks.
  await b.reload();
  await expect(b.getByTestId('toast-sync-lost')).toContainText('Out of sync. Leave and rejoin.');
  await b.getByTestId('pvp-sync-leave').click();
  await expect(b.getByTestId('pvp-create')).toBeVisible();
  await a.keyboard.press('Escape');
  await a.getByTestId('pvp-leave').click();
  await expect(a.getByTestId('pvp-create')).toBeVisible();
});
