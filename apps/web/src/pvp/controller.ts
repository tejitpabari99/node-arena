import { ERROR_CODES, LockstepClient, toWireOutcome, type ClientMessage, type EndMsg, type ErrorCode, type LobbyStateMsg, type SeatStatusMsg, type ServerMessage, type StartMsg, type Versions } from '@node-arena/net';
import { loadContent, type CompiledLevel, type ContentFiles, type ManifestV2 } from '@node-arena/content';
import { create, type Sim } from '@node-arena/sim';
import type { TickUpdate } from '../driver';
import { NetDriver, type NetDriverOptions } from '../driver/net-driver';
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
  /** Match start message (countdownMs drives the "Get ready" countdown). */
  start: StartMsg | null;
  /** Server-sourced result (R6); set on `end`, screen becomes 'result' once local sim reaches finalTick or after the fallback delay. */
  end: EndMsg | null;
  /** Latest status per seat from `seat.status`. */
  seatStatus: Record<number, { status: SeatStatusMsg['status']; graceMs?: number }>;
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
  files?: ContentFiles;
  manifest?: () => ManifestV2 | undefined;
  createRuntime?: (context: RuntimeContext) => LevelRuntime | Promise<LevelRuntime>;
  /** Compiled level by id; default compiles `files` via loadContent (cached). */
  getLevel?: (levelId: string) => CompiledLevel | undefined;
  createSim?: (level: CompiledLevel, seed: number, setup: { teams: number[] }) => Sim;
  createDriver?: (o: NetDriverOptions) => NetDriver;
  now?: () => number;
  raf?: NetDriverOptions['raf'];
  caf?: NetDriverOptions['caf'];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** Delay after `end` before the result shows even if local sim has not reached finalTick. Default 3000. */
  resultFallbackMs?: number;
}

export const RESULT_FALLBACK_MS = 3000;
export const SIM_MISMATCH_STRING = 'Game content differs from the server. Reload to update.';

/** Non-snapshot notifications for the UI layer. */
export type PvpEvent = { t: 'desync'; tick: number; serverHash: string; localTick: number; localHash: string };

type Pending = { t: 'room.create' } | { t: 'room.join'; code: string; role: PvpRole };

export function createPvpController(options: PvpOptions) {
  const listeners = new Set<() => void>(), events = new Set<(u: TickUpdate) => void>(), pvpEvents = new Set<(e: PvpEvent) => void>();
  const initial = (): PvpSnapshot => ({ screen: 'idle', nick: options.identity.nick, conn: null, code: null, seat: null, host: false, role: 'play', lobby: null, start: null, end: null, seatStatus: {}, error: null, serverUrl: options.serverUrl });
  let state = initial();
  let conn: PvpConnection | null = null, offs: Array<() => void> = [];
  let pending: Pending | null = null, welcomed = false, disposed = false;
  const publish = (patch: Partial<PvpSnapshot> = {}) => { if (disposed) return; state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
  // Match resources, generation-scoped (mirrors AppController.startLevel).
  let generation = 0, driver: NetDriver | null = null, runtime: LevelRuntime | undefined, matchManifest: ManifestV2 | undefined, fallbackTimer: unknown = null, compiledCache: ReturnType<typeof loadContent> | undefined;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)), clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const clearMatch = () => {
    ++generation;
    if (fallbackTimer !== null) clearTimer(fallbackTimer);
    fallbackTimer = null;
    const d = driver, r = runtime; driver = null; runtime = undefined; matchManifest = undefined;
    d?.dispose(); r?.dispose();
  };
  const getLevel = (id: string): CompiledLevel | undefined => {
    if (options.getLevel) return options.getLevel(id);
    if (!options.files) return undefined;
    const m = options.manifest?.();
    compiledCache ??= loadContent(options.files, { themes: Object.keys(m?.themes ?? {}), colorKeys: Object.keys(m?.palettes ?? {}) });
    return compiledCache.compiled[id];
  };
  const drop = () => { clearMatch(); offs.forEach((f) => f()); offs = []; const c = conn; conn = null; welcomed = false; pending = null; c?.close(); };
  const reset = (error: string | null) => { drop(); state = { ...initial(), screen: 'menu', error }; listeners.forEach((fn) => fn()); };
  const dispatch = (m: ClientMessage) => { conn?.send(m); };

  const finishResult = (gen: number) => {
    if (gen !== generation || state.screen === 'result' || !state.end) return;
    if (fallbackTimer !== null) { clearTimer(fallbackTimer); fallbackTimer = null; }
    const over = driver?.sim.view.over ?? null, local = toWireOutcome(over);
    if (!local || JSON.stringify(local) !== JSON.stringify(state.end.outcome)) console.error('[pvp] local result disagrees with server end', { local, server: state.end.outcome, localTick: driver?.tick, finalTick: state.end.finalTick });
    driver?.stop(); runtime?.cancel();
    publish({ screen: 'result' });
  };
  const checkResult = () => {
    const e = state.end;
    if (e && driver && state.screen !== 'result' && (driver.sim.view.over || driver.tick >= e.finalTick)) finishResult(generation);
  };
  const startMatch = async (m: StartMsg) => {
    clearMatch();
    const gen = generation;
    const level = getLevel(m.levelId);
    if (!level || level.simHash.slice(0, 16) !== m.simHash) {
      dispatch({ t: 'room.leave' });
      reset(SIM_MISMATCH_STRING);
      return;
    }
    pending = null;
    publish({ screen: 'countdown', start: m, end: null, seatStatus: {}, error: null });
    let owned: NetDriver | undefined, created: LevelRuntime | undefined;
    try {
      const teams = [...m.seats].sort((a, b) => a.player - b.player).map((x) => x.team);
      const sim = (options.createSim ?? ((l, seed, setup) => create(l, seed, setup)))(level, m.seed, { teams });
      const client = new LockstepClient(0);
      const dopts: NetDriverOptions = {
        sim, client, send: dispatch, now: options.now ?? (() => performance.now()),
        ...(options.raf ? { raf: options.raf } : {}), ...(options.caf ? { caf: options.caf } : {}),
        onTick: (update) => {
          if (gen !== generation) return;
          try { runtime?.tick(update); } catch (err) { console.error('[pvp] runtime tick failed', err); }
          events.forEach((fn) => fn(update));
          // "playing" begins on the first server tick (server-paced; no client timer drift).
          if (state.screen === 'countdown') publish({ screen: 'playing' });
          checkResult();
        },
        onPushError: (result) => console.warn('[pvp] tick stream error', result),
      };
      owned = (options.createDriver ?? ((o) => new NetDriver(o)))(dopts);
      driver = owned;
      matchManifest = options.manifest?.();
      created = await options.createRuntime?.({ level, manifest: matchManifest as ManifestV2, driver: owned, seat: m.youPlayer, enabled: () => state.screen === 'playing', zoomed: false });
      if (gen !== generation) { created?.dispose(); owned.dispose(); return; }
      runtime = created;
      runtime?.frame({ sim, alpha: 0, steps: 0, paused: false });
      owned.start();
      publish();
    } catch (err) {
      created?.dispose(); owned?.dispose();
      if (gen === generation) { console.error('[pvp] match start failed', err); dispatch({ t: 'room.leave' }); reset('Could not start the match.'); }
    }
  };

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
        void startMatch(m);
        break;
      case 'tick': case 'ticks': case 'catchup':
        driver?.push(m);
        break;
      case 'seat.status':
        publish({ seatStatus: { ...state.seatStatus, [m.player]: m.graceMs === undefined ? { status: m.status } : { status: m.status, graceMs: m.graceMs } } });
        break;
      case 'end': {
        if (!driver || state.end) break;
        const gen = generation;
        publish({ end: m });
        if (driver.sim.view.over || driver.tick >= m.finalTick) finishResult(gen);
        else fallbackTimer = setTimer(() => { fallbackTimer = null; finishResult(gen); }, options.resultFallbackMs ?? RESULT_FALLBACK_MS);
        break;
      }
      case 'desync': {
        const localHash = driver?.sim.hash() ?? '', localTick = driver?.tick ?? -1;
        console.warn('[pvp] desync', { tick: m.tick, serverHash: m.serverHash, localTick, localHash });
        pvpEvents.forEach((fn) => fn({ t: 'desync', tick: m.tick, serverHash: m.serverHash, localTick, localHash }));
        break;
      }
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
    state = { ...state, screen: 'connecting', code: null, seat: null, host: false, lobby: null, start: null, end: null, seatStatus: {}, error: null, role: action.t === 'room.join' ? action.role : 'play' };
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
    subscribePvpEvents(fn: (e: PvpEvent) => void) { pvpEvents.add(fn); return () => { pvpEvents.delete(fn); }; },
    /** Audio source accessors (same shape as AppController). */
    get driver() { return driver; },
    get runtime() { return runtime; },
    get manifest() { return matchManifest; },
    get options() { return options; },
    /** Compiled level by id (for lobby seat colours). */
    level(id: string) { return getLevel(id); },
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
    dispose() { if (disposed) return; drop(); disposed = true; listeners.clear(); events.clear(); pvpEvents.clear(); },
  };
  return api;
}
export type PvpController = ReturnType<typeof createPvpController>;
