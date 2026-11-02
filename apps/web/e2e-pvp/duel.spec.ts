import { expect, test } from './fixtures';
import { openMatch } from './open-match';
import { runScriptedAttack } from './scripted-attack';

// Duel S 1v1 through the real input path (SP06 R5/D8): seat 0 runs a scripted attack, seat 1 idles; no time-limit override.
// MEASURED (local swiftshader chromium): play-to-result ~39 s (finalTick ~716 at ~20 ticks/s), whole test ~41 s, limit 150 s.
// FIXTURE DECISION: none needed (< ~90 s); no tiny e2e map, no lobby time-limit override.

test('Duel S 1v1: scripted attack by seat 0 wins; both pages agree on result and final hash', async ({ newPlayerPage }) => {
  test.setTimeout(150_000);
  const { a, b } = await openMatch(newPlayerPage);
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
