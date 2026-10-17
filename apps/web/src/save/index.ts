/** Small, versioned browser save store. No simulation or content ordering dependencies. */
export const SAVE_KEY = 'nodearena:save';
export const SAVE_BACKUP_KEY = `${SAVE_KEY}.bak`;
export interface SaveSettings {
  musicVol: number;
  sfxVol: number;
  musicMute: boolean;
  sfxMute: boolean;
  colorblind: boolean;
  quality: 'low' | 'med' | 'high';
  reducedMotion: boolean;
}
export interface SaveData {
  v: 1;
  completed: Record<string, { firstAt: string }>;
  settings: SaveSettings;
  lastLevel: string | null;
}
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface SaveNotice { kind: 'reset' | 'storage'; message: string }
export interface MatchResult {
  outcome: 'won' | 'lost' | 'timeout' | 'draw';
  devTuned: boolean;
  replay: boolean;
}
export interface SaveStore {
  snapshot(): SaveData;
  updateSettings(patch: Partial<SaveSettings>): void;
  setLastLevel(levelId: string | null): void;
  /** Returns true only when a new completion was recorded. */
  recordResult(levelId: string, result: MatchResult): boolean;
  /** Each notice kind is returned once per store/session, even after repeated failures. */
  consumeNotice(): SaveNotice | null;
}
export interface SaveOptions {
  storage?: SaveStorage | null;
  /** Access is lazy and caught, including SecurityError from the localStorage getter. */
  storageProvider?: () => SaveStorage | null;
  now?: () => Date;
}

export function defaultSave(): SaveData {
  return {
    v: 1, completed: Object.create(null) as SaveData['completed'],
    settings: { musicVol: 0.7, sfxVol: 1, musicMute: false, sfxMute: false,
      colorblind: false, quality: 'med', reducedMotion: typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches },
    lastLevel: null,
  };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected save object');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Unexpected save fields');
  }
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid completion date');
  return value;
}
function level(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') throw new Error('Invalid level id');
  return value;
}
function settings(value: unknown, legacy = false): SaveSettings {
  const source = record(value);
  const keys = ['musicVol', 'sfxVol', 'musicMute', 'sfxMute', 'colorblind', 'quality'];
  if (!legacy) keys.push('reducedMotion');
  exact(source, keys);
  for (const key of ['musicVol', 'sfxVol']) {
    const volume = source[key];
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw new Error('Volume must be finite and between 0 and 1');
    }
  }
  for (const key of ['musicMute', 'sfxMute', 'colorblind', ...(!legacy ? ['reducedMotion'] : [])]) {
    if (typeof source[key] !== 'boolean') throw new Error('Invalid settings flag');
  }
  if (!['low', 'med', 'high'].includes(source.quality as string)) throw new Error('Invalid quality');
  return { ...source, ...(legacy ? { reducedMotion: false } : {}) } as unknown as SaveSettings;
}
function validateSave(value: unknown): SaveData {
  const source = record(value);
  exact(source, ['v', 'completed', 'settings', 'lastLevel']);
  if (source.v !== 1) throw new Error('Invalid save version');
  const completed: SaveData['completed'] = Object.create(null) as SaveData['completed'];
  for (const [id, entry] of Object.entries(record(source.completed))) {
    const completion = record(entry);
    exact(completion, ['firstAt']);
    completed[id] = { firstAt: date(completion.firstAt) };
  }
  return { v: 1, completed, settings: settings(source.settings), lastLevel: level(source.lastLevel) };
}

/** Index n upgrades version n to n+1. v0 used date strings and had no reduced-motion flag. */
export const migrations: ReadonlyArray<(old: unknown) => unknown> = Object.freeze([
  (old: unknown): SaveData => {
    const source = record(old);
    exact(source, ['v', 'completed', 'settings', 'lastLevel']);
    if (source.v !== 0) throw new Error('Invalid historical save version');
    const completed: SaveData['completed'] = Object.create(null) as SaveData['completed'];
    for (const [id, firstAt] of Object.entries(record(source.completed))) {
      completed[id] = { firstAt: date(firstAt) };
    }
    return { v: 1, completed, settings: settings(source.settings, true), lastLevel: level(source.lastLevel) };
  },
]);

/** Pure parse/migrate/validate, always returning a fresh object. Throws on unsafe saves. */
export function decodeSave(raw: string): SaveData {
  let value: unknown = JSON.parse(raw);
  const version = record(value).v;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > 1) {
    throw new Error('Unsupported save version');
  }
  for (let current = version; current < 1; current++) value = migrations[current]!(value);
  return validateSave(value);
}

function browserStorage(): SaveStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}
export function createSaveStore(options: SaveOptions = {}): SaveStore {
  let state = defaultSave();
  let storage: SaveStorage | null = null;
  const notices: SaveNotice[] = [];
  const seen = new Set<SaveNotice['kind']>();
  const notify = (kind: SaveNotice['kind']) => {
    if (seen.has(kind)) return;
    seen.add(kind);
    notices.push({ kind, message: kind === 'reset'
      ? 'Your saved data could not be read and was reset. A backup was kept when storage allowed it.'
      : 'Saving is unavailable. Progress and settings will be kept for this session.' });
  };
  const write = (key: string, raw: string) => {
    try {
      if (!storage) throw new Error('Storage unavailable');
      storage.setItem(key, raw);
    } catch { notify('storage'); }
  };
  const persist = () => write(SAVE_KEY, JSON.stringify(state));
  try {
    storage = options.storage !== undefined ? options.storage : (options.storageProvider ?? browserStorage)();
    if (!storage) notify('storage');
  } catch { notify('storage'); }
  let raw: string | null = null;
  if (storage) {
    try { raw = storage.getItem(SAVE_KEY); } catch { storage = null; notify('storage'); }
  }
  if (raw !== null) {
    try {
      state = decodeSave(raw);
    } catch {
      notify('reset');
      write(SAVE_BACKUP_KEY, raw);
    }
    // Also persists migrated saves and recovered defaults. Failed writes retain state.
    persist();
  }
  return {
    snapshot: () => validateSave(state),
    updateSettings(patch) {
      const keys = Object.keys(defaultSave().settings);
      if (Object.keys(record(patch)).some(key => !keys.includes(key))) throw new Error('Unknown setting');
      state.settings = settings({ ...state.settings, ...patch });
      persist();
    },
    setLastLevel(levelId) { state.lastLevel = level(levelId); persist(); },
    recordResult(levelId, result) {
      if (typeof levelId !== 'string') throw new Error('Invalid level id');
      // Require explicit normal-match provenance, including at runtime for JS callers.
      if (result.outcome !== 'won' || result.devTuned !== false || result.replay !== false) return false;
      if (Object.hasOwn(state.completed, levelId)) return false;
      state.completed[levelId] = { firstAt: (options.now?.() ?? new Date()).toISOString() };
      persist();
      return true;
    },
    consumeNotice: () => notices.shift() ?? null,
  };
}
