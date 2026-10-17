import { expect, test } from '@playwright/test';
// Imports the production wrapper through an isolated Vite module graph. This check intentionally runs with WEB_TEST_SERVER=dev.
test('real WebAudio decodes a test WAV, plays mapped voices, mutes independently and disposes', async ({ page }) => {
  test.skip(process.env.WEB_TEST_SERVER !== 'dev', 'Real WebAudio module fixture requires Vite dev transport');
  await page.route('**/audio-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Audio fixture</body></html>' }));
  await page.goto('/audio-test');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/audio/index.ts';
    const { createAudio } = await import(/* @vite-ignore */ modulePath);
    const ctx = new AudioContext();
    // Synthetic test-only PCM WAV; no production audio is added to the assets tree.
    const rate = 24000, count = rate, bytes = new ArrayBuffer(44 + count * 2), data = new DataView(bytes);
    const text = (offset: number, value: string) => [...value].forEach((c,i) => data.setUint8(offset+i,c.charCodeAt(0)));
    text(0,'RIFF'); data.setUint32(4,bytes.byteLength-8,true); text(8,'WAVE'); text(12,'fmt ');
    data.setUint32(16,16,true); data.setUint16(20,1,true); data.setUint16(22,1,true);
    data.setUint32(24,rate,true); data.setUint32(28,rate*2,true); data.setUint16(32,2,true); data.setUint16(34,16,true);
    text(36,'data'); data.setUint32(40,count*2,true);
    for(let i=0;i<count;i++) data.setInt16(44+i*2,Math.sin(i/rate*2*Math.PI*440)*12000,true);
    const buffer = await ctx.decodeAudioData(bytes), sfx = ctx.createAnalyser(), music = ctx.createAnalyser();
    sfx.fftSize = music.fftSize = 512;
    const createGain = ctx.createGain.bind(ctx), gains: GainNode[] = [];
    ctx.createGain = () => { const gain = createGain(); gain.connect(gains.length ? music : sfx); gains.push(gain); return gain; };
    const audio = createAudio({ context: ctx, gestureTarget: document, voiceCap: 2, cooldownSeconds: 0 });
    const settings = { sfxVol: 1, musicVol: .3, sfxMute: false, musicMute: false };
    audio.settings(settings); audio.setLevel({ events: { Music: { sfx: 'audio/test.wav' }, Clash: { sfx: 'audio/test.wav' } } }, new Map([['audio/test.wav',buffer]]));
    // Expose only this isolated test fixture for a trusted Playwright pointer gesture.
    (window as unknown as { audioFixture: unknown }).audioFixture = { audio, ctx, sfx, music, settings, gains };
    return { decoded: buffer.length, sampleRate: buffer.sampleRate };
  });
  expect(result.decoded).toBeGreaterThan(20000);
  await page.mouse.click(4,4);
  const wave = await page.evaluate(async () => {
    const f = (window as any).audioFixture;
    f.audio.consumeEvents([{ type:'Clash' }, { type:'Clash' }, { type:'Clash' }], {});
    const wait = () => new Promise(resolve => setTimeout(resolve,100));
    const peak = (analyser: AnalyserNode) => { const samples = new Float32Array(512); analyser.getFloatTimeDomainData(samples); return Math.max(...samples.map(Math.abs)); };
    await wait(); const audible = { sfx: peak(f.sfx), music: peak(f.music), cap: f.audio.activeVoices, state: f.ctx.state };
    f.audio.settings({ ...f.settings, sfxMute: true }); await wait();
    const muted = { sfx: peak(f.sfx), music: peak(f.music) };
    f.audio.settings({ ...f.settings, musicMute: true }); await wait();
    const independent = { sfx: peak(f.sfx), music: peak(f.music) };
    f.audio.dispose(); const disposed = f.audio.activeVoices; await f.ctx.close();
    return { audible, muted, independent, disposed };
  });
  expect(wave.audible.state).toBe('running'); expect(wave.audible.cap).toBe(2);
  expect(wave.audible.sfx).toBeGreaterThan(.1); expect(wave.audible.music).toBeGreaterThan(.01);
  expect(wave.muted.sfx).toBe(0); expect(wave.muted.music).toBeGreaterThan(.01);
  expect(wave.independent.sfx).toBeGreaterThan(.1); expect(wave.independent.music).toBe(0);
  expect(wave.disposed).toBe(0);
});
