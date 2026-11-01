import { expect, test } from './fixtures';
import { createRoom, joinRoom } from './open-match';

test('home -> create -> join: two contexts see the same lobby-code and each other', async ({ newPlayerPage }) => {
  const a = await newPlayerPage();
  const b = await newPlayerPage();
  const code = await createRoom(a, 'Alice');
  await expect(a.getByTestId('lobby-seat-0')).toContainText('Player 1');
  await expect(a.getByTestId('lobby-seat-1')).toContainText('Open');
  await joinRoom(b, code, 'Bob');
  await expect(a.getByTestId('lobby-code')).toHaveText(code);
  await expect(a.getByTestId('lobby-seat-1')).toContainText('Bob');
  // Joiner sees a read-only form with their own row highlighted.
  await expect(b.getByTestId('lobby-seat-1')).toHaveAttribute('data-you', 'true');
  await expect(b.getByTestId('seat-kind-1')).toHaveCount(0);
  await expect(b.getByTestId('map-na-pvp-cross')).toBeDisabled();
});

test('nickname with spaces survives reload and prefills the join form', async ({ newPlayerPage }) => {
  const a = await newPlayerPage();
  const code = await createRoom(a, 'Alice');
  const b = await newPlayerPage();
  await joinRoom(b, code, 'New player');
  await expect(a.getByTestId('lobby-seat-1')).toContainText('New player');
  await b.reload();
  await b.getByTestId('pvp-play').click();
  await b.getByTestId('pvp-join-tile').click();
  await b.getByTestId('pvp-role-play').click();
  await expect(b.getByTestId('pvp-nick')).toHaveValue('New player');
});

test('role chooser: Spectate joins as a spectator with the read-only form', async ({ newPlayerPage }) => {
  const a = await newPlayerPage();
  const code = await createRoom(a, 'Alice');
  const w = await newPlayerPage();
  await joinRoom(w, code, 'Watcher', 'watch');
  await expect(w.getByText('Spectating')).toBeVisible();
  await expect(w.getByTestId('lobby-ready')).toHaveCount(0);
  await expect(a.getByTestId('lobby-spectators')).toContainText('1');
});

test('play link with ?room prefills the code and asks for a nickname', async ({ newPlayerPage }) => {
  const a = await newPlayerPage(), b = await newPlayerPage();
  const code = await createRoom(a, 'Alice');
  await b.goto(`/?room=${code.toLowerCase()}`);
  await expect(b.getByTestId('pvp-code-input')).toHaveValue(code);
  await expect(b.getByTestId('pvp-join')).toBeDisabled();
  await b.getByTestId('pvp-nick').fill('New player');
  await b.getByTestId('pvp-join').click();
  await expect(b.getByTestId('lobby-code')).toHaveText(code);
  await b.getByTestId('lobby-leave').click();
  await expect(b.getByTestId('pvp-create-tile')).toBeVisible();
});

test('invalid and missing play links show an online menu error', async ({ page }) => {
  await page.goto('/?room=bad');
  await expect(page.getByTestId('pvp-error')).toContainText('Invalid room code');
  await page.getByTestId('pvp-back').click();
  await expect(page.getByTestId('pvp-play')).toBeVisible();
  await page.goto('/?room=ZZZZ&nick=Bob');
  await expect(page.getByTestId('pvp-error')).toContainText('Room not found');
});
