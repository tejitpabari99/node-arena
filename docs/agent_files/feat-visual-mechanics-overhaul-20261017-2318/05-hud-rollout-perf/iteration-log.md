---
status: in-progress
summary: SP05 HUD/rollout/perf iteration log (non-visual tasks: one row per iteration).
date: 2026-10-20
---
# Iteration log — 05-hud-rollout-perf

| iter | date | task | commit | tests (run 1 / run 2) | typecheck/lint | change / notes |
|---|---|---|---|---|---|---|
| 1 | 2026-10-20 | T1 strength() + tokens | (this commit) | strength.test.ts 10/10, 10/10 | pass / pass | apps/web/src/ui/strength.ts (garrison.count + players[].transit, neutrals excluded, largest-remainder %), ui/tokens.ts (pill #1B5BC0 / #FFFFFF, WCAG helper) |
| 2 | 2026-10-20 | T2 tipSeen save setting | (this commit) | save.test.ts 39/39, 39/39; full web unit 316/316 | pass / pass | SaveSettings.tipSeen (default false); settings() accepts optional key (key-less v1/v0 load false, no v bump); fixtures untouched, expectations use v1Loaded; +2 tests |
| 3 | 2026-10-20 | T3 harness additions | (this commit) | web unit 330/330 (+visual-hud.test.ts); selfcheck full: 60/60 PNGs identical, 0 metrics diffs (27 jobs); selfcheck --all-levels: 80/80 identical, 0 metrics diffs (40 jobs) | pass / pass | scenes l01-tip/pause/results (frame `action` pause\|results; results = L1 timeout at tick 3600), `--all-levels` (lvl-NN, tick 400, 1920x1080+1366x768, single browser), tipSeen=true for every scene except l01-tip, `hud` record per frame (collectHud), H01-H07 in thresholds.json + CHECKLIST B/B.1/B.2 + `lib/hud-metrics.mjs` hooked into visual:check; test-harness `pause()`/`strength()`; ref-map l01-tip(V19)/pause,results(V20)/lvl-NN(items []). H01-H07 all FAIL on pre-HUD code (expected); checklist-vs-thresholds agrees (`--checklist-only`). Pre-existing M fails (clash/l10/l10cb/l18) unchanged. |

## Task 4 (HUD) — scenes l01, l01-tip, l10 @1920x1080 + 1366x768
| iter | change | self/blind V18, V19 | pixel checks | notes |
|---|---|---|---|---|
| 1 | initial HUD (21722a7) | self 8/8; blind 7/8 | H01-H07 pass (l01, l01-tip, l10) | blind: pill text small, bar thin vs ref capsule, buttons small |
| 2 | bigger pill/bar/buttons (30px bar) | 7/8 | H pass | same gaps |
| 3 | white buttons, 34px bar | 7/7 | H04 tip@1366 fail then fixed | V19 down: tip text small |
| 4 | vh-scaled sizes, tip 760px | 7/8 | pass | |
| 5 | bar becomes the pill (text overlaid on bar, stroke text) | 7/8 | pass | stuck x3 -> switched approach |
| 6-7 | wider pill, separators, gloss/uppercase (reverted) | 7/8 | pass | gloss no gain, reverted |
| 8 (kept) | font clamp 24px min, tip .72em | 7/8 | H04 tip@1366 9.2% pass | final CSS |
| 9 | text row above 1.9em bar (reverted) | 7/7 | pass | V19 down -> reverted to 8 |

Differences (blind, consistent): ref pill has no timer/1x button (PRD mandates both); ref bar is bare tri-colour capsule; ref buttons single undo; tip is a card (PRD R3) vs ref banner art. V18 Blocked-visual at merged 7; V19 merged 8 (self 8, blind 8; diffs: tip card vs banner, small text at 1366, overlaps border props).
H01-H07 pass on l01, l01-tip, l10 both viewports. l18/l10cb H rows fail only because those scenes were not recaptured (no pill in stale metrics).

## Task 5 (palette restyle) — scenes menu, picker, pause, results @1920x1080 + 1366x768
| iter | change | self/blind (menu V20, picker V21, pause V20, results V20) | notes |
|---|---|---|---|
| 1 | :root tokens (--c-*), sand/grass gradient bg, navy rimmed 24px panels, blue primary / sand secondary chunky buttons, outlined headings, UI_TOKENS + ui-tokens.test.ts (all pairs >= 4.5:1, strict AA, no large-text allowance) | self 8/8/8/8; blind 7/7/7/7 | blind gaps: heading outline invisible on navy, sentence case, buttons thin/small, tiny body text. App.tsx untouched (selectors unchanged). Web unit 348/348, typecheck/lint pass |
| 2 | uppercase 44px headings, 64px buttons, picker 150px tiles (1920 fits) | blind 7/7/7/6 | gaps: heading outline invisible, flat |
| 3 | blue ribbon h2 (centered, white rim); HUD tip/round buttons reset to prior size (regression caught in l01-tip); H01-H07 l01/l01-tip/l10 all pass | blind 7/7/7/7 | gaps: outline, chunk |
| 4 | ribbon --c-blue (dark outline now visible), 7-8px button drop shadows; large-text 3:1 test for heading on blue | 7/7/7/7 | |
| 5 | gradient sand/blue buttons, ribbon gradient, 0.3em heading stroke | 7/7/7/7 | |
| 6 | 6px white panel rim, eyebrow 18px/subtle 17px | blind menu 8, pause 8, results 8, picker 7 (self 8) | blind picker gap: tiny tile text, dark slab vs light ref |
| 7 | tile order 34px stroked, labels 15px bold | picker 7 | |
| 8 (final) | picker panel --c-blue-deep, white->sand tiles | blind picker 8 (diffs: no red/yellow segmented header, bg warm vs sky-blue, flat tiles w/o icons, thin rim, L20 clipped at 1366) ; menu 8/pause 8/results 8 (diffs: header box vs red ribbon+tails, flat navy vs inset rows, no orange footer/art, cream pills absent in ref) | V20 8, V21 8 merged min(self 8, blind). Tests: web unit 349/349, typecheck+lint+check:manifest pass, app-flow e2e (dev) pass, H01-H07 0 FAIL on l01/l01-tip/l10, App.tsx untouched |

## Task 6 (HUD/menu e2e selector update; non-visual)
| iter | change | result |
|---|---|---|
| 1 | baseline `test:e2e` (prod) | 1 fail: acceptance.spec.ts:68 `.hud strong` removed; dev.spec/boot/input-palette/cache-regressions already match new aria-labels |
| 2 | acceptance:68 -> `[data-hud="pill"] strong` toContainText 'Fixture 2'; slice.spec perf toggle -> pause > Settings > "Performance HUD" checkbox > Done > Resume; new e2e/hud.spec.ts (tip once on L1 + reload after dismiss, no tip on L2, meter role/aria-valuetext format sums 100, speed button, Esc/Pause) | prod: hud 4/4 pass, acceptance pass; dev suite 33 pass, 11 skipped (3 fixme SP05 baseline, 8 SLICE opt-in); SLICE=1 perf-HUD specs 2/2 pass |
Flake: acceptance.spec.ts:95 stress p95 failed once on dev run, passed on prod runs/rerun (known SwiftShader flake). Picker at 1366x768: L20 tile bbox y 632-733 (< 768) visible, reachable; no CSS change. typecheck + lint pass.

## Task 7 — L1 slice gate (visual; all scenes, 1920x1080 + 1366x768, `--lod high`)
Iter 0 (3cbedf9): metrics fails: M09 l10/l10cb (.857/.872 > .85), M11 l10/l10cb/l18, M18 l18@1080 + clash@1080 (.205), M20 l18; M13 = T10. Blind (l01/l10): V01 5, V05 5-6, V06 5-6, V07 5-6, V13 5, V18 6, V23 6.
| iter | change (owner) | result |
|---|---|---|
| 1 (877365b) | fix(SP03): ground GRASS_PAD 8 (kept), EDGE_SOFT 3.5->6, rocks 120->240 | M09 l10/l10cb pass (.82-.85), M18 l18/clash pass (<.2); class shares l01 grass .39 sand .31 rock .16 (ref tw01 .455/.18/.06) |
| 2 (025f22d) | picker compact grid at max-height 820px (SP05 V21): 20th level + Back button were clipped at 1366x768 | all 21 cards + Back visible |
| tried, reverted | tower scale .72->.86 / .79; camera margin 3->1.5/2.2/2.6; BAND_H .13->.11; GRASS_PAD 10; l10 tick 340-600 | scale: M01 l01 .051 > .0492, M20 l10 + M18 l18 fail; margin: M20 l10/l10cb Max-tower (3-4 white runs vs 5) fail, clash M18; BAND_H: l01 M11 c .459 > .45; tick: yellow tower b .754 persists |

### Final metrics (committed state, 60 PNGs, check --strict)
PASS at both viewports: M01-M10, M12, M14-M19 on all named scenes (M07/M08 also 1920x1200). FAIL: M11 l10@both (yellow tower b .754 > .72; neutral troop overlap sat .069-.074 > .05), M11 l18@both (5/14: green team hue 130 lies inside the SP01 tree-green ground mask H105-150, so green towers have 0 fg: a=null), M11 l10cb@both (cb orange #D55E00 H26 is 31 deg from red 357 > 25 tolerance, b .165-.175), M20 l18@both (same green-mask cause: 0w/0b tower). M13 jsMs 10.1 fail (T10). Evidence: metric mis-specification for green/colourblind hues (thresholds untouched; for final-review).

### Final merged scores (min(self, blind); self <= blind, blind shown = upper bound; 7 cap seen on every SP03/SP04 item)
l01: V01 5, V02 6, V03 6, V04 6, V05 5, V06 5, V07 5, V10 5, V11 7, V13 5, V18 6, V19 8, V22 8, V23 6. l10: V01 6, V05 6, V06 6, V08 5, V03 6, V04 7, V07 5, V10 6, V13 5, V19 8, V22 8, V23 6. l18: V01 6, V06 6, V08 6, V16 7, V22 8, V23 6, V24 7. l10cb: V09 8. clash: V14 7, V15 6, V16 7. cut: V17 5. buildout: V12 6. menu V20 7. picker V21 7.
Blind-scorer rationale (repeated): tower ~3% frame height (metric M01 says 7.8% of height at l01), troops read as blobs, roof digits small at full frame, ribbons more opaque/chevrons vs ref dots, menu/picker lack character art (layout redesign out of scope), cut p3/p6 look the same, clash FX white puffs not team-coloured.
Outcome: Blocked-visual (>=8 only V09, V19, V22). Hand-offs for final-review: green/cb M11/M20 metric mis-spec; yellow-tower roof dominance (3 floors); V13/V15/V17 need SP04 art (team-coloured confetti, retract staging); optional human-first meter order not done.

## Task 8 — 20-level rollout sweep (details + matrix in rollout-log.md)
| iter | change | result |
|---|---|---|
| 0 | baseline sweep; test/rollout-props.test.ts (R3) | R1/R2/R3/R6 pass 20/20; R4/R5 blind 4-5 / 6-7 |
| 1 | roof number 44 px | M11 l01@1920 c .451 > .45 -> regression |
| 2 | lane width = factor x median tower width | M05 all in band |
| 3 | troop size factor | M06 L9/L12 pass |
| 4 | per-level camera margin L5/L8/L9/L12 | M15 union <= .1 |
| 5 | revert digit to 40 | l01 M11 passes |
| 6 | roofNumberPx: 44 except L1; rollout-params.test.ts | std-tower digit 10-12 px; no new gated fails; blind final R4 5-6, R5 6-7 -> Blocked-visual |

## Task 9 — Perf instrumentation (non-visual)
- `createPerfMetrics(capacity=120, history=7200)`: preallocated Float64Array rings (no per-frame allocation); snapshot adds `frames[]`, `frameP99`, `renderMs`, `sample{n,fpsMean,fps1Low,frameP95,frameP99,jsMsMean,jsMsP95,renderMsMean,renderMsP95}`; `percentile()` export; `reset()`; HUD-visible fields unchanged. renderMs = scene.render() only (informational; M13 jsMs unchanged).
- Harness: `__na.perf()`, `__na.perfReset()`. capture `--gpu`: l18 perf = 5 s warm-up + 30 s sample (default 5 s untouched); perf record adds frameMsP99, fps1Low, jsMsMean, triangles, `app` (createPerfMetrics sample).
- Unit: dev.test.ts 9/9 twice identical; web vitest 376/376; typecheck, lint clean.
- Run: xvfb headed (private Xvfb :99) + `--gpu` on SwiftShader (no real GPU; fps informational, CPU-throttle/DPR proxy left for T10).
| run | fps | p95 ms | p99 ms | 1% low | jsMs p95 | calls | tris | app n / renderMs p95 |
|---|---|---|---|---|---|---|---|---|
| 1 | 0.87 | 1195.5 | 1205.4 | 0.83 | 7.1 | 44 | 151796 | 53 / 3.6 |
| 2 | 0.88 | 1192.7 | 1236.5 | 0.81 | 7.5 | 44 | 151796 | 53 / 4.6 |
- Note: SwiftShader 1920x1080 is readback-bound (~1.2 s/frame), so fps/1% low meaningless here; app n (53) > capture n (27) because the driver's own rAF loop also feeds the snapshot.

## Task 11 - Restore fixme specs + regenerate 7 acceptance baselines
- Removed 3 `test.fixme(true,'SP05 baseline refresh: ...')` markers in e2e/acceptance.spec.ts (capture, glb-fixture, greybox); `rg "SP05 baseline refresh"` in apps/web/e2e: 0 hits (apps/web/test/visual-checklist.test.ts:25 is a CHECKLIST doc-string assertion, not a marker, left as is).
- Spec fixes needed once restored: glb-fixture `tower.fixture` visual now sets `build:undefined` (inherits `build:'stacked'` from tower.standard, which ignores model scale; test intends the GLB model path, asserts modelScale 1.2); capture test `test.setTimeout(150000)` + `timeout:60000` on capture.png/clash.png (first frame after ~400 single-tick evaluates drains a SwiftShader backlog ~19 s; 5 s default timed out); e2e/scene.spec.ts med DPR 1.5 -> 1.25 (stale since T10).
- Regenerated once with `playwright test acceptance --update-snapshots --workers=1`, maxDiffPixelRatio still .01, only `-chromium-linux` variants. Old copies viewed vs new (old|new composites); each: reason "reskin".
  - capture.png: old dark HUD + grey slab + victory modal -> new blue pill HUD, sand/grass diorama, chunky VICTORY modal; no render bug.
  - clash.png: old greybox towers, flat lane -> new stacked towers, two-colour lane, cream clash puff + split chevrons; no render bug.
  - glb-fixture.png: old grey slab + green cone GLB fixture -> new diorama; green-tinted GLB fixture tower left, stacked towers elsewhere; no render bug.
  - menu.png: old dark card -> new sand/grass bg, navy card, outlined title; card bottom (Settings/next button) is cut by the 960x600 viewport (page layout, observation only).
  - picker.png: old 960x967 dark grid -> new 960x715 6-column cream tiles; reskin, no bug.
  - greybox.png: old grey slab -> new diorama with props, stacked towers, hint toast; no bug.
  - colorblind.png: as greybox, orange/blue colourblind palette in pill + towers; no bug.
- e2e (preview) x2 plain: 21 passed, 23 skipped, 1 failed both runs = acceptance.spec.ts:95 stress p95 4.2-4.5 ms (<4 asserted; known SwiftShader flake, load avg ~3.8 from other sessions; passes intermittently, e.g. 1 of 5 alone). All 7 snapshot assertions pass on both runs.
- Dev suite (`WEB_TEST_SERVER=dev`): 35 passed, 8 skipped, failures: :95 stress (same flake) and scene.spec.ts (stale 1.5 DPR, fixed -> see rerun).

## Task 12 - README, CREDITS check, ci and e2e green
- FUTURES.md: all six deferred items already present (tank factory, watchtower/archer, boosts, new SFX, level layout/balance pass, more themes); no edit. CREDITS.md: 8 GLBs under apps/web/assets/models all have rows, no city-kit roads row, no textures on disk; `pnpm check:manifest` PASS. `check:content --base HEAD` current (no content/sim files touched).
- README: new "Look" section + 3 composites docs/img/{l01,l10,l18}-1920x1080.png (visual:capture --lod high, then PIL 256-colour quantise, ~200 KB each). T13 re-copies from BF/final after final capture.
- `pnpm run ci`: exit 0 (376 web unit tests, all gates). Note: ci log has no Playwright step; e2e run separately.
- `pnpm --filter @node-arena/web test:e2e` x2 (load avg 4.2-4.4, other sessions): 21 passed, 23 skipped, 1 failed both = acceptance.spec.ts:95 stress p95 (<4 ms).
- Stress investigation (solo `playwright test acceptance -g "full runtime stress"`, p95 ms per run; threshold untouched):
  - branch solo: 3.3(pass) 4.2 4.4 4.4 4.2 3.9(pass) 4.7 4.3 4.3 3.6(pass) 4.0 + later 3.0 3.4 3.8 4.0 4.2 4.3 4.6 5.0 (n=19)
  - main d4111c8 (temp worktree, rebuilt dist-test): 3.4 3.7 3.4 3.9 3.5 3.5 + 2.4 3.6 3.7 3.8 3.8 3.9 4.1 4.6 (n=14); instrumented main runs 4.1/2.9/3.1/4.2/4.1/3.6/4.3/2.7 (also >=4)
  - Medians branch ~4.1 vs main ~3.7: overlapping, host load avg 3.3-4.3 throughout (own runs + other sessions).
  - Per-component in-page profile (frame mean ms, branch vs main): troops 0.37-0.41 vs 0.32-0.47; render 0.80-0.94 vs 0.59-0.95; lines 0.03 vs 0.001; brawl 0.006-0.03 vs n/a; tick_towers/input identical. Draw calls 19 vs 19. Extra cost <= ~0.1 ms mean; p95 tail is render (SwiftShader), not logic.
  - Experiments: HUD unmounted -> p95 3.9-4.9 (no change); LOD forced 'high' -> 3.4-4.6 (no change). Not HUD, not LOD. No branch code change justified; no fix made.
- menu.png 960x600: card bottom cut by viewport only (Play + Settings visible, further buttons below fold); body has min-height 100vh, no overflow hidden, so page scrolls; not clipped content. No CSS/baseline change.

## Review fix (dev-review 2026-10-20-1858): manifest levelVisuals, single roof number
- Per-level overrides moved from render code (CAMERA_MARGIN_OVERRIDE, TROOP_SIZE_OVERRIDE, roofNumberPx) into manifest `levelVisuals` (schema 1.2.0, additive: `cameraMargin` -2..5, `troopScale` (0,2]); read via `createManifestResolver(m).levelVisual(levelId)`. No level-id literals left in apps/web/src/render (unit test greps). Test checks every key is a real level id.
- Roof number: level-id special case removed; one global NUMBER_PX = 44 (was 40 on 01-first-steps, 44 elsewhere). Honest consequence: M11 for l01 now FAILS at 1920x1080: (c) white-body/fg 0.29..0.454 > 0.45 cap (1366x768 passes, c .286..0.445). Accepted per review; thresholds untouched.
- Recapture `--all-levels --lod high` + `--scene l01 --lod high` (scratch eval, thresholds extended to lvl-* in scratchpad copy only): M15 union margin and M06 troop/tower identical to rollout-log final matrix on all 20 levels (e.g. L5 .087, L8 .09, L9 .094/.57, L12 .086/.498); M02/M16 0 fails (42 rows); M19 fails only lvl-02@1366 and lvl-12@1366 (same as already logged). l01 M02 .19-.232, M16 15/11 px, M19 pass.
- capture.mjs: `--perf-only` writes perf-run.json, leaves run.json alone (runFileName helper + unit test).
