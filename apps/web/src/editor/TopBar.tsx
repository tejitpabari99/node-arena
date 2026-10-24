import { useEffect, useRef, useState } from 'preact/hooks';
import type { ContentIssue } from '@node-arena/content';
import { chipText } from './save-core.js';
import { useEditor } from './EditorContext.js';

export interface TopBarProps {
  issues: ContentIssue[];
  warnings: ContentIssue[];
  /** Non-issue save failure (network etc.) for the current revision. */
  saveMessage: string;
  issueLabel(issue: ContentIssue): string;
  onName(): void;
  onPlay(): void;
  extras: preact.ComponentChildren;
}

/** Editor top bar: navigation, name, undo/redo, save chip + Save, Play. Check/Finalize arrive via `extras` until they move. */
export function TopBar({ issues, warnings, saveMessage, issueLabel, onName, onPlay, extras }: TopBarProps) {
  const { doc, history, dispatch, locked, save, saveState } = useEditor();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  const count = issues.length || 1;
  return <>
    <a href="/" class="ed-btn">← Game</a>
    <button class="ed-btn" data-testid="level-name" title={doc.id} disabled={locked} onClick={onName}>{doc.name || doc.id}</button>
    <button class="ed-btn" disabled={locked || !history.past.length} onClick={() => dispatch({ type: 'undo' })}>Undo</button>
    <button class="ed-btn" disabled={locked || !history.future.length} onClick={() => dispatch({ type: 'redo' })}>Redo</button>
    <span class="ed-top-spacer" />
    <span ref={root} class="ed-chip-wrap">
      <button class="ed-chip" role="status" data-testid="save-chip" data-state={saveState} aria-expanded={open} onClick={() => setOpen(value => !value)}>{chipText(saveState, count)}</button>
      {open && <div class="ed-popover ed-save-popover" data-testid="save-popover">
        {issues.length === 0 && warnings.length === 0 && !saveMessage && <p>No issues.</p>}
        {saveMessage && <p data-testid="save-message">{saveMessage}</p>}
        {issues.length > 0 && <ul aria-label="Save errors">{issues.map((issue, index) => <li key={index} data-item={issue.pointer}>{issueLabel(issue)}: {issue.message}</li>)}</ul>}
        {warnings.length > 0 && <ul aria-label="Save warnings">{warnings.map((issue, index) => <li key={index} data-item={issue.pointer}>{issueLabel(issue)}: {issue.message}</li>)}</ul>}
      </div>}
    </span>
    {extras}
    <button class="ed-btn" disabled={locked} onClick={onPlay}>Play</button>
    <button class="ed-btn ed-btn-primary" disabled={locked} onClick={() => void save('manual')}>Save</button>
  </>;
}
