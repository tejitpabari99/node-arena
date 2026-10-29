import { expect, test, type Browser, type Page } from '@playwright/test';
import { runScriptedAttack } from './scripted-attack';

// Duel S 1v1 through the real input path (SP06 R5/D8): seat 0 runs a scripted attack, seat 1 idles; no time-limit override.
// MEASURED (local swiftshader chromium): play-to-result ~39 s (finalTick ~716 at ~20 ticks/s), whole test ~41 s, limit 150 s.
// FIXTURE DECISION: none needed (< ~90 s); no tiny e2e map, no lobby time-limit override.
//
// KNOWN BUG WORKAROUND: apps/server/src/room.ts draws `seed = rand(0, 2 ** 32)` but packages/net/src/validate.ts `int()`
// caps at MAX_INT (<= 2^31-1), so the client silently drops the `start` message for ~50% of seeds and stays in the lobby.
// `openMatch` retries with a fresh room when the start stalls. Remove the retry once the seed range is fixed.

const mkPage = async (browser: Browser): Promise<Page> => (await browser.newContext()).newPage();

async function openMatch(browser: Browser): Promise<{ a: Page; b: Page; stalls: number }> {
  for (let stalls = 0; stalls < 8; stalls++) {
    const a = await mkPage(browser);
    const b = await mkPage(browser);
    await a.goto('/?nick=Alice');
    await a.getByTestId('pvp-play').click();
    await a.getByTestId('pvp-create').click();
    const code = ((await a.getByTestId('lobby-code').textContent()) ?? '').trim();
    expect(code).not.toBe('');
    await expect(a.getByTestId('lobby-map')).toContainText('Duel S');
    // NOTE: `?room=` is parsed (net/links.ts) but never wired to controller.openLink in src, so join via the UI.
    await b.goto('/?nick=Bob');
    await b.getByTestId('pvp-play').click();
    await b.getByTestId('pvp-code-input').fill(code);
    await b.getByTestId('pvp-join').click();
    await expect(b.getByTestId('lobby-code')).toHaveText(code);
    await b.getByTestId('lobby-ready').click();
    await expect(a.getByTestId('lobby-start')).toBeEnabled();
    await a.getByTestId('lobby-start').click();
    try {
      await expect.poll(() => a.evaluate(() => (window as any).__na.screen), { timeout: 8_000 }).not.toBe('lobby');
      return { a, b, stalls };
    } catch {
      await a.context().close();
      await b.context().close();
    }
  }
  throw new Error('match never started (8 attempts)');
}

test('Duel S 1v1: scripted attack by seat 0 wins; both pages agree on result and final hash', async ({ browser }) => {
  test.setTimeout(150_000);
  const { a, b, stalls } = await openMatch(browser);
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
  console.log(`[duel] play-to-result ms: ${Date.now() - t0}, finalTick ${sa.end.finalTick}, start stalls ${stalls}`);
});
