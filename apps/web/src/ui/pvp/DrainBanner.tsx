import { useEffect, useState } from 'preact/hooks';
/** Where the banner shows: in a match (countdown/playing) or in the lobby. */
export type DrainMode = 'match' | 'lobby';
export const DRAIN_LOBBY_TEXT = "Server restarting - you can't start a new match.";
const clock = (ms: number): string => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** SP09 D10 wording. */
export const drainText = (remainingMs: number, mode: DrainMode): string =>
  mode === 'lobby' ? DRAIN_LOBBY_TEXT : `Server restarting - this match will end in ${clock(remainingMs)}`;
/** Restart notice with a local countdown. Never rendered over the result screen; sits beside (not over) the pause overlay. */
export function DrainBanner({ deadlineAt, mode, now = () => performance.now() }: { deadlineAt: number; mode: DrainMode; now?: () => number }) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (mode !== 'match') return;
    const id = setInterval(() => bump((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [mode]);
  return <p class="pvp-error drain-banner" role="status" data-testid="drain-banner" data-mode={mode}>{drainText(deadlineAt - now(), mode)}</p>;
}
