import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import type { LobbyStateMsg } from '@node-arena/net';
import { PvpMenu } from '../../src/ui/pvp/PvpMenu';
import { Lobby, startBlocker } from '../../src/ui/pvp/Lobby';
import { SeatRow } from '../../src/ui/pvp/SeatRow';
import { Picker } from '../../src/ui/Picker';
import { defaultSave } from '../../src/save';
import type { AppSnapshot } from '../../src/app/state';

type N = VNode<Record<string, unknown>>;
function find(node: unknown, test: (n: N) => boolean, out: N[] = []): N[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, test, out));
  else if (node && typeof node === 'object' && 'props' in node) { const n = node as N; if (test(n)) out.push(n); find(n.props.children, test, out); }
  return out;
}
const byId = (root: unknown, id: string) => find(root, (n) => n.props['data-testid'] === id)[0];
const text = (n: unknown): string => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' && 'props' in n ? text((n as N).props.children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '';

const seat = (kind: 'human' | 'bot', team: number, occupant?: { nick: string; ready: boolean }) => ({ kind, team, ...(occupant ? { occupant: { ...occupant, status: 'connected' as const } } : {}) });
const lobby = (seats: LobbyStateMsg['seats'], host: number | null = 0): LobbyStateMsg => ({ t: 'lobby.state', levelId: 'duel-s', timeLimitSec: 60, host, spectators: 0, seats });

const menuProps = (o: Partial<Parameters<typeof PvpMenu>[0]> = {}) => ({ view: 'home' as const, joinRole: 'play' as const, nick: 'Ann', code: '', error: null, onNick: () => {}, onCode: () => {}, onGoCreate: () => {}, onGoJoin: () => {}, onRole: () => {}, onJoin: () => {}, onBack: () => {}, onDismissError: () => {}, ...o });
const lobbyProps = (o: Partial<Parameters<typeof Lobby>[0]> = {}) => ({ code: 'ABCD', lobby: lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1)]), seat: 0, host: true, conn: 'connected' as const, error: null, levelName: 'Duel S', seatColors: ['#f00', '#00f'], onReady: () => {}, onStart: () => {}, onLeave: () => {}, onRetry: () => {}, onDismissError: () => {}, ...o });

const click = (n: N | undefined) => (n!.props.onClick as () => void)();
describe('PvpMenu', () => {
  it('home shows exactly two tiles', () => {
    const onGoCreate = vi.fn(), onGoJoin = vi.fn(), v = PvpMenu(menuProps({ onGoCreate, onGoJoin }));
    expect(find(v, (n) => String(n.props.class ?? '').includes('menu-tile'))).toHaveLength(2);
    click(byId(v, 'pvp-create-tile')); click(byId(v, 'pvp-join-tile'));
    expect(onGoCreate).toHaveBeenCalledOnce(); expect(onGoJoin).toHaveBeenCalledOnce();
    expect(byId(v, 'pvp-nick')).toBeUndefined();
  });
  it('role chooser: Participant -> play, Spectate -> watch', () => {
    const onRole = vi.fn(), v = PvpMenu(menuProps({ view: 'join-role', onRole }));
    click(byId(v, 'pvp-role-play')); click(byId(v, 'pvp-role-watch'));
    expect(onRole.mock.calls).toEqual([['play'], ['watch']]);
  });
  it('join form order nick, code, Join last; submit uses role; disabled until valid', () => {
    const onJoin = vi.fn(), v = PvpMenu(menuProps({ view: 'join-form', joinRole: 'watch', code: 'ABCD', onJoin }));
    const ids = find(v, (n) => typeof n.props['data-testid'] === 'string').map((n) => n.props['data-testid']);
    expect(ids.filter((i) => ['pvp-nick', 'pvp-code-input', 'pvp-join'].includes(i as string))).toEqual(['pvp-nick', 'pvp-code-input', 'pvp-join']);
    expect(ids[ids.length - 1]).toBe('pvp-join');
    expect(byId(v, 'pvp-nick')!.props.maxLength).toBe(20);
    const form = find(v, (n) => n.type === 'form')[0]!, preventDefault = vi.fn();
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault });
    expect(onJoin).toHaveBeenCalledWith('ABCD', 'watch'); expect(preventDefault).toHaveBeenCalled();
    expect(byId(v, 'pvp-join')!.props.disabled).toBe(false);
    expect(byId(PvpMenu(menuProps({ view: 'join-form', code: '' })), 'pvp-join')!.props.disabled).toBe(true);
    expect(byId(PvpMenu(menuProps({ view: 'join-form', nick: ' ', code: 'X' })), 'pvp-join')!.props.disabled).toBe(true);
    onJoin.mockClear();
    (find(PvpMenu(menuProps({ view: 'join-form', code: '', onJoin })), (n) => n.type === 'form')[0]!.props.onSubmit as (e: unknown) => void)({ preventDefault });
    expect(onJoin).not.toHaveBeenCalled();
  });
  it('back and error text', () => {
    const onBack = vi.fn(); click(byId(PvpMenu(menuProps({ onBack })), 'pvp-back')); expect(onBack).toHaveBeenCalledOnce();
    expect(text(byId(PvpMenu(menuProps({ error: 'Room not found.' })), 'pvp-error'))).toContain('Room not found.');
  });
});

describe('Lobby', () => {
  it('shows code, conn state and 2 seat rows', () => {
    const v = Lobby(lobbyProps());
    expect(text(byId(v, 'lobby-code'))).toBe('ABCD'); expect(text(byId(v, 'conn-state'))).toBe('connected');
    expect(find(v, (n) => (n.type as unknown) === SeatRow)).toHaveLength(2);
    const r0 = SeatRow({ index: 0, seat: lobbyProps().lobby!.seats[0]!, you: true, host: true }), r1 = SeatRow({ index: 1, seat: lobbyProps().lobby!.seats[1]!, you: false, host: false });
    expect(byId(r0, 'lobby-seat-0')).toBeTruthy(); expect(text(r0)).toContain('a (you)'); expect(text(r1)).toContain('Open');
  });
  it('host start disabled with reason until opponent joins and readies', () => {
    expect(startBlocker(lobbyProps().lobby)).toBe('Waiting for opponent');
    const v = Lobby(lobbyProps());
    expect(byId(v, 'lobby-start')!.props.disabled).toBe(true); expect(text(byId(v, 'lobby-reason'))).toBe('Waiting for opponent');
    const joined = lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1, { nick: 'b', ready: false })]);
    expect(startBlocker(joined)).toBe('Waiting for ready');
    const ready = lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1, { nick: 'b', ready: true })]);
    expect(startBlocker(ready)).toBeNull();
    const onStart = vi.fn(), w = Lobby(lobbyProps({ lobby: ready, onStart }));
    expect(byId(w, 'lobby-start')!.props.disabled).toBe(false); expect(byId(w, 'lobby-reason')).toBeUndefined();
    (byId(w, 'lobby-start')!.props.onClick as () => void)(); expect(onStart).toHaveBeenCalledOnce();
  });
  it('guest sees ready toggle, no start; Leave and retry wired', () => {
    const onReady = vi.fn(), onLeave = vi.fn(), onRetry = vi.fn();
    const l = lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1, { nick: 'b', ready: false })]);
    const v = Lobby(lobbyProps({ lobby: l, seat: 1, host: false, conn: 'lost', onReady, onLeave, onRetry }));
    expect(byId(v, 'lobby-start')).toBeUndefined(); expect(byId(v, 'lobby-ready')!.props['aria-pressed']).toBe(false);
    (byId(v, 'lobby-ready')!.props.onClick as () => void)(); (byId(v, 'lobby-leave')!.props.onClick as () => void)(); (byId(v, 'conn-retry')!.props.onClick as () => void)();
    expect(onReady).toHaveBeenCalledOnce(); expect(onLeave).toHaveBeenCalledOnce(); expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('Lobby M2 full', () => {
  const maps = [{ id: 'duel-s', name: 'Duel S', maxPlayers: 2, teams: [0, 1], timeLimitSec: 60, theme: 't' }, { id: 'cross', name: 'Cross', maxPlayers: 4, teams: [0, 1, 0, 1], timeLimitSec: 60, theme: 't' }];
  const two = lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1, { nick: 'b', ready: true })]);
  const rowProps = (n: N) => n.props as unknown as Parameters<typeof SeatRow>[0];
  it('host sees map cards and seat controls; picking wires callbacks', () => {
    const onMap = vi.fn(), onSeat = vi.fn();
    const v = Lobby(lobbyProps({ lobby: two, maps, onMap, onSeat }));
    expect(byId(v, 'lobby-map-duel-s')!.props.disabled).toBe(false); expect(byId(v, 'lobby-map-cross')).toBeTruthy();
    (byId(v, 'lobby-map-cross')!.props.onClick as () => void)(); expect(onMap).toHaveBeenCalledWith('cross');
    const r1 = find(v, (n) => (n.type as unknown) === SeatRow)[1]!;
    const row = SeatRow(rowProps(r1));
    const kind = byId(row, 'seat-kind-1')!, team = byId(row, 'seat-team-1')!;
    expect(byId(row, 'seat-kind-0')).toBeUndefined();
    (r1.props.onChange as (i: number, p: object) => void)(1, { kind: 'bot' });
    expect(onSeat).toHaveBeenCalledWith([{ kind: 'human', team: 0 }, { kind: 'bot', team: 1, difficulty: 'normal' }]);
    (r1.props.onChange as (i: number, p: object) => void)(1, { team: 0 });
    expect(onSeat).toHaveBeenLastCalledWith([{ kind: 'human', team: 0 }, { kind: 'human', team: 0 }]);
    expect(kind.props.value).toBe('human'); expect(team.props.value).toBe('1');
    expect(byId(SeatRow({ ...rowProps(r1), seat: { kind: 'bot', team: 1, difficulty: 'hard' } }), 'seat-difficulty-1')!.props.value).toBe('hard');
    expect(byId(SeatRow({ ...rowProps(r1), seat: { kind: 'human', team: 1 } }), 'seat-difficulty-1')).toBeUndefined();
  });
  it('non-host: read-only seats and map cards, Ready shown', () => {
    const v = Lobby(lobbyProps({ lobby: two, maps, host: false, seat: 1 }));
    expect(byId(v, 'lobby-map-cross')!.props.disabled).toBe(true);
    const r = SeatRow({ ...rowProps(find(v, (n) => (n.type as unknown) === SeatRow)[1]!) });
    expect(byId(r, 'seat-kind-1')).toBeUndefined(); expect(byId(r, 'seat-team-1')).toBeUndefined(); expect(byId(r, 'seat-team-label-1')).toBeTruthy();
    expect(byId(v, 'lobby-ready')).toBeTruthy(); expect(byId(v, 'lobby-start')).toBeUndefined();
  });
  it('start blockers: disconnected/reserved seat, empty seats ignored', () => {
    const grace = lobby([seat('human', 0, { nick: 'a', ready: true }), { kind: 'human', team: 1, occupant: { nick: 'b', ready: true, status: 'away' } }]);
    expect(startBlocker(grace)).toBe('Waiting for player to reconnect');
    const v = Lobby(lobbyProps({ lobby: grace })); expect(byId(v, 'lobby-start')!.props.disabled).toBe(true);
    expect(text(byId(SeatRow({ index: 1, seat: grace.seats[1]!, you: false, host: false }), 'lobby-seat-1'))).toContain('Not connected');
    const withBot = lobby([seat('human', 0, { nick: 'a', ready: true }), { kind: 'bot', team: 1, difficulty: 'easy' }, { kind: 'empty', team: 0 }]);
    expect(startBlocker(withBot)).toBeNull();
  });
  it('share links with copy buttons and spectator count', () => {
    const onCopy = vi.fn(), links = { play: 'http://x/?room=ABCD', watch: 'http://x/?room=ABCD&watch' };
    const v = Lobby(lobbyProps({ lobby: { ...two, spectators: 3 }, links, onCopy }));
    (byId(v, 'copy-play-link')!.props.onClick as () => void)(); (byId(v, 'copy-watch-link')!.props.onClick as () => void)();
    expect(onCopy).toHaveBeenNthCalledWith(1, links.play); expect(onCopy).toHaveBeenNthCalledWith(2, links.watch);
    expect(text(byId(v, 'lobby-spectators'))).toContain('3');
  });
});

describe('Picker Play online', () => {
  const state = { save: defaultSave(), levels: [], customLevels: [], pickerView: 'main' } as unknown as AppSnapshot;
  it('shows pvp-play only when onPlayOnline given', () => {
    const base = { state, onStart: () => {}, onMute: () => {}, onCredits: () => {} };
    expect(byId(Picker(base), 'pvp-play')).toBeUndefined();
    const fn = vi.fn(), v = Picker({ ...base, onPlayOnline: fn });
    (byId(v, 'pvp-play')!.props.onClick as () => void)(); expect(fn).toHaveBeenCalledOnce();
  });
});

describe('PvpLayer leave', () => {
  it('eliminated seat and spectators leave directly; live seats confirm quit', async () => {
    const { leaveNeedsConfirm } = await import('../../src/ui/pvp/PvpLayer');
    expect(leaveNeedsConfirm(1, false)).toBe(true);
    expect(leaveNeedsConfirm(1, true)).toBe(false);
    expect(leaveNeedsConfirm(null, false)).toBe(false);
  });
});
