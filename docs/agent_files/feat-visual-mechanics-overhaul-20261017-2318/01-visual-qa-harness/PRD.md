---
status: approved
summary: Deterministic Playwright capture + side-by-side compose + projection/pixel metrics + scored CHECKLIST so every visual task can iterate autonomously against the Tower War references
date: 2026-10-17
---
# PRD: Visual QA Harness (SP01)

Repo/branch: node-arena · feat/visual-mechanics-overhaul · Depends on: none (phase 1)
Owns: `apps/web/visual/**` (scripts, `scenes.json`, `ref-map.json`, `thresholds.json`), `visual:*` scripts in `apps/web/package.json`, `visualProbe()` + a `visual-clash` fixture in `apps/web/src/test-harness/**`, tag-only edits (`userData.visualRole`, no look change) in `apps/web/src/render/{towers,lines,troops,scene}.ts`, `<BF>/01-visual-qa-harness/CHECKLIST.md` (+ `iteration-log.md` iter 0), `apps/web/.gitignore`/root `.gitignore` entry for `visual-out/`. Does not own: any look change, sim/bots, existing e2e specs/snapshots.

## TL;DR
- `visual:capture` renders 6 fixed scenes x 2 viewports, paused at fixed ticks, fixed seed, frozen clock, and writes PNGs + `metrics.json` to `apps/web/visual-out/` (git-ignored).
- Metrics come from scene state + camera projection (a harness `visualProbe()`), with pixel-share metrics only where projection can't answer. Every metric has a threshold in `thresholds.json`, mirrored in CHECKLIST.md.
- `visual:compose` screenshots an HTML grid (current | mapped refs | detail crops) with Playwright; no image libs.
- CHECKLIST.md = 24 scored items with 4/6/8/10 anchors tied to named reference images (full list in Appendix A, written verbatim by the implementation).
- Iteration 0 = capture the current v1 look and score it; most items must fail. That is the baseline.

## Problem
Later SPs (03-05) iterate on look autonomously, but there is no repeatable way to see the game the same way twice, compare it to the refs, or tell "better" from "different". Existing tooling is ad hoc: `slice.spec.ts` (owner-run, 1920x1080, SLICE=1) screenshots L1/L10/L18 with real-time waits (non-deterministic), and `acceptance.spec.ts` snapshots use 640x360-960x600 fixtures. [verified: slice.spec.ts waits `RUN_MS` real time; acceptance.spec.ts viewport 640x360]

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Same commit + same machine => byte-identical PNGs (near-identical fallback, see AC) | Cross-machine pixel equality (visual-out is not committed) |
| Metrics robust to GPU/AA noise (projection first) | Perceptual-diff/ML scoring; the agent views composites and scores by rubric |
| Headless and headed runs; optional real-GPU mode | Making fps pass on SwiftShader |
| Zero impact on existing e2e/ci | Updating e2e baselines (SP05), changing any visuals |

## Requirements
1. **Scripts** (`apps/web/package.json`): `visual:capture [--scene id] [--viewport 1920x1080|1366x768|1920x1200] [--headed] [--gpu] [--dev] [--no-build]`, `visual:compose [--scene id]`, `visual:check [--strict]` (metrics.json vs thresholds.json, prints table, exit 1 only with `--strict`), `visual:selfcheck` (capture x2 + diff). Plain `.mjs` ESM using `playwright`'s `chromium` API from the existing `@playwright/test` dep; no new dependencies.
2. **Scenes** (`visual/scenes.json`): `l01`, `l10`, `l18`, `clash`, `menu`, `picker`, plus `buildout` (L1, 3 frames: +2/+6/+12 ticks after a player DrawLine, for lane build-out) and `l10cb` (L10 with `colorblind:true`, for V09). `clash` also writes a second PNG at capture tick +6 and a per-tick `splitTrace` (lane `splitWorld`/`splitScreen`, ticks T..T+9) into `metrics.json` for SP04's continuity check. Viewports: 1920x1080 and 1366x768 for every scene; `l01`, `l10`, `l18` are additionally captured at **1920x1200 (16:10 aspect check, gates M07/M08 only)**. Later SPs may append scenes or adjust a scene's capture tick in `scenes.json` with a logged reason; they never edit `thresholds.json` downward. Each = level/screen + scripted commands + capture tick (L1 tick 240, L10 400, L18 600; clash = first `Clash` event tick + 20) + seed. Shipped content and shipped manifest (no fixture) except `clash`.
3. **Clash fixture** (`fixtureFiles(..., 'visual-clash')`): 4 towers — A(p1) and B(p2) hostile with A->B and B->A drawn; C(p1) and D(p2/neutral) with C->D crossing the A-B lane. Bots must emit no commands in the window (verify via event log; pick least-active existing profile otherwise).
4. **Determinism recipe** (details in Architecture).
5. **Probe** `window.__na.visualProbe()` (test hooks only, absent in prod build): see Architecture.
6. **Metrics** M01-M12 below, per scene x viewport, to `visual-out/metrics.json`.
7. **Compose**: per scene, `compare-<scene>.png` = labelled row: current (both viewports stacked, 1920 one primary) | mapped refs (scaled to equal height) | detail strip (crops of first owned tower, one lane midpoint, one troop cluster, clash point). `ref-map.json` maps scene -> refs + role; reference dir resolved by glob `docs/agent_files/*visual-mechanics-overhaul*/ref` (override `VISUAL_REF_DIR`).
8. **CHECKLIST.md** created from Appendix A; also a "probe contract" section so SP03/04/05 keep tags/fields alive.
9. **Isolation**: separate preview port 4174 (e2e uses 4173); lives outside `e2e/` (not matched by `testDir`); not added to `scripts/ci.sh`; `visual-out/` git-ignored. Existing snapshot baselines (`acceptance.spec.ts-snapshots/*`) are untouched here and are deliberately updated by SP05.

## Architecture
```
apps/web/visual/{capture.mjs, compose.mjs, check.mjs, selfcheck.mjs, lib/{browser,probe-metrics,pixels}.mjs,
                 scenes.json, ref-map.json, thresholds.json, compose.html.tpl}
apps/web/visual-out/{<scene>-<WxH>.png, metrics.json, compare-<scene>.png, run.json}   # ignored
```
**Determinism recipe** (each is a checkable step in capture.mjs):
- Chromium args as in playwright.config (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) + `--force-color-profile=srgb --font-render-hinting=none --disable-lcd-text --hide-scrollbars`; `--gpu` swaps SwiftShader for the default GL. `run.json` records `UNMASKED_RENDERER`, chromium version, commit, so `gpu:true/false` is known.
- `deviceScaleFactor: 1`, `reducedMotion: 'reduce'`, locale/timezone fixed, settings `{quality:'high', reducedMotion:true, colorblind:false}` pinned via `__na.settings` (per-scene overrides only for `l10cb` and the `buildout`/`clash`-strip frames).
- Time: `page.clock.install()` before load, then `fastForward`/`runFor` only; no real-time waits. Sim advanced only by `__na.step(n)` (driver idle; `?test=1` already disables autonomous stepping for fixed ticks [verified: acceptance.spec.ts steps via `__na.step`]). After the last step: `__na.render()` x2 (renderer time is advanced by a fixed dt per stepped tick, never the wall clock; `render({settle:true})` is the default and calls every renderer module's optional `settle()` so springs/pops/build-outs snap to their target, owned by SP03 towers and SP04 lanes/brawl; `buildout` and the `clash` +6/strip frames use `settle:false` and `reducedMotion:false` so animation is visible yet reproducible), `await document.fonts.ready`, 2 rAF, mouse parked off-canvas, `screenshot({animations:'disabled', caret:'hide'})`.
- Seed: `load(id)` must use a fixed seed; if `startLevel` lacks a seed arg, add an optional `seed` to the harness `load` (default unchanged).
- Bot drift: bots are deterministic per seed, but SP02 retune changes L1/L10/L18 states. Scene scripts therefore issue explicit player lines at tick 0 and metrics are structural (not tied to bot choices). Cross-SP02 composites are not comparable pixel-wise; note commit in `run.json`.
- Fonts: system font stack differs per machine; same-machine only. `run.json` stores a hash of resolved font families for the HUD/menu.

**Probe** (`visualProbe()` returns plain JSON, camera projection per `project()` in test-harness; all rects in CSS px of the canvas viewport):
```ts
{ viewport:{w,h}, clearColor:'#hex', ground:{cornerRayHits:boolean[9]},
  towers:[{id,owner,count,cap,floors,model:Rect,countRect:Rect|null,countOnRoof:boolean,slotDots:number,hasCard:boolean,paintHue:number,visualWidthWorld:number|null}],
  lanes:[{from,to,pair:string /* 'lowId-highId' */,widthWorld:number,screenWidthPx:number,splitWorld:number|null,splitScreen:{x,y}|null,mid:{x,y}}],
  troops:{count,screenHeightPx:number|null,sampleRects:Rect[]}, clash:{fxScreen:{x,y}|null,eventScreen:{x,y}|null} }
```
Built from the `inspect()` handles already in test-harness (`towers`, `lines`, `fx`, `camera`) plus `userData.visualRole` tags (`tower|count|lane|troop|ground`; `ground` also covers border/props/rocks) that this SP adds to the v1 renderer non-visually. SP03/SP04 keep or re-emit every tag on their replacement meshes (`count` = the roof decal mesh, `lane` also carries `userData.pair`) and populate `floors`, `cap`, `countOnRoof`, `slotDots`, `visualWidthWorld`, `splitWorld`, `splitScreen`, `widthWorld`. v1 gaps (no `floors`, `splitScreen`, ribbon width) return `null`; **null never passes a metric** — this makes SP03/04 regressions loud.

**Pixel metrics** run in a second blank page: PNG -> `<img>` -> canvas -> `getImageData`; no native libs. Same helper does the selfcheck diff.

## Metrics (all in `thresholds.json`; px thresholds given at 1920x1080 and scaled by viewport height for 1366x768)
| ID | Metric | Source | Threshold | Ref calibration |
|---|---|---|---|---|
| M01 | tower screen width, % viewport width (median owned tower) | projected model bbox | l01/l10 >=6.0% at 1920x1080, >=5.5% at 1366x768, <=12%; l18 3.0-8% | towerwar_01: 70/554=12.6% portrait, ~5.8% of height; landscape ref yt1: ~7% of height |
| M02 | count height / tower width (roof number rect) | probe | 0.30-0.55; card/label area / tower area <=1.0 | towerwar_01/03: digit ~35-45% of width; v1: card ~3x tower |
| M03 | count on roof: `countOnRoof` all towers, `hasCard` none | probe | 100% / 0 | towerwar_06 |
| M04 | floors == clamp(ceil(5*count/cap), 1, 5) for all towers | probe vs sim | 100% | SP03 decision 3 (cap-relative bands) |
| M05 | lane screen width / tower width (mid-lane) | probe | 0.25-0.40 | towerwar_01, citytakeover_01 (~1/4-1/3) |
| M06 | troop on-screen height, % viewport height; /tower width | probe | >=1.5% and 0.22-0.60 | towerwar_01 ~1.7%, ratio ~0.29 |
| M07 | void pixel share | pixels, from an extra pass of the same frame with the harness clear colour forced to magenta `#FF00FF` (so sand-coloured clear colour is not miscounted); share of magenta +-6/channel | <=0.5% (all views incl. 1920x1200) | no void in any ref |
| M08 | 9 viewport sample rays hit ground/border | probe | 9/9 | refs fill frame |
| M09 | grass share in central 60% | pixels (hue 70-150, s>.35) | >=30% (l01/l10) | towerwar_01, yt1 |
| M10 | sand/rock border share (warm hue 20-50, l>.55, s .3-.8) | pixels, outer 20% L/R | >=6% | towerwar_01, yt1 |
| M11 | tower paint: share of tower-rect non-bg pixels within +-25 deg of team hue (owned) / s<.12 (neutral) | pixels in projected rect | >=45% | towerwar_01 |
| M12 | head-on: exactly 1 lane object for the A-B pair; crossing lane separate; split-vs-Clash-event screen error | probe (`clash` scene) | 1 / 1 / <=12 px | brief decision |
| M13 | perf (l18, 5 s real time, fresh page, no clock): fps, p95 frame ms, drawCalls, jsMs p95 | `__na.sample()` + `renderer.info` | `gpu:true`: fps>=55; always: drawCalls<=100, jsMs p95<=8; fps on SwiftShader = `informational` | AGENTS perf goal |

## Iteration protocol
SP01's own loop is **tooling-correctness**, then the baseline:
1. Build capture; run `visual:capture` twice; `visual:selfcheck` must report identical SHA-256 of every PNG (fallback: <=0.01% differing pixels, each channel delta <=2, and metrics.json identical after dropping `perf`). Any diff => find the nondeterminism source (log it), fix, repeat. Stuck rule: 3 iterations with no change in diff count -> write hypotheses (clock, font, MSAA, shader time uniform, DOM transition) to `iteration-log.md`, switch approach (e.g. pin `quality:'low'` no-AA for capture). Cap 12.
2. Build compose; view every `compare-*.png` yourself: labels legible, refs not distorted, crops land on the right objects. Fix and re-run.
3. **Iteration 0 baseline** on unmodified v1 visuals: capture all scenes, compose, score every Appendix A item 0-10 against its anchors, evaluate all metrics, append row 0 to `<BF>/01-visual-qa-harness/iteration-log.md` (scores, metrics, top 3 gaps). Expected: most items <=3, M01/M02/M03/M05/M06/M07/M12 fail (v1: cards ~3x tower, grey plane in void, 2 lanes for head-on). If an item or metric *passes* at baseline, tighten its anchor or threshold (never loosen) so it discriminates.
4. Calibration check: score `towerwar_01.jpg` as if it were a capture for items V01-V13 (view-only); it must self-score >=8 on all. If not, the rubric is wrong; fix the rubric.
5. Exit: selfcheck green, all composites viewed, baseline logged, `pnpm --filter @node-arena/web test`, `typecheck`, `lint` and `test:e2e` unchanged-green. Commit: `01-visual-qa-harness: Task N — <change>`.
Rules for later SPs (copy into CHECKLIST.md header): never edit refs, never lower thresholds, update screenshot baselines only in SP05. A snapshot-based e2e test broken by a look change is marked `test.fixme(true, 'SP05 baseline refresh: <reason>')` (never removed, snapshot files untouched) by the SP that breaks it; SP05 greps that string and restores each one.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Runner | Plain `.mjs` scripts on `chromium` API, own port 4174 | New Playwright project/spec; Puppeteer | No dep, can't affect `test:e2e`, headed flag trivial |
| 2 | Time control | `page.clock` + manual `__na.step` | Real-time waits; patching renderer clocks | Deterministic, no renderer edits |
| 3 | Metric source | Projection via `visualProbe()` first; pixels only for void/grass/border/paint | Pixel-only | GPU/AA noise; tells *which* object is wrong |
| 4 | Compose | Playwright screenshots an HTML grid | sharp/pngjs/ImageMagick | Dependency-light; none installed [verified: no sharp/pngjs in node_modules] |
| 5 | Thresholds | `thresholds.json` machine-readable, mirrored in CHECKLIST.md; null fails | Prose only | `visual:check` automates the gate; no silent loosening |
| 6 | Scenes use shipped content; clash uses fixture | as Req 2/3 | Fixture for all | Tests real levels/manifest |
| 7 | Viewports | 1920x1080 primary + 1366x768 | single | Laptop target; px thresholds scale by height |
| 8 | fps | Informational on SwiftShader; gated only with `--gpu`; portable proxies always gated | Gate fps always | SwiftShader fps is meaningless |
| 9 | Baseline | Iteration 0 on v1, expected failing | Skip | Proves harness discriminates |

## Risks / Open Questions
- [RESOLVED: probe tags + null-fails contract] later SPs replacing meshes could break the probe silently; CHECKLIST.md lists the contract and SP03/04 ACs require non-null probe fields.
- [RESOLVED: same-machine only] fonts/GPU differ across machines.
- [RESOLVED: scripted explicit lines] bot retune drifts scene states.
- [DEFERRED] automatic perceptual score (SSIM vs refs): refs are portrait phone shots, layout differs; rubric scoring by viewing is the gate.
- [RESOLVED: no user decision required]

## Acceptance Criteria
- `pnpm --filter @node-arena/web visual:capture` produces 8 scenes x 2 viewports (+ 1920x1200 for l01/l10/l18) + `metrics.json` + `run.json` headless; `--headed` and `--scene l01` work.
- `visual:selfcheck` passes (identical hashes) on two consecutive runs.
- `visual:compose` writes `compare-<scene>.png` for all scenes showing labelled current | refs | crops.
- `visual:check` prints each M01-M13 with pass/fail/informational; with v1 code, M01,M02,M03,M05,M06,M07,M12 fail and null probe fields count as fail.
- `visual-out/` is git-ignored; `pnpm test`, `lint`, `typecheck`, `test:e2e` unchanged; no e2e file or snapshot modified.
- CHECKLIST.md contains every Appendix A item and Appendix B metric table; `iteration-log.md` has iteration-0 scores for every item and scene.
- Calibration (step 4) recorded.

## Appendix A: Visual Checklist (CHECKLIST.md content)
Scale: 0-2 absent/wrong; **4** = element exists but reads clearly as the old/placeholder look; **6** = right idea, visibly off in proportion/colour/detail; **8** = would pass as a sibling of the ref at a glance, minor polish gaps; **10** = indistinguishable in style/proportion from the anchor. Exit needs >=8 on task-relevant items. Owner = SP that must reach 8.

| ID | Item | Scene | Anchor refs | 4 | 6 | 8 | 10 | Owner |
|---|---|---|---|---|---|---|---|---|
| V01 | Camera: ~65 deg steep, landscape, level centred, fits | l01,l10,l18 | yt1, towerwar_01 | v1 shallow ~40 deg, board skew | steep but crops/too much margin | steep, framed, margin <=8% | like yt1 framing | 03 |
| V02 | Ground: bright grass, soft shadow blobs, no void/edge | l01 | towerwar_01, yt1 | grey plane in blue void | green plane, flat, edge visible | full-bleed grass, shadows, no edge | + subtle tonal variation as 01 | 03 |
| V03 | Border dressing: sand/rock + trees/crates/tires on sides | l01,l10 | towerwar_01, yt1 | few props floating | sand ring, sparse props | dense, varied, cropped by frame | matches 01 density and colour | 03 |
| V04 | Palette/lighting: saturated toy palette, soft light | all | towerwar_01, yt1 | muted greys | right hues, harsh/dull | cohesive, bright | matches 01 | 03 |
| V05 | Tower paint: whole tower team colour, grey neutral, chunky octagon | l01,l10 | towerwar_01/03 | grey tower, coloured base disc | coloured but thin/boxy | chunky, colour dominant, distinct neutral | = 01 blue/red tower | 03 |
| V06 | Floors by count band (max 5), proportions | l01,l10,l18 | towerwar_03, yt1 | single stack, no banding | floors but wrong count | floors correct, readable steps | = 03 "Max" stack | 03 |
| V07 | Roof count: white outlined number on roof, 35-45% tower width tall | all | towerwar_01, citytakeover_01 | dark card above, 3x tower | on roof, thin/small | bold outlined, correct size | = yt1 "38" | 03 |
| V08 | Slot dots (1-3) + "Max" at cap | l10,l18 | towerwar_03, yt1 | glyph rows in card | dots present, wrong state | filled/empty correct, legible | = 03 | 03 |
| V09 | Colourblind glyph on roof, default clean | l10cb | brief | glyph in card | glyph on every tower | only in cb mode, readable | clean, distinct per team | 03 |
| V10 | Lane ribbon: flat, translucent tint, darker edges, ~1/3 tower width | l01,l10 | towerwar_01/06, citytakeover_01 | thin dashes | wide, opaque or hard | translucent, right width | = 06 ribbons | 04 |
| V11 | Chevrons show direction, evenly repeated | l01 | citytakeover_01, yt1 | none | present, wrong size/spacing | clear, consistent | = 01 | 04 |
| V12 | Lane build-out animates from source | buildout | brief | pops in whole | grows but jitters | smooth from source | smooth + ends under tower | 04 |
| V13 | Troops: chunky chibi, team tint, single file, >=1.5% screen height | l01,l10 | towerwar_01/06, citytakeover_01 | specks | visible, boxy/untinted | readable character, tinted, queue | = 06 | 04 |
| V14 | Head-on: ONE shared lane, colour split at meeting point | clash | towerwar_06, brief | two overlapping dashed lines | one lane, no split | split at live point | split tracks fight smoothly | 04 |
| V15 | Brawl FX at clash: puffs + small marker | clash | towerwar_06 (red/blue splats), yt1 | none | static blob | animated puffs on point | = 06 confetti | 04 |
| V16 | Crossing lanes overlap, no merge/artifact | clash,l18 | towerwar_06, citytakeover_01 | z-fight/glitch | overlap ok, colour mix odd | clean layering | = 01 | 04 |
| V17 | Cut feedback on ribbon | l10 | brief | none | flash only | ribbon snaps/fades | polished | 04 |
| V18 | HUD: top-centre level pill + strength bar, round pause/1x/2x buttons | l01 | yt1, towerwar_09, citytakeover_01 | dark panel | pill, wrong bar/placement | pill + live share bar, round buttons | = yt1 | 05 |
| V19 | Help text only as first-level tip; no persistent help bar | l01,l10 | towerwar_09 | persistent bar | shown always in L1 | tip L1 only | dismisses cleanly | 05 |
| V20 | Menu restyled to palette | menu | towerwar_05, citytakeover_05 | old dark | partial | consistent | cohesive | 05 |
| V21 | Level picker restyled | picker | citytakeover_06 | old dark | partial | consistent, 20 readable | cohesive | 05 |
| V22 | No v1 leftovers (label cards, road slab, grey plane, offset dashes) | all | v1_playtest_1/2 | 3+ present | 1-2 | none | none + no regressions in L18 | 03/04 |
| V23 | Gestalt: "looks like Tower War" at thumbnail size | l01,l10,l18 | towerwar_01/06 | no | same genre | would be mistaken at 25% size | indistinguishable style | 05 |
| V24 | Density/readability at L18 (many towers/troops) | l18 | towerwar_03, yt1 | clutter, unreadable | readable, dense | clear hierarchy | = 03 | 05 |

Appendix B (copy of Metrics table above, with thresholds) goes in CHECKLIST.md next to this; `thresholds.json` is the source of truth and `visual:check` fails if the two disagree.

## Scene -> reference mapping (`ref-map.json`)
| Scene | Refs |
|---|---|
| l01 | towerwar_01, towerwar_yt1, towerwar_09 |
| l10 | towerwar_06, citytakeover_01 |
| l10cb | towerwar_06 |
| l18 | towerwar_03, towerwar_yt1 |
| clash | towerwar_06, citytakeover_01 |
| buildout | towerwar_01, towerwar_yt1 |
| menu | towerwar_05, citytakeover_05 |
| picker | citytakeover_06 |
