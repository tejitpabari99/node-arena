# Web client

Landscape Tower War client: Vite + Preact + Three.js, local campaign progress and audio settings. Node >=22.13, pnpm 10.34.6. Run commands from the repository root.

- `apps/web/src/app/` — picker, match lifecycle and runtime.
- `apps/web/src/ui/` — 20 campaign cards, building ownership HUD, dialogs and credits.
- `apps/web/src/render/` — world renderer, camera and one mirrored world root.
- `apps/web/src/input/` — pointer draw, swipe/right-button cut and hold eraser through GameDriver.
- `apps/web/src/save/`, `apps/web/src/audio/` — v2 local progress, four audio preferences and gesture-gated playback; old saves backed up/reset.
- `apps/web/src/test-harness/` — development/test-build hooks; excluded from ordinary production.
- `apps/web/test/sp07/`, `apps/web/test/sp08/`, `apps/web/e2e/` — renderer/shell tests, real driver commands, campaign camera sizes and content identity parity.
- `apps/web/assets/` — imported art/audio/UI and v2 manifests; private source art, see [credits](../../docs/CREDITS.md).

| Command | Purpose |
|---|---|
| `pnpm dev` | Development server on loopback |
| `pnpm build:web` | Typecheck and ordinary production bundle |
| `pnpm test:web` | Renderer/shell unit and browser tests |
| `pnpm test:web:e2e` | Test build and preview Playwright suite |
| `pnpm test:web:all` | Preview + development suites, sequential with one worker |
| `pnpm campaign:verify` | All 20 levels, five-second smoke, screenshots/grid/JSON under `test-results/campaign/` |
| `pnpm assets:capture:web` | Real-client SP08 reference captures |

Install Chromium before browser checks: `pnpm --filter @node-arena/web exec playwright install --with-deps chromium`. Package commands also expose build:test, preview:test and test:e2e:dev.

Harness URL: `/?test=1&level=1&seed=1` selects manual ticks and isolated progress; window.__na exposes probes/driver commands. Fixture query values win/loss require test=1 and development/test bundles. The hash-parity HTML entry is emitted only by the test build. Production excludes these hooks.

See [root development](../../README.md#development), [gates/tools](../../tools/README.md) and [levels/fidelity](../../docs/LEVELS_GUIDE.md). No deployment is configured or authorized by these commands.
