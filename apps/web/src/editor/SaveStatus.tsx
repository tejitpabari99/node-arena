import type { ContentIssue } from '@node-arena/content';
import { useEffect, useRef, useState } from 'preact/hooks';
import { chipText, type ChipKind } from './save-core.js';
import { useDismiss } from './useDismiss.js';

export interface SaveStatusProps {
  saveState: ChipKind;
  issues: ContentIssue[];
  warnings: ContentIssue[];
  saveMessage: string;
  /** Increments for each failed manual save, including repeated failures. */
  failureSeq: number;
  issueLabel(issue: ContentIssue): string;
}

/** Plain status unless save failures have details to inspect. */
export function SaveStatus({ saveState, issues, warnings, saveMessage, failureSeq, issueLabel }: SaveStatusProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const seen = useRef(failureSeq);
  const interactive = saveState === 'error' || issues.length > 0 || !!saveMessage;
  const state = interactive ? 'error' : saveState;
  useEffect(() => {
    if (failureSeq !== seen.current) { seen.current = failureSeq; setOpen(interactive); }
    if (!interactive) setOpen(false);
  }, [failureSeq, interactive]);
  useDismiss({ enabled: open && interactive, refs: [root], triggerRef: trigger, onDismiss: () => setOpen(false) });
  const text = chipText(state, issues.length);
  return <span ref={root} class="ed-chip-wrap ed-save-status-wrap">
    {interactive
      ? <button ref={trigger} type="button" class="ed-status ed-save-status" data-testid="save-chip" data-state={state} aria-expanded={open} onClick={() => setOpen(value => !value)}>{text}</button>
      : <span class="ed-status ed-save-status" role="status" data-testid="save-chip" data-state={state}>{text}</span>}
    {open && interactive && <div class="ed-popover ed-save-popover" data-testid="save-popover">
      {issues.length === 0 && warnings.length === 0 && !saveMessage && <p>No issues.</p>}
      {saveMessage && <p data-testid="save-message">{saveMessage}</p>}
      {issues.length > 0 && <ul aria-label="Save errors">{issues.map((issue, index) => <li key={index} data-item={issue.pointer}>{issueLabel(issue)}: {issue.message}</li>)}</ul>}
      {warnings.length > 0 && <ul aria-label="Save warnings">{warnings.map((issue, index) => <li key={index} data-item={issue.pointer}>{issueLabel(issue)}: {issue.message}</li>)}</ul>}
    </div>}
  </span>;
}
