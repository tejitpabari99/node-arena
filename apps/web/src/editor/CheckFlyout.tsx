import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ContentIssue } from '@node-arena/content';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';
import { useDismiss } from './useDismiss.js';
import { CHECK_LEGEND, formatIssue, formatRunLine, outcomeText, runTable, summaryLine, formatGameTime, uniqueRuns } from './check-format.js';

export interface CheckFlyoutProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  panelRef: RefObject<HTMLDivElement>;
  flyoutRef?: RefObject<HTMLDivElement>;
  detailsRef: RefObject<HTMLButtonElement>;
  job: 'check' | 'finalize' | null;
  onCancel(): void;
  checkIssues: ContentIssue[];
  issueLabel(issue: ContentIssue): string;
  checkError: string;
  proxyEvents: EditorProxyEvent[];
}

/** Controlled child of Share. Dismissal changes the surface only, never the job. */
export function CheckFlyout(p: CheckFlyoutProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const flyout = p.flyoutRef ?? ownRef;
  useDismiss({ enabled: p.open, refs: [flyout], triggerRef: p.detailsRef, onDismiss: () => p.onOpenChange(false) });
  useLayoutEffect(() => {
    if (!p.open) return;
    const place = () => {
      const panel = p.panelRef.current?.getBoundingClientRect(), element = flyout.current;
      if (!panel || !element) return;
      element.style.right = `${window.innerWidth - panel.left + 8}px`;
      element.style.top = `${panel.top}px`;
      element.style.width = `${Math.max(0, Math.min(400, panel.left - 16))}px`;
      element.style.maxHeight = `${Math.max(0, window.innerHeight - panel.top - 12)}px`;
    };
    place();
    (flyout.current?.querySelector<HTMLButtonElement>('button') ?? flyout.current)?.focus();
    const observer = new ResizeObserver(place);
    if (p.panelRef.current) observer.observe(p.panelRef.current);
    // Share repositions itself on the same resize event; re-place next frame so a stale panel rect is never kept.
    let frame = 0;
    const onResize = () => { place(); cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    window.addEventListener('resize', onResize);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, [p.open]);
  if (!p.open) return null;
  const report = p.proxyEvents.find(event => event.type === 'result');
  const checking = p.job === 'check';
  const runs = uniqueRuns(p.proxyEvents), table = runTable(runs), seat = report?.type === 'result' ? report.report.humanSeat : undefined;
  const evidence = p.proxyEvents.some(event => event.type === 'progress' || event.type === 'result');
  const close = () => { p.onOpenChange(false); p.detailsRef.current?.focus(); };
  return <div ref={flyout} class="ed-popover ed-check-flyout" role="dialog" aria-labelledby="editor-check-title" tabIndex={-1} data-testid="check-popover">
    <button type="button" class="ed-btn ed-popover-close" aria-label="Close check details" onClick={close}>×</button>
    <h2 id="editor-check-title" class="ed-popover-title">Check details</h2>
    {checking && <p role="status"><span class="ed-spinner" role="progressbar" aria-label="Working" /> Checking proxy matches… <button type="button" class="ed-btn" onClick={p.onCancel}>Cancel</button></p>}
    {p.checkError && <p role="alert">{p.checkError}</p>}
    {p.checkIssues.length > 0 && <ul role="alert" aria-label="Check errors">{p.checkIssues.map((issue, index) => { const f = formatIssue(issue, p.issueLabel(issue)); return <li key={index} data-item={issue.pointer} title={f.raw}>{f.text}</li>; })}</ul>}
    {evidence && <section aria-label="Proxy evidence" aria-live="polite">
      {report?.type === 'result' && <p role="status"><strong>{summaryLine(report.report)}</strong></p>}
      {runs.length > 0 && <table class="ed-check-table" aria-label="Test games"><thead><tr><th scope="col">Test</th>{table.seeds.map(seed => <th key={seed} scope="col">Start {seed}</th>)}</tr></thead>
        <tbody>{table.rows.map(row => <tr key={row.proxy}><th scope="row">{row.label}</th>{table.seeds.map(seed => { const run = row.cells.get(seed); return <td key={seed} title={run ? formatRunLine(run, seat) : undefined} data-won={run?.won ? 'true' : 'false'}>{run ? `${outcomeText(run, seat)} · ${formatGameTime(run.ticks)}` : '…'}</td>; })}</tr>)}</tbody></table>}
      <details class="ed-check-legend" open><summary>What am I looking at?</summary>
        <ul>{CHECK_LEGEND.kinds.map(line => <li key={line}>{line}</li>)}</ul>
      </details>
      <p>{CHECK_LEGEND.hint}</p>
      {report?.type === 'result' && <details><summary>Full proxy report</summary><pre>{JSON.stringify(report.report, null, 2)}</pre></details>}
    </section>}
    {!checking && !p.checkError && p.checkIssues.length === 0 && !evidence && <p>No check results. Run Check to see proxy evidence.</p>}
  </div>;
}
