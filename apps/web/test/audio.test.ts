import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '@node-arena/content';
import type { SimEvent, SimView } from '@node-arena/sim';
import { defaultSave } from '../src/save';
import { createAudio } from '../src/audio';
class Source {
  buffer: AudioBuffer | null = null; loop = false; onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
}
function fixture(options: {cap?: number; suspended?: boolean} = {}) {
  const sources: Source[] = [], gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const context = { currentTime: 0, state: options.suspended ? 'suspended' : 'running', destination: {},
    createBufferSource: () => { const s = new Source(); sources.push(s); return s; },
    createGain: () => { const g = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; gains.push(g); return g; },
    resume: vi.fn(async () => { context.state = 'running'; }), close: vi.fn(async () => {}) };
  const gestureTarget = new EventTarget();
  const audio = createAudio({ context: context as unknown as AudioContext, gestureTarget, voiceCap: options.cap ?? 2 });
  const manifest = { events: { Clash: { sfx: 'audio/clash.wav' }, Music: { sfx: 'audio/music.wav' } }, visuals: { office: { sfx: 'audio/capture.wav' } } } as unknown as Manifest;
  const buffers = new Map(['clash', 'music', 'capture'].map(n => [`audio/${n}.wav`, {} as AudioBuffer]));
  const view = { towerStatic: [{ visual: 'office' }] } as unknown as SimView;
  audio.setLevel(manifest, buffers); audio.settings(defaultSave().settings);
  return { audio, context, sources, gains, gestureTarget, manifest, buffers, view };
}
const clash = { type: 'Clash', channel: 1, progA: 0, progB: 0 } as SimEvent;
const captured = { type: 'Captured', tower: 0, from: 0, to: 1 } as SimEvent;
describe('manifest audio', () => {
  it('maps events, prioritizes explicit mapping, cools down by wall audio time and steals oldest within cap', () => {
    const f = fixture(); expect(f.sources[0]!.loop).toBe(true);
    f.audio.consumeEvents([clash, clash], f.view); expect(f.audio.activeVoices).toBe(1);
    f.audio.consumeEvents([captured], f.view); expect(f.sources[2]!.buffer).toBe(f.buffers.get('audio/capture.wav'));
    f.context.currentTime = .2; f.audio.consumeEvents([clash], f.view);
    expect(f.audio.activeVoices).toBe(2); expect(f.sources[1]!.stop).toHaveBeenCalledOnce();
    f.sources[3]!.onended!(); expect(f.audio.activeVoices).toBe(1); expect(f.sources[3]!.buffer).toBeNull();
    f.manifest.events.Captured = { sfx: 'audio/clash.wav' }; f.context.currentTime = 1;
    f.audio.consumeEvents([captured], f.view); expect(f.sources.at(-1)!.buffer).toBe(f.buffers.get('audio/clash.wav'));
  });
  it('keeps a single loop on repeated snapshots, separate gains and clears buffers on level end', () => {
    const f = fixture(); f.audio.setLevel(f.manifest, f.buffers); expect(f.sources).toHaveLength(1);
    f.audio.settings({ ...defaultSave().settings, musicVol: .3, sfxMute: true });
    expect(f.gains.map(g => g.gain.value)).toEqual([0, .3]);
    f.audio.consumeEvents([clash], f.view); expect(f.audio.activeVoices).toBe(0);
    f.audio.settings({ ...defaultSave().settings, musicMute: true, sfxVol: .2 });
    expect(f.gains.map(g => g.gain.value)).toEqual([.2, 0]);
    f.audio.consumeEvents([clash], f.view); f.audio.clearLevel();
    expect(f.audio.activeVoices).toBe(0); expect(f.sources.every(s => s.buffer === null)).toBe(true);
    f.audio.dispose(); f.audio.dispose(); expect(f.context.close).not.toHaveBeenCalled();
    expect(f.gains.every(g => g.disconnect.mock.calls.length === 1)).toBe(true);
  });
  it('drops suspended SFX, retries denied resume on next gesture, detaches after dispose', async () => {
    const f = fixture({ suspended: true }); f.audio.consumeEvents([clash], f.view); expect(f.audio.activeVoices).toBe(0);
    f.context.resume.mockRejectedValueOnce(new Error('denied'));
    f.gestureTarget.dispatchEvent(new Event('pointerdown')); await Promise.resolve(); await Promise.resolve();
    f.gestureTarget.dispatchEvent(new Event('keydown')); await Promise.resolve(); await Promise.resolve();
    expect(f.context.resume).toHaveBeenCalledTimes(2); expect(f.context.state).toBe('running');
    f.audio.consumeEvents([clash], f.view); expect(f.audio.activeVoices).toBe(1);
    f.audio.dispose(); f.context.state = 'suspended'; f.gestureTarget.dispatchEvent(new Event('pointerdown'));
    expect(f.context.resume).toHaveBeenCalledTimes(2);
  });
});

import { connectAppAudio } from '../src/audio/app';
import { createAppController } from '../src/app/state';
import { contentFiles } from '../src/app/boot';
import { parseManifest } from '../src/manifest/load';
import manifestJSON from './fixtures/greybox-manifest.json';
import { AssetManager } from '../src/manifest/assets';
import { createSaveStore, SAVE_KEY } from '../src/save';
it('connects real controller sessions/events, persists settings, restarts music once and releases old buffers', async () => {
  const f = fixture(); f.audio.dispose();
  const manifest = parseManifest({ ...manifestJSON, events: { ...manifestJSON.events, Music: { sfx: 'audio/music.wav' }, LineDrawn: { sfx: 'audio/clash.wav' } } });
  const data = new Map<string, string>(), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k,v); } };
  const app = createAppController({ files: contentFiles(), loadManifest: async () => manifest, autoStart: false,
    save: createSaveStore({ storage }), createAssetManager: m => new AssetManager(m, { loadAudio: async src => f.buffers.get(src)! }) });
  const connector = connectAppAudio(app, { context: f.context as unknown as AudioContext, gestureTarget: f.gestureTarget });
  await app.boot(); await app.startLevel('sample');
  const loop = f.sources.at(-1)!; expect(loop.loop).toBe(true);
  app.step(5); app.pause(); app.openSettings();
  app.updateSettings({ musicVol: .25, sfxVol: .4, sfxMute: true });
  expect(f.sources.at(-1)).toBe(loop);
  expect(JSON.parse(data.get(SAVE_KEY)!).settings).toMatchObject({ musicVol: .25, sfxVol: .4, sfxMute: true });
  expect(createSaveStore({ storage }).snapshot().settings.musicVol).toBe(.25);
  app.closeSettings(); app.resume(); app.updateSettings({ sfxMute: false });
  app.driver!.submit({ type: 'DrawLine', player: 'p1', from: 't1', to: 't3' }); app.step();
  expect(connector.audio.activeVoices).toBe(1);
  await app.restart(); expect(loop.buffer).toBeNull();
  expect(f.sources.filter(s => s.loop && s.buffer)).toHaveLength(1);
  const current = f.sources.at(-1)!; app.menu(); expect(current.buffer).toBeNull();
  connector.dispose(); app.dispose();
});
it('closes an owned context exactly once and stays silent without manifest audio', () => {
  const f = fixture(); f.audio.dispose();
  const audio = createAudio({ createContext: () => f.context as unknown as AudioContext, gestureTarget: f.gestureTarget });
  audio.setLevel({ events: {}, visuals: {} } as Manifest, new Map());
  expect(f.context.close).not.toHaveBeenCalled();
  f.gestureTarget.dispatchEvent(new Event('keydown')); audio.dispose(); audio.dispose();
  expect(f.context.close).toHaveBeenCalledOnce();
});
