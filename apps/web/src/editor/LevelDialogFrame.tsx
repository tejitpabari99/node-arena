import type { ComponentChildren } from 'preact';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';

interface LevelDialogFrameProps {
  title: string;
  suspended?: boolean;
  busy: boolean;
  onClose(): void;
  children: ComponentChildren;
}

/** Modal shell shared by Create/Open. Standalone bodies do not acquire modal behavior. */
export function LevelDialogFrame({ title, busy, onClose, children, suspended = false }: LevelDialogFrameProps) {
  const root = useRef<HTMLDivElement>(null), titleId = useId();
  const current = useRef({ busy, onClose }); current.current = { busy, onClose };
  useLayoutEffect(() => {
    if (suspended) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = root.current!;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex="0"]'))
      .filter(control => !control.matches(':disabled'));
    (controls()[0] ?? dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      // A dirty confirmation may be mounted above this dialog while its action awaits.
      if (Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).at(-1) !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!current.current.busy) current.current.onClose();
      } else if (event.key === 'Tab') {
        const available = controls(), first = available[0], last = available.at(-1);
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
  }, [suspended]);
  return <div class="editor-shell ed-modal-backdrop" hidden={suspended} inert={suspended} onPointerDown={event => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    if (!busy) onClose();
  }}>
    <div ref={root} class="ed-modal ed-level-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}>
      <h2 id={titleId} class="ed-modal-title">{title}</h2>
      {children}
      <div class="ed-modal-actions"><button class="ed-btn" disabled={busy} onClick={onClose}>Cancel</button></div>
    </div>
  </div>;
}
