/** Pure dirty/save-queue helpers shared by manual Save and (later) autosave. */

/** JSON with sorted object keys so key order never makes equal documents look different. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : item);
}

/** Dirty = never saved, or present differs from the last document known to equal disk (reference check first). */
export function isDirty<T extends object>(present: T, saved: T | null): boolean {
  return !saved || (present !== saved && stableStringify(present) !== stableStringify(saved));
}

export type ChipKind = 'saved' | 'saving' | 'unsaved' | 'error';
export function chipText(kind: ChipKind, issueCount: number): string {
  return kind === 'saved' ? 'Saved ✓' : kind === 'saving' ? 'Saving…' : kind === 'unsaved' ? 'Unsaved' : `Can't save · ${issueCount} issues`;
}

/**
 * Single-flight queue. A save requested while another is in flight waits for it,
 * then runs only if the document is still dirty. A save requested while idle always runs.
 */
export function createSaveQueue<S>(run: (source: S) => Promise<void>, stillDirty: () => boolean) {
  let pending = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    get busy() { return pending > 0; },
    enqueue(source: S): Promise<void> {
      const waited = pending > 0;
      pending++;
      const job = chain.then(() => waited && !stillDirty() ? undefined : run(source));
      chain = job.catch(() => undefined);
      return job.finally(() => { pending--; });
    },
  };
}
