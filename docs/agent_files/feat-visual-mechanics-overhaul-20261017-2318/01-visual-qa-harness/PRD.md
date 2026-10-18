---
status: approved
summary: Deterministic Playwright capture + side-by-side compose + projection/pixel metrics (HSV, calibrated on the refs) + scored CHECKLIST with blind second scorer, so every visual task can iterate autonomously against the Tower War references (goal: look the same)
date: 2026-10-17
---
# PRD: Visual QA Harness (SP01)

Repo/branch: node-arena · feat/visual-mechanics-overhaul · Depends on: none (phase 1)
Owns: `apps/web/visual/**` (scripts incl. `score-sheet`/`score-merge`/`calibrate`/determinism lint, `scenes.json`, `ref-map.json`, `ref-calib.json`, `thresholds.json`), `visual:*` scripts in `apps/web/package.json`, `visualProbe()` + a `visual-clash` fixture in `apps/web/src/test-harness/**`, tag-only edits (`userData.visualRole`, no look change) in `apps/web/src/render/{towers,lines,troops,scene}.ts`, `<BF>/01-visual-qa-harness/CHECKLIST.md` (+ `iteration-log.md` iter 0), `apps/web/.gitignore`/root `.gitignore` entry for `visual-out/`. Does not own: any look change, sim/bots, existing e2e specs/snapshots.

## TL;DR
- `visual:capture` renders 9 fixed scenes (l01, l10, l18, clash, menu, picker, buildout, cut, l10cb) x 2 viewports, paused at fixed ticks, fixed seed, frozen clock, and writes PNGs + `metrics.json` to `apps/web/visual-out/` (git-ignored).
- Metrics M01-M20 come from scene state + camera projection (a harness `visualProbe()`) and from pixels (HSV classes calibrated on the ref images, see Colour spec). Pixel metrics never trust renderer self-reports. Every metric has a threshold in `thresholds.json`, mirrored in CHECKLIST.md.
- Scoring is two-person: the iterating agent scores with >=3 logged observable differences per item >=8 and an objective pixel check; a separate blind scorer sub-agent scores from the composite + a blank score sheet only; the item score is the min of the two (Scoring protocol).
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
1. **Scripts** (`apps/web/package.json`): `visual:capture [--scene id] [--viewport 1920x1080|1366x768|1920x1200] [--headed] [--gpu] [--dev] [--no-build]`, `visual:compose [--scene id]`, `visual:check [--strict]` (metrics.json vs thresholds.json, prints table, exit 1 only with `--strict`), `visual:selfcheck` (capture x2 + diff + determinism lint), `visual:calibrate` (runs the pixel metrics on the ref images per `ref-calib.json`), `visual:score-sheet [--scene id]` (blank blind score sheet), `visual:score-merge a.json b.json` (min-merge two score files). Plain `.mjs` ESM using `playwright`'s `chromium` API from the existing `@playwright/test` dep; no new dependencies.
2. **Scenes** (`visual/scenes.json`): `l01`, `l10`, `l18`, `clash`, `menu`, `picker`, plus `buildout` (L1, 3 frames: +2/+6/+12 ticks after a player DrawLine, for lane build-out), `cut` (L1: scripted DrawLine at tick 0, run to tick 120 settled, then a scripted `CutLine` on that lane at fixed tick 120; frames at +1/+3/+6 ticks = 50/150/300 ms at 20 Hz so the 80 ms flash and 0.3 s retract are visible; `settle:false`, `reducedMotion:false`; bots must emit no commands through +6, verified from the event log, else fall back to the `visual-clash` fixture; for V17 and SP04 cut feedback) and `l10cb` (L10 with `colorblind:true`, for V09). `clash` also writes a second PNG at capture tick +6 and a per-tick `splitTrace` (lane `splitWorld`/`splitScreen`, most recent Clash tick and `eventScreen`, ticks T..T+9) into `metrics.json` for SP04's continuity check and the M12 unsettled-frame tolerance. Viewports: 1920x1080 and 1366x768 for every scene; `l01`, `l10`, `l18` are additionally captured at **1920x1200 (16:10 aspect check, gates M07/M08 only)**. Later SPs may append scenes or adjust a scene's capture tick in `scenes.json` with a logged reason; they never edit `thresholds.json` downward. Each = level/screen + scripted commands + capture tick (L1 tick 240, L10 400, L18 600; clash = first `Clash` event tick + 20) + seed. Shipped content and shipped manifest (no fixture) except `clash`.
3. **Clash fixture** (`fixtureFiles(..., 'visual-clash')`): 4 towers — A(p1) and B(p2) hostile with A->B and B->A drawn; C(p1) and D(p2/neutral) with C->D crossing the A-B lane. Bots must emit no commands in the window (verify via event log; pick least-active existing profile otherwise).
4. **Determinism recipe** (details in Architecture).
5. **Probe** `window.__na.visualProbe()` (test hooks only, absent in prod build): see Architecture.
6. **Metrics** M01-M20 below, per scene x viewport, to `visual-out/metrics.json`.
7. **Compose**: per scene, `compare-<scene>.png` = labelled row: current (both viewports stacked, 1920 one primary) | mapped refs (scaled to equal height) | detail strip (crops of first owned tower, one lane midpoint, one troop cluster, clash point). `ref-map.json` maps scene -> refs + role (+ optional `items` list of V-ids, used by `visual:score-sheet` for scenes that an owner SP appends later, e.g. SP05's `l01-tip`, `pause`, `results`); reference dir resolved by glob `docs/agent_files/*visual-mechanics-overhaul*/ref` (override `VISUAL_REF_DIR`).
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
- Time: `page.clock.install()` before load, then `fastForward`/`runFor` only; no real-time waits. Sim advanced only by `__na.step(n)` (driver idle; `?test=1` already disables autonomous stepping for fixed ticks [verified: acceptance.spec.ts steps via `__na.step`]). After the last step: `__na.render()` x2 (world time in `apps/web/src/app/runtime.ts:86` is already `(tick+alpha)/TICK_RATE`, so tick-driven motion is reproducible with no renderer edit; only renderer-local state timers (springs, pops, build-outs) need a fixed dt per stepped tick instead of the wall clock; `render({settle:true})` is the default and calls every renderer module's optional `settle()` so those timers snap to their target, owned by SP03 towers and SP04 lanes/brawl; `buildout`, `cut` and the `clash` +6/strip frames use `settle:false` and `reducedMotion:false` so animation is visible yet reproducible), then `await page.clock.runFor(32)` (two 16 ms frames; under `page.clock.install()` rAF callbacks and the `document.fonts.ready` continuation never fire until the clock is advanced, so this call is mandatory), `await document.fonts.ready`, `await page.clock.runFor(32)` again, mouse parked off-canvas, `screenshot({animations:'disabled', caret:'hide'})`.
- Render randomness (N6): `Math.random` is banned in `apps/web/src/render/**` and `apps/web/src/fx/**` (any render jitter, e.g. brawl puffs, is seeded from `(pairKey, tick)` via a mulberry32 helper). `visual/lib/lint-determinism.mjs` greps for `Math.random|crypto.getRandomValues|Date.now|performance.now` in those dirs (allow-list: test-harness, perf sampling) and `visual:selfcheck` fails on any hit [verified: no `Math.random` in `apps/web/src` today].
- Seed: `load(id)` must use a fixed seed; if `startLevel` lacks a seed arg, add an optional `seed` to the harness `load` (default unchanged).
- Bot drift: bots are deterministic per seed, but SP02 retune changes L1/L10/L18 states. Scene scripts therefore issue explicit player lines at tick 0 and metrics are structural (not tied to bot choices). Cross-SP02 composites are not comparable pixel-wise; note commit in `run.json`.
- Fonts: system font stack differs per machine; same-machine only. `run.json` stores a hash of resolved font families for the HUD/menu.

**Probe** (`visualProbe()` returns plain JSON, camera projection per `project()` in test-harness; all rects in CSS px of the canvas viewport):
```ts
{ viewport:{w,h}, clearColor:'#hex', ground:{cornerRayHits:boolean[9],playQuadScreen:{x,y}[4]|null /* projected grass patch (level bounds + pad), locator for M09/M10 */},
  towers:[{id,owner,count,cap,floors,model:Rect,countRect:Rect|null,countOnRoof:boolean,slotDots:number,hasCard:boolean,paintHue:number,visualWidthWorld:number|null}],
  lanes:[{from,to,pair:string /* 'lowId-highId' */,widthWorld:number,screenWidthPx:number,splitWorld:number|null,splitScreen:{x,y}|null,mid:{x,y}}],
  troops:{count,screenHeightPx:number|null,sampleRects:Rect[]}, clash:{fxScreen:{x,y}|null,eventScreen:{x,y}|null /* projected progA/L point of the pair's most recent Clash */,eventTick:number|null,eventPair:string|null} }
```
Built from the `inspect()` handles already in test-harness (`towers`, `lines`, `fx`, `camera`) plus `userData.visualRole` tags (`tower|count|lane|troop|ground`; `ground` also covers border/props/rocks) that this SP adds to the v1 renderer non-visually. SP03/SP04 keep or re-emit every tag on their replacement meshes (tags may sit on an `InstancedMesh` with `userData.towerIds[]`/`pair` lists; the probe then derives each tower's `model` Rect from the root transform + `visualWidthWorld` + stack height rather than mesh traversal) (`count` = the roof decal mesh, `lane` also carries `userData.pair`) and populate `floors`, `cap`, `countOnRoof`, `slotDots`, `visualWidthWorld`, `splitWorld`, `splitScreen`, `widthWorld`. v1 gaps (no `floors`, `splitScreen`, ribbon width) return `null`; **null never passes a metric** — this makes SP03/04 regressions loud.

**Pixel metrics** run in a second blank page: PNG -> `<img>` -> canvas -> `getImageData`; no native libs. Same helper does the selfcheck diff and `visual:calibrate` (decodes the ref JPEGs the same way). Probe rects are only *locators* (where to look); pass/fail of M09-M11, M16, M18-M20 comes from pixels, never from renderer-reported flags.

**Colour spec (B2).** All pixel metrics use **HSV** from 8-bit sRGB: H degrees 0-360, S and V 0-1 (standard `rgb->hsv`, same as Python `colorsys`), in `visual/lib/color.mjs`. Ranges below were measured from the actual refs (PIL, medians over hand-picked crops of towerwar_01.jpg and the central 324 px of towerwar_yt1.jpg) and are the only definitions; HSL is not used.
| Class | HSV rule | Ref evidence (median) |
|---|---|---|
| grass | H 55-105, S>=.40, V>=.40 (includes yellow-green and shaded grass) | tw01 H75 S.90-.97 V.78-.85; yt1 H73-74 S.75 V.80-.86 |
| sand | H 25-48, S .20-.60, V>=.85 | tw01 H33-35 S.45 V1.0 (PRD `#FFE1B3` = H36 S.30 V1.0) |
| rock | (H<=22 or H>=350), S .30-.80, V .40-.90 | tw01 H14 S.68 V.75 (PRD `#BC5439` = H12 S.69 V.74) |
| white body | S<=.20, V>=.60 | tower floors |
| grey | S<=.20, .35<=V<.90 | neutral roof V.55, floors V.74 |
| team-sat | S>=.45, V>=.40, within +-25 deg of team hue (blue 212, red 357, yellow 44, green 130) | tw01 blue roof H205, red H357, yellow H44 |
| ground mask | grass or sand or rock or tree-green (H 105-150, S>=.35) | excluded when measuring towers |
The v1 sand-HSL rule (`s .3-.8, l>.55, hue 20-50`) and `hue 70-150` grass rule are retired (they failed the PRD's own sand `#FFE1B3` and the sampled grass hue 73-76). Magenta void (M07) is unchanged: `#FF00FF` +-6/channel.

## Metrics (all in `thresholds.json`; px thresholds given at 1920x1080 and scaled by viewport height for 1366x768)
Status column: `cal` = threshold measured on the refs (this PRD), `prov` = provisional; `visual:calibrate` / T8 confirm or fix `prov` before SP03 starts, and a `prov` metric may only be tightened afterwards.
| ID | Metric | Source | Threshold | Ref calibration | St |
|---|---|---|---|---|---|
| M01 | tower screen width, % viewport width (median owned tower) | projected model bbox | l01/l10 >=6.0% at 1920x1080, >=5.5% at 1366x768, <=12%; l18 3.0-8% | towerwar_01: 70/554=12.6% portrait, ~5.8% of height; landscape ref yt1: ~7% of height | prov |
| M02 | count digit height / tower bbox width (roof number) | pixels in `countRect` locator (white-fill component height); card area / tower area <=1.0 | 0.14-0.30 | measured: tw01 red5 11.7px/75=0.16, grey25 11px/~70=0.16; yt1 38/44 zoom 0.19-0.22 (roof width). The earlier 0.30-0.55 was wrong | cal |
| M03 | count on roof: every tower has the roof-decal mesh inside its model rect AND `hasCard` none AND M17=0 | probe + M19 | 100% / 0 | towerwar_06 | cal |
| M04 | floors == clamp(ceil(5*count/cap), 1, 5) for all towers | probe vs sim | 100% | TW cap 63: 5 -> 1 floor, 25 -> 2, 38/44 -> 4, Max -> 5 [verified visually] | cal |
| M05 | lane screen width / tower width (mid-lane) | probe | 0.25-0.40 | towerwar_01, citytakeover_01 (~1/4-1/3) | prov |
| M06 | troop on-screen height, % viewport height; /tower width | probe | >=1.5% and 0.22-0.60 | towerwar_01 ~1.7%, ratio ~0.29 | prov |
| M07 | void pixel share | pixels, from an extra pass of the same frame with the harness clear colour forced to magenta `#FF00FF` (so sand-coloured clear colour is not miscounted); share of magenta +-6/channel | <=0.5% (all views incl. 1920x1200) | no void in any ref | cal |
| M08 | 9 viewport sample rays hit ground/border | probe | 9/9 | refs fill frame | cal |
| M09 | grass share **inside the play quad** (`ground.playQuadScreen`, any aspect) | pixels, class `grass` | 0.55-0.85 (l01/l10) | tw01 play band y190-870: 0.68; yt1 play band: 0.70 | cal |
| M10 | border: of pixels **outside** the play quad, share that is sand or rock; plus border area | pixels, classes `sand`+`rock` | sand+rock >=0.60 of border pixels, grass <=0.05 of border, border area >=10% of frame | tw01 border (above/below the play band, 34% of frame): sand .49 + rock .17 = 0.66, grass .01; yt1 (44% of frame): sand .39 + rock .38 = 0.77, grass 0.00. Region = whatever lies outside the quad (top/bottom in portrait refs, any side in landscape), not fixed L/R 20% | cal |
| M11 | tower paint (owned towers; tower rect = probe model bbox, ground-masked): (a) team-sat share of saturated fg pixels (S>=.45,V>=.40) >=0.85; (b) team-sat pixels / fg pixels (roof cap + trim bands) 0.35-0.72 and **never >=0.80** (whole-tower paint = City Takeover look, fails); (c) white-body pixels / fg 0.15-0.45. Neutral towers: saturated pixels <=5% of fg and grey+white >=90% of fg | pixels, class table | as stated | tw01 red5/red4/blue5/yellow4: (a) .93/.88/.99/1.00, (b) .59/.54/.64/.67, (c) .26/.27/.25/.26; yt1 44/38/Max (4-5 floors): (a) .94/.94/.97, (b) .46/.43/.46, (c) .30/.25/.27; neutral tw01 grey25/grey5: sat .01/.00, grey+white 1.00 | cal |
| M12 | head-on (SP04 definition; "A" = lower-index tower, never the owner): (a) exactly 1 lane object for the A-B pair; (b) crossing C-D lane separate (exactly 1); (c) split error = `|splitScreen - project(point at progA_recent/L from the lower-index tower)|` against the **most recent** Clash event of that pair (latest tick), measured on a `settle()`d frame taken at or after that Clash tick with no newer Clash (the main `clash` frame); for unsettled frames k ticks later (+6 PNG, `splitTrace` ticks) tolerance = 12 px + projected front-closure distance over k ticks (<= 2 x troop speed x k / TICK_RATE) | probe (`clash` scene: `lanes[]`, `splitScreen`, `clash.eventScreen`/`eventTick`, `splitTrace`) | (a) 1 / (b) 1 / (c) <=12 px (settled) | combat.ts `clash()`: Clash event point = `progA/L`; brief decision | prov |
| M13 | perf (l18, 5 s real time, fresh page, no clock): fps, p95 frame ms, drawCalls, jsMs p95 | `__na.sample()` + `renderer.info` | `gpu:true`: fps>=55; always: drawCalls<=100, jsMs p95<=8; fps on SwiftShader = `informational` | AGENTS perf goal | prov |
| M14 | grass share of the whole frame | pixels, class `grass` | 0.30-0.60 | tw01 (y<1030, no promo banner) 0.45; yt1 0.39 | cal |
| M15 | towers in frame: min over all towers and edges of (model-rect edge distance / viewport dimension); and tightest-axis margin of the union bbox of all tower rects | probe rects | min margin >=0.02 and tightest-axis union margin <=0.10 | brief V01 (margin <=8% target) | prov |
| M16 | roof number glyph height in px (largest white-fill component with dark outline inside the roof-rect locator, tallest digit) | pixels | >=12 px at 1366x768 L1 (scaled by viewport height elsewhere); >=10 px at L18 | M02 0.16 x M01 75 px = 12 px; refs digit ~11.5 px at tw01 native size | prov |
| M17 | DOM label count: `document.querySelectorAll('[data-tower-index], .tower-label')` on game scenes; and `[data-tower-summary]` count | page DOM | 0 / exactly 1 (post SP03 T5) | PRD SP03 R8 | cal |
| M18 | palette distance (objective check for V02/V04/V05): total-variation distance between class-share vectors {grass, sand, rock, white, grey, team-sat, other} of the capture and of the best mapped ref, for (i) the whole frame and (ii) the crop of the first owned tower vs a ref tower crop (`ref-calib.json`) | pixels | (i) <=0.20, (ii) <=0.20 | tw01 vs yt1 frame TV = 0.125 (two refs of the same look pass) | cal |
| M19 | roof-decal pixel visibility, probe-independent (objective check for V07/V08): in the upper 45% of each tower crop, >=1 white-fill component (S<=.15,V>=.92) with a dark-outline ring (V<=.25 within 2 px) and height >= 0.10 x tower width; plus the count of circular bright/dim dot blobs below it equals the sim's slot count (`__na` sim view, not the probe) | pixels + sim view | 100% of towers; dots match 100% | tw01/yt1: every tower has outlined number + 1-3 dots (verified visually) | prov |
| M20 | floor stripes (objective check for V05/V06): along the vertical centre line of the tower rect, count runs of white-body pixels (>=2 px) between roof cap and plinth | pixels | runs within [floors-1, floors+1] and >=1 team-sat band run per white run | yt1 38: 3-4 white runs between blue bands | prov |

## Iteration protocol
SP01's own loop is **tooling-correctness**, then the baseline:
1. Build capture; run `visual:capture` twice; `visual:selfcheck` must report identical SHA-256 of every PNG (fallback: <=0.01% differing pixels, each channel delta <=2, and metrics.json identical after dropping `perf`). Any diff => find the nondeterminism source (log it), fix, repeat. Stuck rule: 3 iterations with no change in diff count -> write hypotheses (clock, font, MSAA, shader time uniform, DOM transition, banned-random hit) to `iteration-log.md`, switch approach (e.g. pin `quality:'low'` no-AA for capture). Cap 12.
2. Build compose; view every `compare-*.png` yourself: labels legible, refs not distorted, crops land on the right objects. Fix and re-run.
3. **Iteration 0 baseline** on unmodified v1 visuals: capture all scenes, compose, score every Appendix A item 0-10 against its anchors using the Scoring protocol (self + blind, min), evaluate all metrics, append row 0 to `<BF>/01-visual-qa-harness/iteration-log.md` (scores, metrics, top 3 gaps). Expected: most items <=3, M01/M02/M03/M05/M06/M07/M12 fail (v1: cards ~3x tower, grey plane in void, 2 lanes for head-on). If an item or metric *passes* at baseline, tighten its anchor or threshold (never loosen) so it discriminates.
4. **Calibration (objective first; the old self-score is only a sanity check).** (a) `visual:calibrate` runs M09, M10, M11, M14, M18 and the pixel parts of M02/M16/M19/M20 on `towerwar_01.jpg` (y<1030) and `towerwar_yt1.jpg` (central 324 px) per `ref-calib.json` (play bands tw01 y190-870, yt1 y180-580; tower boxes tw01 red5 (50,340,125,440), blue5 (415,715,505,800), yellow4 (405,225,480,325), grey25 (35,440,115,560); yt1 44 (700,395,755,480), 38 (525,385,580,470), Max (600,455,650,535)). Tower crops are rescaled so the tower bbox is 75 px wide (the M01 floor at 1366x768) before the size-dependent pixel metrics (M02, M16, M19, M20) run. **Every metric must pass on both refs**; any failure means the metric is wrong, fix the metric, never the ref. (b) A hand-built landscape mock (`visual/calib/mock-landscape.html`, 1920x1080: yt1 grass band widened to the centre, tw01 sand/rock strips at top and bottom, sand also at the sides) must pass M09/M10/M14, proving the region logic works with a landscape border. (c) Rubric self-score: `towerwar_01.jpg` as a capture for V01-V13 must score >=8 (tautological, kept as sanity). (d) **Discrimination controls** scored by the blind scorer: `v1_playtest_1.png` as capture must score <=4 on V01-V07 and V22; `citytakeover_01.jpg` as capture must score <=6 on V05 (whole-tower paint is the wrong look). If a control scores higher, the anchors are too loose; tighten them.
5. Exit: selfcheck green, all composites viewed, baseline logged, `pnpm --filter @node-arena/web test`, `typecheck`, `lint` and `test:e2e` unchanged-green. Commit: `01-visual-qa-harness: Task N — <change>`.
Rules for later SPs (copy into CHECKLIST.md header): never edit refs, never lower thresholds, update screenshot baselines only in SP05. Where Tower War and City Takeover differ, **Tower War wins**; the only exceptions are lane chevrons (V11, user chose to keep them) and the level picker (V21, Tower War has none). A snapshot-based e2e test broken by a look change is marked `test.fixme(true, 'SP05 baseline refresh: <reason>')` (never removed, snapshot files untouched) by the SP that breaks it; SP05 greps that string and restores each one.

## Scoring protocol (B3; shared by SP01-SP05, referenced from every visual task's Iteration block)
Self-scoring against "= ref" anchors cannot catch drift, so every scored iteration does all of:
1. **Difference log before any score >=8.** For each item the iterating agent wants to score >=8, write >=3 concrete observable differences vs the mapped ref in the iteration log (each = what, ref value, ours value; e.g. "roof cap height: ref 31% of tower height, ours 22%", "stripe count: ref 4 bands, ours 3", "grass hue: ref H75, ours H82", "tree density at rim: ref ~12/100 px, ours 5"). If it cannot find 3, it must say which crops it compared; fewer than 3 caps the item at 7.
2. **Objective pixel check per item where feasible.** Mapped metrics (CHECKLIST column "Pixel check"): V01 M15/M08, V02 M09/M14/M18, V03 M10, V04 M18, V05 M11/M18(ii)/M20, V06 M04/M20, V07 M16/M19/M02, V08 M19, V22 M17. An item cannot score >=8 while its mapped pixel metric fails; the pixel check outranks the eyeball.
3. **Blind second scorer.** After the iterating agent's own scoring, the orchestrator spawns a separate sub-agent (fresh context, model `sonnet`) and gives it ONLY: the composite PNG path(s) and the blank sheet from `pnpm --filter @node-arena/web visual:score-sheet --scene <id>` (items relevant to that scene with their 4/6/8/10 anchors, the ref list, and empty `score` / `differences` fields; no metrics, no previous scores, no iteration log, no code, no diff). The blind scorer writes `visual-out/score-blind-<iter>.json` (`{item:{score,differences[]}}`; items >=8 need >=3 differences) and may not read the repo. The iterating agent saves its own scores as `visual-out/score-self-<iter>.json`; `visual:score-merge self.json blind.json` writes the merged file: **item score = min(self, blind)**, flags any item where |self-blind| >= 3 for the log. Exit gates use merged scores. Spawn a fresh blind scorer every iteration (never reuse one that has seen earlier scores or code).
4. Log row additions: self scores, blind scores, merged, pixel-check results, difference log, top 3 gaps.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Runner | Plain `.mjs` scripts on `chromium` API, own port 4174 | New Playwright project/spec; Puppeteer | No dep, can't affect `test:e2e`, headed flag trivial |
| 2 | Time control | `page.clock` + manual `__na.step` + `clock.runFor(32)`; world time already `(tick+alpha)/TICK_RATE`; harness adds only fixed-dt for renderer-local state timers via `settle()`/`render({settle})` | Real-time waits; patching renderer clocks | Deterministic; no look-changing renderer edits (the harness hooks are the only renderer-side additions) |
| 3 | Metric source | Projection via `visualProbe()` first; pixels only for void/grass/border/paint | Pixel-only | GPU/AA noise; tells *which* object is wrong |
| 4 | Compose | Playwright screenshots an HTML grid | sharp/pngjs/ImageMagick | Dependency-light; none installed [verified: no sharp/pngjs in node_modules] |
| 5 | Thresholds | `thresholds.json` machine-readable, mirrored in CHECKLIST.md; null fails | Prose only | `visual:check` automates the gate; no silent loosening |
| 6 | Scenes use shipped content; clash uses fixture | as Req 2/3 | Fixture for all | Tests real levels/manifest |
| 7 | Viewports | 1920x1080 primary + 1366x768 | single | Laptop target; px thresholds scale by height |
| 8 | fps | Informational on SwiftShader; gated only with `--gpu`; portable proxies always gated | Gate fps always | SwiftShader fps is meaningless |
| 9 | Baseline | Iteration 0 on v1, expected failing | Skip | Proves harness discriminates |
| 10 | Scoring | min(self, blind second scorer) + >=3 logged differences + objective pixel check | Single self-score | Self-scoring is near-tautological and renderer self-reports are not independent |
| 11 | Colour space | HSV measured from refs (Colour spec) | HSL fixed ranges | HSL ranges failed the PRD's own palette |

## Risks / Open Questions
- [RESOLVED: probe tags + null-fails contract] later SPs replacing meshes could break the probe silently; CHECKLIST.md lists the contract and SP03/04 ACs require non-null probe fields.
- [RESOLVED: same-machine only] fonts/GPU differ across machines.
- [RESOLVED: scripted explicit lines] bot retune drifts scene states.
- [DEFERRED] automatic perceptual score (SSIM vs refs): refs are portrait phone shots, layout differs; class-share distance (M18) + rubric scoring by two scorers is the gate.
- [OPEN, resolved in T8] `prov` metric ranges (M01, M05, M06, M12, M13, M15, M16, M19, M20) get confirmed by `visual:calibrate` and the landscape mock before SP03 starts.
- [RESOLVED: no user decision required]

## Acceptance Criteria
- `pnpm --filter @node-arena/web visual:capture` produces 9 scenes x 2 viewports (+ 1920x1200 for l01/l10/l18) + `metrics.json` + `run.json` headless; `--headed` and `--scene l01` work.
- `visual:selfcheck` passes (identical hashes) on two consecutive runs.
- `visual:compose` writes `compare-<scene>.png` for all scenes showing labelled current | refs | crops.
- `visual:check` prints each M01-M20 with pass/fail/informational; with v1 code, M01,M02,M03,M05,M06,M07,M12 fail and null probe fields count as fail.
- `visual:selfcheck` also fails on any `Math.random`/`Date.now` hit in render code (determinism lint).
- `visual:calibrate` passes M09, M10, M11, M14, M18 (and pixel parts of M02/M16/M19/M20) on towerwar_01 and towerwar_yt1; the landscape mock passes M09/M10/M14; discrimination controls (v1_playtest_1 <=4 on V01-V07/V22; citytakeover_01 <=6 on V05) recorded.
- `visual:score-sheet` emits a blank sheet with no scores/metrics/code; `visual:score-merge` takes the per-item min.
- `visual-out/` is git-ignored; `pnpm test`, `lint`, `typecheck`, `test:e2e` unchanged; no e2e file or snapshot modified.
- CHECKLIST.md contains every Appendix A item (with the Pixel check column) and Appendix B metric table (M01-M20); `iteration-log.md` has iteration-0 scores for every item and scene.
- Calibration (step 4a-d) recorded.

## Appendix A: Visual Checklist (CHECKLIST.md content)
Scale: 0-2 absent/wrong; **4** = element exists but reads clearly as the old/placeholder look; **6** = right idea, visibly off in proportion/colour/detail; **8** = would pass as a sibling of the ref at a glance, minor polish gaps; **10** = indistinguishable in style/proportion from the anchor. Exit needs >=8 on task-relevant items, as the merged min(self, blind) score with the pixel check passing (Scoring protocol). Owner = SP that must reach 8. Tower War refs win over City Takeover refs, except V11 chevrons and V21 picker. Refs are portrait phone shots: anchors compare **proportions** (ratios, shares, counts, hues), never portrait layout.

**Tower look (V05/V06, measured from towerwar_01 red5/grey25, towerwar_03, towerwar_06 and the yt1 zooms of "38"/"44").** Bottom to top: (1) wide octagonal plinth in the team colour (neutral: dark grey) topped by a light-grey/white chamfer ring, with a light-grey door frame and dark door and small side buttresses; (2) one to five floors, each a **white/light-grey chamfered octagon body with one dark horizontal slit window**, each floor sitting on a **thin team-colour band** (chamfered ring) so the vertical rhythm is white body / team band / white body / team band; upper floors are slightly narrower than lower ones (stepped taper); (3) a **thick chamfered octagon roof cap in the saturated team colour**, overhanging the top floor, flat top, darker bevelled edge, carrying the number and dots. Neutral: roof mid-grey (V~.55), bands light grey, bodies light grey, no saturated pixels. The body is never team-painted; only roof cap, trim bands and plinth carry the team hue (blue ~205-212, red ~357, yellow ~44). Floors follow ceil(5*count/63) in the ref (5 -> 1, 25 -> 2, 38/44 -> 4, Max -> 5).

| ID | Item | Scene | Anchor refs | 4 | 6 | 8 | 10 | Pixel check | Owner |
|---|---|---|---|---|---|---|---|---|---|
| V01 | Camera: ~65 deg steep, landscape, level centred, fits. Anchored on **proportions**: tower width / frame height (tw01 ~5.8%, yt1 ~7%), border share of frame (tw01 34%, yt1 44%), lane width / tower width, margin | l01,l10,l18 | yt1, towerwar_01 | v1 shallow ~40 deg, board skew | steep but tower-width ratio >25% off the ref or margin >12% or no border band | steep, tower-width ratio within 25% of ref, border band 10-45% of frame, tightest-axis margin <=8%, all towers inside frame | ratios within 10% of yt1 | M15, M08, M10 border area | 03 |
| V02 | Ground: bright grass, soft shadow blobs, no void/edge | l01 | towerwar_01, yt1 | grey plane in blue void | green plane, flat, edge visible | full-bleed grass, shadows, no edge | + subtle tonal variation as 01 | M07, M09, M14, M18(i) | 03 |
| V03 | Border dressing: sand/rock + trees/crates/tyres on all outside-the-patch regions | l01,l10 | towerwar_01, yt1 | few props floating | sand ring, sparse props | dense, varied, cropped by frame | matches 01 density and colour | M10 | 03 |
| V04 | Palette/lighting: saturated toy palette, soft light | all | towerwar_01, yt1 | muted greys | right hues, harsh/dull | cohesive, bright | matches 01 | M18(i) | 03 |
| V05 | Tower look: white/light-grey floors with slit windows, team-colour thick roof cap + thin team band under every floor + team plinth; neutral all grey (see Tower look) | l01,l10 | towerwar_01 (red5, blue5, yellow4, grey25), towerwar_03, towerwar_06, yt1 | grey tower, coloured base disc, or whole body painted team colour (City Takeover look) | white/grey floors + team roof but missing per-floor team bands, slits, plinth/door ring, or boxy | all of: white body floors with slit, team band per floor, chunky team roof cap, plinth + door, neutral all grey; M11 passes | = tw01 red5 / yt1 "38" at same scale | M11, M18(ii), M20 | 03 |
| V06 | Floors by count band (max 5), stepped taper, proportions | l01,l10,l18 | towerwar_03, yt1 | single stack, no banding | floors but wrong count or no taper | floors correct (M04), white/team alternation, readable steps | = 03 "Max" stack | M04, M20 | 03 |
| V07 | Roof count: white-fill dark-outlined number ON the roof plate, digit height ~0.16-0.22 of tower width | all | towerwar_01, towerwar_03, yt1 ("38", "44") | dark card above, 3x tower | on roof, thin/small (<0.14) | bold fill + outline, centred in upper roof, M02 and M16 pass | = yt1 "38" | M02, M16, M19 | 03 |
| V08 | Slot dots (1 < 10, 2 >= 10, 3 >= 30 count) below the number: **bright white = free slot, dim translucent = slot in use**; neutral shows bright dots; "Max" at cap | l10,l18 | towerwar_01 (blue5 bright, red5 dim), yt1 ("44" two bright + one dim; "38" three dim), towerwar_03 | glyph rows in card | dots present, wrong state or count | count correct, bright/dim semantics correct, legible, M19 passes | = 01/yt1 sets | M19 | 03 |
| V09 | Colourblind glyph on roof, default clean | l10cb | brief | glyph in card | glyph on every tower | only in cb mode, readable | clean, distinct per team | M19 (default scenes: no extra glyph blobs) | 03 |
| V10 | Lane ribbon: flat soft translucent tint, darker edge line, tiny dots, ~1/4-1/3 tower width (**Tower War ribbon**) | l01,l10 | towerwar_01, towerwar_06 | thin dashes | wide, opaque or hard | translucent, right width (M05) | = 06 ribbons | M05 | 04 |
| V11 | Chevrons show direction, evenly repeated (**City Takeover chevrons, user-kept**) | l01 | citytakeover_01 | none | present, wrong size/spacing | clear, consistent | = CT 01 | - | 04 |
| V12 | Lane build-out animates from source | buildout | brief | pops in whole | grows but jitters | smooth from source | smooth + ends under tower | - | 04 |
| V13 | Troops: chunky chibi, team tint, single file, >=1.5% screen height | l01,l10 | towerwar_01, towerwar_06 | specks | visible, boxy/untinted | readable character, tinted, queue | = 06 | M06 | 04 |
| V14 | Head-on: ONE shared lane, colour split at meeting point | clash | towerwar_06, brief | two overlapping dashed lines | one lane, no split | split at live point | split tracks fight smoothly | M12 | 04 |
| V15 | Brawl FX at clash: puffs + small marker | clash | towerwar_06 (red/blue splats), yt1 | none | static blob | animated puffs on point | = 06 confetti | - | 04 |
| V16 | Crossing lanes overlap, no merge/artifact | clash,l18 | towerwar_06 | z-fight/glitch | overlap ok, colour mix odd | clean layering | = 06 | - | 04 |
| V17 | Cut feedback on ribbon (flash, retract) | cut | brief | none | flash only | ribbon snaps/fades over the +1/+3/+6 frames | polished | frame diff between +1/+3/+6 non-zero on the lane crop | 04 |
| V18 | HUD: top-centre level pill + strength bar, round pause/1x/2x buttons | l01 | yt1, towerwar_09 | dark panel | pill, wrong bar/placement | pill + live share bar, round buttons | = yt1 | - | 05 |
| V19 | Help text only as first-level tip; no persistent help bar | l01,l10 | towerwar_09 | persistent bar | shown always in L1 | tip L1 only | dismisses cleanly | - | 05 |
| V20 | Menu restyled to palette | menu | towerwar_05 | old dark | partial | consistent | cohesive | - | 05 |
| V21 | Level picker restyled (Tower War has none; closest ref) | picker | citytakeover_06 | old dark | partial | consistent, 20 readable | cohesive | - | 05 |
| V22 | No v1 leftovers (label cards, road slab, grey plane, offset dashes) | all | v1_playtest_1/2 | 3+ present | 1-2 | none | none + no regressions in L18 | M17, M07 | 03/04 |
| V23 | Gestalt: "looks like Tower War" at thumbnail size | l01,l10,l18 | towerwar_01/06 | no | same genre | would be mistaken at 25% size | indistinguishable style | M18 | 05 |
| V24 | Density/readability at L18 (many towers/troops) | l18 | towerwar_03, yt1 | clutter, unreadable | readable, dense | clear hierarchy | = 03 | M16 (L18 threshold) | 05 |

Appendix B (copy of Metrics table above, with thresholds, status and colour spec) goes in CHECKLIST.md next to this; `thresholds.json` is the source of truth and `visual:check` fails if the two disagree.

## Scene -> reference mapping (`ref-map.json`; Tower War refs only unless noted)
| Scene | Refs |
|---|---|
| l01 | towerwar_01, towerwar_yt1, towerwar_09; role `chevrons`: citytakeover_01 (V11 only) |
| l10 | towerwar_06 |
| l10cb | towerwar_06 |
| l18 | towerwar_03, towerwar_yt1 |
| clash | towerwar_06 |
| buildout | towerwar_01, towerwar_yt1 |
| cut | towerwar_01, towerwar_06 |
| menu | towerwar_05 |
| picker | citytakeover_06 (no Tower War equivalent) |
