import { useLayoutEffect, useRef } from 'preact/hooks';

export interface ToastNotice {
  id: string;
  kind: 'success' | 'error' | 'info';
  message: string;
  action?: { label: string; onClick(): void };
  testId?: string;
}
export interface ToastsProps {
  /** Script-removal messages derived from history; no dismiss. */
  banners: string[];
  /** Dismissible error (manifest load etc.). */
  error: string;
  onDismissError(): void;
  notices?: ToastNotice[];
  onDismissNotice?(id: string): void;
}

function Notice({ notice, onDismiss }: { notice: ToastNotice; onDismiss: ToastsProps['onDismissNotice'] }) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => {
    const timer = window.setTimeout(() => dismiss.current?.(notice.id), 8000);
    return () => window.clearTimeout(timer);
  }, [notice.id]);
  return <p role={notice.kind === 'error' ? 'alert' : 'status'} class={`ed-toast ed-toast-${notice.kind}`} data-testid={notice.testId}>
    {notice.message}
    {notice.action && <button type="button" class="ed-toast-action" onClick={notice.action.onClick}>{notice.action.label}</button>}
    <button type="button" class="ed-toast-close" aria-label="Dismiss notice" onClick={() => onDismiss?.(notice.id)}>×</button>
  </p>;
}

/** Top-center toast stack over the canvas slot. */
export function Toasts({ banners, error, onDismissError, notices = [], onDismissNotice }: ToastsProps) {
  if (!banners.length && !error && !notices.length) return null;
  return <div class="ed-toasts">
    {error && <p role="alert" class="ed-toast ed-toast-error" data-testid="error-toast">{error}<button class="ed-btn" aria-label="Dismiss error" onClick={onDismissError}>×</button></p>}
    {banners.map(message => <p key={message} role="status" class="ed-toast editor-script-banner" data-testid="script-removal-banner">{message}</p>)}
    {notices.map(notice => <Notice key={notice.id} notice={notice} onDismiss={onDismissNotice} />)}
  </div>;
}
