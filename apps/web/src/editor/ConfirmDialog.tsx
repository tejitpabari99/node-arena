import { useId, useLayoutEffect, useRef } from 'preact/hooks';

export interface ConfirmDialogProps {
  busy?: boolean;
  title?: string;
  message?: string;
  saveLabel?: string;
  discardLabel?: string;
  onSave(): void;
  /** Omit for actions such as Duplicate, which must save current edits first. */
  onDiscard?(): void;
  onCancel(): void;
}

/** Props-driven dirty-document confirmation. Keep mounted after failed saving. */
export function ConfirmDialog({ busy = false, title = 'Unsaved changes', message = 'Save your changes before continuing?', saveLabel = 'Save', discardLabel = 'Discard', onSave, onDiscard, onCancel }: ConfirmDialogProps) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef({ busy, onCancel });
  current.current = { busy, onCancel };
  const titleId = useId(), messageId = useId();
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = root.current!;
    dialog.querySelector<HTMLButtonElement>('button')!.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!current.current.busy) current.current.onCancel();
      } else if (event.key === 'Tab') {
        const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (!dialog.contains(document.activeElement) || document.activeElement === dialog || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last! : first).focus();
        }
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <div class="editor-shell ed-modal-backdrop">
    <div ref={root} class="ed-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} aria-busy={busy} tabIndex={-1} data-testid="discard-confirm">
      <h2 id={titleId} class="ed-modal-title">{title}</h2>
      <p id={messageId}>{message}</p>
      <div class="ed-modal-actions">
        <button class="ed-btn ed-btn-primary" data-testid="confirm-save" disabled={busy} onClick={() => { if (!busy) onSave(); }}>{saveLabel}</button>
        {onDiscard && <button class="ed-btn" data-testid="confirm-discard" disabled={busy} onClick={() => { if (!busy) onDiscard(); }}>{discardLabel}</button>}
        <button class="ed-btn" data-testid="confirm-cancel" disabled={busy} onClick={() => { if (!busy) onCancel(); }}>Cancel</button>
      </div>
    </div>
  </div>;
}
