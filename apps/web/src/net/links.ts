export interface RoomLink { code: string; role: 'play' | 'watch' }
const CODE_RE = /^[A-Za-z0-9]{4}$/;

export function parseRoomLink(search: string): RoomLink | null {
  const q = new URLSearchParams(search);
  const code = q.get('room');
  if (code === null || !CODE_RE.test(code)) return null;
  return { code: code.toUpperCase(), role: q.has('watch') ? 'watch' : 'play' };
}

export function shareLinks(origin: string, path: string, code: string): { play: string; watch: string } {
  const base = `${origin}${path}?room=${encodeURIComponent(code.toUpperCase())}`;
  return { play: base, watch: `${base}&watch` };
}

/** Query string without the deep-link params (`room`, `watch`), keeping everything else. */
export function stripRoomParams(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('room'); q.delete('watch');
  const rest = q.toString();
  return rest ? `?${rest}` : '';
}
