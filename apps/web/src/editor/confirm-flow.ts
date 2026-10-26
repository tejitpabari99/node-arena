export type ConfirmDecision = 'save' | 'discard' | 'cancel';

/** Returns whether the pending action ran. Saving must report explicit success. */
export async function confirmAction(
  decision: ConfirmDecision,
  save: () => Promise<boolean>,
  action: () => void | Promise<void>,
): Promise<boolean> {
  if (decision === 'cancel') return false;
  if (decision === 'save' && !await save()) return false;
  await action();
  return true;
}
