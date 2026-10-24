import { useEffect, useRef, useState } from 'preact/hooks';
import type { ContentIssue } from '@node-arena/content';
import type { EditorFinalizeEvent } from '../../../../tools/src/editor-finalize.js';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';

export type JobPopover = 'check' | 'finalize' | null;
export interface JobPopoversProps {
  open: JobPopover;
  setOpen(next: JobPopover): void;
  /** Which job is running, if any. */
  job: 'check' | 'finalize' | null;
  busy: boolean;
  dirty: boolean;
  onCheck(): void;
  onCancel(): void;
  onFinalize(): void;
  checkIssues: ContentIssue[];
  issueLabel(issue: ContentIssue): string;
  checkError: string;
  proxyEvents: EditorProxyEvent[];
  finalizeEvents: EditorFinalizeEvent[];
  finalizeError: string;
  lockStatus: 'checking' | 'current' | 'unfinalized' | 'unknown';
  lockOutput: string;
}

function Spinner() { return <span class="ed-spinner" role="progressbar" aria-label="Working" />; }

/** Check and Finalize buttons with their popovers; closing a popover never cancels a job. */
export function JobPopovers(p: JobPopoversProps) {
  const checkWrap = useRef<HTMLSpanElement>(null), finalizeWrap = useRef<HTMLSpanElement>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!p.open) return;
    const wrap = (p.open === 'check' ? checkWrap : finalizeWrap).current;
    if (wrap) setLeft(Math.max(8, Math.min(wrap.getBoundingClientRect().left, window.innerWidth - 440)));
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!checkWrap.current?.contains(target) && !finalizeWrap.current?.contains(target)) p.setOpen(null);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') p.setOpen(null); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [p.open]);
  const report = p.proxyEvents.find(event => event.type === 'result');
  const checking = p.job === 'check', finalizing = p.job === 'finalize';
  const toggle = (which: 'check' | 'finalize') => p.setOpen(p.open === which ? null : which);
  return <>
    <span ref={checkWrap} class="ed-chip-wrap">
      <button class="ed-btn" disabled={p.busy} onClick={p.onCheck}>{checking && <Spinner />}Check</button>
      <button class="ed-btn ed-caret" aria-label="Check details" aria-expanded={p.open === 'check'} onClick={() => toggle('check')}>▾</button>
      {p.open === 'check' && <div class="ed-popover ed-job-popover" data-testid="check-popover" style={{ left: `${left}px` }}>
        <button class="ed-btn ed-popover-close" aria-label="Close" onClick={() => p.setOpen(null)}>×</button>
        {checking && <p role="status"><Spinner /> Checking proxy matches… <button class="ed-btn" onClick={p.onCancel}>Cancel</button></p>}
        {p.checkError && <p role="alert">{p.checkError}</p>}
        {p.checkIssues.length > 0 && <ul role="alert" aria-label="Check errors">{p.checkIssues.map((issue, index) => <li key={index} data-item={issue.pointer}>{p.issueLabel(issue)}: {issue.message}</li>)}</ul>}
        {p.proxyEvents.length > 0 && <section aria-label="Proxy evidence" aria-live="polite">
          <p>Evidence only. Proxy wins do not prove solvability; no wins do not prove impossibility. Owner play and sign-off remain required.</p>
          {report?.type === 'result' && <p role="status">{`Proxy wins: ${report.report.totalWins}/${report.report.runs}. Validation: ${report.report.ok ? 'passed' : 'failed'}.`}</p>}
          <pre>{p.proxyEvents.map(event => event.type === 'progress' ? `${event.run.proxy} seed ${event.run.seed}: ${event.run.outcome}, winner ${event.run.winner ?? 'none'}, ${event.run.ticks} ticks` : event.type === 'error' ? event.error : '').filter(Boolean).join('\n')}</pre>
          {report?.type === 'result' && <details><summary>Full proxy report</summary><pre>{JSON.stringify(report.report, null, 2)}</pre></details>}
        </section>}
        {!checking && !p.checkError && p.checkIssues.length === 0 && p.proxyEvents.length === 0 && <p>No check results. Run Check to see proxy evidence.</p>}
      </div>}
    </span>
    <span ref={finalizeWrap} class="ed-chip-wrap">
      <button class="ed-btn" disabled={p.busy || p.dirty} onClick={p.onFinalize}>{finalizing && <Spinner />}Finalize</button>
      <button class="ed-btn ed-caret" aria-label="Finalize details" aria-expanded={p.open === 'finalize'} onClick={() => toggle('finalize')}>▾</button>
      {p.open === 'finalize' && <div class="ed-popover ed-job-popover" data-testid="finalize-popover" style={{ left: `${left}px` }}>
        <button class="ed-btn ed-popover-close" aria-label="Close" onClick={() => p.setOpen(null)}>×</button>
        {p.dirty && <p>Unsaved changes. Save before Finalize.</p>}
        <p role="status" data-testid="lock-status">{p.lockStatus === 'unfinalized' ? 'Unfinalized changes on disk.' : p.lockStatus === 'current' ? 'Content locks current on disk.' : p.lockStatus === 'checking' ? 'Checking content status…' : 'Content status unavailable; retry after saving or running a job.'}</p>
        {p.lockOutput && <details><summary>Content status details</summary><pre>{p.lockOutput}</pre></details>}
        {p.finalizeError && <p role="alert">{p.finalizeError}</p>}
        {p.finalizeEvents.length > 0 && <section aria-label="Finalize output" aria-live="polite"><pre>{p.finalizeEvents.map(event => event.type === 'step' ? `→ ${event.step}\n` : event.type === 'output' ? event.output : event.type === 'error' ? `${event.error}\n` : event.type === 'result' ? 'Finalize complete. Review git diff and commit when ready.\n' : '').join('')}</pre></section>}
      </div>}
    </span>
  </>;
}
