# Audio

`createAudio` owns a thin WebAudio graph with separate SFX/music gain nodes. Injected contexts are borrowed; contexts created by the wrapper are closed on disposal. Sources disconnect and drop decoded-buffer references when ended, stolen or unloaded. The SFX cap defaults to eight; when full the oldest voice is stopped. Per-event cooldown defaults to 120 ms of AudioContext time, independent of simulation speed. Muted/zero-volume/suspended SFX are dropped, avoiding delayed bursts after resume.

`connectAppAudio` listens to controller settings, level-session identity and sim events. Existing Settings UI writes go through the SaveStore; audio only observes those settings. Music continues through pause, settings and results, ends when the level unloads, and restarts once for a new ready session. Pointerdown and keydown resume the context; failed autoplay resumes are caught and retried on later gestures.

## SP05 asset contract

- `manifest.events[simEvent.type].sfx` is a safe relative asset path, such as `audio/clash.wav`, loaded into `AssetSession.audio` by the existing loader.
- Explicit event SFX wins. `Captured` can fall back to the captured tower's `manifest.visuals[visual].sfx`, matching the FX fallback contract.
- Add one looping music track as `manifest.events.Music.sfx`. `Music` is a reserved mapping key, not a simulation event. The resolver already loads every events SFX path.
- SP05 supplies production CC0 audio and credits. Missing mappings are silent; Task13 introduces no production assets.

Run `pnpm --filter @node-arena/web test test/audio.test.ts` for wrapper and real-controller lifecycle/save checks. Run `WEB_TEST_SERVER=dev pnpm --filter @node-arena/web exec playwright test e2e/audio.spec.ts --workers=1` for real browser WebAudio: synthetic in-memory WAV decoding, measured waveform output, independent muting, cap and disposal. This fixture deliberately uses Vite source transport and is skipped in the preview suite.
