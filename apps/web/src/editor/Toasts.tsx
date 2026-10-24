export interface ToastsProps {
  /** Script-removal messages derived from history; no dismiss. */
  banners: string[];
  /** Dismissible error (manifest load etc.). */
  error: string;
  onDismissError(): void;
}

/** Top-center toast stack over the canvas slot. */
export function Toasts({ banners, error, onDismissError }: ToastsProps) {
  if (!banners.length && !error) return null;
  return <div class="ed-toasts">
    {error && <p role="alert" class="ed-toast ed-toast-error" data-testid="error-toast">{error}<button class="ed-btn" aria-label="Dismiss error" onClick={onDismissError}>×</button></p>}
    {banners.map(message => <p key={message} role="status" class="ed-toast editor-script-banner" data-testid="script-removal-banner">{message}</p>)}
  </div>;
}
