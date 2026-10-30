import { expect, test } from './fixtures';
import { openMatch } from './open-match';
import { runScriptedAttack } from './scripted-attack';

// SP06 R12: spectator joins mid-match via the watch deep link; rematch returns both players to a new match in the same room.
// Each spec plays a full Duel S match (~40 s), as duel.spec.ts does.

test('spectator joins mid-match via ?room&watch and reaches the same result and final hash', async ({ newPlayerPage }) => {
  test.setTimeout(150_000);
  const { a, b, code } = await openMatch(newPlayerPage);
  const w = await newPlayerPage();
  await expect.poll(() => a.evaluate(() => (window as any).__na.pvp.tick()), { timeout: 30_000 }).toBeGreaterThan(0);
  await w.goto(`/?room=${code}&watch&nick=Watcher`);
  await expect(w.getByTestId('pvp-spectating')).toBeVisible({ timeout: 30_000 });
  const stop = await runScriptedAttack(a, 0);
  try {
    await expect(a.getByTestId('pvp-result')).toBeAttached({ timeout: 130_000 });
    await expect(w.getByTestId('pvp-result')).toBeAttached({ timeout: 30_000 });
    await expect(w.getByTestId('pvp-rematch')).toHaveCount(0); // spectators cannot rematch
    await expect(w.getByTestId('pvp-result-leave')).toBeVisible();
  } finally { stop(); }
  const [sa, sw] = await Promise.all([a, w].map((p) => p.evaluate(() => (window as any).__na.pvp.state())));
  expect(sw.end.outcome.outcome).toBe('victory');
  expect(sw.end.outcome.winner).toBe(0);
  expect(sw.end.finalHash).toBe(sa.end.finalHash);
  expect(sw.end.finalTick).toBe(sa.end.finalTick);
  await expect(w.getByTestId('result-placement-0')).toBeAttached();
  void b;
});

test('rematch: both players return to a new match in the same room', async ({ newPlayerPage }) => {
  test.setTimeout(240_000);
  const { a, b, code } = await openMatch(newPlayerPage);
  await expect.poll(() => a.evaluate(() => (window as any).__na.pvp.tick()), { timeout: 30_000 }).toBeGreaterThan(0);
  const firstId = await a.evaluate(() => (window as any).__na.pvp.state().start.matchId);
  const stop = await runScriptedAttack(a, 0);
  try {
    await expect(a.getByTestId('pvp-result')).toBeAttached({ timeout: 130_000 });
    await expect(b.getByTestId('pvp-result')).toBeAttached({ timeout: 20_000 });
  } finally { stop(); }
  await expect(a.getByTestId('result-placement-0')).toBeAttached();
  // The first click resets the room for everyone (server rematch): the host lands in the lobby with Bob already ready.
  await b.getByTestId('pvp-rematch').click();
  for (const p of [a, b]) {
    await expect(p.getByTestId('lobby-code')).toHaveText(code);
    await expect(p.getByTestId('pvp-result')).toHaveCount(0);
  }
  await expect(a.getByTestId('lobby-start')).toBeEnabled();
  await a.getByTestId('lobby-start').click();
  for (const p of [a, b]) {
    await expect.poll(() => p.evaluate(() => (window as any).__na.pvp.state().start?.matchId), { timeout: 15_000 }).not.toBe(firstId);
    await expect.poll(() => p.evaluate(() => (window as any).__na.pvp.tick()), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(p.getByTestId('pvp-result')).toHaveCount(0);
  }
});
