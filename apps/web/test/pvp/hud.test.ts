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

import { SeatLegend, legendEntries, type SeatLegendProps } from '../../src/ui/pvp/SeatLegend';
const legend = (o: Partial<SeatLegendProps> = {}): SeatLegendProps => ({
  seats: [{ player: 0, kind: 'human', team: 0, nick: 'Ann' }, { player: 1, kind: 'human', team: 0, nick: 'Bo' }, { player: 2, kind: 'human', team: 1, nick: 'Cy' }, { player: 3, kind: 'bot', team: 1, nick: 'Bot' }],
  colorKeys: ['blue', 'red', 'green', 'yellow'], palettes: { blue: '#00f', red: '#f00', green: '#0f0', yellow: '#ff0' }, seat: 0, ...o,
});
describe('SeatLegend (SP05 T12)', () => {
  it('4-seat team legend: you, ally, team badges, bot, eliminated, disconnected', () => {
    const v = SeatLegend(legend({ eliminatedAt: [-1, -1, 120, -1], seatStatus: { 1: { status: 'grace' } } }));
    for (let i = 0; i < 4; i++) expect(byId(v, `seat-legend-${i}`)).toBeDefined();
    expect(text(byId(v, 'seat-legend-0'))).toContain('(you)');
    expect(byId(v, 'seat-legend-1')!.props['data-ally']).toBe('true');
    expect(byId(v, 'seat-legend-2')!.props['data-ally']).toBe('false');
    expect([0, 1, 2, 3].map((i) => text(byId(v, `seat-legend-team-${i}`)))).toEqual(['T1', 'T1', 'T2', 'T2']);
    expect(text(byId(v, 'seat-legend-status-1'))).toBe('Disconnected');
    expect(text(byId(v, 'seat-legend-status-2'))).toBe('Eliminated');
    expect(text(byId(v, 'seat-legend-status-3'))).toBe('Bot');
    expect(byId(v, 'seat-legend-status-0')).toBeUndefined();
  });
  it('colors from palettes by colorKey; spectator has no you/ally; eliminated wins', () => {
    const e = legendEntries(legend({ seat: null, eliminatedAt: [-1, -1, -1, 5] }));
    expect(e.map((x) => x.color)).toEqual(['#00f', '#f00', '#0f0', '#ff0']);
    expect(e.some((x) => x.you || x.ally)).toBe(false);
    expect(e[3]!.status).toBe('eliminated');
  });
  it('HUD renders legend and passes teams to bar; bar groups teams with gap', () => {
    const v = PvpHud(props({ legend: legend() }));
    expect(find(v, (n) => (n.type as unknown) === SeatLegend)).toHaveLength(1);
    const segs = [{ player: 0, colorKey: 'a', permille: 300 }, { player: 2, colorKey: 'b', permille: 300 }, { player: 1, colorKey: 'c', permille: 400 }];
    const bar = OwnershipBar({ segments: segs, palettes: {}, teams: [0, 0, 1, 1] });
    const spans = find(bar, (n) => n.type === 'span');
    expect(spans.map((s) => s.props['data-ownership-player'])).toEqual([0, 1, 2]);
    expect(spans.map((s) => s.props.class)).toEqual([undefined, undefined, 'team-gap']);
  });
});
