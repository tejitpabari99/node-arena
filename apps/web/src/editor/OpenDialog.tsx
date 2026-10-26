import { useEffect, useState } from 'preact/hooks';
import { readLevel } from './api.js';
import type { CreateBodyProps } from './CreateDialog.js';
import { LevelDialogFrame } from './LevelDialogFrame.js';

export type OpenBodyProps = CreateBodyProps;
export interface OpenDialogProps extends OpenBodyProps { onClose(): void }

export function OpenDialogBody({ levels, loading, disabled: unavailable = false, currentId, onReplace, onBusyChange }: OpenBodyProps) {
  const customs = levels.filter(level => level.id.startsWith('na-'));
  const [picked, setPicked] = useState<string | null>(null);
  const id = customs.some(level => level.id === picked) ? picked! : customs.some(level => level.id === currentId) ? currentId! : customs[0]?.id ?? '';
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const disabled = unavailable || loading || busy;
  async function open() {
    if (disabled || !id) return;
    setBusy(true); onBusyChange?.(true); setError('');
    try { const doc = await readLevel(id); await onReplace(doc, true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return <form class="ed-level-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); void open(); }}>
    {error && <p class="ed-file-error" role="alert">{error}</p>}
    <label>Open level<select aria-label="Open level" value={id} disabled={disabled || !id} onChange={event => setPicked(event.currentTarget.value)}>
      {customs.map(level => <option key={level.id} value={level.id}>{level.name} ({level.id})</option>)}
    </select></label>
    {loading ? <p role="status">Loading levels…</p> : !id && <p>No custom levels yet.</p>}
    <div class="ed-modal-actions"><button type="submit" class="ed-btn ed-btn-primary" data-testid="open-confirm" disabled={disabled || !id}>Open level</button></div>
  </form>;
}

export function OpenDialog({ onClose, onBusyChange, ...props }: OpenDialogProps) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  return <LevelDialogFrame title="Open level" busy={busy} onClose={onClose}>
    <OpenDialogBody {...props} onBusyChange={setBusy} />
  </LevelDialogFrame>;
}
