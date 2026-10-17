---
status: done
summary: Real app deterministic acceptance, screenshots, 2000+ troop CPU/draw gates and twenty-switch lifetime baseline pass; laptop sign-off remains manual
date: 2026-10-08
---
# Task 15 — Full application acceptance and performance

The actual production sample remains the only production level. All twenty test
arenas are authored JSON fixtures under a `?test=1` gate, validated and compiled
through the real app. GLB responses are synthetic test assets exercising the same
manifest/GLTF pipeline; they are not final SP05 art. No production bots, campaign,
CC0 files, content lock, rules, or SP04 CI/workflow/manifest CLI was added.

## Verified behavior

Eight application acceptance checks run on production preview and Vite dev:

- Normal URLs expose no test API. Test mode fixes seed 1, disables driver rAF,
  steps only until game over, and renders the current tick. A real pointer draw
  keeps spawning through tick 600 (30 seconds), with live troops. Public
  `createReplayRecorder` records commands stamped by the real driver; public
  `playReplay` matches checkpoints/final hash using authoritative content metadata,
  level simHash, and seed.
- Both pointer right-click and swipe cuts emit `LineCut`, stop future spawning
  on that channel, preserve in-flight arrival events, and allow a separate route
  to continue spawning.
- A real capture updates tower base color, roof glyph, current garrison label,
  and event-positioned FX. First head-on clash FX are within one world unit of
  the midpoint. Stable screenshots cover greybox menu/picker/game, GLB reskin,
  capture, head-on clash, and colourblind palette/glyphs with <=1% pixel tolerance.
  All screenshot comparisons pass in both servers; no structural fallback needed.
- All twenty authored fixtures can be selected. Real simulation capture produces
  victory and persistent completion after reload. Retry and Next lead directly to
  arenas; forbidden ad/energy/payment/interstitial DOM is absent. Stepping beyond
  a one-second limit stops at tick 20 and shows timeout.
- Actual GLB asset loading fails three times with asset key/source shown in the
  error screen. Retry fetches only the failed source (4 total troop requests,
  successful tower remains at 1), then renders a previously unknown fixture
  archetype/visual key at its manifest-authored scale. Invalid boot manifests show
  the same recoverable error UI and Retry succeeds after a valid response.

Integration failures exposed by the initial real-app tests were fixed within
SP03: the full-size `#app` container intercepted canvas gestures; it now allows
pointer events through while menus and controls remain interactive. A fast boot
response could publish before Preact's effect subscribed, leaving the shell at
"Preparing"; the controller subscription now uses the synchronous layout effect.
Fixture unit checks caught cap/bounds mistakes before final verification. Three
legacy dev tests used a machine-specific sim URL; these now derive it from their
own `import.meta.url` and were re-run after typecheck/lint.

## Full-scene stress method and results

Unlike the isolated Task 2 spike, this creates the real app/controller/driver,
real schema-valid compiled content, simulation troop rings, asset session, camera,
towers, instanced troops, lines, FX pool, input, labels, and UI. A source generates
200 troops/sec onto an 80-unit route; the slow authored test troop retains all
in-flight troops. Measurement starts with 2,000 troops and ends with 3,200.

Quality low, 640x360, DPR1, antialias/shadows off; visible screenshot scenes use
960x600 for unobstructed labels. Chromium 156 / Three r186 / ANGLE SwiftShader.
There are 20 warmed render frames, followed by 120 samples paced by rAF. Each
sample times the complete synchronous `app.step(1)` path: sim/replay recording,
app tick subscribers, tower/line/FX/input updates, troop attribute writes, and
WebGL render submission. Deferred Preact commits and GPU execution are outside
this synchronous CPU interval. No `gl.finish`, mocked troop count, or rounded HUD
metric is used. Every raw value is preserved in the linked JSON evidence.

| Server | N | Min ms | Median ms | Mean ms | p95 ms | Max ms | Draw calls | Ending troops |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Preview | 120 | 0.800 | 1.300 | 1.758 | 3.900 | 8.400 | 15 | 3,200 |
| Dev | 120 | 0.900 | 1.300 | 1.446 | 2.600 | 5.500 | 15 | 3,200 |

Nearest-rank p95 is strictly below 4 ms in both, and all draws are below 100.
Occasional maxima exceed 4 ms; these are p95 acceptance gates, not guarantees
that every frame stays below 4 ms. The preview result has only 0.1 ms margin.
Software GL is not evidence of laptop 60fps or final-art GPU performance.

## Twenty switches and cleanup

After sampling, cut the live route and render its remaining in-flight troops.
That equally warmed state establishes **13 geometries / 4 textures**. Each of 20
level switches recreates the same full app runtime, warms troops, cuts the route,
and compares GPU counts with that baseline. Counts remain identical; the DOM
contains exactly 3 tower labels and 1 canvas each time. The test-side lifetime
census remains at 13 relevant listeners and zero pending rAF throughout.

Menu restores zero labels, zero canvases, zero relevant listeners, and zero
pending rAF. All 21 retired renderers report **0 geometries**, and their actual
WebGL contexts report lost. Three's renderer-owned lazy fallback environment
texture remains reflected as **1 texture** in each disposed renderer's info;
this documented internal counter is not an application allocation, and the lost
contexts free its GPU storage. The known count is asserted explicitly rather
than hidden by constructing fresh renderers. Asset session borrowed resources
are released after the owned render scope. Both server runs preserve the complete
retired memory/context and listener evidence.

## Full verification

`pnpm test` passes 509 tests (232 content, 152 sim, 125 web), with no unit skips.
`pnpm build`, `pnpm lint`, `pnpm check:schemas`,
`pnpm check:content --base 343593c`, `pnpm sim:golden` (11), and `pnpm bench:sim`
all exit 0. Full browser runs are sequential with one worker: preview **13 pass /
12 skip**, dev **25 pass / 0 skip**. Preview skips are legacy isolated modules
requiring dev transport; all eight real-app acceptance checks pass in both.
After the test-only portable-import correction, web build/typecheck, lint, and
all three affected dev checks pass again. Full command outputs and raw metrics
are indexed in [task15-evidence/README.md](task15-evidence/README.md).

## Remaining owner/later-project work

- Owner: real integrated-GPU laptop 60fps and readability playtest/sign-off; not
  available on this software-GL machine and not claimed complete.
- SP04 supplies actual bot behavior; SP05 supplies twenty tuned production arenas,
  selected CC0 final art/audio and credits. The harness proves the integration
  contracts without claiming those later deliverables are complete.
