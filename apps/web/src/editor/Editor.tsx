import { ContentLoadError, loadCatalog, type Catalog, type ContentIssue } from '@node-arena/content';
import { validateEditorDocument } from '../../../../tools/src/editor-validation.js';
import { contentFiles } from '../app/boot.js';
import { loadManifest } from '../manifest/load.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PlayOverlay } from './PlayOverlay.js';
import { LegacyPanel } from './LegacyPanel.js';
import { Shell } from './Shell.js';
import { TopBar } from './TopBar.js';
import { createSaveQueue, isDirty, stableStringify } from './save-core.js';
import { Viewport } from './Viewport.js';
import { EditorCtx, type EditorContext } from './EditorContext.js';
import type { EditorViewport, ViewportStatus } from './viewport-engine.js';
import type { Point, Selection } from './picking.js';
import type { EditorFinalizeEvent } from '../../../../tools/src/editor-finalize.js';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';
import { finalizeLevel, readFinalizeStatus, checkSolvable, EditorApiError, listLevels, readLevel, saveLevel, type LevelListing } from './api.js';
import { copySelection, createHistory, historyReducer, scriptRemovalMessages, type Clipboard, type DocHistory, type DocOp, type HistoryAction } from './model.js';
import { blankDocument, copyDocument, type LevelDoc, type SizePreset } from './document.js';

/** Owns immutable working-copy snapshots; forms and Play attach here. */
export function Editor() {
  const [choices, setChoices] = useState<{ themes: string[]; colors: string[] }>({ themes: [], colors: [] });
  const [levels, setLevels] = useState<LevelListing[]>([]);
  const [history, setHistory] = useState<DocHistory | null>(null);
  const doc = history?.present ?? null;
  const openSeq = useRef(0);
  const historyRef = useRef<DocHistory | null>(null);
  historyRef.current = history;
  // Last document known equal to disk. null for new blank/template/copy documents.
  const savedRef = useRef<LevelDoc | null>(null);
  const [savedDoc, setSavedDoc] = useState<LevelDoc | null>(null);
  function markSaved(next: LevelDoc | null) { savedRef.current = next; setSavedDoc(next); }
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<{ doc: LevelDoc; message: string } | null>(null);
  const [validation, setValidation] = useState<{ issues: ContentIssue[]; warnings: ContentIssue[] }>({ issues: [], warnings: [] });
  const [saving, setSaving] = useState(0);
  function setDoc(next: LevelDoc | null) {
    openSeq.current++; markSaved(null); setAttempted(false); setFailure(null); setValidation({ issues: [], warnings: [] });
    setHistory(next ? createHistory(next) : null);
  }
  function dispatch(action: HistoryAction) { if (busy) return; clearSave(); setHistory(state => state ? historyReducer(state, action) : state); }
  const [selection, setSelection] = useState<Selection[]>([]);
  const [clipboard, setClipboard] = useState<Clipboard>();
  const pasteCount = useRef(0);
  const viewport = useRef<EditorViewport>();
  const [viewportStatus, setViewportStatus] = useState<ViewportStatus>({ message: 'Loading preview…' });
  const [losStatus, setLosStatus] = useState('Choose two buildings to preview line of sight.');
  const [pointer, setPointer] = useState<Point | null>(null);
  useEffect(() => { setSelection([]); setClipboard(undefined); pasteCount.current = 0; }, [doc?.id]);
  // 40x30 buildable area around the bounds centre, fixed for the lifetime of an opened document.
  const area = useMemo(() => {
    const b = doc?.bounds ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    return { minX: cx - 20, maxX: cx + 20, minZ: cz - 15, maxZ: cz + 15 };
  }, [openSeq.current]);
  const [id, setId] = useState('');
  const [theme, setTheme] = useState('green');
  const [size, setSize] = useState<SizePreset>('medium');
  const [copyId, setCopyId] = useState('');
  const [reopenId, setReopenId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [issues, setIssues] = useState<ContentIssue[]>([]);
  const [finalizeEvents, setFinalizeEvents] = useState<EditorFinalizeEvent[]>([]);
  const [lockStatus, setLockStatus] = useState<'checking' | 'current' | 'unfinalized' | 'unknown'>('checking');
  const [lockOutput, setLockOutput] = useState('');
  const [proxyEvents, setProxyEvents] = useState<EditorProxyEvent[]>([]);
  const proxyAbort = useRef<AbortController | null>(null);
  useEffect(() => () => proxyAbort.current?.abort(), []);
  const proxyReport = proxyEvents.find(event => event.type === 'result');
  const catalog = useRef<Promise<Catalog> | undefined>(undefined);
  function clearSave() { setLockStatus('checking'); setFinalizeEvents([]); setProxyEvents([]); setIssues([]); }
  function getCatalog() {
    catalog.current ??= loadManifest().then(manifest => loadCatalog(contentFiles(), { themes: Object.keys(manifest.themes), colorKeys: Object.keys(manifest.palettes) }));
    return catalog.current;
  }
  async function runSave(source: 'manual' | 'auto') {
    const current = historyRef.current;
    if (!current) return;
    const sent = current.present, seq = openSeq.current;
    if (source === 'manual') { setBusy(true); setError(''); clearSave(); }
    setSaving(count => count + 1);
    try {
      const checked = validateEditorDocument(await getCatalog(), sent, sent.id);
      const result = await saveLevel(checked.level);
      if (openSeq.current !== seq) return;
      markSaved(result.level); setFailure(null); setValidation({ issues: [], warnings: result.warnings });
      // Swap in the normalized document only if nothing was edited during the request; no history entry.
      setHistory(state => state && state.present === sent ? { ...state, present: result.level } : state);
      const items = await listLevels(); setLevels(items); setReopenId(result.level.id);
    } catch (reason) {
      if (openSeq.current !== seq) return;
      setAttempted(true);
      if (reason instanceof ContentLoadError) { setValidation({ issues: reason.errors, warnings: [] }); setFailure({ doc: sent, message: '' }); }
      else if (reason instanceof EditorApiError && reason.issues.length) { setValidation({ issues: reason.issues, warnings: [] }); setFailure({ doc: sent, message: '' }); }
      else setFailure({ doc: sent, message: reason instanceof Error ? reason.message : String(reason) });
    } finally { setSaving(count => count - 1); if (source === 'manual') setBusy(false); }
  }
  const runSaveRef = useRef(runSave); runSaveRef.current = runSave;
  const saveQueue = useRef<ReturnType<typeof createSaveQueue<'manual' | 'auto'>>>();
  saveQueue.current ??= createSaveQueue<'manual' | 'auto'>(source => runSaveRef.current(source), () => !!historyRef.current && isDirty(historyRef.current.present, savedRef.current));
  const doSave = (source: 'manual' | 'auto' = 'manual') => saveQueue.current!.enqueue(source);
  // Client-side validation, debounced; chip only surfaces it once armed (see below).
  useEffect(() => {
    if (!doc) return;
    let active = true;
    const timer = setTimeout(() => {
      void getCatalog().then(cat => {
        let next: { issues: ContentIssue[]; warnings: ContentIssue[] };
        try { next = { issues: [], warnings: validateEditorDocument(cat, doc, doc.id).warnings }; }
        catch (reason) { next = { issues: reason instanceof ContentLoadError ? reason.errors : [], warnings: [] }; }
        if (active) setValidation(next);
      }).catch(() => undefined);
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [doc]);
  const dirty = !!doc && isDirty(doc, savedDoc);
  const armed = savedDoc !== null || attempted;
  const failureActive = !!failure && !!doc && (failure.doc === doc || stableStringify(failure.doc) === stableStringify(doc));
  const saveMessage = failureActive ? failure!.message : '';
  const saveState: EditorContext['saveState'] = saving > 0 ? 'saving' : (armed && validation.issues.length > 0) || saveMessage ? 'error' : dirty ? 'unsaved' : 'saved';
  // Each document/save/job transition invalidates old responses. This check never disables editing.
  useEffect(() => {
    let active = true;
    setLockStatus('checking');
    if (!doc || busy) return;
    const timer = setTimeout(() => {
      void readFinalizeStatus().then(status => {
        if (active) { setLockStatus(status.unfinalized ? 'unfinalized' : 'current'); setLockOutput(status.output); }
      }).catch(reason => { if (active) { setLockStatus('unknown'); setLockOutput(String(reason)); } });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [doc, busy]);
  async function finalize() {
    if (!doc || dirty) return;
    setBusy(true); setError(''); setFinalizeEvents([]); setLockStatus('checking');
    try { await finalizeLevel(doc, event => setFinalizeEvents(events => [...events, event])); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function solvable() {
    if (!doc) return;
    const controller = new AbortController(); proxyAbort.current = controller;
    setBusy(true); setError(''); setIssues([]); setProxyEvents([]);
    try { await checkSolvable(doc, event => setProxyEvents(events => [...events, event]), controller.signal); }
    catch (reason) {
      if (controller.signal.aborted) setError('Proxy check cancelled.');
      else if (reason instanceof EditorApiError && reason.issues.length) setIssues(reason.issues);
      else setError(reason instanceof Error ? reason.message : String(reason));
    } finally { proxyAbort.current = null; setBusy(false); }
  }
  function issueLabel(issue: ContentIssue) {
    const match = /^\/(buildings|elements|players)\/(\d+)/.exec(issue.pointer);
    if (!match || !doc) return issue.pointer || 'Level';
    const item = doc[match[1] as 'buildings' | 'elements' | 'players'][Number(match[2])];
    return `${match[1]} ${item?.id ?? match[2]} (${issue.pointer})`;
  }
  useEffect(() => {
    void loadManifest().then(manifest => setChoices({ themes: Object.keys(manifest.themes), colors: Object.keys(manifest.palettes) })).catch(reason => setError(String(reason)));
    void listLevels().then(async items => {
      setLevels(items); setCopyId(items[0]?.id ?? '');
      setReopenId(items.find(item => item.id.startsWith('na-'))?.id ?? '');
      const params = new URLSearchParams(window.location.search), template = params.get('template');
      if (template !== null) {
        // Create-custom flow: copy a template into a new unique custom level; never reuses the template id.
        if (!items.some(item => item.id === template)) throw new Error('Unknown template requested. Choose a level below.');
        let n = 1; while (items.some(item => item.id === `na-custom-${n}`)) n++;
        const copy = copyDocument(await readLevel(template), `na-custom-${n}`);
        copy.name = `Custom ${n}`;
        setCopyId(template); setDoc(copy); return;
      }
      const requested = params.get('level');
      if (requested === null) return;
      // Only server-listed ids reach the API. Imported levels always require a new copy id.
      if (!items.some(item => item.id === requested)) throw new Error('Unknown level requested. Choose a level below.');
      setCopyId(requested);
      if (requested.startsWith('na-')) {
        setReopenId(requested); const loaded = await readLevel(requested); setDoc(loaded); markSaved(loaded);
      }
    }).catch(reason => setError(String(reason))).finally(() => setLoading(false));
  }, []);
  async function open(copy: boolean) {
    setBusy(true); setError(''); clearSave();
    try {
      const source = await readLevel(copy ? copyId : reopenId);
      if (copy && levels.some(level => level.id === id)) throw new Error('Choose a new id; that level already exists.');
      const next = copy ? copyDocument(source, id) : source; setDoc(next); if (!copy) markSaved(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  function blank() {
    setError(''); clearSave();
    try {
      if (levels.some(level => level.id === id)) throw new Error('Choose a new id; that level already exists.');
      setDoc(blankDocument(id, theme, size));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  useEffect(() => { (window as unknown as { __editorSave?: typeof doSave }).__editorSave = doSave; });
  const ctx: EditorContext | null = doc && history ? {
    doc, history, dispatch, area, selection, clipboard, viewport, locked: busy, themes: choices.themes, colors: choices.colors, viewportStatus, losStatus,
    edit: (op: DocOp) => dispatch({ type: 'edit', op, area }),
    deleteSelection() { if (selection.length === 1) dispatch({ type: 'edit', op: { type: 'delete', target: selection[0]! }, area }); },
    select: next => { viewport.current?.select(next); },
    copy() { setClipboard(copySelection(doc, selection)); pasteCount.current = 0; },
    paste() { if (!clipboard) return; pasteCount.current++; dispatch({ type: 'edit', op: { type: 'paste', clipboard, offset: { x: .5 * pasteCount.current, z: .5 * pasteCount.current } }, area }); },
    save: doSave, saveState, dirty,
  } : null;
  const alerts = <>
    {error && <p role="alert">{error}</p>}
    {history && scriptRemovalMessages(history).map(message => <p key={message} role="status" class="editor-script-banner" data-testid="script-removal-banner">{message}</p>)}
    {issues.length > 0 && <ul role="alert" aria-label="Check errors">{issues.map((issue, index) => <li key={index} data-item={issue.pointer}>{issueLabel(issue)}: {issue.message}</li>)}</ul>}
    <p role="status" data-testid="finalize-status">{dirty ? 'Unsaved changes. Save before Finalize. ' : ''}{lockStatus === 'unfinalized' ? 'Unfinalized changes on disk.' : lockStatus === 'current' ? 'Content locks current on disk.' : lockStatus === 'checking' ? 'Content status stale; checking…' : 'Content status unavailable; retry after saving or running a job.'}</p>
    {lockOutput && <details><summary>Content status details</summary><pre>{lockOutput}</pre></details>}
    {finalizeEvents.length > 0 && <section aria-label="Finalize output" aria-live="polite"><pre>{finalizeEvents.map(event => event.type === 'step' ? `→ ${event.step}\n` : event.type === 'output' ? event.output : event.type === 'error' ? `${event.error}\n` : event.type === 'result' ? 'Finalize complete. Review git diff and commit when ready.\n' : '').join('')}</pre></section>}
    {proxyEvents.length > 0 && <section aria-label="Proxy evidence" aria-live="polite">
      <p>Evidence only. Proxy wins do not prove solvability; no wins do not prove impossibility. Owner play and sign-off remain required.</p>
      <p role="status">{proxyReport?.type === 'result' ? `Proxy wins: ${proxyReport.report.totalWins}/${proxyReport.report.runs}. Validation: ${proxyReport.report.ok ? 'passed' : 'failed'}.` : proxyAbort.current ? 'Checking proxy matches…' : 'Proxy check stopped.'}</p>
      <pre>{proxyEvents.map(event => event.type === 'progress' ? `${event.run.proxy} seed ${event.run.seed}: ${event.run.outcome}, winner ${event.run.winner ?? 'none'}, ${event.run.ticks} ticks` : event.type === 'error' ? event.error : '').filter(Boolean).join('\n')}</pre>
      {proxyReport?.type === 'result' && <details><summary>Full proxy report</summary><pre>{JSON.stringify(proxyReport.report, null, 2)}</pre></details>}
    </section>}
  </>;
  const toolbar = doc && ctx && <EditorCtx.Provider value={ctx}><TopBar issues={validation.issues} warnings={validation.warnings} saveMessage={saveMessage} issueLabel={issueLabel} onName={() => { setDoc(null); setId(''); setError(''); clearSave(); }} onPlay={() => setPlaying(true)}
    extras={<><button disabled={busy} onClick={() => void solvable()}>Solvable?</button><button disabled={busy || dirty} onClick={() => void finalize()}>Finalize</button>{proxyAbort.current && <button onClick={() => proxyAbort.current?.abort()}>Cancel check</button>}</>} /></EditorCtx.Provider>;
  return <>{doc && ctx ? <Shell inert={playing} counts={{ buildings: doc.buildings.length, obstacles: doc.elements.length, players: doc.players.length }} top={toolbar} left={<>{alerts}<EditorCtx.Provider value={ctx}><LegacyPanel pointer={pointer} /></EditorCtx.Provider></>}>
    <EditorCtx.Provider value={ctx}><Viewport onStatus={setViewportStatus} onLos={setLosStatus} onSelection={setSelection} onPointer={setPointer} /></EditorCtx.Provider>
  </Shell> : <main class="editor-shell ed-start" inert={playing}>
    <header><h1>Level editor</h1><a href="/">Game</a></header>
    {error && <p role="alert">{error}</p>}
      <p>Create a blank level, copy an existing level, or reopen a custom level.</p>
      <label>New level id<input value={id} onInput={event => setId(event.currentTarget.value)} placeholder="na-my-level" /></label>
      <p class="editor-hint">Blank levels and copies need a new na- id. Copies drop imported source metadata.</p>
      <div class="editor-start-grid">
        <section><h2>Blank</h2>
          <label>Theme<select value={theme} onChange={event => setTheme(event.currentTarget.value)}><option value="green">Green</option><option value="snow">Snow</option></select></label>
          <label>Size<select value={size} onChange={event => setSize(event.currentTarget.value as SizePreset)}><option value="small">Small (12 × 12)</option><option value="medium">Medium (20 × 20)</option><option value="large">Large (30 × 30)</option></select></label>
          <p>2 players: blue human, red AI</p><button disabled={loading || busy} onClick={blank}>Create blank</button>
        </section>
        <section><h2>Copy of any level</h2>
          <label>Copy level<select value={copyId} onChange={event => setCopyId(event.currentTarget.value)}>{levels.map(level => <option key={level.id} value={level.id}>{level.name} ({level.id})</option>)}</select></label>
          <button disabled={loading || busy || !copyId} onClick={() => void open(true)}>Copy level</button>
        </section>
        <section><h2>Reopen custom level</h2>
          <label>Reopen level<select value={reopenId} onChange={event => setReopenId(event.currentTarget.value)}>{levels.filter(level => level.id.startsWith('na-')).map(level => <option key={level.id} value={level.id}>{level.name} ({level.id})</option>)}</select></label>
          {!loading && !reopenId && <p>No custom levels yet.</p>}
          <button disabled={loading || busy || !reopenId} onClick={() => void open(false)}>Reopen level</button>
        </section>
      </div>
      {loading && <p role="status">Loading levels…</p>}
  </main>}{playing && doc && <PlayOverlay doc={doc} onExit={() => setPlaying(false)} />}</>;
}
