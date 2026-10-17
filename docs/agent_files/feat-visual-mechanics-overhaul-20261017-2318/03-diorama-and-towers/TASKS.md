---
status: draft
summary: 7 tasks - palette/theme/camera/road removal, ground, props import+scatter, stacked towers, roof count/dots/glyph, label removal + specs, L10/L18 smoke + perf sample
date: 2026-10-17
---
# Tasks: Diorama + Towers (SP03)
Source of truth: docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318/03-diorama-and-towers/PRD.md. Re-skin the L1 slice first (both viewports, plus 1920x1200 for M07/M08), then smoke-check L10/L18. Sim, level layout, lanes, troops, HUD and screenshot baselines are out of scope. No open items.

Shared iteration rules (repeated in every task so each is executable alone). Let BF = docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318. Capture: `pnpm --filter @node-arena/web visual:capture --scene <id>`. Compose: `pnpm --filter @node-arena/web visual:compose`. Metrics: `pnpm --filter @node-arena/web visual:check`. Checklist: BF/01-visual-qa-harness/CHECKLIST.md (SP01 T7). Log: BF/03-diorama-and-towers/iteration-log.md, one row per iteration: iter #, date, commit, per-item scores, metrics, top 3 gaps, planned change. Loop: capture, compose, view the `visual-out/compare-<scene>.png` composites yourself, score gated items 0-10 against the anchors, read metrics, fix only the top 1-3 gaps with the smallest change, re-run touched unit/e2e tests, commit (`03-diorama-and-towers: Task N - iter k: <change>`) if improved, revert if any score dropped. Exit: all gated items >= 8, metrics pass, tests green. Stuck: 3 iterations with no improvement, log hypotheses and switch approach. Cap 12 iterations, then mark `Blocked-visual` in this file and continue. Never edit refs, lower thresholds, delete tests or update screenshot baselines. Marker for snapshot tests broken here: `test.fixme(true, 'SP05 baseline refresh: <reason>')`.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Palette, `grass` theme, steep camera, road removal | SP01 T8 | todo |
| 2 | Ground: sand plane, grass patch, rock ring | T1 | todo |
| 3 | Props import + seeded scatter | T2 | todo |
| 4 | Stacked painted tower meshes | T1 | todo |
| 5 | Roof count, slot dots, Max, colourblind glyph, pops | T4 | todo |
| 6 | Label removal + spec updates | T5 | todo |
| 7 | L10/L18 smoke + perf sample | T3, T6 | todo |

## Task 1 - Palette, `grass` theme, steep camera, road removal
What it is / what it means: R1, R3, R6, R9, Decisions 1, 2, 10. Establishes the look data and the corrected framing; first task, so it also reads SP01's iteration-0 baseline (row 0) as the starting point.
What changes at a high level: Add manifest theme `grass` (palette tokens from the PRD table, optional `palette` and `scatter {seed, density}` fields, `schemaVersion` bump, `pnpm content:schemas`) and tower `build: "stacked"` in the visual schema (the `block` fixture path stays). Repoint all 20 levels to `"visual": "grass"`, retire `city.*`, delete the road/light/cone prop entries and, once unused, the three orphan GLBs, credits rows (grep all 20 levels for `mapObjects` first). Camera becomes pitch 65, fov ~35, margin tuned; fit uses towers plus footprint plus roof height only (drop the label-height term); top ray stays >= 40 deg below horizon; clear colour sand `#FFE1B3`; one warm directional light with soft shadows plus hemisphere fill.
Done when: `pnpm validate:content`, `check:content --base HEAD~` (simHash unchanged; otherwise follow the contentVersion process), `check:manifest`, `check:schemas`, `sim:golden` green; `scene.spec.ts` camera assertions updated deliberately; no road slab.
Iteration: Visual. Scenes: `l01` at 1920x1080, 1366x768, 1920x1200. Refs: `towerwar_01.jpg`, `towerwar_yt1.jpg` (framing); baseline `v1_playtest_1.png`. Gated items: V01, V04, V22 (road and grey-plane part). Metrics: M07 void share <= 0.5% at all three viewports, M08 9/9 rays, all towers inside frame with >= 2% margin. Follow the shared loop, exit, stuck and cap rules above (cap 12).

## Task 2 - Ground: sand plane, grass patch, rock ring
What it is / what it means: R2, Decision 10. The play surface plus the SP04 contract.
What changes at a high level: `ground.ts` builds a sand base plane >= 4x bounds, a rounded-rect grass patch (level bounds + ~6 u pad, soft edge, two low-frequency greens), and rock clusters along the outer border beyond the frustum edge. Top surface is y = 0 and coplanar with no decal, prop or shadow-catcher geometry in the grass interior (lanes will sit at y = 0.04). Every ground, border and prop mesh carries `userData.visualRole='ground'`. Fog off.
Done when: no void or board edge at 16:9 and 16:10; `scene.spec.ts` ground-bounds assertions updated; visual probe ground tags non-null.
Iteration: Visual. Scenes: `l01` at 1920x1080, 1366x768, 1920x1200. Refs: `towerwar_01.jpg`, `towerwar_yt1.jpg`. Gated items: V02, V04, V22 (grey plane). Metrics: M07, M08, M09 grass share in central 60% >= 30%, grass share of whole frame 35-65%. Follow the shared loop, exit, stuck and cap rules above (cap 12).

## Task 3 - Props import + seeded scatter
What it is / what it means: R4, R5, Decisions 7, 8, 9. Border dressing from Nature Kit and Survival Kit; tyres built in code.
What changes at a high level: Add a `nature` pass to `tools/assets/import-art.mjs` (same dedupe/prune/quantize/meshopt pipeline, <= ~500 tris per prop) producing `models/prop-*.glb`; props chosen purely for visual match to refs (Kenney, Quaternius or code-built; no licence check); add manifest `models` and CREDITS rows (source note only). `props.ts` implements a pure scatter `(levelId, bounds, towers[], theme)` using mulberry32 seeded from the level id hash: trees as rim clusters on grass, crates/barrels/tyres/stumps in the sand band, rocks beyond. Keep-out: tower footprint + 3 u disc and a 2.5 u half-width corridor for pairs closer than 40 u only; grass interior otherwise empty. One `InstancedMesh` per model (<= ~12 draw calls, <= 150k tris); only rocks/trees cast shadows; quality `low` disables prop shadows.
Done when: unit tests show scatter is deterministic per level and respects keep-out; `check:manifest` and `assets.spec.ts` (updated deliberately) green; >= 20 prop instances visible on L1.
Iteration: Visual. Scenes: `l01` at 1920x1080 and 1366x768 (1920x1200 for M07). Refs: `towerwar_01.jpg`, `towerwar_yt1.jpg`. Gated items: V03, V04, plus the shadows soft/no acne part of V04. Metrics: M10 sand/rock border share >= 6%, M07, M13 drawCalls <= 100. Follow the shared loop, exit, stuck (try another pack or density) and cap rules above (cap 12).

## Task 4 - Stacked painted tower meshes
What it is / what it means: R7 (mesh part), Decision 6. Whole-tower team recolour with floor control.
What changes at a high level: Code-built `tower-mesh.ts`: chamfered octagonal floors, window-slit strip per floor, lighter trim ring, plinth, door and roof plate; body and roof in team colour (flat-shaded standard material), trim `lighten(team, .35)`, neutral grey with `#F5F5F5` trim. Archetype width from `footprintRadius` x ~0.9. Floors shown/hidden by `floors = clamp(ceil(5 * count / cap), 1, 5)`, 150 ms scale-pop on gaining one; recolour plus 250 ms pop (1 to 1.12 to 1) on capture. Sets `userData.visualWidth` and `visualRole='tower'` on roots; `towers.visualWidth(id)` returns it. Probe fields `floors`, `visualWidthWorld` become non-null. Tune footprint scale, not camera.
Done when: floor-band function table unit test passes (caps 20/50/80 each span 1-5); `visualWidth` contract unit-tested.
Iteration: Visual. Scenes: `l01` at 1920x1080 and 1366x768, then `l10`. Refs: `towerwar_03.jpg`, `towerwar_06.jpg`, `towerwar_yt1.jpg` (floors, zoomed). Gated items: V05, V06. Metrics: M01 standard tower width >= 6.0% at 1920x1080 and >= 5.5% at 1366x768, M04 floors 100%, M11 tower paint >= 45%. Follow the shared loop, exit, stuck and cap rules above (cap 12).

## Task 5 - Roof count, slot dots, Max, colourblind glyph, pops
What it is / what it means: R7 (roof decal), Decisions 4, 5. Readable numbers on the roof replace the label cards.
What changes at a high level: `roof-texture.ts` per-tower 128x128 sRGB canvas texture (mipmapped, anisotropy 4) redrawn only when text, dots or glyph change: bold white 72 px count with 8 px black stroke, "Max" at cap, slot dots below equal to current slots (filled white = used line, hollow/dim = free), hidden on neutral; colourblind glyph top-left at ~25% size only when the setting is on. `towers.update(view, {colorblind})` keeps its signature and diffs `(owner, count, cap, slots, lines, colorblind)`. Roof decal mesh `visualRole='count'`; probe `countOnRoof`, `cap`, `slotDots` non-null. Fallback if glyph height misses: bigger roof plate, drop dots on `small` below 1366 px.
Done when: texture redraw-on-change unit test; towers e2e roof-state assertions written and green when run (`pnpm --filter @node-arena/web test:e2e`, except `SP05 baseline refresh` fixme specs, which SP05 T11 restores).
Iteration: Visual. Scenes: `l01` (1920x1080, 1366x768), `l10`, `l10cb`, `l18`. Refs: `towerwar_01.jpg`, `towerwar_03.jpg`, `towerwar_yt1.jpg`, `citytakeover_01.jpg` (dots/density), `towerwar_06.jpg` for `l10cb`. Gated items: V07, V08, V09. Metrics: M02 count height / tower width 0.30-0.55, M03 count on roof 100% and no cards, roof number glyph height >= 14 px at 1366x768 L1 and >= 11 px at L18. Follow the shared loop, exit, stuck and cap rules above (cap 12).

## Task 6 - Label removal + spec updates
What it is / what it means: R8, Decision 11, spec-impact list. Removes the DOM labels and keeps accessibility.
What changes at a high level: Delete `render/labels.ts`, `labelLayer`, `projectLabels` and `TowerPresentation.label`; the overlay registry stays (garrison and drawsLines feed the roof texture). Add one visually-hidden live region `[data-tower-summary]` updated on change. Update `test-harness/index.ts` label-reading lines only. Update deliberately (never delete): `towers.spec.ts`, `scene.spec.ts`, `acceptance.spec.ts`, `slice.spec.ts`, `boot.spec.ts`, `dev.spec.ts`, `cache-regressions.spec.ts`, `assets.spec.ts` (grep `label` hits). Snapshot-dependent tests get the `SP05 baseline refresh` fixme marker; snapshot files untouched. The executor updates the specs, then runs the relevant e2e specs and requires them green (except specs carrying the `SP05 baseline refresh` fixme marker, which SP05 T11 restores).
Done when: relevant e2e specs green (except fixme-marked ones), zero `[data-tower-index]` nodes, `labels.ts` gone, `[data-tower-summary]` present, `pnpm --filter @node-arena/web typecheck`, `lint`, unit tests green, `rg "SP05 baseline refresh"` lists every fixme.
Iteration: Non-visual. Measurement: DOM `[data-tower-index]` count = 0 in an `l01` capture via `visual:capture --scene l01` + `visual:check` (M03 no label cards / `hasCard` none; M02 card-to-tower area ratio 0), plus typecheck/lint/unit. Log each attempt as a row in the iteration log; same loop (change, re-run, commit if green, revert if a prior test breaks), stuck rule and cap 12 as above, then `blocked`.

## Task 7 - L10/L18 smoke + perf sample
What it is / what it means: Iteration-protocol SP03 scene rule; hands remaining gaps to SP05.
What changes at a high level: Run the full SP03 gate on `l01` once more, then smoke `l10` and `l18` (render, no console errors, no void, no overlap catastrophe). Fix only regressions or severe gaps cheaply fixable; record the rest in the log as SP05 hand-offs. Sample perf on `l18`.
Done when: L1 gated items still >= 8 at all viewports; L10/L18 items >= 6; zero render errors; acceptance criteria checklist in the PRD ticked in the log.
Iteration: Visual plus perf. Commands: `visual:capture --scene l01`, `--scene l10`, `--scene l18`, `visual:compose`, `visual:check`. Gated: V01-V09 and V22 (label/road/grey-plane part) on their named scenes (L1 >= 8; L10/L18 >= 6), M07 at 1920x1080, 1366x768 and 1920x1200, M01 L18 3-8%, glyph height >= 11 px at L18, M13 drawCalls <= 100, M13 sampled (fps informational on SwiftShader, final gate in SP05). Follow the shared loop, exit, stuck and cap rules above (cap 12).
