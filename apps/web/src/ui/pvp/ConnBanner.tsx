import type { ConnState } from '../../net/connection';
export const CONN_BANNER_TEXT: Partial<Record<ConnState, string>> = {
  reconnecting: 'Reconnecting...', lost: 'Connection lost.', refused: 'A newer version of Node Arena is available - reload', superseded: 'Opened in another tab.',
};
/** Connection status banner; null when connected. refused/superseded are terminal (no retry). */
export function ConnBanner({ conn, onRetry }: { conn: ConnState | null; onRetry(): void }) {
  const msg = conn ? CONN_BANNER_TEXT[conn] : undefined;
  if (!msg) return null;
  return <p class="pvp-error conn-banner" role="alert" data-testid="conn-banner" data-state={conn}>{msg}
    {conn === 'lost' && <> <button class="text-button" data-testid="banner-retry" onClick={onRetry}>Retry</button></>}
    {conn === 'refused' && <> <button class="text-button" data-testid="banner-reload" onClick={() => { try { location.reload(); } catch { /* no location */ } }}>Reload</button></>}
  </p>;
}
