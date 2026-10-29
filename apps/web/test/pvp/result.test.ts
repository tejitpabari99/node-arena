import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import type { EndOutcome } from '@node-arena/net';
import { PvpResult, resultTitle } from '../../src/ui/pvp/PvpResult';
import { BattlePopup } from '../../src/ui/PausePopup';
import { ConnBanner } from '../../src/ui/pvp/ConnBanner';

type N = VNode<Record<string, unknown>>;
function find(node: unknown, test: (n: N) => boolean, out: N[] = []): N[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, test, out));
  else if (node && typeof node === 'object' && 'props' in node) { const n = node as N; if (test(n)) out.push(n); find(n.props.children, test, out); }
  return out;
}
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
  it('renders placement rows with nick, team, buildings, troops', () => {
    const v = PvpResult({ outcome: team, seat: 2, ranking, seats, onLeave: () => {} });
    const r0 = find(v, (n) => n.props['data-testid'] === 'result-placement-0')[0]!, r1 = find(v, (n) => n.props['data-testid'] === 'result-placement-1')[0]!;
    const t = (n: N): string => JSON.stringify(n.props.children);
    expect(t(r0)).toContain('ann & bob'); expect(t(r0)).toContain('Team 1'); expect(t(r0)).toContain('5'); expect(t(r0)).toContain('20');
    expect(t(r1)).toContain('cy'); expect(t(r1)).toContain('Team 2');
    expect(find(v, (n) => (n.type as unknown) === BattlePopup)[0]!.props.title).toBe('Defeat');
    expect(find(v, (n) => n.props['data-testid'] === 'result-team')).toHaveLength(1);
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

describe('ConnBanner', () => {
  it('reconnecting, lost+Retry, refused, superseded; none when connected', () => {
    const retry = vi.fn();
    expect(ConnBanner({ conn: 'connected', onRetry: retry })).toBeNull();
    const rc = ConnBanner({ conn: 'reconnecting', onRetry: retry })!; expect(JSON.stringify(rc.props.children)).toContain('Reconnecting');
    const lost = ConnBanner({ conn: 'lost', onRetry: retry })!;
    (find(lost, (n) => n.props['data-testid'] === 'banner-retry')[0]!.props.onClick as () => void)(); expect(retry).toHaveBeenCalledOnce();
    const ref = ConnBanner({ conn: 'refused', onRetry: retry })!; expect(JSON.stringify(ref.props.children)).toContain('New version');
    expect(find(ref, (n) => n.props['data-testid'] === 'banner-retry')).toHaveLength(0);
    expect(JSON.stringify(ConnBanner({ conn: 'superseded', onRetry: retry })!.props.children)).toContain('Opened in another tab');
  });
});
