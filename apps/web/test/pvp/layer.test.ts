import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VNode } from 'preact';
import type { PvpMapInfo } from '@node-arena/content';
import type { ClientMessage, LobbyStateMsg, ServerMessage, Versions } from '@node-arena/net';
import type { PvpConnection } from '../../src/net/connection';
import { createIdentity } from '../../src/net/identity';
import { createPvpController, type PvpController, type PvpSnapshot } from '../../src/pvp/controller';
import { newDraft, setType } from '../../src/pvp/room-draft';
import { mount } from './mini-hooks';

vi.mock('preact/hooks', () => import('./mini-hooks'));
const { PvpLayer, TOAST_MS } = await import('../../src/ui/pvp/PvpLayer');
const { PvpMenu } = await import('../../src/ui/pvp/PvpMenu');
const { RoomForm } = await import('../../src/ui/pvp/RoomForm');
const { Lobby } = await import('../../src/ui/pvp/Lobby');

type N = VNode<Record<string, unknown>>;
function find(node: unknown, test: (n: N) => boolean, out: N[] = []): N[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, test, out));
  else if (node && typeof node === 'object' && 'props' in node) { const n = node as N; if (test(n)) out.push(n); find(n.props.children, test, out); }
  return out;
}
const byId = (root: unknown, id: string) => find(root, (n) => n.props['data-testid'] === id)[0];
const text = (n: unknown): string => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' && 'props' in n ? text((n as N).props.children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '';
const call = (f: unknown, ...a: unknown[]) => (f as (...x: unknown[]) => unknown)(...a);
type Props = Record<string, unknown> & { children?: unknown };
const asProps = (n: unknown) => (n as N).props as Props;
/** Renders a component VNode the way preact would (one level, no hooks inside). */
const view = (n: unknown) => (n as N & { type: (p: Props) => unknown }).type(asProps(n));

const map = (id: string, maxPlayers: number, teams?: number[]): PvpMapInfo => ({ id, name: id, maxPlayers, teams: teams ?? Array.from({ length: maxPlayers }, (_, i) => i), timeLimitSec: null, theme: 't' });
const maps = [map('duel', 2), map('cross', 4, [0, 0, 1, 1])];
const versions: Versions = { rules: 'r', schema: 's', content: 'c', bot: 'b' };
const welcome: ServerMessage = { t: 'welcome', pv: 1, playerId: 'p', serverVersions: versions };

function real(nick = 'Ann') {
  const sent: ClientMessage[] = [], cbs = new Set<(m: ServerMessage) => void>();
  const conn: PvpConnection = { state: 'connected', info: { attempt: 0, nextRetryAt: null, outageStartedAt: null, lastCloseCode: null }, send(m) { sent.push(m); return true; }, onMessage(cb) { cbs.add(cb); return () => cbs.delete(cb); }, onState() { return () => {}; }, retry() {}, close() {} };
  const identity = createIdentity({ local: null, session: null }); if (nick) identity.setNick(nick);
  const ctl = createPvpController({ identity, serverUrl: 'ws://x', versions, createSocket: () => { throw new Error('no'); }, createConnection: () => conn, maps: () => maps });
  return { ctl, sent, push: (m: ServerMessage) => cbs.forEach((f) => f(m)) };
}

const baseSnap = (patch: Partial<PvpSnapshot>): PvpSnapshot => ({
  screen: 'menu', nick: 'Ann', nickDraft: 'Ann', menuView: 'home', joinRole: 'play', createDraft: null, conn: 'connected', connInfo: null, code: null, seat: null, host: false, role: 'play',
  lobby: null, start: null, end: null, ranking: null, pause: null, error: null, serverUrl: 'ws://x', pvpUnavailable: false, draining: null, ...patch,
});
/** Controller stand-in for pure state -> props tests; `set` publishes a new snapshot. */
function stub(patch: Partial<PvpSnapshot>) {
  let snap = baseSnap(patch);
  const subs = new Set<() => void>();
  const ctl = {
    snapshot: () => snap, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; }, maps: () => maps, level: () => undefined, options: {},
    setNick: vi.fn(), join: vi.fn(), goCreate: vi.fn(), goJoin: vi.fn(), chooseRole: vi.fn(), back: vi.fn(), dismissError: vi.fn(), createRoom: vi.fn(),
  };
  return { ctl: ctl as unknown as PvpController, fns: ctl, set(p: Partial<PvpSnapshot>) { snap = { ...snap, ...p }; subs.forEach((f) => f()); }, listeners: () => subs.size };
}
const mk = (pvp: PvpController) => mount(PvpLayer, { pvp, thumbs: undefined });

const seat = (kind: 'human' | 'bot', team: number, occupant?: { nick: string; ready: boolean }) => ({ kind, team, ...(occupant ? { occupant: { ...occupant, status: 'connected' as const } } : {}) });
const lobbyMsg = (levelId: string, seats: LobbyStateMsg['seats'], spectators = 0): LobbyStateMsg => ({ t: 'lobby.state', levelId, timeLimitSec: 60, host: 0, spectators, seats });
const duelLobby = (guest?: string) => lobbyMsg('duel', [seat('human', 0, { nick: 'Ann', ready: true }), seat('human', 1, guest ? { nick: guest, ready: true } : undefined)]);

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('PvpLayer menu flow (real controller)', () => {
  it('join-role -> join-form: Join is disabled until nickname and code are valid; Spectate joins as watch', () => {
    const h = real(''); h.ctl.open();
    const m = mk(h.ctl);
    expect(asProps(m.output)).toMatchObject({ view: 'home', joinRole: 'play' });
    call(asProps(m.output).onGoJoin);
    expect(asProps(m.output).view).toBe('join-role');
    const roles = view(m.output);
    call(asProps(byId(roles, 'pvp-role-watch')).onClick);
    expect(asProps(m.output)).toMatchObject({ view: 'join-form', joinRole: 'watch' });
    const join = () => byId(view(m.output), 'pvp-join')!.props.disabled;
    expect(join()).toBe(true); // no nick, no code
    call(asProps(m.output).onCode, 'abcd'); expect(asProps(m.output).code).toBe('abcd'); expect(join()).toBe(true); // code only
    call(asProps(m.output).onNick, '   '); expect(join()).toBe(true); // blank nick
    call(asProps(m.output).onNick, 'Zed'); expect(asProps(m.output).nick).toBe('Zed'); expect(join()).toBe(false);
    call(asProps(m.output).onCode, ''); expect(join()).toBe(true);
    call(asProps(m.output).onCode, 'wxyz');
    const form = find(view(m.output), (n) => n.type === 'form')[0]!;
    call(form.props.onSubmit, { preventDefault: () => {} });
    expect(h.ctl.snapshot().screen).toBe('connecting');
    h.push(welcome);
    expect(h.sent).toEqual([{ t: 'room.join', code: 'WXYZ', role: 'watch' }]);
    m.unmount();
  });
  it('Participant role joins as play and Back steps join-form -> join-role -> home', () => {
    const h = real(); h.ctl.open();
    const m = mk(h.ctl);
    call(asProps(m.output).onGoJoin); call(asProps(byId(view(m.output), 'pvp-role-play')).onClick);
    expect(asProps(m.output)).toMatchObject({ view: 'join-form', joinRole: 'play' });
    call(asProps(m.output).onCode, 'q1w2'); call(asProps(m.output).onJoin, 'q1w2', 'play'); h.push(welcome);
    expect(h.sent).toEqual([{ t: 'room.join', code: 'Q1W2', role: 'play' }]);
    m.unmount();
    const g = real(); g.ctl.open(); const n = mk(g.ctl);
    call(asProps(n.output).onGoJoin); call(asProps(n.output).onRole, 'play');
    call(asProps(n.output).onBack); expect(asProps(n.output).view).toBe('join-role');
    call(asProps(n.output).onBack); expect(asProps(n.output).view).toBe('home');
    n.unmount();
  });
  it('create form defaults: PvP, first map, 2 players, host row plus one Open human row', () => {
    const h = real(); h.ctl.open();
    const m = mk(h.ctl);
    call(asProps(m.output).onGoCreate);
    expect(asProps(m.output).view).toBe('create');
    const form = (asProps(m.output).children as N);
    expect(form.type).toBe(RoomForm);
    const f = view(form);
    expect(byId(f, 'type-pvp')!.props['aria-pressed']).toBe(true); expect(byId(f, 'type-team')!.props['aria-pressed']).toBe(false);
    expect(byId(f, 'map-duel')!.props['aria-pressed']).toBe(true); expect(byId(f, 'map-cross')!.props['aria-pressed']).toBe(false);
    expect(text(byId(f, 'players-value'))).toBe('2');
    expect(text(byId(f, 'lobby-seat-0'))).toContain('Player 1 (you)'); expect(text(byId(f, 'lobby-seat-1'))).toContain('Open');
    expect(find(f, (n) => String(n.props['data-testid'] ?? '').startsWith('lobby-seat-'))).toHaveLength(2);
    expect(byId(f, 'seat-kind-0')).toBeUndefined(); expect(byId(f, 'seat-kind-1')).toBeTruthy();
    expect(byId(f, 'teams-value')).toBeUndefined();
    expect(byId(f, 'pvp-create')!.props.disabled).toBe(false);
    m.unmount();
  });
  it('create form: Team shows the teams stepper and team selects, Bot select relabels the row Bot1', () => {
    const h = real(); h.ctl.open();
    const m = mk(h.ctl);
    call(asProps(m.output).onGoCreate);
    const f0 = asProps(asProps(m.output).children);
    call(f0.onMap, 'cross'); call(f0.onPlayers, 4); call(f0.onType, 'team');
    let f = view(asProps(m.output).children);
    expect(text(byId(f, 'teams-value'))).toBe('2');
    for (let i = 0; i < 4; i++) expect(byId(f, `seat-team-${i}`)).toBeTruthy();
    expect(find(f, (n) => String(n.props['data-testid'] ?? '').startsWith('lobby-seat-'))).toHaveLength(4);
    call(byId(f, 'seat-kind-2')!.props.onChange, { currentTarget: { value: 'bot' } });
    f = view(asProps(m.output).children);
    expect(text(byId(f, 'lobby-seat-2'))).toContain('Bot1'); expect(text(byId(f, 'lobby-seat-1'))).toContain('Open');
    expect(byId(f, 'seat-difficulty-2')).toBeTruthy();
    call(byId(f, 'seat-kind-1')!.props.onChange, { currentTarget: { value: 'bot' } });
    f = view(asProps(m.output).children);
    expect([1, 2, 3].map((i) => text(byId(f, `lobby-seat-${i}`)).match(/Bot\d|Open/)?.[0])).toEqual(['Bot1', 'Bot2', 'Open']);
    m.unmount();
  });
  it('Create room posts the drafted map and seats', () => {
    const h = real(); h.ctl.open();
    const m = mk(h.ctl);
    call(asProps(m.output).onGoCreate);
    call(asProps(asProps(m.output).children).onMap, 'cross');
    call(find(view(asProps(m.output).children), (n) => n.type === 'form')[0]!.props.onSubmit, { preventDefault: () => {} });
    h.push(welcome);
    expect(h.sent).toEqual([{ t: 'room.create', levelId: 'cross', seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }] }]);
    m.unmount();
  });
  it('unsubscribes from the controller on unmount', () => {
    const s = stub({});
    const m = mk(s.ctl); expect(s.listeners()).toBe(1);
    m.unmount(); expect(s.listeners()).toBe(0);
  });
});

describe('PvpLayer unavailable / refused states (stub controller)', () => {
  const createDraft = newDraft(maps)!;
  it('pvpUnavailable disables the tiles and Create, and shows the error without Reload or Dismiss', () => {
    const s = stub({ menuView: 'create', createDraft, pvpUnavailable: true, conn: 'refused', error: 'PvP unavailable: this build differs from the server' });
    const m = mk(s.ctl);
    expect(asProps(m.output)).toMatchObject({ unavailable: true, reload: false });
    const menu = view(m.output);
    expect(text(byId(menu, 'pvp-error'))).toContain('PvP unavailable');
    expect(byId(menu, 'pvp-reload')).toBeUndefined();
    expect(find(menu, (n) => n.type === 'button' && text(n) === 'Dismiss')).toHaveLength(0);
    expect(byId(view(asProps(m.output).children), 'pvp-create')!.props.disabled).toBe(true);
    s.set({ menuView: 'home' });
    expect(byId(view(m.output), 'pvp-create-tile')!.props.disabled).toBe(true); expect(byId(view(m.output), 'pvp-join-tile')!.props.disabled).toBe(true);
    m.unmount();
  });
  it('refused (newer build) offers Reload, disables Create and the tiles; Reload reloads the page', () => {
    const reload = vi.fn(); vi.stubGlobal('location', { reload, origin: 'http://x', pathname: '/' });
    const s = stub({ menuView: 'create', createDraft, conn: 'refused', error: 'A newer version of Node Arena is available - reload' });
    const m = mk(s.ctl);
    expect(asProps(m.output)).toMatchObject({ unavailable: false, reload: true });
    const menu = view(m.output);
    call(byId(menu, 'pvp-reload')!.props.onClick); expect(reload).toHaveBeenCalledOnce();
    expect(byId(view(asProps(m.output).children), 'pvp-create')!.props.disabled).toBe(true);
    s.set({ menuView: 'home' });
    expect(byId(view(m.output), 'pvp-create-tile')!.props.disabled).toBe(true);
    m.unmount();
  });
  it('connecting blocks Create and the tiles', () => {
    const s = stub({ screen: 'connecting', menuView: 'create', createDraft, conn: 'connecting' });
    const m = mk(s.ctl);
    expect(asProps(m.output).unavailable).toBe(true);
    expect(byId(view(asProps(m.output).children), 'pvp-create')!.props.disabled).toBe(true);
    m.unmount();
  });
  it('a healthy connection leaves Create enabled and a plain error dismissible', () => {
    const s = stub({ menuView: 'create', createDraft, error: 'Room not found. Check the code.' });
    const m = mk(s.ctl);
    expect(byId(view(asProps(m.output).children), 'pvp-create')!.props.disabled).toBe(false);
    const dismiss = find(view(m.output), (n) => n.type === 'button' && text(n) === 'Dismiss')[0]!;
    call(dismiss.props.onClick); expect(s.fns.dismissError).toHaveBeenCalledOnce();
    m.unmount();
  });
});

describe('PvpLayer lobby (stub controller)', () => {
  const draft = { ...setType(newDraft(maps)!, 'team', maps[1]!), mapId: 'cross' };
  const crossDraft = (type: 'pvp' | 'team', teams = 3) => ({ ...draft, type, teams, players: 4 });
  const crossLobby = lobbyMsg('cross', [seat('human', 0, { nick: 'Ann', ready: true }), seat('human', 1), seat('human', 2), seat('human', 3)]);
  const hostLobby = (patch: Partial<PvpSnapshot> = {}) => stub({ screen: 'lobby', host: true, seat: 0, code: 'ABCD', lobby: crossLobby, createDraft: crossDraft('team'), ...patch });
  const hintOf = (m: { output: unknown }) => asProps(m.output).hint;

  it('host sees code, Start, copy links, spectator count', () => {
    vi.stubGlobal('location', { origin: 'https://na.test', pathname: '/play/' });
    const s = hostLobby();
    const m = mk(s.ctl);
    expect((m.output as N).type).toBe(Lobby);
    expect(asProps(m.output).links).toEqual({ play: 'https://na.test/play/?room=ABCD', watch: 'https://na.test/play/?room=ABCD&watch' });
    const l = view(m.output);
    expect(text(byId(l, 'lobby-code'))).toBe('ABCD'); expect(byId(l, 'lobby-start')).toBeTruthy();
    expect(byId(l, 'copy-play-link')).toBeTruthy(); expect(byId(l, 'copy-watch-link')).toBeTruthy();
    expect(byId(l, 'lobby-ready')).toBeUndefined();
    m.unmount();
  });
  it('without a location there are no copy links', () => {
    const m = mk(hostLobby().ctl);
    expect(asProps(m.output).links).toBeNull(); expect(byId(view(m.output), 'copy-play-link')).toBeUndefined();
    m.unmount();
  });
  it('joiner sees a read-only form with Ready instead of Start', () => {
    const s = stub({ screen: 'lobby', host: false, seat: 1, code: 'ABCD', nick: 'Bob', lobby: duelLobby('Bob') });
    const m = mk(s.ctl), l = view(m.output);
    expect(byId(l, 'lobby-start')).toBeUndefined(); expect(byId(l, 'lobby-ready')).toBeTruthy();
    const form = view(find(l, (n) => (n.type as unknown) === RoomForm)[0]);
    expect(byId(form, 'seat-kind-1')).toBeUndefined(); expect(byId(form, 'type-team')!.props.disabled).toBe(true);
    expect(text(byId(form, 'lobby-seat-1'))).toContain('Bob');
    m.unmount();
  });
  it('an Open row shows the joiner nickname once someone takes it', () => {
    const s = stub({ screen: 'lobby', host: true, seat: 0, code: 'ABCD', lobby: duelLobby() });
    const m = mk(s.ctl);
    const row = () => text(byId(view(find(view(m.output), (n) => (n.type as unknown) === RoomForm)[0]), 'lobby-seat-1'));
    expect(row()).toContain('Open');
    s.set({ lobby: duelLobby('Bob') });
    expect(row()).toContain('Bob'); expect(row()).not.toContain('Open');
    m.unmount();
  });
  it('the host create-form type/teams survive room creation and later code changes', () => {
    const s = hostLobby(), m = mk(s.ctl);
    expect(hintOf(m)).toEqual({ type: 'team', teams: 3 });
    s.set({ code: 'WXYZ' });
    expect(hintOf(m)).toEqual({ type: 'team', teams: 3 });
    s.set({ createDraft: crossDraft('pvp', 2), code: 'QRST' }); // later draft changes do not overwrite a live hint
    expect(hintOf(m)).toEqual({ type: 'team', teams: 3 });
    m.unmount();
  });
  it('the hint is not applied when the draft map differs from the room map, or for non-hosts, and clears on leaving the lobby', () => {
    const other = hostLobby({ createDraft: { ...crossDraft('team'), mapId: 'duel' } }), a = mk(other.ctl);
    expect(hintOf(a)).toBeNull(); a.unmount();
    const guest = hostLobby({ host: false, seat: 1 }), b = mk(guest.ctl);
    expect(hintOf(b)).toBeNull(); b.unmount();
    const none = hostLobby({ createDraft: null }), c = mk(none.ctl);
    expect(hintOf(c)).toBeNull(); c.unmount();
    const s = hostLobby(), m = mk(s.ctl);
    expect(hintOf(m)).toEqual({ type: 'team', teams: 3 });
    s.set({ screen: 'menu', lobby: null, code: null }); s.set({ screen: 'lobby', lobby: crossLobby, code: 'NEXT', createDraft: { ...crossDraft('pvp', 2), mapId: 'duel' } });
    expect(hintOf(m)).toBeNull();
    m.unmount();
  });
  it('onHint lets the lobby remember a host edit', () => {
    const s = hostLobby({ createDraft: null }), m = mk(s.ctl);
    call(asProps(m.output).onHint, { type: 'team', teams: 2 });
    expect(hintOf(m)).toEqual({ type: 'team', teams: 2 });
    m.unmount();
  });
});

describe('PvpLayer moved-to-spectators toast', () => {
  const full = lobbyMsg('duel', [seat('human', 0, { nick: 'Ann', ready: true }), seat('human', 1, { nick: 'Bob', ready: true })]);
  const moved = (n: number) => lobbyMsg('cross', [seat('human', 0, { nick: 'Ann', ready: true }), ...Array.from({ length: 3 }, (_, i) => (i < 3 - n ? seat('human', i + 1, { nick: `p${i}`, ready: true }) : seat('human', i + 1)))], n);
  const toastOf = (m: { output: unknown }) => asProps(m.output).toast;
  const fourFull = lobbyMsg('cross', [0, 1, 2, 3].map((i) => seat('human', i, { nick: `p${i}`, ready: true })));

  it('shows the singular toast for the diff, then dismisses it after TOAST_MS', () => {
    vi.useFakeTimers();
    const s = stub({ screen: 'lobby', host: true, seat: 0, code: 'ABCD', lobby: full }), m = mk(s.ctl);
    expect(toastOf(m)).toBeNull();
    s.set({ lobby: lobbyMsg('duel', [seat('human', 0, { nick: 'Ann', ready: true }), { kind: 'bot', team: 1, difficulty: 'easy' }], 1) });
    expect(toastOf(m)).toBe('1 player moved to spectators');
    vi.advanceTimersByTime(TOAST_MS - 1); expect(toastOf(m)).toBe('1 player moved to spectators');
    vi.advanceTimersByTime(1); expect(toastOf(m)).toBeNull();
    m.unmount();
  });
  it('uses the plural for several players', () => {
    vi.useFakeTimers();
    const s = stub({ screen: 'lobby', host: true, seat: 0, code: 'ABCD', lobby: fourFull }), m = mk(s.ctl);
    s.set({ lobby: moved(2) });
    expect(toastOf(m)).toBe('2 players moved to spectators');
    m.unmount();
  });
  it('no toast for a plain leave or a spectator joining', () => {
    vi.useFakeTimers();
    const s = stub({ screen: 'lobby', host: true, seat: 0, code: 'ABCD', lobby: full }), m = mk(s.ctl);
    s.set({ lobby: lobbyMsg('duel', [seat('human', 0, { nick: 'Ann', ready: true }), seat('human', 1)]) });
    expect(toastOf(m)).toBeNull();
    s.set({ lobby: lobbyMsg('duel', [seat('human', 0, { nick: 'Ann', ready: true }), seat('human', 1)], 2) });
    expect(toastOf(m)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    m.unmount();
  });
  it('clears the pending toast timer on unmount', () => {
    vi.useFakeTimers();
    const s = stub({ screen: 'lobby', host: true, seat: 0, code: 'ABCD', lobby: fourFull }), m = mk(s.ctl);
    s.set({ lobby: moved(1) });
    expect(toastOf(m)).toBe('1 player moved to spectators');
    expect(vi.getTimerCount()).toBe(1);
    m.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('an unrelated lobby update inside the window neither dismisses the toast early nor leaves it stuck', () => {
    vi.useFakeTimers();
    const s = stub({ screen: 'lobby', host: true, seat: 0, code: 'ABCD', lobby: fourFull }), m = mk(s.ctl);
    s.set({ lobby: moved(1) });
    vi.advanceTimersByTime(1000);
    s.set({ lobby: { ...moved(1), host: 0, timeLimitSec: 90 } }); // e.g. another lobby.state (same occupancy)
    expect(toastOf(m)).toBe('1 player moved to spectators');
    vi.advanceTimersByTime(TOAST_MS);
    expect(toastOf(m)).toBeNull();
    m.unmount();
  });
  it('a toast does not linger across leaving and re-entering the lobby', () => {
    vi.useFakeTimers();
    const s = stub({ screen: 'lobby', host: true, seat: 0, code: 'ABCD', lobby: fourFull }), m = mk(s.ctl);
    s.set({ lobby: moved(1) });
    s.set({ screen: 'menu', lobby: null, code: null });
    s.set({ screen: 'lobby', lobby: fourFull, code: 'WXYZ' });
    expect(toastOf(m)).toBeNull();
    m.unmount();
  });
});
