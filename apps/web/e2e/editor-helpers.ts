import { expect, type Page } from '@playwright/test';

export async function openFile(page: Page, kind: 'create' | 'open') {
  await page.getByTestId('file-menu-button').click();
  await page.getByTestId(`menu-${kind}`).click();
}
export async function share(page: Page) {
  if (!await page.getByTestId('share-panel').count()) await page.getByTestId('share-button').click();
}
export async function save(page: Page) {
  await share(page);
  await page.getByTestId('share-panel').getByRole('button', { name: 'Save', exact: true }).click();
}
export async function undo(page: Page) {
  await page.getByTestId('file-menu-button').click();
  await page.getByTestId('menu-undo').click();
}
export async function redo(page: Page) {
  await page.getByTestId('file-menu-button').click();
  await page.getByTestId('menu-redo').click();
}
export async function historyDisabled(page: Page, which: 'undo' | 'redo' = 'undo') {
  // Inspect without releasing an active canvas pointer drag.
  await page.getByTestId('file-menu-button').focus();
  await page.getByTestId('file-menu-button').press('ArrowDown');
  const disabled = await page.getByTestId(`menu-${which}`).isDisabled();
  await page.keyboard.press('Escape');
  return disabled;
}
export async function createBlank(page: Page, id?: string) {
  if (await page.getByTestId('file-menu-button').count()) await openFile(page, 'create');
  if (id) await page.getByLabel('New level id').fill(id);
  await page.getByTestId('create-confirm').click();
}
export async function copyFrom(page: Page, source: string, id?: string) {
  if (await page.getByTestId('file-menu-button').count()) await openFile(page, 'create');
  if (id) await page.getByLabel('New level id').fill(id);
  await page.getByLabel('Copy existing level', { exact: true }).selectOption(source);
  await page.getByTestId('create-confirm').click();
}
export async function expectId(page: Page, id: string | RegExp) {
  await expect(page.getByLabel('Level id', { exact: true })).toHaveText(id);
}
/** Enter through the game-menu Create handoff, then choose an existing source. */
export async function openCopied(page: Page, source = 'levelview-1') {
  await page.goto('/editor.html?create=1');
  await copyFrom(page, source);
  await expect(page.getByTestId('viewport-status')).toContainText('Ready');
}
