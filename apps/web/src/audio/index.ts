import type { ManifestV2 } from '@node-arena/content';
import type { SimEvent, SimView } from '@node-arena/sim';
import { defaultSave, type SaveSettings } from '../save';
export interface AudioOptions {
  /** Borrowed contexts are never closed. The default context is created lazily. */
  context?: AudioContext;
  createContext?: () => AudioContext;
  gestureTarget?: EventTarget;
  voiceCap?: number;
  cooldownSeconds?: number;
}
interface Voice { source: AudioBufferSourceNode }
/** ManifestV2 sfx values are relative asset paths, decoded by the browser audio connector. */
export function createAudio(options: AudioOptions = {}) {
  const target = options.gestureTarget ?? (typeof document === 'undefined' ? undefined : document);
  const cap = Math.max(1, Math.floor(options.voiceCap ?? 8));
  const cooldown = Math.max(0, options.cooldownSeconds ?? .12);
  let context = options.context, sfxGain: GainNode | undefined, musicGain: GainNode | undefined;
  let musicSrc: string | null = null;
  let manifest: ManifestV2 | undefined, buffers: ReadonlyMap<string, AudioBuffer> | undefined;
  let settings = defaultSave().settings, music: Voice | undefined, disposed = false, resuming = false;
  const voices = new Set<Voice>(), last = new Map<string, number>();
  function ensureContext() {
    if (!context) {
      try { context = (options.createContext ?? (() => new AudioContext()))(); }
      catch { return undefined; }
    }
    if (!sfxGain) {
      sfxGain = context.createGain(); musicGain = context.createGain();
      sfxGain.connect(context.destination); musicGain.connect(context.destination); applySettings();
    }
    return context;
  }
  function applySettings() {
    if (sfxGain) sfxGain.gain.value = settings.sfxMute ? 0 : settings.sfxVol;
    if (musicGain) musicGain.gain.value = settings.musicMute ? 0 : settings.musicVol;
  }
  function release(voice: Voice, stop = false) {
    voice.source.onended = null;
    if (stop) { try { voice.source.stop(); } catch { /* Already ended. */ } }
    voice.source.disconnect(); voice.source.buffer = null; voices.delete(voice);
    if (music === voice) music = undefined;
  }
  function start(buffer: AudioBuffer, loop: boolean): Voice | undefined {
    const ctx = ensureContext(); if (!ctx) return;
    const source = ctx.createBufferSource(), voice = { source };
    source.buffer = buffer; source.loop = loop; source.connect(loop ? musicGain! : sfxGain!);
    source.onended = () => release(voice);
    try { source.start(); } catch { release(voice); return; }
    return voice;
  }
  function startMusic() {
    if (disposed || music || !musicSrc || ensureContext()?.state !== 'running') return;
    const buffer = musicSrc ? buffers?.get(musicSrc) : undefined;
    if (buffer) music = start(buffer, true);
  }
  function clearLevel() {
    for (const voice of voices) release(voice, true);
    if (music) release(music, true);
    last.clear(); musicSrc = null; manifest = undefined; buffers = undefined;
  }
  function gesture() {
    if (disposed || resuming) return;
    const ctx = ensureContext(); if (!ctx || ctx.state === 'closed') return;
    if (ctx.state === 'running') { startMusic(); return; }
    resuming = true;
    try {
      void ctx.resume().then(() => { if (!disposed) startMusic(); }, () => {}).finally(() => { resuming = false; });
    } catch { resuming = false; }
  }
  target?.addEventListener('pointerdown', gesture);
  target?.addEventListener('keydown', gesture);
  return {
    setLevel(nextManifestV2: ManifestV2, nextBuffers: ReadonlyMap<string, AudioBuffer>, nextMusic: string | null = null) {
      if (disposed || (manifest === nextManifestV2 && buffers === nextBuffers && musicSrc === nextMusic)) return;
      clearLevel(); manifest = nextManifestV2; buffers = nextBuffers; musicSrc = nextMusic; startMusic();
    },
    clearLevel,
    settings(value: SaveSettings) { if (!disposed) { settings = { ...value }; applySettings(); } },
    consumeEvents(events: readonly SimEvent[], view: SimView) {
      if (disposed || !manifest || !buffers || settings.sfxMute || settings.sfxVol === 0) return;
      for (const event of events) {
        const src = manifest.events[event.type]?.sfx ?? (event.type === 'BuildingCaptured' ? manifest.visuals[view.buildingStatic[event.building]?.visual ?? '']?.sfx : undefined);
        const buffer = src ? buffers.get(src) : undefined; if (!buffer) continue;
        const ctx = ensureContext(); if (!ctx || ctx.state !== 'running') continue;
        if (ctx.currentTime - (last.get(event.type) ?? -Infinity) < cooldown) continue;
        if (voices.size >= cap) release(voices.values().next().value!, true);
        const voice = start(buffer, false); if (voice) { voices.add(voice); last.set(event.type, ctx.currentTime); }
      }
    },
    get activeVoices() { return voices.size; },
    dispose() {
      if (disposed) return; disposed = true; clearLevel();
      target?.removeEventListener('pointerdown', gesture); target?.removeEventListener('keydown', gesture);
      sfxGain?.disconnect(); musicGain?.disconnect(); sfxGain = musicGain = undefined;
      if (context && !options.context) void context.close().catch(() => {});
      context = undefined;
    },
  };
}
export type GameAudio = ReturnType<typeof createAudio>;
