import { ERROR_CODES, type ClientMessage, type ErrorCode, type LobbyStateMsg, type ServerMessage, type StartMsg, type Versions } from '@node-arena/net';
import type { ContentFiles, ManifestV2 } from '@node-arena/content';
import type { TickUpdate } from '../driver';
import type { LevelRuntime, RuntimeContext } from '../app/state';
import { createPvpConnection, type ConnState, type PvpConnection, type PvpConnectionOpts } from '../net/connection';
import type { Identity } from '../net/identity';
import type { RoomLink } from '../net/links';

export type PvpScreen = 'idle' | 'menu' | 'connecting' | 'lobby' | 'countdown' | 'playing' | 'result';
export type PvpRole = 'play' | 'watch';

export interface PvpSnapshot {
  screen: PvpScreen;
  nick: string;
  conn: ConnState | null;
  code: string | null;
  /** Own seat (null = spectator) once in a room. */
  seat: number | null;
  host: boolean;
  role: PvpRole;
  lobby: LobbyStateMsg | null;
  /** Stored for Task 6 (match lifecycle). */
  start: StartMsg | null;
  /** Short user-facing string; null when none. */
  error: string | null;
  serverUrl: string | null;
}

export const ERROR_STRINGS: Record<ErrorCode, string> = {
  'bad-json': 'Protocol error. Reload the page.',
  'too-large': 'Message too large.',
  'bad-message': 'Protocol error. Reload the page.',
  'unknown-type': 'Protocol error. Reload the page.',
  'version-mismatch': 'Game version differs from the server. Reload to update.',
  'not-authed': 'Not connected yet. Try again.',
  'not-in-room': 'You are not in a room.',
  'not-host': 'Only the host can do that.',
  'not-your-seat': 'That seat is not yours.',
  'rate-limited': 'Too fast. Slow down.',
  'room-full': 'Room is full.',
  'room-not-found': 'Room not found. Check the code.',
  'spectators-full': 'No spectator slots left.',
  'bad-lobby': 'That lobby change is not allowed.',
  'not-ready': 'Not everyone is ready.',
  'match-in-progress': 'Match already in progress.',
  'desync': 'Game state desynced from the server.',
  'internal': 'Server error. Try again.',
};
export const errorString = (code: string): string => (ERROR_CODES as readonly string[]).includes(code) ? ERROR_STRINGS[code as ErrorCode] : 'Something went wrong.';

const CLOSED_STRINGS: Record<string, string> = {
  shutdown: 'Server is shutting down.', 'server-restart': 'Server restarted. Room closed.', internal: 'Room closed by a server error.', idle: 'Room closed (idle).',
};

const CONN_STRINGS: Partial<Record<ConnState, string>> = {
  lost: 'Connection lost.', refused: 'Game version differs from the server. Reload to update.', superseded: 'Opened in another tab.',
};

export interface PvpOptions {
  identity: Identity;
  /** Resolved ws(s) URL, or null when online play is unavailable. */
  serverUrl: string | null;
  versions: Versions;
  createSocket: PvpConnectionOpts['createSocket'];
  /** Injectable for tests; defaults to createPvpConnection. */
  createConnection?: (opts: PvpConnectionOpts) => PvpConnection;
  /** Reserved for Task 6 (match lifecycle). */
  files?: ContentFiles;
  manifest?: () => ManifestV2 | undefined;
  createRuntime?: (context: RuntimeContext) => LevelRuntime | Promise<LevelRuntime>;
}

type Pending = { t: 'room.create' } | { t: 'room.join'; code: string; role: PvpRole };

export function createPvpController(options: PvpOptions) {
  const listeners = new Set<() => void>(), events = new Set<(u: TickUpdate) => void>();
  const initial = (): PvpSnapshot => ({ screen: 'idle', nick: options.identity.nick, conn: null, code: null, seat: null, host: false, role: 'play', lobby: null, start: null, error: null, serverUrl: options.serverUrl });
  let state = initial();
  let conn: PvpConnection | null = null, offs: Array<() => void> = [];
  let pending: Pending | null = null, welcomed = false, disposed = false;
  const publish = (patch: Partial<PvpSnapshot> = {}) => { if (disposed) return; state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
  const drop = () => { offs.forEach((f) => f()); offs = []; const c = conn; conn = null; welcomed = false; pending = null; c?.close(); };
  const reset = (error: string | null) => { drop(); state = { ...initial(), screen: 'menu', error }; listeners.forEach((fn) => fn()); };
  const dispatch = (m: ClientMessage) => { conn?.send(m); };

  const onMessage = (m: ServerMessage) => {
    switch (m.t) {
      case 'welcome':
        welcomed = true;
        if (pending) { const p = pending; dispatch(p); }
        break;
      case 'room.joined':
        pending = null;
        publish({ screen: 'lobby', code: m.code, seat: m.you.seat, host: m.you.host, role: m.you.seat === null ? 'watch' : 'play', error: null });
        break;
      case 'lobby.state': {
        // host may change (host handover); keep own host flag in sync from seat/host fields.
        const host = state.seat !== null && m.host === state.seat;
        publish({ lobby: m, host });
        break;
      }
      case 'start':
        pending = null;
        publish({ screen: 'countdown', start: m, error: null });
        break;
      case 'room.closed':
        reset(CLOSED_STRINGS[m.reason] ?? 'Room closed.');
        break;
      case 'error':
        if (state.screen === 'connecting') reset(errorString(m.code));
        else publish({ error: errorString(m.code) });
        break;
      default: break;
    }
  };
  const onState = (s: ConnState) => {
    const msg = CONN_STRINGS[s];
    if (s === 'refused' || s === 'superseded') { reset(msg ?? null); return; }
    publish({ conn: s, ...(msg ? { error: msg } : s === 'connected' || s === 'connecting' ? { error: state.error === CONN_STRINGS.lost ? null : state.error } : {}) });
  };

  const connect = (action: Pending) => {
    if (disposed || !options.serverUrl) return;
    drop();
    pending = action;
    state = { ...state, screen: 'connecting', code: null, seat: null, host: false, lobby: null, start: null, error: null, role: action.t === 'room.join' ? action.role : 'play' };
    const make = options.createConnection ?? createPvpConnection;
    conn = make({ url: options.serverUrl, nick: options.identity.nick, token: options.identity.token, versions: options.versions, createSocket: options.createSocket });
    offs = [conn.onMessage(onMessage), conn.onState(onState)];
    state = { ...state, conn: conn.state };
    listeners.forEach((fn) => fn());
  };

  const api = {
    snapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    subscribeEvents(fn: (u: TickUpdate) => void) { events.add(fn); return () => { events.delete(fn); }; },
    /** Reserved for Task 6. */
    get options() { return options; },
    get connection() { return conn; },
    get welcomed() { return welcomed; },
    open() { if (disposed || state.screen !== 'idle') return; publish({ screen: 'menu', error: null }); },
    setNick(nick: string) { publish({ nick: options.identity.setNick(nick) }); },
    create() { if (state.screen === 'menu') connect({ t: 'room.create' }); },
    join(code: string, role: PvpRole = 'play') { if (state.screen === 'menu') connect({ t: 'room.join', code: code.trim().toUpperCase(), role }); },
    watch(code: string) { api.join(code, 'watch'); },
    openLink(link: RoomLink) { if (state.screen === 'idle') api.open(); api.join(link.code, link.role); },
    /** Non-host toggles own ready flag; host is implicitly ready. */
    ready() {
      if (state.screen !== 'lobby' || state.host || state.seat === null) return;
      const cur = state.lobby?.seats[state.seat]?.occupant?.ready ?? false;
      dispatch({ t: 'lobby.ready', ready: !cur });
    },
    start() { if (state.screen === 'lobby' && state.host) dispatch({ t: 'lobby.start' }); },
    leave() {
      if (state.screen === 'idle' || state.screen === 'menu') return;
      dispatch({ t: 'room.leave' });
      reset(null);
    },
    /** Back to idle (closes the PvP layer). */
    close() { if (state.screen === 'idle') return; drop(); state = initial(); listeners.forEach((fn) => fn()); },
    retry() {
      if (state.conn === 'lost') { conn?.retry(); return; }
      if (state.screen === 'menu') publish({ error: null });
    },
    dismissError() { publish({ error: null }); },
    dispose() { if (disposed) return; drop(); disposed = true; listeners.clear(); events.clear(); },
  };
  return api;
}
export type PvpController = ReturnType<typeof createPvpController>;
