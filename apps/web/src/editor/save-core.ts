/** Pure dirty/save-queue helpers shared by manual Save and (later) autosave. */

/** JSON with sorted object keys so key order never makes equal documents look different. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : item);
}

/** Authored content only: the root editorVersion is owned by the server, including in undo snapshots. */
function authoredContent(value: object): object {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'editorVersion'));
}

/** Dirty = never saved, or authored content differs from the saved response (reference check first). */
export function isDirty<T extends object>(present: T, saved: T | null): boolean {
  return !saved || (present !== saved && stableStringify(authoredContent(present)) !== stableStringify(authoredContent(saved)));
}

export type ChipKind = 'saved' | 'saving' | 'unsaved' | 'error';
export function chipText(kind: ChipKind, issueCount: number): string {
  return kind === 'saved' ? '✓ Saved' : kind === 'saving' ? 'Saving…' : kind === 'unsaved' ? 'Unsaved' : (issueCount > 0 ? `${issueCount} issues` : "Can't save");
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

export interface AutosaveState {
  armed: boolean; dirty: boolean; valid: boolean;
  /** Finalize, Check or a manual Save is running. */
  jobRunning: boolean; saveInFlight: boolean;
  /** The last save attempt failed for exactly this revision. */
  failedThisRevision: boolean;
}
/** Autosave tick decision: only after a manual Save of this doc, never re-hammering a failed revision. */
export function shouldAutosave(s: AutosaveState): boolean {
  return s.armed && s.dirty && s.valid && !s.jobRunning && !s.saveInFlight && !s.failedThisRevision;
}
