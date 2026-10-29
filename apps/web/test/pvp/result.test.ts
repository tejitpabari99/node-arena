import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import type { EndOutcome } from '@node-arena/net';
import { PvpResult, resultTitle } from '../../src/ui/pvp/PvpResult';
import { BattlePopup } from '../../src/ui/PausePopup';

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
