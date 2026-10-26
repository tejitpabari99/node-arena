import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

export type DismissReason = 'escape' | 'outside-pointer' | 'focus-out';
export interface DismissOptions {
  enabled: boolean;
  refs: readonly RefObject<HTMLElement>[];
  triggerRef?: RefObject<HTMLElement>;
  escapeEnabled?: boolean;
  onDismiss(reason: DismissReason): void;
}
/** Callers disable a parent's Escape handler while its child surface is open.
 * Include child/portal refs in the parent's refs to treat them as inside clicks.
 * Only Escape restores focus; pointer and focus dismissal preserve the destination.
 */
export function useDismiss(options: DismissOptions) {
  const latest = useRef(options);
  latest.current = options;
  useLayoutEffect(() => {
    if (!options.enabled) return;
    const inside = (target: EventTarget | null) => target instanceof Node && latest.current.refs.some(ref => ref.current?.contains(target));
    const dismiss = (reason: DismissReason) => {
      latest.current.onDismiss(reason);
      if (reason === 'escape') latest.current.triggerRef?.current?.focus();
    };
    const pointer = (event: PointerEvent) => { if (!inside(event.target)) dismiss('outside-pointer'); };
    const focus = (event: FocusEvent) => { if (!inside(event.target)) dismiss('focus-out'); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || latest.current.escapeEnabled === false) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss('escape');
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('focusin', focus);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('keydown', key);
    };
  }, [options.enabled]);
}
