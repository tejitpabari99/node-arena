import { expect, test } from './fixtures';
import { openMatch } from './open-match';
import { runScriptedAttack } from './scripted-attack';

// SP08 Task 5: two browsers; one client's local sim is corrupted mid-match (test hook steps one extra tick). The hash checkpoint
// mismatches, the server sends `desync`, the client auto-resyncs (toast), converges, and both clients finish with the same result.

test('injected desync: Resyncing toast, recovery, both clients end with the matching result', async ({ newPlayerPage }) => {
  test.setTimeout(170_000);
  const { a, b } = await openMatch(newPlayerPage);
  await expect.poll(() => a.evaluate(() => (window as any).__na.pvp.tick()), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => b.evaluate(() => (window as any).__na.pvp.tick()), { timeout: 30_000 }).toBeGreaterThan(20);
  const stop = await runScriptedAttack(a, 0);
  try {
    await b.evaluate(() => (window as any).__na.pvp.corruptSim());
    await expect(b.getByTestId('toast-desync')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => b.evaluate(() => (window as any).__na.pvp.pvpEvents()), { timeout: 10_000 }).toEqual(expect.arrayContaining(['desync', 'resync']));
    const ev = await b.evaluate(() => (window as any).__na.pvp.pvpEvents() as string[]);
    expect(ev.filter((t) => t === 'resync')).toHaveLength(1);
    expect(ev).not.toContain('sync-lost');
    await expect(b.getByTestId('toast-sync-lost')).toHaveCount(0);
    // Converged: same hash at a later shared checkpoint tick (hashAt records every 50th tick after the rebuild).
    await expect.poll(async () => {
      const t = await b.evaluate(() => (window as any).__na.pvp.tick() as number);
      const target = Math.floor(t / 50) * 50;
      const [ha, hb] = await Promise.all([a, b].map((p) => p.evaluate((n) => (window as any).__na.pvp.hashAt(n), target)));
      return target > 0 && ha !== null && ha === hb;
    }, { timeout: 30_000 }).toBe(true);
    await expect(a.getByTestId('pvp-result')).toBeAttached({ timeout: 130_000 });
    await expect(b.getByTestId('pvp-result')).toBeAttached({ timeout: 20_000 });
  } finally { stop(); }
  const [sa, sb] = await Promise.all([a, b].map((p) => p.evaluate(() => (window as any).__na.pvp.state())));
  expect(sb.end.outcome).toEqual(sa.end.outcome);
  expect(sb.end.outcome.outcome).toBe('victory');
  expect(sb.end.finalHash).toBe(sa.end.finalHash);
  const hb = await b.evaluate(() => (window as any).__na.hash());
  expect(hb).toBe(sa.end.finalHash);
});
