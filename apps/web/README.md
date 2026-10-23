# Web client

Vite, Preact and Three.js landscape Tower War client. Node >=22.13, pnpm 10.34.6.

- `src/app/` — campaign picker, match lifecycle and runtime.
- `src/ui/` — 20 campaign cards, building ownership HUD, restart/result dialogs and credits.
- `src/render/` — SP07 world renderer; camera and one mirrored world root.
- `src/input/` — pointer draw, swipe/right-button cut and hold eraser; commands enter through GameDriver.
- `src/save/` — v2 local progress and four audio preferences. Older saves are backed up and reset.
- `src/audio/` — manifest audio and gesture-gated playback.
- `src/test-harness/` — development/test-build hooks; ordinary production omits them.
- `test/sp07`, `test/sp08` — current renderer and shell unit/browser tests.
- `e2e/` — real driver commands, picker/results, all campaign camera sizes and browser content identity parity.
- `assets/` — imported models, textures, audio, UI sprites and v2 manifest.

Run `pnpm dev`, `pnpm --filter @node-arena/web build`, `pnpm --filter @node-arena/web test`, or root `pnpm test:web:all` (test build + preview and development browser suites, one worker).

Browser hooks: `/?test=1&level=1&seed=1` uses manual ticks and isolated progress; `window.__na` exposes probes and driver commands. `?fixture=win|loss` requires `test=1` and exists only in development/test bundles. The hash-parity HTML entry is emitted only by `build:test`.

Renderer capture tools live in `tools/assets/` and the active branch's SP07/SP08 artifacts. The v1 visual metrics/capture toolchain has been removed.
