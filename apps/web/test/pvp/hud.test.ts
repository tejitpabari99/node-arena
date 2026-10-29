import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import { PvpHud, formatTimer, type PvpHudProps } from '../../src/ui/pvp/PvpHud';
import { Toast, DESYNC_TOAST } from '../../src/ui/pvp/Toast';
import { BattlePopup } from '../../src/ui/PausePopup';
import { OwnershipBar } from '../../src/ui/OwnershipBar';

type N = VNode<Record<string, unknown>>;
function find(node: unknown, test: (n: N) => boolean, out: N[] = []): N[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, test, out));
  else if (node && typeof node === 'object' && 'props' in node) { const n = node as N; if (test(n)) out.push(n); find(n.props.children, test, out); }
  return out;
}
const byId = (root: unknown, id: string) => find(root, (n) => n.props['data-testid'] === id)[0];
const text = (n: unknown): string => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' && 'props' in n ? text((n as N).props.children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '';
const props = (o: Partial<PvpHudProps> = {}): PvpHudProps => ({ segments: [{ player: 0, colorKey: 'a', permille: 600 }, { player: 1, colorKey: 'b', permille: 400 }], palettes: { a: '#f00', b: '#00f' }, ticksLeft: 20 * 90, seat: 0, menuOpen: false, onLeave: () => {}, ...o });

describe('PvpHud', () => {
  it('formats match-timer from ticks left', () => {
    expect(formatTimer(20 * 90)).toBe('1:30'); expect(formatTimer(0)).toBe('0:00'); expect(formatTimer(-5)).toBe('0:00'); expect(formatTimer(1)).toBe('0:01');
    expect(text(byId(PvpHud(props()), 'match-timer'))).toBe('1:30');
  });
  it('renders N-color ownership bar with palettes', () => {
    const bar = find(PvpHud(props()), (n) => (n.type as unknown) === OwnershipBar)[0]!;
    expect((bar.props.segments as unknown[]).length).toBe(2); expect(bar.props.palettes).toEqual({ a: '#f00', b: '#00f' });
  });
  it('has no pause control and no Esc menu when closed', () => {
    const v = PvpHud(props());
    expect(find(v, (n) => n.type === 'button')).toHaveLength(0);
    expect(find(v, (n) => (n.type as unknown) === BattlePopup)).toHaveLength(0);
  });
  it('Esc menu offers Leave only', () => {
    const onLeave = vi.fn(), v = PvpHud(props({ menuOpen: true, onLeave }));
    expect(find(v, (n) => (n.type as unknown) === BattlePopup)).toHaveLength(1);
    const buttons = find(v, (n) => n.type === 'button'); expect(buttons).toHaveLength(1);
    (byId(v, 'pvp-leave')!.props.onClick as () => void)(); expect(onLeave).toHaveBeenCalledOnce();
  });
  it('spectator shows Spectating badge; player does not', () => {
    expect(text(byId(PvpHud(props({ seat: null })), 'pvp-spectating'))).toContain('Spectating');
    expect(byId(PvpHud(props()), 'pvp-spectating')).toBeUndefined();
  });
});

describe('Toast', () => {
  it('renders desync toast', () => {
    const v = Toast({ message: DESYNC_TOAST, testId: 'toast-desync' });
    expect(v.props['data-testid']).toBe('toast-desync'); expect(text(v)).toBe('Out of sync with server');
  });
});
