import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createRoom, joinRoom, setBot } from './open-match';

// SP06 R12 / SP03: exercise the real create form and server bots; no commands or sim overrides.
async function started(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__na?.pvp?.tick()), { timeout: 30_000 }).toBeGreaterThan(0);
}

test('one human starts alone against an easy bot and reaches the result @slow', async ({ newPlayerPage }) => {
  test.setTimeout(210_000);
  const host = await newPlayerPage();
  await createRoom(host, 'Host', async (p) => { await setBot(p, 1); });
  await expect(host.getByTestId('lobby-seat-1')).toContainText('Bot1');
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
  test.setTimeout(150_000);
  const host = await newPlayerPage();
  const code = await createRoom(host, 'Host', async (p) => {
    await p.getByTestId('map-na-pvp-cross').click();
    await p.getByTestId('players-plus').click(); await p.getByTestId('players-plus').click();
    await expect(p.getByTestId('players-value')).toHaveText('4');
    await p.getByTestId('type-team').click();
    await setBot(p, 2); await setBot(p, 3);
    // One human and one bot on each of two teams.
    for (const [seat, team] of [[0, 0], [1, 1], [2, 0], [3, 1]]) {
      await p.getByTestId(`seat-team-${seat}`).selectOption(String(team));
      await expect(p.getByTestId(`seat-team-${seat}`)).toHaveValue(String(team));
    }
  });
  await expect(host.getByTestId('lobby-seat-2')).toContainText('Bot1');
  await expect(host.getByTestId('lobby-seat-3')).toContainText('Bot2');
  const guest = await newPlayerPage();
  await joinRoom(guest, code, 'Guest');
  for (const seat of [2, 3]) await expect(guest.getByTestId(`seat-team-label-${seat}`)).toContainText('easy');
  await expect(host.getByTestId('lobby-seat-1')).toContainText('Guest');
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
    await expect(page.getByTestId('pvp-create-tile')).toBeVisible();
  }
});

test('3 seats: host + one human + one bot start and tick on Cross', async ({ newPlayerPage }) => {
  test.setTimeout(150_000);
  const host = await newPlayerPage();
  const code = await createRoom(host, 'Host', async (p) => {
    await p.getByTestId('map-na-pvp-cross').click();
    await p.getByTestId('players-plus').click();
    await expect(p.getByTestId('players-value')).toHaveText('3');
    await setBot(p, 2);
  });
  const guest = await newPlayerPage();
  await joinRoom(guest, code, 'Guest');
  await guest.getByTestId('lobby-ready').click();
  await host.getByTestId('lobby-start').click();
  await Promise.all([host, guest].map(started));
  expect(await host.evaluate(() => window.__na!.pvp!.state().start!.seats.map(({ kind }) => kind))).toEqual(['human', 'human', 'bot']);
});

test('4 seats of Cross free-for-all with three humans waiting shows blockers and start-ready', async ({ newPlayerPage }) => {
  test.setTimeout(150_000);
  const host = await newPlayerPage();
  const code = await createRoom(host, 'Host', async (p) => {
    await p.getByTestId('map-na-pvp-cross').click();
    await p.getByTestId('players-plus').click(); await p.getByTestId('players-plus').click();
    await expect(p.getByTestId('players-value')).toHaveText('4');
  });
  const guests = [await newPlayerPage(), await newPlayerPage(), await newPlayerPage()];
  for (const [i, g] of guests.entries()) await joinRoom(g, code, `G${i + 1}`);
  await expect(host.getByTestId('lobby-start')).toBeDisabled();
  for (const g of guests) await g.getByTestId('lobby-ready').click();
  await expect(host.getByTestId('lobby-start')).toBeEnabled();
  // A held last row locks "-"; shrinking is only possible once it is free.
  await expect(host.getByTestId('players-minus')).toBeDisabled();
  await expect(host.getByTestId('players-hint')).toBeVisible();
  await host.getByTestId('lobby-start').click();
  await Promise.all([host, ...guests].map(started));
  expect(await host.evaluate(() => window.__na!.pvp!.state().start!.seats.length)).toBe(4);
});
