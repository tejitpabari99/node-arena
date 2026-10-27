import { useId, useState } from 'preact/hooks';
import { CreateDialogBody, type CreateBodyProps } from './CreateDialog.js';
import { OpenDialogBody } from './OpenDialog.js';

export interface StartScreenProps extends CreateBodyProps { startError?: string }

/** No document is open: shared forms in a persistent card, with no dismissal trap. */
export function StartScreen({ startError = '', loading, disabled = false, onBusyChange, ...props }: StartScreenProps) {
  const titleId = useId();
  const [creating, setCreating] = useState(false), [opening, setOpening] = useState(false);
  return <main class="editor-shell ed-start-screen">
    <section class="ed-start-card" aria-labelledby={titleId}>
      <a class="ed-start-back" href="/?view=custom">Back</a>
      <h1 id={titleId} class="ed-modal-title">Level editor</h1>
      {startError && <p class="ed-file-error" role="alert">{startError}</p>}
      <h2>Create level</h2>
      <CreateDialogBody {...props} loading={loading} disabled={disabled || opening} onBusyChange={busy => { setCreating(busy); onBusyChange?.(busy); }} />
      <h2 class="ed-start-open-title">Open level</h2>
      <OpenDialogBody {...props} loading={loading} disabled={disabled || creating} onBusyChange={busy => { setOpening(busy); onBusyChange?.(busy); }} />
    </section>
  </main>;
}
