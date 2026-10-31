import { useEffect, useState } from 'preact/hooks';
import type { ConnInfo, ConnState } from '../../net/connection';
export const CONN_BANNER_TEXT: Partial<Record<ConnState, string>> = {
  connecting: 'Connecting...', reconnecting: 'Reconnecting...', lost: 'Connection lost.', refused: 'A newer version of Node Arena is available - reload', superseded: 'Opened in another tab.',
};
/** Banner wording for a state; `reconnecting` adds attempt number and seconds to the next retry when `info` has them. */
export function connBannerText(conn: ConnState, info?: ConnInfo | null, now: number = Date.now()): string | undefined {
  const base = CONN_BANNER_TEXT[conn];
  if (conn !== 'reconnecting' || !base || !info) return base;
  const secs = info.nextRetryAt === null ? null : Math.max(0, Math.ceil((info.nextRetryAt - now) / 1000));
  const parts = [info.attempt > 0 ? `attempt ${info.attempt}` : '', secs === null ? '' : secs > 0 ? `retry in ${secs}s` : 'retrying now'].filter(Boolean);
  return parts.length ? `${base} (${parts.join(', ')})` : base;
}
/** Text node that re-renders itself every 500 ms while reconnecting so the retry countdown moves. */
function ConnText({ conn, info, now }: { conn: ConnState; info?: ConnInfo | null | undefined; now: () => number }) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (conn !== 'reconnecting') return;
    const id = setInterval(() => bump((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [conn]);
  return <>{connBannerText(conn, info, now())}</>;
}
/**
 * Connection status banner; null when connected (the catch-up overlay then owns progress). connecting/reconnecting are informational,
 * lost has Retry, refused has Reload, superseded is terminal. Fixed at the bottom (stacked above the drain banner) so it never covers the ownership bar, pause overlay, countdown or HUD controls.
 */
export function ConnBanner({ conn, info, onRetry, now = Date.now }: { conn: ConnState | null; info?: ConnInfo | null | undefined; onRetry(): void; now?: () => number }) {
  if (!conn || !CONN_BANNER_TEXT[conn]) return null;
  return <p class="pvp-error conn-banner" role="alert" data-testid="conn-banner" data-state={conn}><ConnText conn={conn} info={info} now={now} />
    {conn === 'lost' && <> <button class="text-button" data-testid="banner-retry" onClick={onRetry}>Retry</button></>}
    {conn === 'refused' && <> <button class="text-button" data-testid="banner-reload" onClick={() => { try { location.reload(); } catch { /* no location */ } }}>Reload</button></>}
  </p>;
}
