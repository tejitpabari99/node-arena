import { useEffect, useState } from 'preact/hooks';
import { blankDocument, copyDocument, type LevelDoc, type SizePreset } from './document.js';
import { readLevel, type LevelListing } from './api.js';

export interface FileModalProps {
  levels: LevelListing[];
  /** Standalone (no document open): cannot be dismissed. */
  standalone: boolean;
  dirty: boolean;
  loading: boolean;
  /** Error carried in from the initial URL load. */
  startError: string;
  copyHint: string;
  /** Id of the open document, if any; counts as taken for the id prefill. */
  currentId?: string;
  onClose(): void;
  /** Installs `doc`; `saved` means it equals disk (opened custom level). */
  onReplace(doc: LevelDoc, saved: boolean): void;
}

const EXISTS = 'Choose a new id; that level already exists.';

/** New blank / Copy / Open. Standalone over the sky when no document exists, dismissible otherwise. */
export function FileModal({ levels, standalone, dirty, loading, startError, copyHint, currentId, onClose, onReplace }: FileModalProps) {
  const customs = levels.filter(level => level.id.startsWith('na-'));
  let n = 1; while (levels.some(level => level.id === `na-custom-${n}`) || currentId === `na-custom-${n}`) n++;
  const [typedId, setTypedId] = useState<string | null>(null), id = typedId ?? `na-custom-${n}`;
  const [theme, setTheme] = useState('green'), [size, setSize] = useState<SizePreset>('medium');
  const [copyPick, setCopyPick] = useState(''), copyId = copyPick || copyHint || levels[0]?.id || '';
  const [openPick, setOpenPick] = useState(''), openId = openPick || (customs.some(level => level.id === currentId) ? currentId! : customs[0]?.id ?? '');
  const [error, setError] = useState(startError), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ doc: LevelDoc; saved: boolean } | null>(null);
  useEffect(() => { if (startError) setError(startError); }, [startError]);
  useEffect(() => {
    if (standalone) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (pending) setPending(null); else onClose(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [standalone, pending, onClose]);
  function finish(doc: LevelDoc, saved: boolean) { if (dirty) setPending({ doc, saved }); else onReplace(doc, saved); }
  function blank() {
    setError('');
    try {
      if (levels.some(level => level.id === id)) throw new Error(EXISTS);
      finish(blankDocument(id, theme, size), false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function load(copy: boolean) {
    setBusy(true); setError('');
    try {
      const source = await readLevel(copy ? copyId : openId);
      if (copy && levels.some(level => level.id === id)) throw new Error(EXISTS);
      finish(copy ? copyDocument(source, id) : source, !copy);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  const off = loading || busy || !!pending;
  const dialog = <div class="ed-modal ed-file" role="dialog" aria-modal="true" aria-labelledby="ed-file-title">
    <h2 id="ed-file-title" class="ed-modal-title">{standalone ? 'Level editor' : 'Open or create a level'}</h2>
    {standalone && <a class="ed-file-game" href="/">Game</a>}
    {error && <p role="alert">{error}</p>}
    {pending && <div class="ed-file-confirm" data-testid="discard-confirm">
      <p>Discard unsaved changes?</p>
      <button class="ed-btn ed-btn-primary" onClick={() => onReplace(pending.doc, pending.saved)}>Discard and continue</button>
      <button class="ed-btn" onClick={() => setPending(null)}>Cancel</button>
    </div>}
    <label>New level id<input value={id} disabled={!!pending} onInput={event => setTypedId(event.currentTarget.value)} placeholder="na-my-level" /></label>
    <p class="editor-hint">Blank levels and copies need a new na- id. Copies drop imported source metadata.</p>
    <div class="editor-start-grid">
      <section><h3>New blank</h3>
        <label>Theme<select value={theme} onChange={event => setTheme(event.currentTarget.value)}><option value="green">Green</option><option value="snow">Snow</option></select></label>
        <label>Size<select value={size} onChange={event => setSize(event.currentTarget.value as SizePreset)}><option value="small">Small (12 × 12)</option><option value="medium">Medium (20 × 20)</option><option value="large">Large (30 × 30)</option></select></label>
        <p>2 players: blue human, red AI</p><button disabled={off} onClick={blank}>Create blank</button>
      </section>
      <section><h3>Copy of any level</h3>
        <label>Copy level<select value={copyId} onChange={event => setCopyPick(event.currentTarget.value)}>{levels.map(level => <option key={level.id} value={level.id}>{level.name} ({level.id})</option>)}</select></label>
        <button disabled={off || !copyId} onClick={() => void load(true)}>Copy level</button>
      </section>
      <section><h3>Open custom level</h3>
        <label>Open level<select value={openId} onChange={event => setOpenPick(event.currentTarget.value)}>{customs.map(level => <option key={level.id} value={level.id}>{level.name} ({level.id})</option>)}</select></label>
        {!loading && !openId && <p>No custom levels yet.</p>}
        <button disabled={off || !openId} onClick={() => void load(false)}>Open level</button>
      </section>
    </div>
    {loading && <p role="status">Loading levels…</p>}
    {!standalone && !pending && <button class="ed-btn ed-file-cancel" onClick={onClose}>Cancel</button>}
  </div>;
  return standalone
    ? <main class="editor-shell ed-file-standalone">{dialog}</main>
    : <div class="editor-shell ed-file-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>{dialog}</div>;
}
