import { ContentLoadError, loadCatalog, type Catalog, type ContentIssue } from '@node-arena/content';
import { validateEditorDocument } from '../../../../tools/src/editor-validation.js';
import { contentFiles } from '../app/boot.js';
import { loadManifest } from '../manifest/load.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PlayOverlay } from './PlayOverlay.js';
import { LeftPanel } from './LeftPanel.js';
import { Toasts } from './Toasts.js';
import { Shell } from './Shell.js';
import { TopBar } from './TopBar.js';
import { JobPopovers, type JobPopover } from './JobPopovers.js';
import { createSaveQueue, isDirty, stableStringify } from './save-core.js';
import { useAutosave } from './useAutosave.js';
import { Viewport } from './Viewport.js';
import { EditorCtx, type EditorContext } from './EditorContext.js';
import type { EditorViewport, ViewportStatus } from './viewport-engine.js';
import type { Point, Selection } from './picking.js';
import type { EditorFinalizeEvent } from '../../../../tools/src/editor-finalize.js';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';
import { finalizeLevel, readFinalizeStatus, checkSolvable, EditorApiError, listLevels, saveLevel } from './api.js';
import { copySelection, createHistory, historyReducer, scriptRemovalMessages, type Clipboard, type DocHistory, type DocOp, type HistoryAction } from './model.js';
import type { LevelDoc } from './document.js';
import { FileModal } from './FileModal.js';
import { useInitialLoad } from './useInitialLoad.js';

/** Owns immutable working-copy snapshots; forms and Play attach here. */
export function Editor() {
  const [choices, setChoices] = useState<{ themes: string[]; colors: string[]; palettes: Record<string, string> }>({ themes: [], colors: [], palettes: {} });
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
  // Armed by a successful manual Save of the current doc; reset whenever the doc is replaced.
  const armedRef = useRef(false);
  function setDoc(next: LevelDoc | null) {
    openSeq.current++; armedRef.current = false; markSaved(null); setAttempted(false); setFailure(null); setValidation({ issues: [], warnings: [] });
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
  const [error, setError] = useState('');
  const [manualFailures, setManualFailures] = useState(0);
  const [fileOpen, setFileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [issues, setIssues] = useState<ContentIssue[]>([]);
  const [finalizeEvents, setFinalizeEvents] = useState<EditorFinalizeEvent[]>([]);
  const [lockStatus, setLockStatus] = useState<'checking' | 'current' | 'unfinalized' | 'unknown'>('checking');
  const [lockOutput, setLockOutput] = useState('');
  const [proxyEvents, setProxyEvents] = useState<EditorProxyEvent[]>([]);
  const [job, setJob] = useState<'check' | 'finalize' | null>(null);
  const [popover, setPopover] = useState<JobPopover>(null);
  const [checkError, setCheckError] = useState('');
  const [finalizeError, setFinalizeError] = useState('');
  const proxyAbort = useRef<AbortController | null>(null);
  useEffect(() => () => proxyAbort.current?.abort(), []);
  const proxyReport = proxyEvents.find(event => event.type === 'result');
  const catalog = useRef<Promise<Catalog> | undefined>(undefined);
  function clearSave() { setLockStatus('checking'); setFinalizeEvents([]); setProxyEvents([]); setIssues([]); setCheckError(''); setFinalizeError(''); }
  function getCatalog() {
    catalog.current ??= loadManifest().then(manifest => loadCatalog(contentFiles(), { themes: Object.keys(manifest.themes), colorKeys: Object.keys(manifest.palettes) }));
    return catalog.current;
  }
  async function runSave(source: 'manual' | 'auto') {
    const current = historyRef.current;
    if (!current) return;
    const sent = current.present, seq = openSeq.current;
    if (source === 'manual') { setBusy(true); clearSave(); }
    setSaving(count => count + 1);
    try {
      const checked = validateEditorDocument(await getCatalog(), sent, sent.id);
      const result = await saveLevel(checked.level);
      if (openSeq.current !== seq) return;
      markSaved(result.level); setFailure(null); if (source === 'manual') armedRef.current = true; setValidation({ issues: [], warnings: result.warnings });
      // Swap in the normalized document only if nothing was edited during the request; no history entry.
      setHistory(state => state && state.present === sent ? { ...state, present: result.level } : state);
      setLevels(await listLevels());
    } catch (reason) {
      if (openSeq.current !== seq) return;
      // 409 = another job holds the gate: transient, the next tick retries.
      if (source === 'auto' && reason instanceof EditorApiError && reason.status === 409) return;
      setAttempted(true); if (source === 'manual') setManualFailures(count => count + 1);
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
  const autosaveRef = useRef({ armed: false, dirty: false, valid: false, jobRunning: false, saveInFlight: false, failedThisRevision: false });
  autosaveRef.current = { armed: armedRef.current, dirty, valid: validation.issues.length === 0, jobRunning: busy, saveInFlight: !!saveQueue.current?.busy, failedThisRevision: failureActive };
  useAutosave(() => ({ ...autosaveRef.current, armed: armedRef.current, saveInFlight: !!saveQueue.current?.busy }), () => void doSave('auto'));
  // Leave-page guard only while there is something unsaved.
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const saveState: EditorContext['saveState'] = saving > 0 ? 'saving' : (armed && validation.issues.length > 0) || saveMessage ? 'error' : dirty ? 'unsaved' : 'saved';
  // Lock status is fetched lazily: when the Finalize popover opens and after a job finishes while it is open.
  useEffect(() => {
    if (popover !== 'finalize' || busy) return;
    let active = true;
    setLockStatus('checking');
    void readFinalizeStatus().then(status => {
      if (active) { setLockStatus(status.unfinalized ? 'unfinalized' : 'current'); setLockOutput(status.output); }
    }).catch(reason => { if (active) { setLockStatus('unknown'); setLockOutput(String(reason)); } });
    return () => { active = false; };
  }, [popover, busy]);
  async function finalize() {
    const sent = savedRef.current;
    if (!doc || dirty || !sent || busy) return;
    setBusy(true); setJob('finalize'); setPopover('finalize'); setError(''); setFinalizeError(''); setFinalizeEvents([]); setLockStatus('checking');
    try { await finalizeLevel(sent, event => setFinalizeEvents(events => [...events, event])); }
    catch (reason) { setFinalizeError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setJob(null); setBusy(false); }
  }
  async function solvable() {
    if (!doc || busy) return;
    const controller = new AbortController(); proxyAbort.current = controller;
    setBusy(true); setJob('check'); setPopover('check'); setError(''); setCheckError(''); setIssues([]); setProxyEvents([]);
    try { await checkSolvable(doc, event => setProxyEvents(events => [...events, event]), controller.signal); }
    catch (reason) {
      if (controller.signal.aborted) setCheckError('Proxy check cancelled.');
      else if (reason instanceof EditorApiError && reason.issues.length) setIssues(reason.issues);
      else setCheckError(reason instanceof Error ? reason.message : String(reason));
    } finally { proxyAbort.current = null; setJob(null); setBusy(false); }
  }
  function issueLabel(issue: ContentIssue) {
    const match = /^\/(buildings|elements|players)\/(\d+)/.exec(issue.pointer);
    if (!match || !doc) return issue.pointer || 'Level';
    const item = doc[match[1] as 'buildings' | 'elements' | 'players'][Number(match[2])];
    return `${match[1]} ${item?.id ?? match[2]} (${issue.pointer})`;
  }
  useEffect(() => {
    void loadManifest().then(manifest => setChoices({ themes: Object.keys(manifest.themes), colors: Object.keys(manifest.palettes), palettes: manifest.palettes as Record<string, string> })).catch(reason => setError(String(reason)));
  }, []);
  /** Replaces the working document: fresh history, selection and saved baseline. */
  function replaceDoc(next: LevelDoc, saved: boolean) {
    setDoc(next); if (saved) markSaved(next);
    setSelection([]); clearSave(); setFileOpen(false);
  }
  const { levels, setLevels, loading, error: startError, copyHint } = useInitialLoad(replaceDoc);
  useEffect(() => { (window as unknown as { __editorSave?: typeof doSave }).__editorSave = doSave; });
  const ctx: EditorContext | null = doc && history ? {
    doc, history, dispatch, area, selection, clipboard, viewport, locked: busy, themes: choices.themes, colors: choices.colors, palettes: choices.palettes, viewportStatus, losStatus,
    edit: (op: DocOp) => dispatch({ type: 'edit', op, area }),
    deleteSelection() { if (selection.length) dispatch({ type: 'edit', op: { type: 'delete-many', targets: selection }, area }); },
    select: next => { viewport.current?.select(next); },
    copy() { setClipboard(copySelection(doc, selection)); pasteCount.current = 0; },
    paste() { if (!clipboard) return; pasteCount.current++; dispatch({ type: 'edit', op: { type: 'paste', clipboard, offset: { x: .5 * pasteCount.current, z: .5 * pasteCount.current } }, area }); },
    save: doSave, saveState, dirty,
  } : null;
  const toolbar = doc && ctx && <EditorCtx.Provider value={ctx}><TopBar failureSeq={manualFailures} issues={validation.issues} warnings={validation.warnings} saveMessage={saveMessage} issueLabel={issueLabel} onName={() => setFileOpen(true)} onPlay={() => setPlaying(true)}
    extras={<JobPopovers open={popover} setOpen={setPopover} job={job} busy={busy} dirty={dirty} onCheck={() => void solvable()} onCancel={() => proxyAbort.current?.abort()} onFinalize={() => void finalize()} checkIssues={issues} issueLabel={issueLabel} checkError={checkError} proxyEvents={proxyEvents} finalizeEvents={finalizeEvents} finalizeError={finalizeError} lockStatus={lockStatus} lockOutput={lockOutput} />} /></EditorCtx.Provider>;
  return <>{doc && ctx ? <Shell inert={playing} counts={{ buildings: doc.buildings.length, obstacles: doc.elements.length, players: doc.players.length }} top={toolbar} left={<EditorCtx.Provider value={ctx}><LeftPanel pointer={pointer} /></EditorCtx.Provider>}>
    <Toasts banners={history ? scriptRemovalMessages(history) : []} error={error} onDismissError={() => setError('')} />
    <EditorCtx.Provider value={ctx}><Viewport onStatus={setViewportStatus} onLos={setLosStatus} onSelection={setSelection} onPointer={setPointer} /></EditorCtx.Provider>
  </Shell> : <FileModal standalone levels={levels} dirty={false} loading={loading} startError={startError} copyHint={copyHint} onClose={() => undefined} onReplace={replaceDoc} />}
  {doc && fileOpen && <FileModal standalone={false} levels={levels} dirty={dirty} loading={loading} startError="" copyHint={copyHint} currentId={doc.id} onClose={() => setFileOpen(false)} onReplace={replaceDoc} />}{playing && doc && <PlayOverlay doc={doc} onExit={() => setPlaying(false)} />}</>;
}
