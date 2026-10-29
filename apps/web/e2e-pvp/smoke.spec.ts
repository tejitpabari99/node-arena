import { expect, test } from './fixtures';

test('two contexts reach lobby and see the same lobby-code', async ({ newPlayerPage }) => {
  const a = await newPlayerPage();
  const b = await newPlayerPage();
  await a.goto('/?nick=Alice');
  await a.getByTestId('pvp-play').click();
  await a.getByTestId('pvp-create').click();
  const codeEl = a.getByTestId('lobby-code');
  await expect(codeEl).toBeVisible();
  const code = ((await codeEl.textContent()) ?? '').trim();
  expect(code).not.toBe('');
  await b.goto('/?nick=Bob');
  await b.getByTestId('pvp-play').click();
  await b.getByTestId('pvp-code-input').fill(code);
  await b.getByTestId('pvp-join').click();
  await expect(b.getByTestId('lobby-code')).toHaveText(code);
  await expect(a.getByTestId('lobby-code')).toHaveText(code);
});
