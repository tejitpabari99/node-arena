import { ContentLoadError, loadCatalog, type Catalog, type ContentIssue } from '@node-arena/content';
import { validateEditorDocument } from '../../../../tools/src/editor-validation.js';
import { contentFiles } from '../app/boot.js';
import { loadManifest } from '../manifest/load.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PlayOverlay } from './PlayOverlay.js';
import { LeftPanel } from './LeftPanel.js';
import { Toasts, type ToastNotice } from './Toasts.js';
import { Shell } from './Shell.js';
import { TopBar } from './TopBar.js';
import { SharePanel } from './SharePanel.js';
import { CheckFlyout } from './CheckFlyout.js';
import { CreateDialog } from './CreateDialog.js';
import { OpenDialog } from './OpenDialog.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { StartScreen } from './StartScreen.js';
import { createSaveQueue, isDirty, stableStringify } from './save-core.js';
import { useAutosave } from './useAutosave.js';
import { Viewport } from './Viewport.js';
import { EditorCtx, type EditorContext } from './EditorContext.js';
import type { EditorViewport, ViewportStatus } from './viewport-engine.js';
import type { Selection } from './picking.js';
import type { EditorFinalizeEvent } from '../../../../tools/src/editor-finalize.js';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';
import { finalizeLevel, readFinalizeStatus, checkSolvable, EditorApiError, duplicateLevel, listLevels, saveLevel } from './api.js';
import { buildableArea, copySelection, createHistory, historyReducer, scriptRemovalMessages, type Clipboard, type DocHistory, type DocOp, type HistoryAction } from './model.js';
import type { LevelDoc } from './document.js';
import { useInitialLoad } from './useInitialLoad.js';
import { confirmAction } from './confirm-flow.js';

type PendingAction = { action(savedResult?: LevelDoc): void | Promise<void>; kind: 'replace' | 'back' | 'duplicate' };
const closedUi = { menu: false, share: false, flyout: false, dialog: null as 'create' | 'open' | null, confirm: null as PendingAction | null };

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
  function dispatch(action: HistoryAction) { if (action.type !== 'end-edit' && busy) return; if (action.type !== 'end-edit') clearSave(); setHistory(state => state ? historyReducer(state, action) : state); }
  const [selection, setSelection] = useState<Selection[]>([]);
  const [clipboard, setClipboard] = useState<Clipboard>();
  const pasteCount = useRef(0);
  const viewport = useRef<EditorViewport>();
  const [viewportStatus, setViewportStatus] = useState<ViewportStatus>({ message: 'Loading preview…' });
  const [losStatus, setLosStatus] = useState('Choose two buildings to preview line of sight.');
  useEffect(() => { setSelection([]); setClipboard(undefined); pasteCount.current = 0; }, [doc?.id]);
  // 40x30 buildable area around the bounds centre, fixed for the lifetime of an opened document.
  const area = useMemo(() => buildableArea(doc?.bounds ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }), [openSeq.current]);
  const [error, setError] = useState('');
  const [manualFailures, setManualFailures] = useState(0);
  const [ui, setUi] = useState(closedUi);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const bypassUnload = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null), flyoutRef = useRef<HTMLDivElement>(null), detailsRef = useRef<HTMLButtonElement>(null);
  const [notices, setNotices] = useState<ToastNotice[]>([]);
  const noticeSeq = useRef(0);
  function notice(value: Omit<ToastNotice, 'id'>) { setNotices(items => [...items, { ...value, id: String(++noticeSeq.current) }]); }
  function showDetails() { setUi(state => ({ ...state, menu: false, share: true, flyout: true })); }
  function shareOpen(share: boolean) { setUi(state => ({ ...state, menu: false, share, flyout: share && state.flyout })); }
  const [busy, setBusy] = useState(false);
  // Keep the job lock across the queued save and stream, including save finally blocks.
  const finalizingRef = useRef(false);
  const saveOutcome = useRef<{ seq: number; ok: boolean } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [issues, setIssues] = useState<ContentIssue[]>([]);
  const [finalizeEvents, setFinalizeEvents] = useState<EditorFinalizeEvent[]>([]);
  const [lockStatus, setLockStatus] = useState<'checking' | 'current' | 'unfinalized' | 'unknown'>('checking');
  const [lockOutput, setLockOutput] = useState('');
  const [proxyEvents, setProxyEvents] = useState<EditorProxyEvent[]>([]);
  const [job, setJob] = useState<'check' | 'finalize' | null>(null);
  const [checkError, setCheckError] = useState('');
  const [finalizeError, setFinalizeError] = useState('');
  const proxyAbort = useRef<AbortController | null>(null);
  useEffect(() => () => proxyAbort.current?.abort(), []);
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
      setHistory(state => state && state.present === sent ? { ...state, present: result.level, merge: undefined } : state);
      saveOutcome.current = { seq, ok: true };
      // A list refresh failure after a successful write must not flip the outcome.
      try { setLevels(await listLevels()); } catch { /* list refreshes on next open */ }
    } catch (reason) {
      if (openSeq.current !== seq) return;
      saveOutcome.current = { seq, ok: false };
      // 409 = another job holds the gate: transient, the next tick retries.
      if (source === 'auto' && reason instanceof EditorApiError && reason.status === 409) return;
      setAttempted(true); if (source === 'manual') setManualFailures(count => count + 1);
      if (reason instanceof ContentLoadError) { setValidation({ issues: reason.errors, warnings: [] }); setFailure({ doc: sent, message: '' }); }
      else if (reason instanceof EditorApiError && reason.issues.length) { setValidation({ issues: reason.issues, warnings: [] }); setFailure({ doc: sent, message: '' }); }
      else setFailure({ doc: sent, message: reason instanceof Error ? reason.message : String(reason) });
    } finally { setSaving(count => count - 1); if (source === 'manual' && !finalizingRef.current) setBusy(false); }
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
    const guard = (event: BeforeUnloadEvent) => { if (!bypassUnload.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const saveState: EditorContext['saveState'] = saving > 0 ? 'saving' : (armed && validation.issues.length > 0) || saveMessage ? 'error' : dirty ? 'unsaved' : 'saved';
  // Fetch lazily when Share opens and refresh after a job finishes.
  useEffect(() => {
    if (!ui.share || busy) return;
    let active = true;
    setLockStatus('checking');
    void readFinalizeStatus().then(status => {
      if (active) { setLockStatus(status.unfinalized ? 'unfinalized' : 'current'); setLockOutput(status.output); }
    }).catch(reason => { if (active) { setLockStatus('unknown'); setLockOutput(String(reason)); } });
    return () => { active = false; };
  }, [ui.share, busy]);
  async function finalize() {
    if (!doc || busy || finalizingRef.current) return;
    const seq = openSeq.current;
    finalizingRef.current = true;
    setBusy(true); setJob('finalize'); shareOpen(true); setUi(state => ({ ...state, flyout: false })); setError(''); setFinalizeError(''); setFinalizeEvents([]); setLockStatus('checking');
    try {
      await doSave('manual');
      const sent = savedRef.current, current = historyRef.current?.present;
      // runSave surfaces failures itself. A resolved queue alone does not prove a save succeeded.
      if (openSeq.current !== seq || !saveOutcome.current?.ok || saveOutcome.current.seq !== seq || !sent || !current || sent.id !== current.id || isDirty(current, sent)) return;
      await finalizeLevel(sent, event => setFinalizeEvents(events => [...events, event]));
      notice({ kind: 'success', message: 'Finalize complete.' });
    }
    catch (reason) { setFinalizeError(reason instanceof Error ? reason.message : String(reason)); }
    finally { finalizingRef.current = false; setJob(null); setBusy(false); }
  }
  async function solvable() {
    if (!doc || busy) return;
    const controller = new AbortController(); proxyAbort.current = controller;
    setBusy(true); setJob('check'); setError(''); setCheckError(''); setIssues([]); setProxyEvents([]);
    try {
      let report: Extract<EditorProxyEvent, { type: 'result' }> | undefined;
      await checkSolvable(doc, event => { setProxyEvents(events => [...events, event]); if (event.type === 'result') report = event; }, controller.signal);
      if (report) notice({ kind: 'success', testId: 'check-toast', message: `Check: AI won ${report.report.totalWins}/${report.report.runs}`, action: { label: 'Details', onClick: showDetails } });
    }
    catch (reason) {
      notice({ kind: 'error', message: controller.signal.aborted ? 'Proxy check cancelled.' : reason instanceof Error ? reason.message : String(reason), action: { label: 'Details', onClick: showDetails } });
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
    setSelection([]); setClipboard(undefined); pasteCount.current = 0; clearSave(); setNotices([]); setUi(closedUi);
  }
  const { levels, setLevels, loading, error: startError, copyHint } = useInitialLoad(replaceDoc);
  function guard(action: PendingAction['action'], kind: PendingAction['kind'] = 'replace') {
    if (busy) return;
    if (historyRef.current && isDirty(historyRef.current.present, savedRef.current)) {
      setUi(state => ({ ...state, menu: false, share: false, flyout: false, confirm: { action, kind } }));
    } else void action();
  }
  function leave() { bypassUnload.current = true; window.location.assign('/'); }
  async function duplicate() {
    const saved = savedRef.current;
    if (!saved) return;
    setBusy(true);
    try { const result = await duplicateLevel(saved.id); replaceDoc(result.level, true); setLevels(await listLevels()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function confirm(save: boolean) {
    const pending = ui.confirm;
    if (!pending || confirmBusy) return;
    setConfirmBusy(true);
    try {
      let savedResult: LevelDoc | undefined;
      const ran = await confirmAction(save ? 'save' : 'discard', async () => {
        const seq = openSeq.current;
        saveOutcome.current = null;
        await doSave('manual');
        const current = historyRef.current?.present, saved = savedRef.current;
        const outcome = saveOutcome.current as { seq: number; ok: boolean } | null;
        if (seq !== openSeq.current || !outcome?.ok || outcome.seq !== seq || !current || !saved || isDirty(current, saved)) return false;
        savedResult = saved;
        return true;
      }, () => pending.action(savedResult));
      if (!ran) return;
      setUi(state => ({ ...state, confirm: null, dialog: null }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setConfirmBusy(false); }
  }
  useEffect(() => { (window as unknown as { __editorSave?: typeof doSave }).__editorSave = doSave; });
  const contextSeq = openSeq.current;
  const ctx: EditorContext | null = doc && history ? {
    doc, savedDoc, history, dispatch, area, selection, clipboard, viewport, locked: busy, themes: choices.themes, colors: choices.colors, palettes: choices.palettes, viewportStatus, losStatus,
    edit: (op: DocOp, merge?: string) => { if (openSeq.current === contextSeq) dispatch({ type: 'edit', op, area, ...(merge ? { merge } : {}) }); },
    endEditBurst: () => dispatch({ type: 'end-edit' }),
    deleteSelection() { if (selection.length) dispatch({ type: 'edit', op: { type: 'delete-many', targets: selection }, area }); },
    select: next => { viewport.current?.select(next); },
    copy() { setClipboard(copySelection(doc, selection)); pasteCount.current = 0; },
    paste() { if (!clipboard) return; pasteCount.current++; dispatch({ type: 'edit', op: { type: 'paste', clipboard, offset: { x: .5 * pasteCount.current, z: .5 * pasteCount.current } }, area }); },
    save: doSave, saveState, dirty,
  } : null;
  const toolbar = doc && ctx && <EditorCtx.Provider value={ctx}><TopBar failureSeq={manualFailures} issues={validation.issues} warnings={validation.warnings} saveMessage={saveMessage} issueLabel={issueLabel}
    onBack={() => guard(leave, 'back')} onPlay={() => { setUi(closedUi); setPlaying(true); }}
    file={{ open: ui.menu, onOpenChange: menu => setUi(state => ({ ...state, menu, share: false, flyout: false })), onCreate: () => setUi(state => ({ ...state, dialog: 'create' })), onOpen: () => setUi(state => ({ ...state, dialog: 'open' })), onDuplicate: () => guard(duplicate, 'duplicate') }}
    share={<><SharePanel open={ui.share} onOpenChange={shareOpen} savedDoc={savedDoc} locked={busy} busy={busy} job={job} onSave={() => void doSave('manual')} onCheck={() => void solvable()} onCancel={() => proxyAbort.current?.abort()} onFinalize={() => void finalize()} onDetails={showDetails} proxyEvents={proxyEvents} hasCheckProblem={issues.length > 0 || !!checkError} finalizeEvents={finalizeEvents} finalizeError={finalizeError} lockStatus={lockStatus} lockOutput={lockOutput} flyoutOpen={ui.flyout} flyoutRef={flyoutRef} panelRef={panelRef} detailsRef={detailsRef} />
      <CheckFlyout open={ui.share && ui.flyout} onOpenChange={flyout => setUi(state => ({ ...state, flyout }))} panelRef={panelRef} flyoutRef={flyoutRef} detailsRef={detailsRef} job={job} onCancel={() => proxyAbort.current?.abort()} checkIssues={issues} issueLabel={issueLabel} checkError={checkError} proxyEvents={proxyEvents} /></>} /></EditorCtx.Provider>;
  const dialogProps = { levels, loading, currentId: doc?.id ?? '', suspended: !!ui.confirm, onClose: () => setUi(state => ({ ...state, dialog: null })), onReplace: (next: LevelDoc, saved: boolean) => guard(savedResult => replaceDoc(saved && savedResult?.id === next.id ? savedResult : next, saved)) };
  return <>{doc && ctx ? <Shell inert={playing} counts={{ buildings: doc.buildings.length, obstacles: doc.elements.length, players: doc.players.length }} top={toolbar} left={<EditorCtx.Provider value={ctx}><LeftPanel /></EditorCtx.Provider>}>
    <Toasts banners={history ? scriptRemovalMessages(history) : []} error={error} onDismissError={() => setError('')} notices={notices} onDismissNotice={id => setNotices(items => items.filter(item => item.id !== id))} />
    <EditorCtx.Provider value={ctx}><Viewport onStatus={setViewportStatus} onLos={setLosStatus} onSelection={setSelection} /></EditorCtx.Provider>
  </Shell> : <StartScreen levels={levels} loading={loading} copyHint={copyHint} startError={startError} onReplace={replaceDoc} />}
  {doc && ui.dialog === 'create' && <CreateDialog {...dialogProps} />}
  {doc && ui.dialog === 'open' && <OpenDialog {...dialogProps} />}
  {ui.confirm && <ConfirmDialog busy={confirmBusy} message={failureActive ? saveMessage || validation.issues.map(issue => `${issueLabel(issue)}: ${issue.message}`).join('\n') || 'Saving failed. Review the save status before continuing.' : 'Save your changes before continuing?'} saveLabel={ui.confirm.kind === 'duplicate' ? 'Save & duplicate' : ui.confirm.kind === 'back' ? 'Save and leave' : 'Save'} discardLabel={ui.confirm.kind === 'back' ? 'Leave without saving' : 'Discard'} onSave={() => void confirm(true)} {...(ui.confirm.kind === 'duplicate' ? {} : { onDiscard: () => void confirm(false) })} onCancel={() => setUi(state => ({ ...state, confirm: null }))} />}
  {playing && doc && <PlayOverlay doc={doc} onExit={() => setPlaying(false)} />}</>;
}
