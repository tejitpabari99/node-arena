import { describe, expect, it, vi } from 'vitest';


import { createSaveStore, decodeSave, defaultSave, SAVE_KEY, type SaveStorage } from '../src/save';

class MemoryStorage implements SaveStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const v1 = defaultSave();
const v0 = { ...v1, v: 1 };
const seeded = (value: unknown) => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, typeof value === 'string' ? value : JSON.stringify(value));
  return storage;
};

describe('versioned saves', () => {
  it.each(['{bad json', 'null', JSON.stringify({ ...v1, v: 3 }), JSON.stringify({ ...v1, v: -1 }), JSON.stringify({ ...v1, mystery: true }), JSON.stringify({ ...v1, completed: { a: { firstAt: 'bad date' } } })])('backs up invalid raw input %s, resets and consumes notice once', (raw) => {
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
      expect(store.recordResult('a', { winner: outcome === 'lost' ? 1 : null, human: 0 })).toBe(false);
    }
    expect(store.recordResult('a', { winner: 0, human: 0 })).toBe(true);
    now.mockReturnValue(new Date('2026-10-09T12:00:00.000Z'));
    expect(store.recordResult('a', { winner: 0, human: 0 })).toBe(false);
    store.setLastLevel('a');
    store.updateSettings({ musicVol: .4, sfxMute: true });
    const snapshot = store.snapshot();
    snapshot.completed.a!.firstAt = 'changed';
    snapshot.settings.musicVol = .9;
    const loaded = createSaveStore({ storage }).snapshot();
    expect(loaded.completed.a?.firstAt).toBe('2026-10-08T12:00:00.000Z');
    expect(loaded.settings.musicVol).toBe(.4);
    expect(loaded.settings.sfxMute).toBe(true);
    expect(loaded.lastLevel).toBe('a');
  });
  it('supports untrusted ids without prototype setters or inherited completion', () => {
    const storage = seeded(JSON.stringify({ ...v1, completed: JSON.parse('{"__proto__":{"firstAt":"2026-10-01T12:00:00.000Z"}}') }));
    const store = createSaveStore({ storage });
    expect(store.snapshot().completed.__proto__?.firstAt).toBe('2026-10-01T12:00:00.000Z');
    expect(store.recordResult('constructor', { winner: 0, human: 0 })).toBe(true);
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
    store.recordResult('session', { winner: 0, human: 0 });
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
      store.updateSettings({ musicMute: true });
      expect(store.snapshot().settings.musicMute).toBe(true);
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
    { ...v1, settings: { ...v1.settings, musicMute: undefined } },
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
    store.updateSettings({ sfxVol: .2 });
    expect(store.snapshot().settings.sfxVol).toBe(.2);
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
