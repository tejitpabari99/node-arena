import type { Page } from '@playwright/test';
import { expect, test, type NewPlayerPage } from './fixtures';

// SP06 R12: exercise the real lobby pickers and server bots; no commands or sim overrides.
async function createLobby(newPlayerPage: NewPlayerPage) {
  const host = await newPlayerPage();
  await host.goto('/?nick=Host');
  await host.getByTestId('pvp-play').click();
  await host.getByTestId('pvp-create').click();
  await expect(host.getByTestId('lobby-code')).toBeVisible();
  const code = (await host.getByTestId('lobby-code').innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{4}$/);
  return { host, code };
}

async function setBot(host: Page, seat: number) {
  await host.getByTestId(`seat-kind-${seat}`).selectOption('bot');
  await host.getByTestId(`seat-difficulty-${seat}`).selectOption('easy');
  await expect(host.getByTestId(`seat-kind-${seat}`)).toHaveValue('bot');
  await expect(host.getByTestId(`seat-difficulty-${seat}`)).toHaveValue('easy');
}

async function started(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__na?.pvp?.tick()), { timeout: 30_000 }).toBeGreaterThan(0);
}

test('one human starts alone against an easy bot and reaches the result @slow', async ({ newPlayerPage }) => {
  test.setTimeout(210_000);
  const { host } = await createLobby(newPlayerPage);
  await expect(host.getByTestId('lobby-map')).toContainText('Duel S');
  await setBot(host, 1);
  await expect(host.getByTestId('lobby-start')).toBeEnabled();
  await host.getByTestId('lobby-start').click();
  await started(host);
  const startTime = Date.now();
  expect(await host.evaluate(() => window.__na!.pvp!.state().start!.seats.map(({ kind, difficulty }) => ({ kind, difficulty })))).toEqual([
    { kind: 'human', difficulty: undefined }, { kind: 'bot', difficulty: 'easy' },
  ]);
  // Do not require a particular winner: this checks a real bot match ends and renders its result.
  // The result wrapper has no layout box; its popup's Leave button is visible.
  await expect(host.getByTestId('pvp-result')).toBeAttached({ timeout: 180_000 });
  await expect(host.getByTestId('pvp-result-leave')).toBeVisible();
  const end = await host.evaluate(() => window.__na!.pvp!.state().end);
  expect(end).not.toBeNull();
  expect(end!.finalTick).toBeGreaterThan(0);
  expect(end!.finalHash).not.toBe('');
  console.log(`[bot] play-to-result ms: ${Date.now() - startTime}, finalTick ${end!.finalTick}`);
});

test('Cross 2v2: two humans and two easy bots stay hash-equal for ten seconds, then leave', async ({ newPlayerPage }) => {
  test.setTimeout(75_000);
  const { host, code } = await createLobby(newPlayerPage);
  await host.getByTestId('lobby-map-na-pvp-cross').click();
  await expect(host.getByTestId('lobby-map')).toContainText('Cross');
  await setBot(host, 2);
  await setBot(host, 3);
  // Explicitly preserve the intended two teams: one human and one bot on each.
  for (const [seat, team] of [[0, 0], [1, 1], [2, 0], [3, 1]]) {
    await host.getByTestId(`seat-team-${seat}`).selectOption(String(team));
    await expect(host.getByTestId(`seat-team-${seat}`)).toHaveValue(String(team));
  }
  const guest = await newPlayerPage();
  await guest.goto(`/?room=${code}&nick=Guest`);
  await expect(guest.getByTestId('lobby-code')).toHaveText(code);
  for (const seat of [2, 3]) await expect(guest.getByTestId(`seat-team-label-${seat}`)).toContainText('easy');
  await guest.getByTestId('lobby-ready').click();
  await expect(host.getByTestId('lobby-start')).toBeEnabled();
  await host.getByTestId('lobby-start').click();
  await Promise.all([host, guest].map(started));
  for (const page of [host, guest]) {
    expect(await page.evaluate(() => window.__na!.pvp!.state().start!.seats.map(({ kind, team }) => ({ kind, team })))).toEqual([
      { kind: 'human', team: 0 }, { kind: 'human', team: 1 }, { kind: 'bot', team: 0 }, { kind: 'bot', team: 1 },
    ]);
  }
  // 20 ticks/s: the first and last samples span 200 ticks = ten seconds.
  // Historical hashes avoid racing reads of clients currently rendering adjacent ticks.
  for (const tick of [50, 100, 150, 200, 250]) {
    const hashes = await Promise.all([host, guest].map(async page => {
      await expect.poll(() => page.evaluate(t => window.__na!.pvp!.hashAt(t), tick), { timeout: 20_000 }).not.toBeNull();
      return page.evaluate(t => window.__na!.pvp!.hashAt(t), tick);
    }));
    expect(hashes[0], `same-tick hash at ${tick}`).toBe(hashes[1]);
  }
  for (const page of [host, guest]) {
    await expect(page.getByTestId('toast-desync')).toHaveCount(0);
    await page.evaluate(() => window.__na!.pvp!.actions.leave());
    await expect(page.getByTestId('pvp-create')).toBeVisible();
  }
});
