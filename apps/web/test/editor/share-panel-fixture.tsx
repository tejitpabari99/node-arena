import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { SharePanel } from '../../src/editor/SharePanel.js';
import { useDismiss } from '../../src/editor/useDismiss.js';
import { blankDocument } from '../../src/editor/document.js';
import type { EditorFinalizeEvent } from '../../../../tools/src/editor-finalize.js';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';
import '../../src/editor/style.css';

const report: EditorProxyEvent = { type: 'result', report: { id: 'na-test', seeds: 4, humanSeat: 0, idleWins: 0, wins: {}, totalWins: 3, runs: 4, truncated: 0, solvable: true, unsolved: null, deterministic: true, ok: true, errors: [], warnings: [], lock: { outcome: '', ticks: 0, finalHash: '' } } };
function Fixture() {
  const [open, setOpen] = useState(false), [job, setJob] = useState<'check' | 'finalize' | null>(null);
  const [calls, setCalls] = useState<string[]>([]), [saved, setSaved] = useState(false), [events, setEvents] = useState<EditorProxyEvent[]>([]), [finalizeEvents, setFinalizeEvents] = useState<EditorFinalizeEvent[]>([]);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null), flyoutRef = useRef<HTMLDivElement>(null), detailsRef = useRef<HTMLButtonElement>(null);
  const call = (name: string) => setCalls(values => [...values, name]);
  useDismiss({ enabled: flyoutOpen, refs: [flyoutRef, panelRef], triggerRef: detailsRef, onDismiss: () => setFlyoutOpen(false) });
  return <main class="ed-shell" style={{ display: 'block' }}>
    <header class="ed-top" style={{ height: '56px', boxSizing: 'border-box', justifyContent: 'flex-end', paddingRight: '56px' }}>
      <SharePanel open={open} onOpenChange={next => { setOpen(next); if (!next) setFlyoutOpen(false); }} savedDoc={saved ? { ...blankDocument('na-test', 'green', 'small'), editorVersion: '0.0.7' } : null}
        locked={job !== null} busy={job !== null} job={job} onSave={kind => call(kind)} onCheck={() => { call('check'); setJob('check'); }} onFinalize={() => { call('finalize'); setJob('finalize'); }} onCancel={() => { call('cancel'); setJob(null); }}
        onDetails={() => setFlyoutOpen(true)} flyoutOpen={flyoutOpen} panelRef={panelRef} flyoutRef={flyoutRef} detailsRef={detailsRef}
        proxyEvents={events} finalizeEvents={finalizeEvents} finalizeError="" lockStatus="current" lockOutput="Disk current" />
    </header>
    <section style={{ padding: '30px' }}>
      <button onClick={() => { setEvents([report]); setJob(null); }}>Finish check</button>
      <button onClick={() => { setFinalizeEvents([{ type: 'step', step: 'validate' }, { type: 'output', step: 'validate', output: 'validated\n'.repeat(80) }, { type: 'result' }]); setJob(null); }}>Finish finalize</button>
      <button onClick={() => setSaved(true)}>Saved doc</button><button data-testid="outside">Outside</button>
      <output data-testid="calls">{calls.join(',')}</output><output data-testid="job">{job ?? 'idle'}</output>
    </section>
    {flyoutOpen && <div ref={flyoutRef} tabIndex={-1} data-testid="fake-flyout" style={{ position: 'fixed', top: '60px', right: '384px' }}><button onClick={() => setFlyoutOpen(false)}>Close flyout</button></div>}
    <div data-testid="map-controls" class="canvas-controls" style={{ position: 'fixed', top: '68px' }}><button class="canvas-btn">+</button></div>
  </main>;
}
render(<Fixture />, document.getElementById('app')!);
