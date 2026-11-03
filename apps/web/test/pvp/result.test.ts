import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import type { EndOutcome } from '@node-arena/net';
import { PvpResult, resultTitle } from '../../src/ui/pvp/PvpResult';
import { BattlePopup } from '../../src/ui/PausePopup';
import { ConnBanner, connBannerText } from '../../src/ui/pvp/ConnBanner';

type N = VNode<Record<string, unknown>>;
function find(node: unknown, test: (n: N) => boolean, out: N[] = []): N[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, test, out));
  else if (node && typeof node === 'object' && 'props' in node) { const n = node as N; if (test(n)) out.push(n); find(n.props.children, test, out); }
  return out;
}
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' && 'props' in node ? text((node as N).props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const win: EndOutcome = { outcome: 'victory', winners: [0], winner: 0 };
describe('PvpResult', () => {
  it('winner sees Victory, loser sees Defeat, in BattlePopup with pvp-result testid', () => {
    const w = PvpResult({ outcome: win, seat: 0, onLeave: () => {} }), l = PvpResult({ outcome: win, seat: 1, onLeave: () => {} });
    expect(w.props['data-testid']).toBe('pvp-result');
    expect(find(w, (n) => (n.type as unknown) === BattlePopup)[0]!.props.title).toBe('Victory!');
    expect(find(l, (n) => (n.type as unknown) === BattlePopup)[0]!.props.title).toBe('Defeat');
  });
  it('draw and spectator titles', () => {
    expect(resultTitle({ outcome: 'draw', winners: [], winner: null }, 0)).toBe('Draw');
    expect(resultTitle(win, null)).toBe('Match over');
  });
  it('Leave button calls onLeave', () => {
    const onLeave = vi.fn();
    const b = find(PvpResult({ outcome: win, seat: 0, onLeave }), (n) => n.props['data-testid'] === 'pvp-result-leave')[0]!;
    (b.props.onClick as () => void)(); expect(onLeave).toHaveBeenCalledOnce();
  });
});

describe('PvpResult N-seat / draw / rematch', () => {
  const seats = [{ player: 0, kind: 'human' as const, team: 0, nick: 'ann' }, { player: 1, kind: 'human' as const, team: 0, nick: 'bob' }, { player: 2, kind: 'human' as const, team: 1, nick: 'cy' }];
  const ranking = [
    { team: 0, seats: [0, 1], rank: 1, buildings: 5, troops: 20, eliminatedAt: null },
    { team: 1, seats: [2], rank: 2, buildings: 0, troops: 0, eliminatedAt: 100 },
  ];
  const team: EndOutcome = { outcome: 'victory', winners: [0, 1], winner: 0 };
  it('renders teams in ranking order in a table without rank numbers; winners bold and eliminated counts replaced', () => {
    const v = PvpResult({ outcome: team, seat: 2, ranking, seats, onLeave: () => {} });
    const table = find(v, n => n.type === 'table')[0]!;
    expect(table.props.class).toBe('result-table');
    expect(find(table, n => n.type === 'th').map(text)).toEqual(['Team', 'Buildings', 'Troops']);
    const rows = find(table, n => n.type === 'tr' && n.props['data-testid'] !== undefined);
    expect(rows.map(n => n.props['data-testid'])).toEqual(['result-placement-0', 'result-placement-1']);
    expect(rows.every(n => n.type === 'tr')).toBe(true);
    expect(find(rows[0], n => n.type === 'td').map(text)).toEqual(['Team 1 (ann & bob)', '5 buildings', '20 troops']);
    expect(rows[0]!.props.class).toBe('winner');
    const loserCells = find(rows[1], n => n.type === 'td');
    expect(loserCells.map(text)).toEqual(['Team 2 (cy)', 'Eliminated']);
    expect(loserCells[1]!.props.colSpan).toBe(2);
    expect(rows[1]!.props.class).toBe('out');
    expect(find(v, n => n.type === 'ol' || n.props.class === 'rank')).toHaveLength(0);
    expect(find(v, (n) => (n.type as unknown) === BattlePopup)[0]!.props.title).toBe('Defeat');
    expect(find(v, (n) => n.props['data-testid'] === 'result-team')).toHaveLength(1);
  });
  it('uses singular counts for one building and troop, with seat fallback names', () => {
    const v = PvpResult({ outcome: win, seat: 0, ranking: [{ team: 2, seats: [3], rank: 1, buildings: 1, troops: 1, eliminatedAt: null }], onLeave: () => {} });
    const row = find(v, n => n.props['data-testid'] === 'result-placement-0')[0]!;
    expect(find(row, n => n.type === 'td').map(text)).toEqual(['Team 3 (Seat 4)', '1 building', '1 troop']);
  });
  it('team-win: teammate sees Victory; spectator sees "X won"', () => {
    expect(resultTitle(team, 1)).toBe('Victory!');
    expect(resultTitle(team, null, { 0: 'ann', 1: 'bob' })).toBe('ann & bob won');
  });
  it('draw: Draw title for all, including forfeit-all-away draw', () => {
    const d: EndOutcome = { outcome: 'draw', winners: [], winner: null };
    expect(resultTitle(d, 0)).toBe('Draw'); expect(resultTitle(d, null, { 0: 'a' })).toBe('Draw');
  });
  it('rematch button for seated players only; wires onRematch', () => {
    const onRematch = vi.fn();
    (find(PvpResult({ outcome: win, seat: 0, onLeave: () => {}, onRematch }), (n) => n.props['data-testid'] === 'pvp-rematch')[0]!.props.onClick as () => void)();
    expect(onRematch).toHaveBeenCalledOnce();
    expect(find(PvpResult({ outcome: win, seat: null, onLeave: () => {}, onRematch }), (n) => n.props['data-testid'] === 'pvp-rematch')).toHaveLength(0);
  });
});

describe('ConnBanner SP11 states', () => {
  const btn = (n: unknown, id: string) => find(n as never, (x) => x.props['data-testid'] === id);
  const info = { attempt: 3, nextRetryAt: 10_000, outageStartedAt: 0, lastCloseCode: 4005 };
  it('all five states render with correct controls; connected renders nothing (welcome handoff to catch-up overlay)', () => {
    const retry = vi.fn();
    const st = (conn: Parameters<typeof ConnBanner>[0]['conn']) => ConnBanner({ conn, onRetry: retry })!;
    expect(ConnBanner({ conn: 'connected', onRetry: retry })).toBeNull();
    expect(ConnBanner({ conn: null, onRetry: retry })).toBeNull();
    for (const s of ['connecting', 'reconnecting', 'lost', 'refused', 'superseded'] as const) {
      const b = st(s); expect(b.props['data-state']).toBe(s); expect(b.props['data-testid']).toBe('conn-banner');
      expect(btn(b, 'banner-retry')).toHaveLength(s === 'lost' ? 1 : 0);
      expect(btn(b, 'banner-reload')).toHaveLength(s === 'refused' ? 1 : 0);
    }
  });
  it('wording: connecting; reconnecting shows attempt and seconds to next retry; refused/superseded terminal text', () => {
    expect(connBannerText('connecting')).toBe('Connecting...');
    expect(connBannerText('reconnecting')).toBe('Reconnecting...');
    expect(connBannerText('reconnecting', info, 4_500)).toBe('Reconnecting... (attempt 3, retry in 6s)');
    expect(connBannerText('reconnecting', info, 10_000)).toBe('Reconnecting... (attempt 3, retrying now)');
    expect(connBannerText('reconnecting', { ...info, nextRetryAt: null }, 0)).toBe('Reconnecting... (attempt 3)');
    expect(connBannerText('lost', info, 0)).toBe('Connection lost.');
    expect(connBannerText('connected')).toBeUndefined();
  });
  it('active-match layer renders banner without removing the pause overlay/countdown siblings (banner is position:fixed, pointer-events none)', async () => {
    const css = (await import('node:fs')).readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.conn-banner[^{]*\{position:fixed/);
  });
});

describe('ConnBanner', () => {
  it('reconnecting, lost+Retry, refused, superseded; none when connected', () => {
    const retry = vi.fn();
    expect(ConnBanner({ conn: 'connected', onRetry: retry })).toBeNull();
    expect(connBannerText('reconnecting')).toContain('Reconnecting');
    const lost = ConnBanner({ conn: 'lost', onRetry: retry })!;
    (find(lost, (n) => n.props['data-testid'] === 'banner-retry')[0]!.props.onClick as () => void)(); expect(retry).toHaveBeenCalledOnce();
    const ref = ConnBanner({ conn: 'refused', onRetry: retry })!; expect(connBannerText('refused')).toContain('A newer version of Node Arena is available - reload');
    expect(find(ref, (n) => n.props['data-testid'] === 'banner-retry')).toHaveLength(0);
    expect(connBannerText('superseded')).toContain('Opened in another tab');
  });
});
