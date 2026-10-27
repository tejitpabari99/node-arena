import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { CheckFlyout } from '../../src/editor/CheckFlyout.js';
import { SharePanel } from '../../src/editor/SharePanel.js';
import { Shell } from '../../src/editor/Shell.js';
import { Toasts, type ToastNotice } from '../../src/editor/Toasts.js';
import { blankDocument } from '../../src/editor/document.js';
import { checkSolvable, EditorApiError } from '../../src/editor/api.js';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';
import type { ContentIssue } from '@node-arena/content';
import '../../src/editor/style.css';

const report: EditorProxyEvent = { type: 'result', report: { id: 'na-test', seeds: 4, humanSeat: 0, idleWins: 0, wins: { 'proxy-500': 3 }, totalWins: 3, runs: 4, truncated: 0, solvable: true, unsolved: null, deterministic: true, ok: true, errors: [], warnings: [], lock: { outcome: 'won', ticks: 120, finalHash: 'report-hash' } } };
const progress: EditorProxyEvent = { type: 'progress', run: { proxy: 'proxy-500', seed: 2, outcome: 'won', winner: 0, won: true, truncated: false, ticks: 120, finalHash: 'run-hash', rejected: 0 } };
let stream: ReadableStreamDefaultController<Uint8Array>;
let validationError = false;
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (input !== '/__editor/solvable') return fetchOriginal(input, init);
  if (validationError) return new Response(JSON.stringify({ error: 'Invalid level', issues: [{ file: 'level.json', pointer: '/players', message: 'Player required' }] }), { status: 400 });
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true }); } }));
};
const emit = (event: EditorProxyEvent) => stream.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
function Fixture() {
  const [open, setOpen] = useState(false), [flyout, setFlyout] = useState(false), [job, setJob] = useState<'check' | null>(null);
  const [events, setEvents] = useState<EditorProxyEvent[]>([]), [error, setError] = useState(''), [issues, setIssues] = useState<ContentIssue[]>([]), [notices, setNotices] = useState<ToastNotice[]>([]), [cancels, setCancels] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null), flyoutRef = useRef<HTMLDivElement>(null), detailsRef = useRef<HTMLButtonElement>(null), abort = useRef<AbortController | null>(null);
  const details = () => { setOpen(true); setFlyout(true); };
  const check = async () => {
    setJob('check'); setEvents([]); setError(''); setIssues([]); abort.current = new AbortController();
    try {
      await checkSolvable(blankDocument('na-test', 'green', 'small'), event => {
        setEvents(previous => [...previous, event]);
        if (event.type === 'result') setNotices([{ id: 'check-result', kind: 'success', message: `Check: AI won ${event.report.totalWins}/${event.report.runs}`, testId: 'check-toast', action: { label: 'Details', onClick: details } }]);
      }, abort.current.signal);
    } catch (failure) {
      const message = abort.current.signal.aborted ? 'Proxy check cancelled' : (failure as Error).message;
      setError(message); if (failure instanceof EditorApiError) setIssues(failure.issues);
      setNotices([{ id: 'check-error', kind: 'error', message, testId: 'check-toast' }]);
    } finally { setJob(null); }
  };
  const cancel = () => { setCancels(value => value + 1); abort.current?.abort(); };
  return <Shell counts={{ buildings: 0, obstacles: 0, players: 0 }} left={<>
    <button onClick={details}>Show check</button>
    <button onClick={() => emit(progress)}>Stream progress</button>
    <button onClick={() => { emit(report); stream.close(); }}>Finish check</button>
    <button onClick={() => { validationError = true; }}>Invalid next check</button>
    <button data-testid="outside">Outside</button>
    <output data-testid="job">{job ?? 'idle'}</output><output data-testid="cancels">{cancels}</output>
  </>} top={<><span style={{ flex: 1 }} /><SharePanel open={open} onOpenChange={value => { setOpen(value); if (!value) setFlyout(false); }} savedDoc={null} locked={job !== null} busy={job !== null} job={job} onSave={() => undefined} onCheck={() => void check()} onCancel={cancel} onFinalize={() => undefined} onDetails={details} proxyEvents={events} hasCheckProblem={issues.length > 0 || !!error} finalizeEvents={[]} finalizeError="" lockStatus="current" lockOutput="" flyoutOpen={flyout} panelRef={panelRef} flyoutRef={flyoutRef} detailsRef={detailsRef} /></>}>
    <div data-testid="map-controls" class="canvas-controls" style={{ position: 'absolute', top: '12px', right: '8px', zIndex: 3 }}><button class="canvas-btn">+</button></div>
    <CheckFlyout open={flyout} onOpenChange={setFlyout} panelRef={panelRef} flyoutRef={flyoutRef} detailsRef={detailsRef} job={job} onCancel={cancel} checkIssues={issues} issueLabel={issue => issue.pointer} checkError={error} proxyEvents={events} />
    <Toasts banners={[]} error="" onDismissError={() => undefined} notices={notices} onDismissNotice={id => setNotices(value => value.filter(notice => notice.id !== id))} />
  </Shell>;
}
render(<Fixture />, document.getElementById('app')!);
