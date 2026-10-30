import { PROTOCOL_VERSION, ERROR_CODES, LockstepClient, toWireOutcome, type ClientMessage, type EndMsg, type ErrorCode, type LobbyStateMsg, type SeatConfig, type ServerMessage, type StartMsg, type Versions } from '@node-arena/net';
import { listPvpMaps, loadContent, type PvpMapInfo, type CompiledLevel, type ContentFiles, type ManifestV2 } from '@node-arena/content';
import { create, type Placement, type Sim } from '@node-arena/sim';
import type { TickUpdate } from '../driver';
import { NetDriver, type NetDriverOptions } from '../driver/net-driver';
import type { LevelRuntime, RuntimeContext } from '../app/state';
import { createPvpConnection, type ConnInfo, type ConnState, type PvpConnection, type PvpConnectionOpts } from '../net/connection';
import { pauseRemaining, toPauseView, type PauseView } from './pause';
import type { Identity } from '../net/identity';
import type { RoomLink } from '../net/links';

export type PvpScreen = 'idle' | 'menu' | 'connecting' | 'lobby' | 'countdown' | 'playing' | 'result' | 'restarted';
export type PvpRole = 'play' | 'watch';

export interface PvpSnapshot {
  screen: PvpScreen;
  nick: string;
  conn: ConnState | null;
  /** Client-local backoff info for the connection banner. */
  connInfo: ConnInfo | null;
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
  /** Final per-team placements from the local sim (identical to server by determinism); null until result. */
  ranking: Placement[] | null;
  /** Latest authoritative pause snapshot (null before the first / after a new match). */
  pause: PauseView | null;
  /** Short user-facing string; null when none. */
  error: string | null;
  serverUrl: string | null;
  pvpUnavailable: boolean;
  /** SP09: server restart notice; `deadlineAt` is on the controller clock (`options.now`). Null when no notice received. */
  draining: { deadlineAt: number } | null;
}

export const ERROR_STRINGS: Record<ErrorCode, string> = {
  'bad-json': 'Protocol error. Reload the page.',
  'too-large': 'Message too large.',
  'bad-message': 'Protocol error. Reload the page.',
  'unknown-type': 'Protocol error. Reload the page.',
  'version-mismatch': 'A newer version of Node Arena is available - reload',
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
  'paused': 'The match is paused.',
  'no-match': 'No match is running.',
  'draining': "Server restarting - you can't start a new match.",
};
export const errorString = (code: string): string => (ERROR_CODES as readonly string[]).includes(code) ? ERROR_STRINGS[code as ErrorCode] : 'Something went wrong.';

/** SP09 D11: terminal strings after the server restarted under a room. */
export const RESTARTED_MATCH_STRING = 'Server restarted. Your match ended with no result.';
export const RESTARTED_ROOM_STRING = 'Server restarted. Room closed.';
const CLOSED_STRINGS: Record<string, string> = {
  shutdown: RESTARTED_ROOM_STRING, 'server-restart': RESTARTED_ROOM_STRING, internal: 'Room closed by a server error.', idle: 'Room closed (idle).',
};

const CONN_STRINGS: Partial<Record<ConnState, string>> = {
  lost: 'Connection lost.', refused: ERROR_STRINGS['version-mismatch'], superseded: 'Opened in another tab.',
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
  /** PvP map list for the lobby picker; default `listPvpMaps` over `files`. */
  maps?: () => PvpMapInfo[];
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
export type PvpEvent = { t: 'desync'; tick: number; serverHash: string; localTick: number; localHash: string } | { t: 'resync'; reason: ResyncReason } | { t: 'sync-lost' };
export type ResyncReason = 'desync' | 'push-error';
/** Auto-resyncs allowed per match before the terminal SYNC_LOST_STRING. */
export const MAX_RESYNCS = 3;
/** Delay before the single retry of a `rate-limited` resync (matches the server's 5 s catch-up token + margin). */
export const RESYNC_RETRY_MS = 5500;
export const SYNC_LOST_STRING = 'Out of sync. Leave and rejoin.';

type Pending = { t: 'room.create' } | { t: 'room.join'; code: string; role: PvpRole };

export function createPvpController(options: PvpOptions) {
  const mismatchKey = 'nodearena:pvp:mismatch';
  const buildKey = JSON.stringify([options.serverUrl, PROTOCOL_VERSION, options.versions]);
  const rememberMismatch = (value: boolean) => {
    try { if (value) sessionStorage.setItem(mismatchKey, buildKey); else if (sessionStorage.getItem(mismatchKey) === buildKey) sessionStorage.removeItem(mismatchKey); } catch { /* storage unavailable */ }
  };
  let mismatchedBeforeReload = false;
  try { mismatchedBeforeReload = sessionStorage.getItem(mismatchKey) === buildKey; } catch { /* storage unavailable */ }
  const listeners = new Set<() => void>(), events = new Set<(u: TickUpdate) => void>(), pvpEvents = new Set<(e: PvpEvent) => void>();
  const initial = (): PvpSnapshot => ({ screen: 'idle', nick: options.identity.nick, conn: null, connInfo: null, code: null, seat: null, host: false, role: 'play', lobby: null, start: null, end: null, ranking: null, pause: null, error: null, serverUrl: options.serverUrl, pvpUnavailable: false, draining: null });
  let state = initial();
  let conn: PvpConnection | null = null, offs: Array<() => void> = [];
  let lastEpoch = -1, autoResumed = -1, pending: Pending | null = null, welcomed = false, disposed = false, skipLobby = false;
  const publish = (patch: Partial<PvpSnapshot> = {}) => { if (disposed) return; state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
  // Match resources, generation-scoped (mirrors AppController.startLevel).
  let generation = 0, driver: NetDriver | null = null, runtime: LevelRuntime | undefined, matchManifest: ManifestV2 | undefined, fallbackTimer: unknown = null, syncLost = false, resyncInFlight = false, resyncRetried = false, resyncCount = 0, resyncTimer: unknown = null, compiledCache: ReturnType<typeof loadContent> | undefined;
  const now = () => (options.now ?? (() => performance.now()))();
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)), clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const clearMatch = () => {
    ++generation;
    lastEpoch = -1; autoResumed = -1;
    if (fallbackTimer !== null) clearTimer(fallbackTimer);
    fallbackTimer = null;
    resyncInFlight = false; resyncRetried = false;
    if (resyncTimer !== null) clearTimer(resyncTimer);
    resyncTimer = null;
    const d = driver, r = runtime; driver = null; runtime = undefined; matchManifest = undefined;
    d?.dispose(); r?.dispose();
  };
  const loaded = () => {
    if (!options.files) return undefined;
    const m = options.manifest?.();
    return (compiledCache ??= loadContent(options.files, { themes: Object.keys(m?.themes ?? {}), colorKeys: Object.keys(m?.palettes ?? {}) }));
  };
  const getLevel = (id: string): CompiledLevel | undefined => {
    if (options.getLevel) return options.getLevel(id);
    return loaded()?.compiled[id];
  };
  const drop = () => { skipLobby = false; clearMatch(); offs.forEach((f) => f()); offs = []; const c = conn; conn = null; welcomed = false; pending = null; c?.close(); };
  const reset = (error: string | null) => { drop(); state = { ...initial(), screen: 'menu', error }; listeners.forEach((fn) => fn()); };
  const dispatch = (m: ClientMessage) => { conn?.send(m); };

  const finishResult = (gen: number) => {
    if (gen !== generation || state.screen === 'result' || !state.end) return;
    if (fallbackTimer !== null) { clearTimer(fallbackTimer); fallbackTimer = null; }
    const over = driver?.sim.view.over ?? null, local = toWireOutcome(over);
    if (!local || JSON.stringify(local) !== JSON.stringify(state.end.outcome)) console.error('[pvp] local result disagrees with server end', { local, server: state.end.outcome, localTick: driver?.tick, finalTick: state.end.finalTick });
    driver?.stop(); runtime?.cancel();
    publish({ screen: 'result', ranking: over?.ranking ? over.ranking.map((p) => ({ ...p, seats: [...p.seats] })) : null });
  };
  const checkResult = () => {
    const e = state.end;
    if (e && driver && state.screen !== 'result' && (driver.sim.view.over || driver.tick >= e.finalTick)) finishResult(generation);
  };
  const markSyncLost = (gen: number, what: string) => {
    if (gen !== generation || syncLost) return;
    console.warn('[pvp] protocol error', what);
    syncLost = true;
    publish({ error: SYNC_LOST_STRING });
    pvpEvents.forEach((fn) => fn({ t: 'sync-lost' }));
  };
  /**
   * Self-heal (SP08): ask the server to replay the match. One request in flight (cleared by the next `start`, which rebuilds
   * sim/lockstep/driver/runtime); capped per match; anything else falls to the terminal "Leave and rejoin".
   */
  const requestResync = (reason: ResyncReason) => {
    if (syncLost || resyncInFlight || !driver || (state.screen !== 'countdown' && state.screen !== 'playing')) return;
    if (resyncCount >= MAX_RESYNCS) return markSyncLost(generation, `resync cap (${reason})`);
    resyncCount++;
    resyncInFlight = true; resyncRetried = false;
    console.warn('[pvp] resync', reason, { n: resyncCount });
    pvpEvents.forEach((fn) => fn({ t: 'resync', reason }));
    dispatch({ t: 'resync' });
  };
  // Server refused the resync: retry `rate-limited` once after a delay, otherwise terminal.
  const resyncRefused = (code: string) => {
    const gen = generation;
    if (code === 'rate-limited' && !resyncRetried) {
      resyncRetried = true;
      resyncTimer = setTimer(() => { resyncTimer = null; if (gen === generation && resyncInFlight && !syncLost) dispatch({ t: 'resync' }); }, RESYNC_RETRY_MS);
      return;
    }
    resyncInFlight = false;
    markSyncLost(gen, `resync refused (${code})`);
  };
  // Own disconnect hold, caught up to the frozen tick: release it once per epoch (manual holds need a click).
  const maybeAutoResume = () => {
    const p = state.pause, me = state.seat;
    if (!p?.paused || me === null || !driver || autoResumed === p.epoch || driver.tick < p.tick) return;
    if (!p.holds.some((h) => h.player === me && h.reason === 'disconnect')) return;
    autoResumed = p.epoch;
    dispatch({ t: 'resume', epoch: p.epoch });
  };
  const startMatch = async (m: StartMsg, reconnect = false) => {
    const prior = state.screen;
    clearMatch();
    syncLost = false;
    const gen = generation;
    const level = getLevel(m.levelId);
    if (!level || level.simHash.slice(0, 16) !== m.simHash) {
      dispatch({ t: 'room.leave' });
      reset(SIM_MISMATCH_STRING);
      return;
    }
    pending = null;
    publish({ screen: reconnect && (prior === 'playing' || prior === 'result') ? 'playing' : 'countdown', start: m, end: null, ranking: null, pause: null, error: null });
    let owned: NetDriver | undefined, created: LevelRuntime | undefined;
    try {
      const teams = [...m.seats].sort((a, b) => a.player - b.player).map((x) => x.team);
      const sim = (options.createSim ?? ((l, seed, setup) => create(l, seed, setup)))(level, m.seed, { teams });
      const client = new LockstepClient(0);
      const dopts: NetDriverOptions = {
        sim, client, send: dispatch, ...(state.seat === null ? { spectator: true } : {}), now: options.now ?? (() => performance.now()),
        ...(options.raf ? { raf: options.raf } : {}), ...(options.caf ? { caf: options.caf } : {}),
        onTick: (update) => {
          if (gen !== generation) return;
          try { runtime?.tick(update); } catch (err) { console.error('[pvp] runtime tick failed', err); }
          events.forEach((fn) => fn(update));
          // "playing" begins on the first server tick (server-paced; no client timer drift).
          if (state.screen === 'countdown') publish({ screen: 'playing' });
          checkResult();
          maybeAutoResume();
        },
        onFrame: (update) => { if (gen === generation) try { runtime?.frame(update); } catch (err) { console.error('[pvp] frame failed', err); } },
        onPushError: (result) => {
          if (gen !== generation) return;
          console.warn('[pvp] tick stream error', result);
          requestResync('push-error');
        },
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
        rememberMismatch(false);
        mismatchedBeforeReload = false;
        if (!pending && state.screen === 'connecting') publish({ screen: 'menu', error: null, pvpUnavailable: false });
        // A play-link reload may already own this seat; onAuthed replays room state.
        if (pending?.t === 'room.join' && pending.role === 'play' && m.resume?.code === pending.code) pending = null;
        if (pending) { const p = pending; dispatch(p); }
        break;
      case 'room.joined': {
        pending = null;
        // Reauth sends room.joined before start; keep the existing match visible and enabled.
        const active = driver && state.code === m.code && (state.screen === 'countdown' || state.screen === 'playing' || state.screen === 'result');
        skipLobby = !!active && state.screen === 'result'; // reauth replays lobby.state; that is not a rematch
        publish({ screen: active ? state.screen : 'lobby', code: m.code, seat: m.you.seat, host: m.you.host, role: m.you.seat === null ? 'watch' : 'play', error: active ? state.error : null });
        break;
      }
      case 'lobby.state': {
        // host may change (host handover); keep own host flag in sync from seat/host fields.
        const host = state.seat !== null && m.host === state.seat;
        // Rematch (R7): after `end`, the server resets the room and broadcasts lobby.state; leave the result screen.
        if (skipLobby) skipLobby = false;
        else if (state.screen === 'result') { clearMatch(); publish({ screen: 'lobby', lobby: m, host, start: null, end: null, ranking: null, pause: null, error: null }); break; }
        publish({ lobby: m, host });
        break;
      }
      case 'start':
        lastEpoch = -1; // epoch is per match; every start (rematch or reconnect) restarts it
        if (state.start?.matchId !== m.matchId) resyncCount = 0; // cap is per match
        // Reconnect re-sends `start` + full catchup: recreate sim/lockstep/runtime and replay from tick 0 (D5).
        void startMatch(m, !!driver && state.start?.matchId === m.matchId);
        break;
      case 'tick': case 'ticks': case 'catchup':
        driver?.push(m);
        break;
      case 'pause.state': {
        if (!driver) break;
        if (m.epoch <= lastEpoch) break;
        lastEpoch = m.epoch;
        driver?.setFrozen(m.paused ? m.tick : null);
        publish({ pause: toPauseView(m, now()) });
        maybeAutoResume();
        break;
      }
      case 'start.cancel':
        // Countdown cancelled server-side: discard sim/runtime/lockstep; the following lobby.state refreshes the lobby.
        if (state.start?.matchId !== m.matchId || state.end) break;
        clearMatch();
        syncLost = false;
        publish({ screen: 'lobby', start: null, end: null, ranking: null, pause: null, error: null });
        break;
      case 'end': {
        if (!driver || state.end) break;
        const gen = generation;
        driver.setFrozen(null); // terminal forfeit while paused: step the queued tail so the final hash matches
        publish({ end: m });
        if (driver.sim.view.over || driver.tick >= m.finalTick) finishResult(gen);
        else fallbackTimer = setTimer(() => { fallbackTimer = null; finishResult(gen); }, options.resultFallbackMs ?? RESULT_FALLBACK_MS);
        break;
      }
      case 'desync': {
        const localHash = driver?.sim.hash() ?? '', localTick = driver?.tick ?? -1;
        console.warn('[pvp] desync', { tick: m.tick, serverHash: m.serverHash, localTick, localHash });
        pvpEvents.forEach((fn) => fn({ t: 'desync', tick: m.tick, serverHash: m.serverHash, localTick, localHash }));
        requestResync('desync');
        break;
      }
      case 'room.closed': {
        if (m.reason === 'shutdown' || (m.reason === 'server-restart' && state.draining)) {
          // Terminal "server restarted" screen with a single Back to menu action; connection and match are torn down.
          const inMatch = (state.screen === 'countdown' || state.screen === 'playing') && !state.end;
          drop();
          state = { ...initial(), screen: 'restarted', error: inMatch ? RESTARTED_MATCH_STRING : RESTARTED_ROOM_STRING };
          listeners.forEach((fn) => fn());
          break;
        }
        reset(CLOSED_STRINGS[m.reason] ?? 'Room closed.');
        break;
      }
      case 'server.draining':
        publish({ draining: { deadlineAt: now() + m.deadlineMs } });
        break;
      case 'error':
        if (resyncInFlight && (m.code === 'rate-limited' || m.code === 'no-match') && driver) { resyncRefused(m.code); break; }
        if (state.screen === 'connecting') reset(errorString(m.code));
        else if (!syncLost || !driver) publish({ error: errorString(m.code) });
        break;
      default: break;
    }
  };
  const onState = (s: ConnState) => {
    const msg = CONN_STRINGS[s];
    if (s === 'refused') {
      rememberMismatch(true);
      reset(mismatchedBeforeReload ? 'PvP unavailable: this build differs from the server' : ERROR_STRINGS['version-mismatch']);
      publish({ conn: 'refused', pvpUnavailable: mismatchedBeforeReload });
      return;
    }
    if (s === 'superseded') { reset(msg ?? null); return; }
    publish({ conn: s, connInfo: conn?.info ?? null, ...(msg ? { error: msg } : s === 'connected' || s === 'connecting' ? { error: state.error === CONN_STRINGS.lost ? null : state.error } : {}) });
  };

  const connect = (action: Pending | null) => {
    if (disposed || !options.serverUrl || state.pvpUnavailable) return;
    drop();
    pending = action;
    state = { ...state, screen: 'connecting', code: null, seat: null, host: false, lobby: null, start: null, end: null, ranking: null, pause: null, error: null, role: action?.t === 'room.join' ? action.role : 'play' };
    const make = options.createConnection ?? createPvpConnection;
    conn = make({ url: options.serverUrl, nick: options.identity.nick, token: options.identity.token, versions: options.versions, createSocket: options.createSocket });
    offs = [conn.onMessage(onMessage), conn.onState(onState)];
    state = { ...state, conn: conn.state, connInfo: conn.info };
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
    /** Lobby map picker list (empty when content unavailable). */
    maps(): PvpMapInfo[] { if (options.maps) return options.maps(); const c = loaded(); return c ? listPvpMaps(c) : []; },
    /** Estimated remaining pause budget (ms) per seat now (display only; null = bot/unlimited). */
    pauseRemaining(at: number = now()) { return pauseRemaining(state.pause, at); },
    /** Seated player opens a manual pause hold (server validates budget/state). */
    pause() { if (state.screen === 'playing' && state.seat !== null) dispatch({ t: 'pause' }); },
    /** Owner releases own hold; carries the epoch of the snapshot the UI showed. */
    resume() { const p = state.pause; if (state.screen === 'playing' && state.seat !== null && p?.paused) dispatch({ t: 'resume', epoch: p.epoch }); },
    /** Confirmed forfeit (running) or countdown cancel. The UI must confirm first. */
    quit() { if ((state.screen === 'playing' || state.screen === 'countdown') && state.seat !== null) dispatch({ t: 'quit' }); },
    get connection() { return conn; },
    get welcomed() { return welcomed; },
    open() {
      if (disposed || state.screen !== 'idle') return;
      publish({ screen: 'menu', error: null });
      // Check compatibility again after reload, without creating or joining a room.
      if (mismatchedBeforeReload) connect(null);
    },
    setNick(nick: string) { publish({ nick: options.identity.setNick(nick) }); },
    create() { if (state.screen === 'menu') connect({ t: 'room.create' }); },
    join(code: string, role: PvpRole = 'play') { if (state.screen === 'menu') connect({ t: 'room.join', code: code.trim().toUpperCase(), role }); },
    watch(code: string) { api.join(code, 'watch'); },
    openLink(link: RoomLink | null) {
      // A play-link supplies its own handshake action; do not replace it with the reload probe.
      if (state.screen === 'idle') publish({ screen: 'menu', error: null });
      if (state.screen !== 'menu') return;
      if (!link) { publish({ error: 'Invalid room code. Enter a 4-character code.' }); return; }
      publish({ code: link.code });
      if (!options.serverUrl) { publish({ error: 'Online play is unavailable.' }); return; }

      // A first-time visitor supplies a nickname in the existing menu, then presses Join.
      if (state.nick) api.join(link.code, link.role);
    },
    /** Non-host toggles own ready flag; host is implicitly ready. */
    ready() {
      if (state.screen !== 'lobby' || state.host || state.seat === null) return;
      const cur = state.lobby?.seats[state.seat]?.occupant?.ready ?? false;
      dispatch({ t: 'lobby.ready', ready: !cur });
    },
    /** Seated player on the result screen asks the server to return the room to the lobby. */
    rematch() {
      if (state.screen !== 'result' || state.seat === null) return;
      if (state.draining) { publish({ error: ERROR_STRINGS.draining }); return; }
      dispatch({ t: 'rematch' });
    },
    /** Terminal "server restarted" screen -> online menu (a fresh connection is made by the next menu action). */
    backToMenu() { if (state.screen === 'restarted') reset(null); },
    /** Remaining ms of the restart window (0 once past); null without a notice. */
    drainRemaining(at: number = now()): number | null { return state.draining ? Math.max(0, state.draining.deadlineAt - at) : null; },
    /** Host-only: full lobby edit (level change resets seats server-side). */
    updateLobby(levelId: string, seats: SeatConfig[]) { if (state.screen === 'lobby' && state.host) dispatch({ t: 'lobby.update', levelId, seats }); },
    start() {
      if (state.screen !== 'lobby' || !state.host) return;
      if (state.draining) { publish({ error: ERROR_STRINGS.draining }); return; }
      dispatch({ t: 'lobby.start' });
    },
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
