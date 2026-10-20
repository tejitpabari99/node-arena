import { describe, expect, it, vi } from 'vitest';
import v0 from './fixtures/save/v0.json';
import v1 from './fixtures/save/v1.json';
import { createSaveStore, decodeSave, defaultSave, migrations, SAVE_KEY, type SaveStorage } from '../src/save';

class MemoryStorage implements SaveStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
/** Fixtures predate tipSeen; they load with the default false. */
const v1Loaded = { ...v1, settings: { ...v1.settings, tipSeen: false } };
const seeded = (value: unknown) => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, typeof value === 'string' ? value : JSON.stringify(value));
  return storage;
};

describe('versioned saves', () => {
  it('loads a key-less v1 blob with tipSeen === false', () => {
    expect('tipSeen' in v1.settings).toBe(false);
    expect(decodeSave(JSON.stringify(v1)).settings.tipSeen).toBe(false);
    expect(createSaveStore({ storage: seeded(v1) }).snapshot().settings.tipSeen).toBe(false);
  });
  it('round-trips tipSeen true and rejects a non-boolean tipSeen', () => {
    const storage = new MemoryStorage();
    createSaveStore({ storage }).updateSettings({ tipSeen: true });
    expect(JSON.parse(storage.getItem(SAVE_KEY)!).settings.tipSeen).toBe(true);
    expect(createSaveStore({ storage }).snapshot().settings.tipSeen).toBe(true);
    expect(() => decodeSave(JSON.stringify({ ...v1, settings: { ...v1.settings, tipSeen: 'yes' } }))).toThrow();
  });
  it.each([v0, v1])('migrates fixture v$v without mutating input', (fixture) => {
    const before = JSON.stringify(fixture);
    expect(decodeSave(JSON.stringify(fixture))).toEqual(v1Loaded);
    expect(JSON.stringify(fixture)).toBe(before);
    expect(migrations).toHaveLength(1);
    expect(migrations[0]!(v0)).toEqual(v1Loaded);
  });
  it('persists migration to current version and retains dates keyed by id', () => {
    const storage = seeded(v0);
    const store = createSaveStore({ storage });
    expect(store.snapshot()).toEqual(v1Loaded);
    expect(JSON.parse(storage.getItem(SAVE_KEY)!)).toEqual(v1Loaded);
    expect(store.consumeNotice()).toBeNull();
  });
  it.each(['{bad json', 'null', JSON.stringify({ ...v1, v: 2 }), JSON.stringify({ ...v1, v: -1 }), JSON.stringify({ ...v1, mystery: true }), JSON.stringify({ ...v1, completed: { a: { firstAt: 'bad date' } } })])('backs up invalid raw input %s, resets and consumes notice once', (raw) => {
    const storage = seeded(raw);
    const store = createSaveStore({ storage });
    expect(storage.getItem(`${SAVE_KEY}.bak`)).toBe(raw);
    expect(store.snapshot()).toEqual(defaultSave());
    expect(JSON.parse(storage.getItem(SAVE_KEY)!)).toEqual(defaultSave());
    expect(store.consumeNotice()?.kind).toBe('reset');
    expect(store.consumeNotice()).toBeNull();
    expect(createSaveStore({ storage }).consumeNotice()).toBeNull();
  });
  it.each([
    { musicVol: -0.1 }, { sfxVol: 1.1 }, { musicVol: '0.4' },
    { musicMute: 1 }, { sfxMute: 'false' }, { colorblind: null },
    { reducedMotion: [] }, { quality: 'ultra' }, { musicVol: null },
  ])('rejects invalid persisted settings %j', (patch) => {
    expect(() => decodeSave(JSON.stringify({ ...v1, settings: { ...v1.settings, ...patch } }))).toThrow();
  });
  it('validates in-memory settings including finite numbers before mutation', () => {
    const store = createSaveStore({ storage: null });
    const before = store.snapshot();
    for (const musicVol of [NaN, Infinity, -Infinity, 2]) {
      expect(() => store.updateSettings({ musicVol })).toThrow();
    }
    expect(() => store.updateSettings({ unexpected: true } as never)).toThrow();
    expect(store.snapshot()).toEqual(before);
  });
  it('records only ordinary wins, preserves first completion, reloads and isolates snapshots', () => {
    const storage = new MemoryStorage();
    const now = vi.fn(() => new Date('2026-10-08T12:00:00.000Z'));
    const store = createSaveStore({ storage, now });
    for (const outcome of ['lost', 'timeout', 'draw'] as const) {
      expect(store.recordResult('a', { outcome, devTuned: false, replay: false })).toBe(false);
    }
    expect(store.recordResult('a', { outcome: 'won', devTuned: true, replay: false })).toBe(false);
    expect(store.recordResult('a', { outcome: 'won', devTuned: false, replay: true })).toBe(false);
    expect(store.recordResult('a', { outcome: 'won', devTuned: false, replay: false })).toBe(true);
    now.mockReturnValue(new Date('2026-10-09T12:00:00.000Z'));
    expect(store.recordResult('a', { outcome: 'won', devTuned: false, replay: false })).toBe(false);
    store.setLastLevel('a');
    store.updateSettings({ quality: 'high', reducedMotion: true });
    const snapshot = store.snapshot();
    snapshot.completed.a!.firstAt = 'changed';
    snapshot.settings.quality = 'low';
    const loaded = createSaveStore({ storage }).snapshot();
    expect(loaded.completed.a?.firstAt).toBe('2026-10-08T12:00:00.000Z');
    expect(loaded.settings.quality).toBe('high');
    expect(loaded.settings.reducedMotion).toBe(true);
    expect(loaded.lastLevel).toBe('a');
  });
  it('supports untrusted ids without prototype setters or inherited completion', () => {
    const storage = seeded(JSON.stringify({ ...v1, completed: JSON.parse('{"__proto__":{"firstAt":"2026-10-01T12:00:00.000Z"}}') }));
    const store = createSaveStore({ storage });
    expect(store.snapshot().completed.__proto__?.firstAt).toBe('2026-10-01T12:00:00.000Z');
    expect(store.recordResult('constructor', { outcome: 'won', devTuned: false, replay: false })).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(storage.getItem(SAVE_KEY)!).completed, 'constructor')).toBe(true);
    expect(Object.prototype).not.toHaveProperty('firstAt');
  });
  it.each(['access', 'read', 'write'] as const)('keeps session progress/settings if storage fails on %s', (failure) => {
    const storage = new MemoryStorage();
    if (failure === 'read') storage.getItem = () => { throw new Error('blocked'); };
    if (failure === 'write') storage.setItem = () => { throw new Error('quota'); };
    const store = createSaveStore({ storageProvider: () => {
      if (failure === 'access') throw new Error('SecurityError');
      return storage;
    } });
    store.updateSettings({ musicVol: 0.2 });
    store.recordResult('session', { outcome: 'won', devTuned: false, replay: false });
    store.setLastLevel('session');
    expect(store.snapshot().settings.musicVol).toBe(0.2);
    expect(store.snapshot().completed.session).toBeDefined();
    expect(store.snapshot().lastLevel).toBe('session');
    expect(store.consumeNotice()?.kind).toBe('storage');
    expect(store.consumeNotice()).toBeNull();
    store.updateSettings({ sfxMute: true });
    expect(store.consumeNotice()).toBeNull();
  });
  it('handles a throwing default browser localStorage getter', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('SecurityError'); } });
    try {
      const store = createSaveStore();
      store.updateSettings({ colorblind: true });
      expect(store.snapshot().settings.colorblind).toBe(true);
      expect(store.consumeNotice()?.kind).toBe('storage');
    } finally { vi.unstubAllGlobals(); }
  });
  it.each([
    { ...v0, settings: { ...v0.settings, reducedMotion: false } },
    { ...v0, completed: { a: { firstAt: '2026-10-01T12:00:00.000Z' } } },
    { ...v1, v: '1' }, { ...v1, v: 0.5 },
    { ...v1, completed: [] }, { ...v1, lastLevel: 2 },
    { ...v1, completed: { a: { firstAt: '2026-10-01T12:00:00.000Z', extra: true } } },
    { ...v1, settings: { ...v1.settings, extra: true } },
    { ...v1, settings: { ...v1.settings, reducedMotion: undefined } },
  ])('rejects malformed version/schema %j', (input) => {
    const raw = JSON.stringify(input);
    const storage = seeded(raw);
    expect(createSaveStore({ storage }).snapshot()).toEqual(defaultSave());
    expect(storage.getItem(`${SAVE_KEY}.bak`)).toBe(raw);
  });
  it('backs up corruption when only primary writes fail and keeps new session state', () => {
    const storage = seeded('{bad');
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === SAVE_KEY) throw new Error('quota');
      setItem(key, value);
    };
    const store = createSaveStore({ storage });
    expect(storage.getItem(`${SAVE_KEY}.bak`)).toBe('{bad');
    store.updateSettings({ quality: 'low' });
    expect(store.snapshot().settings.quality).toBe('low');
    expect(store.consumeNotice()?.kind).toBe('reset');
    expect(store.consumeNotice()?.kind).toBe('storage');
    expect(store.consumeNotice()).toBeNull();
  });
  it('loads fresh defaults and requires explicit ordinary-match provenance', () => {
    const storage = new MemoryStorage();
    const store = createSaveStore({ storage });
    expect(store.snapshot()).toEqual(defaultSave());
    expect(store.consumeNotice()).toBeNull();
    expect(store.recordResult('a', { outcome: 'won' } as never)).toBe(false);
    expect(store.snapshot().completed.a).toBeUndefined();
    store.setLastLevel(null);
    expect(createSaveStore({ storage }).snapshot().lastLevel).toBeNull();
    expect(() => store.setLastLevel(1 as never)).toThrow();
  });
  it('resets corrupt saves even if backup/write is blocked', () => {
    const storage = seeded('{bad');
    storage.setItem = () => { throw new Error('blocked'); };
    const store = createSaveStore({ storage });
    expect(store.snapshot()).toEqual(defaultSave());
    expect(store.consumeNotice()?.kind).toBe('reset');
    expect(store.consumeNotice()?.kind).toBe('storage');
    expect(store.consumeNotice()).toBeNull();
  });
});
