import {
  compileLevel,
  loadContent,
  validateContent,
  type ContentFileMap,
  type CompiledLevel,
  type Level,
  type LoadedContent,
  type Manifest,
} from "@node-arena/content";
import { TICK_RATE, type GameOver, type Sim } from "@node-arena/sim";
import {
  GameDriver,
  type FrameUpdate,
  type TickUpdate,
  type CreateBotDriver,
  type DriverEnvironment,
  type GameDriverOptions,
} from "../driver";
import { AssetManager, type AssetSession } from "../manifest/assets";
import { loadManifest } from "../manifest/load";
import {
  createSaveStore,
  type SaveData,
  type SaveSettings,
  type SaveStore,
} from "../save";
import { cloneFiles, tuningFields, exportFiles, type PerfSnapshot } from "../dev";
export interface BootState {
  readonly screen: "boot";
  readonly schemaVersion: string;
  readonly threeRevision: string;
  readonly sim: Sim;
}
export type Screen =
  | "boot"
  | "menu"
  | "picker"
  | "loading"
  | "playing"
  | "paused"
  | "results"
  | "settings"
  | "error";
export interface AppSnapshot {
  screen: Screen;
  levels: readonly Level[];
  levelId: string | null;
  save: SaveData;
  notices: readonly string[];
  error: unknown;
  result: GameOver | null;
  remainingSeconds: number;
  speed: 1 | 2;
  perf: boolean;
  devEnabled: boolean;
  devTuned: boolean;
  devError: string | null;
}
export interface LevelRuntime {
  readonly metrics?: PerfSnapshot;
  readonly inspection?: unknown;
  frame(update: FrameUpdate): void;
  tick(update: TickUpdate): void;
  settings(value: SaveSettings): void;
  refresh(): void;
  cancel(): boolean;
  dispose(): void;
}
export interface RuntimeContext {
  level: CompiledLevel;
  manifest: Manifest;
  session: AssetSession;
  driver: GameDriver;
  enabled: () => boolean;
}
export interface AppOptions {
  files: ContentFileMap;
  loadManifest?: () => Promise<Manifest>;
  save?: SaveStore;
  autoStart?: boolean;
  createSim?: GameDriverOptions["createSim"];
  createBotDriver?: CreateBotDriver;
  environment?: DriverEnvironment;
  createAssetManager?: (manifest: Manifest) => AssetManager;
  createRuntime?: (context: RuntimeContext) => LevelRuntime;
  beforeLoad?: () => Promise<void>;
  devEnabled?: boolean;
  devTuned?: boolean;
  replay?: boolean;
}
/** Application lifetime; asset cache survives level changes. Runtime is a separately owned per-level scope. */
export function createAppController(options: AppOptions) {
  let files = cloneFiles(options.files);
  const save = options.save ?? createSaveStore(),
    listeners = new Set<() => void>(),
    eventListeners = new Set<(update: TickUpdate) => void>();
  let state: AppSnapshot = {
    screen: "boot",
    levels: [],
    levelId: null,
    save: save.snapshot(),
    notices: [],
    error: null,
    result: null,
    remainingSeconds: 0,
    speed: 1,
    perf: false,
    devEnabled: options.devEnabled ?? (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("dev") === "1"),
    devTuned: options.devTuned ?? false,
    devError: null,
  };
  let loaded: LoadedContent,
    manifest: Manifest,
    manager: AssetManager | undefined,
    session: AssetSession | undefined,
    driver: GameDriver | null = null,
    runtime: LevelRuntime | undefined;
  let generation = 0,
    disposed = false,
    returnScreen: "menu" | "paused" = "menu",
    compiled: CompiledLevel | undefined;
  const publish = () => {
    state = { ...state, save: save.snapshot() };
    let notice;
    const notices = [...state.notices];
    while ((notice = save.consumeNotice())) notices.push(notice.message);
    state = { ...state, notices };
    listeners.forEach((fn) => fn());
  };
  const clearLevel = () => {
    driver?.dispose();
    driver = null;
    try {
      runtime?.dispose();
    } finally {
      runtime = undefined;
      session?.dispose();
      session = undefined;
    }
  };
  const error = (cause: unknown) => {
    state = { ...state, screen: "error", error: cause };
    publish();
  };
  const finishLoad = async (token: number, retry = false) => {
    const owned = session!;
    await (retry ? owned.retryFailed() : owned.load());
    if (disposed || token !== generation) return;
    if (owned.state === "error") {
      error(owned.failures);
      return;
    }
    try {
      driver = new GameDriver({
        level: compiled!,
        matchSeed: 1,
        autoStart: false,
        ...(options.createSim ? { createSim: options.createSim } : {}),
        ...(options.environment ? { environment: options.environment } : {}),
        ...(options.createBotDriver
          ? { createBotDriver: options.createBotDriver }
          : {}),
        onFrame: (update) => runtime?.frame(update),
        onTick: (update) => {
          runtime?.tick(update);
          eventListeners.forEach((fn) => fn(update));
          state = {
            ...state,
            remainingSeconds: Math.ceil(
              Math.max(0, update.sim.view.timeLimitTicks - update.tick) /
                TICK_RATE,
            ),
          };
          if (update.sim.view.over) {
            const result = update.sim.view.over;
            save.recordResult(state.levelId!, {
              outcome: result.outcome,
              devTuned: state.devTuned,
              replay: options.replay ?? false,
            });
            state = { ...state, screen: "results", result };
            runtime?.refresh();
          }
          publish();
        },
        onPauseChange: (reason) => {
          if (reason && state.screen === "playing") {
            state = { ...state, screen: "paused" };
            runtime?.refresh();
            publish();
          }
        },
      });
      runtime = options.createRuntime?.({
        level: compiled!,
        manifest,
        session: owned,
        driver,
        enabled: () => state.screen === "playing",
      });
      state = {
        ...state,
        screen: driver.paused ? "paused" : "playing",
        result: null,
        remainingSeconds: Math.ceil(driver.sim.view.timeLimitTicks / TICK_RATE),
        speed: 1,
        error: null,
      };
      save.setLastLevel(state.levelId);
      runtime?.settings(save.snapshot().settings);
      runtime?.frame({
        sim: driver.sim,
        alpha: 0,
        steps: 0,
        paused: driver.paused,
      });
      publish();
      if (options.autoStart !== false) driver.start();
    } catch (cause) {
      clearLevel();
      error(cause);
    }
  };
  const api = {
    snapshot: () => state,
    get contentFiles() { return cloneFiles(files); },
    get tuningFields() { return state.devEnabled ? tuningFields(files) : []; },
    get exportedFiles() { return exportFiles(files, options.files); },
    async applyDevFiles(nextFiles: ContentFileMap) {
      if (!state.devEnabled || disposed || !manager) return false;
      try {
        const candidate = cloneFiles(nextFiles);
        const checked = validateContent(candidate, { manifest });
        if (checked.errors.length) throw new Error(checked.errors.map(e=>`${e.file}${e.pointer}: ${e.message}`).join("\n"));
        const next = loadContent(candidate);
        const levels = Object.values(next).filter((entity): entity is Level => "towers" in entity).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
        if (!levels.length) throw new Error("No authored levels available");
        for (const level of levels) compileLevel(next, level.id);
        if (state.levelId && !levels.some(l=>l.id===state.levelId)) throw new Error("Active level must remain available");
        files = candidate; loaded = next;
        state = { ...state, levels, devTuned:true, devError:null };
        publish();
        if (state.levelId) await api.restart();
        return true;
      } catch(cause) {
        state = {...state, devError:cause instanceof Error?cause.message:String(cause)};
        publish(); return false;
      }
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    subscribeEvents(fn: (update: TickUpdate) => void) {
      eventListeners.add(fn);
      return () => eventListeners.delete(fn);
    },
    get driver() {
      return driver;
    },
    get runtime() {
      return runtime;
    },
    get manifest() {
      return manifest;
    },
    get assetSession() {
      return session;
    },
    async boot() {
      const token = ++generation;
      state = { ...state, screen: "boot" };
      publish();
      try {
        const next = await (options.loadManifest ?? loadManifest)();
        if (disposed || token !== generation) return;
        const checked = validateContent(files, { manifest: next });
        if (checked.errors.length)
          throw new Error(
            checked.errors
              .map((e) => `${e.file}${e.pointer}: ${e.message}`)
              .join("\n"),
          );
        loaded = loadContent(files);
        manifest = next;
        manager?.dispose();
        manager =
          options.createAssetManager?.(manifest) ?? new AssetManager(manifest);
        const levels = Object.values(loaded)
          .filter((entity): entity is Level => "towers" in entity)
          .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        if (!levels.length) throw new Error("No authored levels available");
        state = { ...state, levels, screen: "menu", error: null };
        publish();
      } catch (cause) {
        if (token === generation && !disposed) error(cause);
      }
    },
    openPicker() {
      if (state.screen === "menu") {
        state = { ...state, screen: "picker" };
        publish();
      }
    },
    async startLevel(id: string) {
      if (!manager || !state.levels.some((l) => l.id === id)) return;
      const token = ++generation;
      clearLevel();
      state = {
        ...state,
        screen: "loading",
        levelId: id,
        result: null,
        error: null,
      };
      publish();
      try {
        compiled = compileLevel(loaded, id);
        session = manager.createSession(manager.resolveLevelAssets(compiled));
        await options.beforeLoad?.();
        if (token !== generation || disposed) return;
        await finishLoad(token);
      } catch (cause) {
        if (token === generation && !disposed) {
          clearLevel();
          error(cause);
        }
      }
    },
    menu() {
      ++generation;
      clearLevel();
      state = { ...state, screen: manager ? "menu" : "error", result: null };
      publish();
    },
    pause() {
      if (state.screen === "playing") driver?.pause();
    },
    resume() {
      if (state.screen === "paused") {
        driver?.resume();
        if (driver && !driver.paused) {
          state = { ...state, screen: "playing" };
          runtime?.refresh();
          publish();
        }
      }
    },
    escape() {
      if (state.screen === "playing") {
        if (!runtime?.cancel()) api.pause();
      } else if (state.screen === "paused") api.resume();
      else if (state.screen === "settings") api.closeSettings();
    },
    restart() {
      return state.levelId ? api.startLevel(state.levelId) : Promise.resolve();
    },
    next() {
      const i = state.levels.findIndex((l) => l.id === state.levelId);
      return state.levels[i + 1]
        ? api.startLevel(state.levels[i + 1]!.id)
        : Promise.resolve();
    },
    async retry() {
      if (session?.state === "error") {
        state = { ...state, screen: "loading", error: null };
        publish();
        await finishLoad(generation, true);
      } else if (manager && state.levelId) await api.restart();
      else await api.boot();
    },
    openSettings() {
      if (state.screen === "menu" || state.screen === "paused") {
        returnScreen = state.screen;
        state = { ...state, screen: "settings" };
        publish();
      }
    },
    closeSettings() {
      if (state.screen === "settings") {
        state = { ...state, screen: returnScreen };
        publish();
      }
    },
    updateSettings(patch: Partial<SaveSettings>) {
      try {
        save.updateSettings(patch);
        runtime?.settings(save.snapshot().settings);
        publish();
      } catch (cause) {
        error(cause);
      }
    },
    setSpeed(value: 1 | 2) {
      driver?.setSpeed(value);
      state = { ...state, speed: value };
      publish();
    },
    togglePerf() {
      state = { ...state, perf: !state.perf };
      publish();
    },
    dismissNotices() {
      state = { ...state, notices: [] };
      publish();
    },
    step(count = 1) {
      return driver?.step(count) ?? 0;
    },
    dispose() {
      disposed = true;
      ++generation;
      clearLevel();
      manager?.dispose();
      listeners.clear();
      eventListeners.clear();
    },
  };
  return api;
}
export type AppController = ReturnType<typeof createAppController>;
