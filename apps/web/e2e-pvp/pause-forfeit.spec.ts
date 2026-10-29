import { expect, test } from './fixtures';
import { openMatch } from './open-match';
import type { Page } from '@playwright/test';

// SP07 Task 13: two-browser pause / Quit / window-close acceptance (AC10). The 30 s budget is the real server value
// (no test hook); the only slow spec is the expiry one (~35 s). Bot-only unlimited pause has no lobby UI: unit-covered (pause.ts).

const tick = (p: Page) => p.evaluate(() => (window as any).__na.pvp.tick() as number | null);
const hash = (p: Page) => p.evaluate(() => (window as any).__na.hash());
const secs = async (p: Page, seat: number) => {
  const m = /(\d+):(\d\d)/.exec((await p.getByTestId(`pvp-pause-remaining-${seat}`).textContent()) ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
async function started(p: Page) {
  await expect.poll(() => tick(p), { timeout: 30_000 }).toBeGreaterThan(2);
}

test('pause: both clients show the countdown, tick freezes, Resume continues, budget is cumulative', async ({ newPlayerPage }) => {
  const { a, b } = await openMatch(newPlayerPage);
  await started(a); await started(b);
  await a.getByTestId('pvp-pause').click();
  for (const p of [a, b]) {
    await expect(p.getByTestId('pvp-pause-overlay')).toBeVisible();
    await expect(p.getByTestId('pvp-pause-hold-0')).toBeVisible();
    await expect(p.getByTestId('pvp-pause-remaining-0')).toBeVisible();
  }
  await expect(a.getByTestId('pvp-resume')).toBeVisible();
  await expect(b.getByTestId('pvp-resume')).toHaveCount(0);
  await a.waitForTimeout(500); // freeze lands at the server's frozen tick, a few ticks after the click
  const [ta, tb] = [await tick(a), await tick(b)];
  await a.waitForTimeout(2500);
  expect(await tick(a)).toBe(ta); expect(await tick(b)).toBe(tb);
  expect(await secs(b, 0)).toBeLessThanOrEqual(28);
  expect(await secs(a, 0)).toBeLessThanOrEqual(28);
  await a.getByTestId('pvp-resume').click();
  for (const p of [a, b]) await expect(p.getByTestId('pvp-pause-overlay')).toHaveCount(0);
  await expect.poll(() => tick(b)).toBeGreaterThan(tb!);
  // Second pause continues from the remainder rather than resetting to 30 s.
  await a.getByTestId('pvp-pause').click();
  await expect(b.getByTestId('pvp-pause-remaining-0')).toBeVisible();
  expect(await secs(b, 0)).toBeLessThanOrEqual(27);
  await a.getByTestId('pvp-resume').click();
  await expect(b.getByTestId('pvp-pause-overlay')).toHaveCount(0);
});

test('Quit asks to confirm: No keeps playing, Yes forfeits (opponent wins, same result both sides)', async ({ newPlayerPage }) => {
  const { a, b } = await openMatch(newPlayerPage);
  await started(a); await started(b);
  await b.keyboard.press('Escape');
  await b.getByTestId('pvp-leave').click();
  await expect(b.getByTestId('pvp-quit-text')).toBeVisible();
  await b.getByTestId('pvp-quit-no').click();
  await expect(b.getByTestId('pvp-quit-text')).toHaveCount(0);
  const t = await tick(b);
  await expect.poll(() => tick(b)).toBeGreaterThan(t!);
  await expect(b.getByTestId('pvp-result')).toHaveCount(0);
  await b.keyboard.press('Escape');
  await b.getByTestId('pvp-leave').click();
  await b.getByTestId('pvp-quit-yes').click();
  await expect(a.getByTestId('pvp-result')).toBeAttached({ timeout: 20_000 });
  await expect(b.getByTestId('pvp-result')).toBeAttached({ timeout: 20_000 });
  const [sa, sb] = await Promise.all([a, b].map((p) => p.evaluate(() => (window as any).__na.pvp.state())));
  for (const s of [sa, sb]) { expect(s.end.outcome.outcome).toBe('victory'); expect(s.end.outcome.winner).toBe(0); }
  expect(sa.end.finalHash).toBe(sb.end.finalHash);
});

// Replaces the M1 "reload exposes sync loss" spec: M2 reconnects a reloaded client and catches it up.
test('reload mid-match: disconnect hold, catch-up, auto-resume, same hash on both sides', async ({ newPlayerPage }) => {
  test.setTimeout(120_000);
  const { a, b } = await openMatch(newPlayerPage);
  await started(a); await started(b);
  const matchId = await b.evaluate(() => (window as any).__na.pvp.state().start.matchId);
  const sentTypes: string[] = [];
  b.on('websocket', (socket) => socket.on('framesent', ({ payload }) => sentTypes.push(JSON.parse(String(payload)).t)));
  // Slow first manifest: the boot manifest must be ready before the match resumes (regression for the startup fetch race).
  let manifestRequests = 0;
  await b.route('**/manifest.json', async (route) => {
    if (++manifestRequests === 1) await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await b.reload();
  await expect(a.getByTestId('pvp-pause-hold-1')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => b.evaluate(() => (window as any).__na?.pvp.state().start?.matchId), { timeout: 30_000 }).toBe(matchId);
  for (const p of [a, b]) await expect(p.getByTestId('pvp-pause-overlay')).toHaveCount(0, { timeout: 30_000 });
  await expect(b.getByTestId('toast-sync-lost')).toHaveCount(0);
  expect(sentTypes).not.toContain('room.join');
  // Freeze both at the same tick, then compare.
  await a.getByTestId('pvp-pause').click();
  await expect(b.getByTestId('pvp-pause-hold-0')).toBeVisible();
  await b.waitForTimeout(1000);
  expect(await tick(b)).toBe(await tick(a));
  expect(await hash(b)).toBe(await hash(a));
  await a.getByTestId('pvp-resume').click();
  await expect.poll(() => tick(b)).toBeGreaterThan((await tick(a))! - 1000);
});

test('window close: opponent sees a disconnect countdown, expiry forfeits the closed player', async ({ newPlayerPage }) => {
  test.setTimeout(120_000);
  const { a, b } = await openMatch(newPlayerPage);
  await started(a); await started(b);
  await b.close();
  await expect(a.getByTestId('pvp-pause-hold-1')).toContainText('disconnected', { timeout: 15_000 });
  expect(await secs(a, 1)).toBeLessThanOrEqual(30);
  await expect(a.getByTestId('pvp-result')).toBeAttached({ timeout: 45_000 });
  const s = await a.evaluate(() => (window as any).__na.pvp.state());
  expect(s.end.outcome.outcome).toBe('victory');
  expect(s.end.outcome.winner).toBe(0);
});
