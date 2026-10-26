import { useEffect, useState } from 'preact/hooks';
import { readLevel, type LevelListing } from './api.js';
import { blankDocument, copyDocument, isDraftId, type LevelDoc, type SizePreset } from './document.js';
import { LevelDialogFrame } from './LevelDialogFrame.js';

export interface CreateBodyProps {
  levels: LevelListing[];
  loading: boolean;
  disabled?: boolean;
  /** The open draft also reserves its id, even if it has never been saved. */
  currentId?: string;
  /** Build/read completes before this callback; the owner can then guard replacement. */
  onReplace(doc: LevelDoc, saved: boolean): void | Promise<void>;
  onBusyChange?(busy: boolean): void;
}
export interface CreateDialogProps extends CreateBodyProps { onClose(): void }

const EXISTS = 'Choose a new id; that level already exists.';

export function CreateDialogBody({ levels, loading, disabled: unavailable = false, currentId, onReplace, onBusyChange }: CreateBodyProps) {
  let next = 1;
  while (levels.some(level => level.id === `na-custom-${next}`) || currentId === `na-custom-${next}`) next++;
  const [typedId, setTypedId] = useState<string | null>(null), id = typedId ?? `na-custom-${next}`;
  const [theme, setTheme] = useState('green'), [size, setSize] = useState<SizePreset>('medium');
  const [copyId, setCopyId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const disabled = unavailable || loading || busy;
  async function create() {
    if (disabled) return;
    setBusy(true); onBusyChange?.(true); setError('');
    try {
      if (levels.some(level => level.id === id) || currentId === id) throw new Error(EXISTS);
      if (!isDraftId(id)) throw new Error('Choose a new id: na- followed by 1–40 lowercase letters, digits or hyphens.');
      const doc = copyId ? copyDocument(await readLevel(copyId), id) : blankDocument(id, theme, size);
      await onReplace(doc, false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return <form class="ed-level-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); void create(); }}>
    {error && <p class="ed-file-error" role="alert">{error}</p>}
    <label>New level id<input value={id} disabled={disabled} onInput={event => setTypedId(event.currentTarget.value)} placeholder="na-my-level" /></label>
    <fieldset class="ed-group-box" disabled={disabled || !!copyId}>
      <legend>Blank level</legend>
      <label>Theme<select aria-label="Theme" value={theme} onChange={event => setTheme(event.currentTarget.value)}><option value="green">Green</option><option value="snow">Snow</option></select></label>
      <label>Size<select aria-label="Size" value={size} onChange={event => setSize(event.currentTarget.value as SizePreset)}><option value="small">Small (12 × 12)</option><option value="medium">Medium (20 × 20)</option><option value="large">Large (30 × 30)</option></select></label>
      <p class="ed-field-hint">2 players: blue human, red AI</p>
    </fieldset>
    {copyId && <p class="ed-field-hint">Copied from {copyId}; theme and size come from the source</p>}
    <div class="ed-divider-or">or</div>
    <label>Copy existing level<select aria-label="Copy existing level" value={copyId} disabled={disabled} onChange={event => setCopyId(event.currentTarget.value)}>
      <option value="">None</option>
      {levels.map(level => <option key={level.id} value={level.id}>{level.name} ({level.id})</option>)}
    </select></label>
    {loading && <p role="status">Loading levels…</p>}
    <div class="ed-modal-actions"><button type="submit" class="ed-btn ed-btn-primary" data-testid="create-confirm" disabled={disabled}>Create</button></div>
  </form>;
}

export function CreateDialog({ onClose, onBusyChange, ...props }: CreateDialogProps) {
  const [busy, setBusy] = useState(false);
  // Notify optional owners without changing the reusable body's contract.
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  return <LevelDialogFrame title="Create level" busy={busy} onClose={onClose}>
    <CreateDialogBody {...props} onBusyChange={setBusy} />
  </LevelDialogFrame>;
}
