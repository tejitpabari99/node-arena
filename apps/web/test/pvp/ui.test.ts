import { describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import type { LobbyStateMsg } from '@node-arena/net';
import { PvpMenu } from '../../src/ui/pvp/PvpMenu';
import { Lobby, startBlocker } from '../../src/ui/pvp/Lobby';
import { RoomForm, type RoomFormProps } from '../../src/ui/pvp/RoomForm';
import { lastRowHeld, movedToSpectators, movedToast } from '../../src/pvp/room-draft';
import type { PvpMapInfo } from '@node-arena/content';
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
const lobbyProps = (o: Partial<Parameters<typeof Lobby>[0]> = {}) => ({ code: 'ABCD', lobby: lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1)]), seat: 0, host: true, conn: 'connected' as const, error: null, nick: 'Ann', seatColors: ['#f00', '#00f'], onReady: () => {}, onStart: () => {}, onLeave: () => {}, onRetry: () => {}, onDismissError: () => {}, ...o });

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

const maps = [{ id: 'duel-s', name: 'Duel S', maxPlayers: 2, teams: [0, 1], timeLimitSec: 60, theme: 't' }, { id: 'cross', name: 'Cross', maxPlayers: 4, teams: [0, 1, 0, 1], timeLimitSec: 60, theme: 't' }] as unknown as PvpMapInfo[];
const crossLobby = (seats: LobbyStateMsg['seats'], spectators = 0): LobbyStateMsg => ({ ...lobby(seats), levelId: 'cross', spectators });
describe('Lobby', () => {
  it('shows code, conn state, live form rows with joiner nick and Open', () => {
    const v = Lobby(lobbyProps({ maps }));
    expect(text(byId(v, 'lobby-code'))).toBe('ABCD'); expect(text(byId(v, 'conn-state'))).toBe('connected');
    const live = find(v, (n) => (n.type as unknown) === RoomForm)[0]!, f = RoomForm(live.props as unknown as RoomFormProps);
    expect(text(byId(f, 'pvp-nick-label'))).toContain('Ann'); expect(byId(f, 'pvp-nick')).toBeUndefined();
    expect(text(byId(f, 'lobby-seat-0'))).toContain('Player 1 · a'); expect(text(byId(f, 'lobby-seat-1'))).toContain('Open');
    const joined = Lobby(lobbyProps({ maps, lobby: lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1, { nick: 'Bob', ready: false })]) }));
    expect(text(byId(RoomForm(find(joined, (n) => (n.type as unknown) === RoomForm)[0]!.props as unknown as RoomFormProps), 'lobby-seat-1'))).toContain('Bob');
  });
  it('bot rows are labelled Bot1, Bot2', () => {
    const l = crossLobby([seat('human', 0, { nick: 'a', ready: true }), { kind: 'human', team: 1 }, { kind: 'bot', team: 2, difficulty: 'easy' }, { kind: 'bot', team: 3, difficulty: 'easy' }]);
    const f = RoomForm(find(Lobby(lobbyProps({ maps, lobby: l })), (n) => (n.type as unknown) === RoomForm)[0]!.props as unknown as RoomFormProps);
    expect(text(byId(f, 'lobby-seat-2'))).toContain('Bot1'); expect(text(byId(f, 'lobby-seat-3'))).toContain('Bot2');
  });
  it('host start disabled with reason until opponent joins and readies', () => {
    expect(startBlocker(lobbyProps().lobby)).toBe('Waiting for opponent');
    const v = Lobby(lobbyProps({ maps }));
    expect(byId(v, 'lobby-start')!.props.disabled).toBe(true); expect(text(byId(v, 'lobby-reason'))).toBe('Waiting for opponent');
    const joined = lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1, { nick: 'b', ready: false })]);
    expect(startBlocker(joined)).toBe('Waiting for ready');
    const ready = lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1, { nick: 'b', ready: true })]);
    expect(startBlocker(ready)).toBeNull();
    const onStart = vi.fn(), w = Lobby(lobbyProps({ maps, lobby: ready, onStart }));
    expect(byId(w, 'lobby-start')!.props.disabled).toBe(false); expect(byId(w, 'lobby-reason')).toBeUndefined();
    (byId(w, 'lobby-start')!.props.onClick as () => void)(); expect(onStart).toHaveBeenCalledOnce();
    expect(startBlocker(lobby([seat('human', 0, { nick: 'a', ready: true }), { kind: 'bot', team: 0, difficulty: 'easy' }]))).toBe('Need at least 2 teams');
  });
  it('guest sees ready toggle, no start; Leave and retry wired', () => {
    const onReady = vi.fn(), onLeave = vi.fn(), onRetry = vi.fn();
    const l = lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1, { nick: 'b', ready: false })]);
    const v = Lobby(lobbyProps({ maps, lobby: l, seat: 1, host: false, conn: 'lost', onReady, onLeave, onRetry }));
    expect(byId(v, 'lobby-start')).toBeUndefined(); expect(byId(v, 'lobby-ready')!.props['aria-pressed']).toBe(false);
    (byId(v, 'lobby-ready')!.props.onClick as () => void)(); (byId(v, 'lobby-leave')!.props.onClick as () => void)(); (byId(v, 'conn-retry')!.props.onClick as () => void)();
    expect(onReady).toHaveBeenCalledOnce(); expect(onLeave).toHaveBeenCalledOnce(); expect(onRetry).toHaveBeenCalledOnce();
  });
  it('spectator sees Spectating and no Ready', () => {
    const v = Lobby(lobbyProps({ maps, host: false, seat: null }));
    expect(byId(v, 'lobby-ready')).toBeUndefined(); expect(text(v)).toContain('Spectating');
  });
});

describe('Lobby live edits', () => {
  const two = lobby([seat('human', 0, { nick: 'a', ready: true }), seat('human', 1, { nick: 'b', ready: true })]);
  const form = (o: Partial<Parameters<typeof Lobby>[0]> = {}) => find(Lobby(lobbyProps({ maps, ...o })), (n) => (n.type as unknown) === RoomForm)[0]!.props as unknown as RoomFormProps;
  it('host edits send one update with levelId + seats', () => {
    const onUpdate = vi.fn(), onHint = vi.fn(), p = form({ lobby: two, onUpdate, onHint });
    p.onMap('cross');
    expect(onUpdate).toHaveBeenLastCalledWith('cross', [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }]);
    p.onRow(1, { kind: 'bot' });
    expect(onUpdate).toHaveBeenLastCalledWith('duel-s', [{ kind: 'human', team: 0 }, { kind: 'bot', difficulty: 'normal', team: 1 }]);
    expect(onUpdate).toHaveBeenCalledTimes(2);
    const q = form({ lobby: crossLobby([seat('human', 0, { nick: 'a', ready: true }), { kind: 'human', team: 1 }]), onUpdate });
    q.onPlayers(4);
    expect(onUpdate).toHaveBeenLastCalledWith('cross', [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }, { kind: 'human', team: 2 }, { kind: 'human', team: 3 }]);
  });
  it('non-host form is read-only', () => {
    const f = RoomForm(form({ lobby: two, host: false, seat: 1 }));
    expect(byId(f, 'map-cross')!.props.disabled).toBe(true); expect(byId(f, 'type-team')!.props.disabled).toBe(true);
    expect(byId(f, 'seat-kind-1')).toBeUndefined(); expect(byId(f, 'seat-team-label-1')).toBeTruthy();
    expect(text(byId(f, 'lobby-seat-1'))).toContain('(you)');
  });
  it('"-" is locked with a hint while another human holds the last row', () => {
    const held = crossLobby([seat('human', 0, { nick: 'a', ready: true }), { kind: 'human', team: 1 }, { kind: 'human', team: 2 }, seat('human', 3, { nick: 'z', ready: false })]);
    const f = RoomForm(form({ lobby: held }));
    expect(byId(f, 'players-minus')!.props.disabled).toBe(true); expect(byId(f, 'players-hint')).toBeTruthy();
    const free = crossLobby([seat('human', 0, { nick: 'a', ready: true }), { kind: 'human', team: 1 }, { kind: 'human', team: 2 }, { kind: 'human', team: 3 }]);
    const g = RoomForm(form({ lobby: free }));
    expect(byId(g, 'players-minus')!.props.disabled).toBe(false); expect(byId(g, 'players-hint')).toBeUndefined();
    expect(lastRowHeld(held.seats)).toBe(true); expect(lastRowHeld(free.seats)).toBe(false);
  });
  it('copy links and spectator count', () => {
    const onCopy = vi.fn(), links = { play: 'http://x/?room=ABCD', watch: 'http://x/?room=ABCD&watch' };
    const v = Lobby(lobbyProps({ maps, lobby: { ...two, spectators: 3 }, links, onCopy }));
    (byId(v, 'copy-play-link')!.props.onClick as () => void)(); (byId(v, 'copy-watch-link')!.props.onClick as () => void)();
    expect(onCopy).toHaveBeenNthCalledWith(1, links.play); expect(onCopy).toHaveBeenNthCalledWith(2, links.watch);
    expect(text(byId(v, 'lobby-spectators'))).toContain('3');
  });
  it('start blockers: disconnected seat, empty seats ignored', () => {
    const grace = lobby([seat('human', 0, { nick: 'a', ready: true }), { kind: 'human', team: 1, occupant: { nick: 'b', ready: true, status: 'away' } }]);
    expect(startBlocker(grace)).toBe('Waiting for player to reconnect');
    expect(byId(Lobby(lobbyProps({ maps, lobby: grace })), 'lobby-start')!.props.disabled).toBe(true);
    const withBot = lobby([seat('human', 0, { nick: 'a', ready: true }), { kind: 'bot', team: 1, difficulty: 'easy' }, { kind: 'empty', team: 0 }]);
    expect(startBlocker(withBot)).toBeNull();
  });
  it('moved-to-spectators diff toast', () => {
    const full = { seats: [seat('human', 0, { nick: 'a', ready: true }), seat('human', 1, { nick: 'b', ready: true })], spectators: 0 };
    expect(movedToSpectators(full, { seats: [full.seats[0]!, { kind: 'bot', team: 1, difficulty: 'easy' }], spectators: 1 })).toBe(1);
    expect(movedToSpectators(full, { seats: [full.seats[0]!, { kind: 'human', team: 1 }], spectators: 0 })).toBe(0); // plain leave
    expect(movedToSpectators(full, { ...full, spectators: 1 })).toBe(0); // spectator joined
    expect(movedToSpectators(null, full)).toBe(0);
    expect(movedToast(1)).toBe('1 player moved to spectators'); expect(movedToast(2)).toBe('2 players moved to spectators');
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
