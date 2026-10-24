import { useEffect, useState } from 'preact/hooks';
import { listLevels, readLevel, type LevelListing } from './api.js';
import { blankDocument, copyDocument, type LevelDoc, type SizePreset } from './document.js';

/** Owns the working document; viewport, reducer, forms and Play attach here in later tasks. */
export function Editor() {
  const [levels, setLevels] = useState<LevelListing[]>([]);
  const [doc, setDoc] = useState<LevelDoc | null>(null);
  const [id, setId] = useState('');
  const [theme, setTheme] = useState('green');
  const [size, setSize] = useState<SizePreset>('medium');
  const [copyId, setCopyId] = useState('');
  const [reopenId, setReopenId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void listLevels().then(items => {
      setLevels(items); setCopyId(items[0]?.id ?? '');
      setReopenId(items.find(item => item.id.startsWith('na-'))?.id ?? '');
    }).catch(reason => setError(String(reason))).finally(() => setLoading(false));
  }, []);
  async function open(copy: boolean) {
    setBusy(true); setError('');
    try {
      const source = await readLevel(copy ? copyId : reopenId);
      if (copy && levels.some(level => level.id === id)) throw new Error('Choose a new id; that level already exists.');
      setDoc(copy ? copyDocument(source, id) : source);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  function blank() {
    setError('');
    try {
      if (levels.some(level => level.id === id)) throw new Error('Choose a new id; that level already exists.');
      setDoc(blankDocument(id, theme, size));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <main class="editor-shell">
    <header><h1>Level editor</h1><span>Local development</span><a href="/">Game</a></header>
    {error && <p role="alert">{error}</p>}
    {doc ? <section aria-label="Working level">
      <div class="editor-toolbar"><h2 data-testid="draft-id">{doc.id}</h2><button onClick={() => { setDoc(null); setId(''); setError(''); }}>Start screen</button></div>
      <p>{doc.name}</p>
      <p data-testid="draft-summary">{doc.theme} · {doc.players.length} players · {doc.buildings.length} buildings · {doc.elements.length} obstacles</p>
      <div class="editor-workspace" aria-label="Level workspace" />
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
  </main>;
}
