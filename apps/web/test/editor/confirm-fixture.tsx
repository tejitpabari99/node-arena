import { render } from 'preact';
import { useState } from 'preact/hooks';
import { ConfirmDialog } from '../../src/editor/ConfirmDialog.js';
import { confirmAction, type ConfirmDecision } from '../../src/editor/confirm-flow.js';
import '../../src/editor/style.css';

function Fixture() {
  const [pending, setPending] = useState<'normal' | 'duplicate' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState(0);
  const [saves, setSaves] = useState(0);
  const [error, setError] = useState('');
  async function decide(decision: ConfirmDecision) {
    if (busy) return;
    if (decision === 'cancel') { setPending(null); return; }
    setBusy(true); setError('');
    try {
      if (await confirmAction(decision, () => {
        setSaves(count => count + 1);
        return new Promise<boolean>(resolve => { Reflect.set(window, 'finishConfirmSave', resolve); });
      }, () => { setActions(count => count + 1); })) setPending(null);
      else setError('Save failed');
    } finally { setBusy(false); }
  }
  return <main class="editor-shell">
    <button onClick={() => setPending('normal')}>Open guarded action</button>
    <button onClick={() => setPending('duplicate')}>Duplicate guarded action</button>
    <output data-testid="actions">{actions}</output><output data-testid="saves">{saves}</output>
    {error && <p role="alert">{error}</p>}
    {pending && <ConfirmDialog busy={busy} saveLabel={pending === 'duplicate' ? 'Save & duplicate' : 'Save'}
      {...(pending === 'normal' ? { onDiscard: () => { void decide('discard'); } } : {})}
      onSave={() => { void decide('save'); }} onCancel={() => { void decide('cancel'); }} />}
  </main>;
}
render(<Fixture />, document.getElementById('app')!);
