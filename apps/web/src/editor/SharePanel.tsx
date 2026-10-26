import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { EditorFinalizeEvent } from '../../../../tools/src/editor-finalize.js';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';
import { versionOf } from './api.js';
import type { LevelDoc } from './document.js';
import { useDismiss } from './useDismiss.js';

export interface SharePanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  savedDoc: LevelDoc | null;
  locked: boolean;
  busy: boolean;
  job: 'check' | 'finalize' | null;
  onSave(kind: 'manual'): void;
  onCheck(): void;
  onCancel(): void;
  onFinalize(): void;
  onDetails(): void;
  proxyEvents: EditorProxyEvent[];
  /** Failed-check evidence (issues or error) also warrants the Details button. */
  hasCheckProblem?: boolean;
  finalizeEvents: EditorFinalizeEvent[];
  finalizeError: string;
  lockStatus: 'checking' | 'current' | 'unfinalized' | 'unknown';
  lockOutput: string;
  /** Child surface participates in containment; its Escape handler closes it first. */
  flyoutOpen?: boolean;
  flyoutRef?: RefObject<HTMLElement>;
  panelRef?: RefObject<HTMLDivElement>;
  detailsRef?: RefObject<HTMLButtonElement>;
}
function Spinner() { return <span class="ed-spinner" role="progressbar" aria-label="Working" />; }

/** Controlled job surface. Job state belongs to Editor and survives dismissing it. */
export function SharePanel(p: SharePanelProps) {
  const trigger = useRef<HTMLButtonElement>(null), ownPanel = useRef<HTMLDivElement>(null);
  const panel = p.panelRef ?? ownPanel;
  const tabbing = useRef(false);
  useDismiss({ enabled: p.open, refs: [trigger, panel, ...(p.flyoutRef ? [p.flyoutRef] : [])], triggerRef: trigger, escapeEnabled: !p.flyoutOpen, onDismiss: () => p.onOpenChange(false) });
  useLayoutEffect(() => {
    if (!p.open) return;
    const place = () => {
      if (panel.current && trigger.current) panel.current.style.right = `max(var(--ed-controls-gutter), ${window.innerWidth - trigger.current.getBoundingClientRect().right}px)`;
    };
    place();
    (panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? panel.current)?.focus();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [p.open]);
  const checking = p.job === 'check', finalizing = p.job === 'finalize';
  const hasReport = p.proxyEvents.length > 0 || !!p.hasCheckProblem;
  const output = p.finalizeEvents.map(event => event.type === 'step' ? `→ ${event.step}\n` : event.type === 'output' ? event.output : event.type === 'error' ? `${event.error}\n` : event.type === 'result' ? 'Finalize complete. Review git diff and commit when ready.\n' : '').join('');
  return <span class="ed-share-wrap">
    <button ref={trigger} type="button" class="ed-btn" data-testid="share-button" aria-label="Share" aria-haspopup="dialog" aria-expanded={p.open} aria-controls={p.open ? 'editor-share-panel' : undefined} onClick={() => p.onOpenChange(!p.open)}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 4-2M6 10l4 2" /><circle cx="4" cy="8" r="2" /><circle cx="12" cy="3" r="2" /><circle cx="12" cy="13" r="2" /></svg>Share</button>
    {p.open && <div ref={panel} id="editor-share-panel" class="ed-popover ed-share-panel" role="dialog" aria-labelledby="editor-share-title" tabIndex={-1} data-testid="share-panel"
      onKeyDown={event => { if (event.key === 'Tab') tabbing.current = true; }}
      onBlurCapture={event => {
        const target = event.relatedTarget as Node | null;
        if (tabbing.current && !event.currentTarget.contains(target) && !p.flyoutRef?.current?.contains(target)) p.onOpenChange(false);
        tabbing.current = false;
      }}>
      <h2 id="editor-share-title" class="ed-popover-title">Share</h2>
      <div class="ed-row ed-share-row">
        <span>Save</span><span class="ed-menu-kbd">Ctrl+S</span><button type="button" class="ed-btn" disabled={p.locked} onClick={() => p.onSave('manual')}>Save</button>
      </div>
      <section class="ed-row ed-share-row ed-share-job" data-testid="finalize-row">
        <div class="ed-share-action"><span>Finalize</span><button type="button" class="ed-btn" disabled={p.busy} onClick={p.onFinalize}>{finalizing && <Spinner />}Finalize</button></div>
        <p class="ed-field-hint" role="status" data-testid="lock-status">{p.lockStatus === 'unfinalized' ? 'Unfinalized changes on disk.' : p.lockStatus === 'current' ? 'Content locks current on disk.' : p.lockStatus === 'checking' ? 'Checking content status…' : 'Content status unavailable; retry after saving or running a job.'}</p>
        {p.lockOutput && <details><summary>Content status details</summary><pre>{p.lockOutput}</pre></details>}
        {p.finalizeError && <p role="alert">{p.finalizeError}</p>}
        {output && <details><summary>Finalize output</summary><pre aria-live="polite">{output}</pre></details>}
      </section>
      <section class="ed-row ed-share-row ed-share-job" data-testid="check-row">
        <div class="ed-share-action"><span>Check</span><span class="ed-share-actions">
          {checking && <button type="button" class="ed-btn" onClick={p.onCancel}>Cancel</button>}
          <button type="button" class="ed-btn" disabled={p.busy} onClick={p.onCheck}>{checking && <Spinner />}Check</button>
        </span></div>
        {hasReport && <button ref={p.detailsRef ?? null} type="button" class="ed-btn ed-btn-ghost ed-share-details" onClick={p.onDetails}>Details</button>}
      </section>
      <footer class="ed-share-version" data-testid="editor-version">{`Version ${p.savedDoc ? versionOf(p.savedDoc) : '0.0.0'}`}</footer>
    </div>}
  </span>;
}
