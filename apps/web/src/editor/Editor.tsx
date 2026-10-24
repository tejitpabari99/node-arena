import { ContentLoadError, loadCatalog, type Catalog, type ContentIssue } from '@node-arena/content';
import { validateEditorDocument } from '../../../../tools/src/editor-validation.js';
import { contentFiles } from '../app/boot.js';
import { loadManifest } from '../manifest/load.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PlayOverlay } from './PlayOverlay.js';
import { LevelPropertiesForm } from './Properties.js';
import { Viewport } from './Viewport.js';
import type { EditorProxyEvent } from '../../../../tools/src/editor-solvable.js';
import { checkSolvable, EditorApiError, listLevels, readLevel, saveLevel, type LevelListing } from './api.js';
import { createHistory, historyReducer, scriptRemovalMessages, type DocHistory, type HistoryAction } from './model.js';
import { blankDocument, copyDocument, type LevelDoc, type SizePreset } from './document.js';

/** Owns immutable working-copy snapshots; forms and Play attach here. */
export function Editor() {
  const [choices, setChoices] = useState<{ themes: string[]; colors: string[] }>({ themes: [], colors: [] });
  const [levels, setLevels] = useState<LevelListing[]>([]);
  const [history, setHistory] = useState<DocHistory | null>(null);
  const doc = history?.present ?? null;
  function setDoc(next: LevelDoc | null) { setHistory(next ? createHistory(next) : null); }
  function dispatch(action: HistoryAction) { clearSave(); setHistory(state => state ? historyReducer(state, action) : state); }
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
  const [warnings, setWarnings] = useState<ContentIssue[]>([]);
  const [saved, setSaved] = useState(false);
  const [proxyEvents, setProxyEvents] = useState<EditorProxyEvent[]>([]);
  const proxyAbort = useRef<AbortController | null>(null);
  useEffect(() => () => proxyAbort.current?.abort(), []);
  const proxyReport = proxyEvents.find(event => event.type === 'result');
  const catalog = useRef<Promise<Catalog> | undefined>(undefined);
  function clearSave() { setProxyEvents([]); setIssues([]); setWarnings([]); setSaved(false); }
  async function save() {
    if (!doc) return;
    setBusy(true); setError(''); clearSave();
    try {
      catalog.current ??= loadManifest().then(manifest => loadCatalog(contentFiles(), { themes: Object.keys(manifest.themes), colorKeys: Object.keys(manifest.palettes) }));
      const checked = validateEditorDocument(await catalog.current, doc, doc.id);
      const result = await saveLevel(checked.level);
      setHistory(state => state ? { ...state, present: result.level } : state); setWarnings(result.warnings); setSaved(true);
      const items = await listLevels(); setLevels(items); setReopenId(result.level.id);
    } catch (reason) {
      if (reason instanceof ContentLoadError) setIssues(reason.errors);
      else if (reason instanceof EditorApiError && reason.issues.length) setIssues(reason.issues);
      else setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
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
    void listLevels().then(items => {
      setLevels(items); setCopyId(items[0]?.id ?? '');
      setReopenId(items.find(item => item.id.startsWith('na-'))?.id ?? '');
    }).catch(reason => setError(String(reason))).finally(() => setLoading(false));
  }, []);
  async function open(copy: boolean) {
    setBusy(true); setError(''); clearSave();
    try {
      const source = await readLevel(copy ? copyId : reopenId);
      if (copy && levels.some(level => level.id === id)) throw new Error('Choose a new id; that level already exists.');
      setDoc(copy ? copyDocument(source, id) : source);
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
  return <><main class="editor-shell" inert={playing}>
    <header><h1>Level editor</h1><span>Local development</span><a href="/">Game</a></header>
    {error && <p role="alert">{error}</p>}
    {doc ? <section aria-label="Working level">
      <div class="editor-toolbar"><h2 data-testid="draft-id">{doc.id}</h2><button disabled={busy} onClick={() => void save()}>Save</button><button disabled={busy} onClick={() => setPlaying(true)}>Play</button><button disabled={busy} onClick={() => void solvable()}>Solvable?</button>{proxyAbort.current && <button onClick={() => proxyAbort.current?.abort()}>Cancel check</button>}<button disabled={busy || !history?.past.length} onClick={() => dispatch({ type: 'undo' })}>Undo</button><button disabled={busy || !history?.future.length} onClick={() => dispatch({ type: 'redo' })}>Redo</button><button disabled={busy} onClick={() => { setDoc(null); setId(''); setError(''); clearSave(); }}>Start screen</button></div>
      {history && scriptRemovalMessages(history).map(message => <p key={message} role="status" class="editor-script-banner" data-testid="script-removal-banner">{message}</p>)}
      {issues.length > 0 && <ul role="alert" aria-label="Save errors">{issues.map((issue, index) => <li key={index} data-item={issue.pointer}>{issueLabel(issue)}: {issue.message}</li>)}</ul>}
      {warnings.length > 0 && <ul aria-label="Save warnings">{warnings.map((issue, index) => <li key={index} data-item={issue.pointer}>{issueLabel(issue)}: {issue.message}</li>)}</ul>}
      {saved && <p role="status">Saved. Run Finalize when ready to update content locks.</p>}
      {proxyEvents.length > 0 && <section aria-label="Proxy evidence" aria-live="polite">
        <p>Evidence only. Proxy wins do not prove solvability; no wins do not prove impossibility. Owner play and sign-off remain required.</p>
        <p role="status">{proxyReport?.type === 'result' ? `Proxy wins: ${proxyReport.report.totalWins}/${proxyReport.report.runs}. Validation: ${proxyReport.report.ok ? 'passed' : 'failed'}.` : proxyAbort.current ? 'Checking proxy matches…' : 'Proxy check stopped.'}</p>
        <pre>{proxyEvents.map(event => event.type === 'progress' ? `${event.run.proxy} seed ${event.run.seed}: ${event.run.outcome}, winner ${event.run.winner ?? 'none'}, ${event.run.ticks} ticks` : event.type === 'error' ? event.error : '').filter(Boolean).join('\n')}</pre>
        {proxyReport?.type === 'result' && <details><summary>Full proxy report</summary><pre>{JSON.stringify(proxyReport.report, null, 2)}</pre></details>}
      </section>}
      <p>{doc.name}</p>
      <p data-testid="draft-summary">{doc.theme} · {doc.players.length} players · {doc.buildings.length} buildings · {doc.elements.length} obstacles</p>
      <LevelPropertiesForm doc={doc} onEdit={op => dispatch({ type: 'edit', op })} themes={choices.themes} colors={choices.colors} disabled={busy} />
      <Viewport doc={doc} disabled={busy} onEdit={op => dispatch({ type: 'edit', op })} />
    </section> : <>
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
    </>}
  </main>{playing && doc && <PlayOverlay doc={doc} onExit={() => setPlaying(false)} />}</>;
}
