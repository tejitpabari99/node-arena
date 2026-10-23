import { describe, expect, it, vi } from 'vitest';
import type { ManifestV2 } from '@node-arena/content';
import type { SimEvent, SimView } from '@node-arena/sim';
import { defaultSave } from '../../src/save';
import { createAudio } from '../../src/audio';
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
  const manifest = { events: { Clash: { sfx: 'audio/clash.wav' },  }, visuals: { office: { sfx: 'audio/capture.wav' } } } as unknown as ManifestV2;
  const buffers = new Map(['clash', 'music', 'capture'].map(n => [`audio/${n}.wav`, {} as AudioBuffer]));
  const view = { buildingStatic: [{ visual: 'office' }] } as unknown as SimView;
  audio.setLevel(manifest, buffers, 'audio/music.wav'); audio.settings(defaultSave().settings);
  return { audio, context, sources, gains, gestureTarget, manifest, buffers, view };
}
const clash: SimEvent = { type: 'Clash', kind:'headon', a:{channel:1,seq:1,owner:0}, b:{channel:2,seq:2,owner:1}, x:0,z:0 };
const captured = { type: 'BuildingCaptured', building: 0, from: 0, to: 1 } as SimEvent;
describe('manifest audio', () => {
  it('maps events, prioritizes explicit mapping, cools down by wall audio time and steals oldest within cap', () => {
    const f = fixture(); expect(f.sources[0]!.loop).toBe(true);
    f.audio.consumeEvents([clash, clash], f.view); expect(f.audio.activeVoices).toBe(1);
    f.audio.consumeEvents([captured], f.view); expect(f.sources[2]!.buffer).toBe(f.buffers.get('audio/capture.wav'));
    f.context.currentTime = .2; f.audio.consumeEvents([clash], f.view);
    expect(f.audio.activeVoices).toBe(2); expect(f.sources[1]!.stop).toHaveBeenCalledOnce();
    f.sources[3]!.onended!(); expect(f.audio.activeVoices).toBe(1); expect(f.sources[3]!.buffer).toBeNull();
    f.manifest.events.BuildingCaptured = { sfx: 'audio/clash.wav' }; f.context.currentTime = 1;
    f.audio.consumeEvents([captured], f.view); expect(f.sources.at(-1)!.buffer).toBe(f.buffers.get('audio/clash.wav'));
  });
  it('keeps a single loop on repeated snapshots, separate gains and clears buffers on level end', () => {
    const f = fixture(); f.audio.setLevel(f.manifest, f.buffers, 'audio/music.wav'); expect(f.sources).toHaveLength(1);
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

import { loadAudioBuffers } from '../../src/audio/app';
it('loads unique v2 event/visual audio paths and ignores transport failure and aborted decodes',async()=>{
 const controller=new AbortController(),decoded={} as AudioBuffer;
 const manifest={events:{Clash:{sfx:'audio/a.ogg'},TowerShot:{sfx:'audio/b.ogg'}},visuals:{house:{sfx:'audio/a.ogg'}}} as unknown as ManifestV2;
 const fetched:string[]=[];const fetcher=async(url:RequestInfo|URL)=>{fetched.push(String(url));return {ok:!String(url).includes('b.ogg'),arrayBuffer:async()=>new ArrayBuffer(2)} as Response;};
 const buffers=await loadAudioBuffers(manifest,controller.signal,{fetcher:fetcher as typeof fetch,decode:async()=>decoded});
 expect(fetched.sort()).toEqual(['/audio/a.ogg','/audio/b.ogg']);expect([...buffers.keys()]).toEqual(['audio/a.ogg']);
 controller.abort();expect((await loadAudioBuffers(manifest,controller.signal,{fetcher:fetcher as typeof fetch,decode:async()=>decoded})).size).toBe(0);
});
it('does not create a playback context before a gesture when the manifest has no music',()=>{
 const createContext=vi.fn(()=>{throw Error('gesture required');});const audio=createAudio({createContext,gestureTarget:new EventTarget()});
 audio.setLevel({events:{},visuals:{}} as unknown as ManifestV2,new Map());expect(createContext).not.toHaveBeenCalled();audio.dispose();
});
