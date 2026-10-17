---
status: approved
summary: Diorama matching the Tower War references as closely as possible (steep camera, grass/sand/rock ground, ref-matched props, saturated palette) and code-built painted stacked towers with roof count/slot dots; label cards removed.
date: 2026-10-17
---
# PRD: SP03 — Diorama + Towers
Repo/branch: node-arena · `feat/visual-mechanics-overhaul` · Depends on: SP01 (capture/compose/checklist) · Owns: `apps/web/src/render/{scene,camera,towers,ground,props,tower-mesh,roof-texture}.ts`, `render/overlays.ts` (registry kept; label/slot-glyph consumers removed), deletes `render/labels.ts`, `apps/web/src/test-harness/index.ts` (label-reading lines only; SP01 owns the probe), `apps/web/assets/manifest.json` (themes/camera/visuals/palettes), new prop GLBs, `tools/assets/import-art.mjs` (nature pass), `docs/CREDITS.md`, tower/scene e2e specs.

## TL;DR
Replace the grey plane, void, road slab and floating cards with a look that matches the reference images (`ref/towerwar_*.jpg` primarily) as closely as possible (same camera feel, proportions, palette, tower shapes, number/dot style, lane look, troop look, props, HUD): ~65° camera fitted to the level, bright grass patch inside a sand border dressed with trees/rocks/crates and rock cliffs, one soft-shadow light, saturated team palette. Towers become code-built stacked-floor octagonal blocks fully painted in the team colour, with a white outlined count and 1–3 slot dots on the roof. Ships on L1 first; L10/L18 only smoke-checked (SP05 rolls out).

## Problem
[verified: v1_playtest_1.png] grey plane in light-blue void, road slab hanging off it, label cards ~3× tower size, tiny grey towers. [verified: assets/manifest.json] the "road" is not scene code: every `city.*` theme lists six `prop.road` entries at x=10..110, z=-8 (authored for a different coordinate frame; level towers sit around origin, bounds 120×80 = ±60×±40) plus lights and cones. [verified: scene.ts] ground = a plane sized to tower bounds; camera `pitchDeg 55, fov 45, margin 12` in manifest; labels = DOM chips (`render/labels.ts`, 96 px wide) projected every frame.

## Goals / Non-Goals
Goals: steep camera, no void/board edge at 16:9 and 16:10; ground and prop border matching the Tower War refs; towers ≥ 6% viewport width, roof count readable at 1366×768; colourblind glyph on roof; labels gone; theme stays data.
Non-goals: lanes/troops/clash (SP04), HUD/menus/rollout/baselines (SP05), tower types beyond small/standard/large, extra themes (→ `docs/FUTURES.md`), level layout edits, sim changes.

## Requirements
**R1 Camera.** `manifest.camera` → `pitchDeg 65`, fov ~35, margin tuned in iteration. `fitCamera` keeps solving for the tower bounds (towers + footprint + roof height, not label height) so all towers fit at 16:9 and 16:10; extra vertical room shows sand/props. Top frustum ray stays ≥ 40° below horizontal, so no horizon. Drop the label-height term in `levelVisualBounds`.
**R2 Ground.** Ground top surface is at **y = 0** (grass patch, sand plane and border all coplanar at y=0 within the lane area; no decal, prop or shadow-catcher geometry inside the grass interior that could z-fight a lane at y=0.04; SP04 contract). All ground/border/prop meshes carry `userData.visualRole='ground'`. (a) Sand base plane ≥ 4× bounds, clear colour = sand so no seam ever shows. (b) Grass play patch = level bounds + ~6 u pad, rounded-rect with soft edge (vertex-colour or canvas-gradient alpha blend; mild low-frequency colour variation, 2 greens). (c) Rock clusters/cliffs (squashed icosahedra / Nature Kit cliffs in rock red-brown) along outer border, beyond the camera frustum edge. Fog off (colour-matched fog optional if perf-neutral).
**R3 Road removal.** Delete `prop.road/light/cone` entries from themes (render-side; no level JSON references props — `mapObjects: []` in L1, to be re-checked for all 20 by a grep task). Drop the three orphan GLBs + credits rows (City Kit Roads) once nothing uses them; `check:manifest` must stay green.
**R4 Props.** Chosen purely for visual match to the refs (any freely downloadable pack or code-built geometry; licensing is not a constraint). Candidate packs (kenney.nl/assets/nature-kit responds 200): **Kenney Nature Kit** (pine/round trees, rocks, stumps, logs, cliffs) and **Kenney Survival Kit** (crates, barrels). Tyres are not guaranteed in either: build them in code (torus) rather than add a pack. Concrete GLB filenames are chosen by the import task after unzipping (reference look: green low-poly pines, orange crates, grey barrels, black tyres, red-brown rocks). Import via a new `nature` pass in `tools/assets/import-art.mjs` (same dedupe/prune/quantize/meshopt pipeline, ≤ ~500 tris/prop), outputs `models/prop-*.glb`; add manifest `models` + CREDITS rows (pack, file, source URL, date, modifications; traceability only, not a gate).
**R5 Scatter.** Seeded (mulberry32 from level id hash; never `Math.random`), deterministic per level. Zones: *grass interior* = trees only in clusters at the patch rim (reference: tree rows hugging the grass edge); *sand band* = crates/barrels/tyres/stumps; *rock ring* beyond. Keep-out: disc of `footprintRadius + 3 u` around every tower, plus a 2.5 u-half-width corridor around each segment between towers **only for pairs closer than 40 u** (long cross-map pairs are not reserved — would empty the board), and the whole grass interior except rim clusters. Rendered with `InstancedMesh` per prop model (≤ ~12 draw calls, ≤ 150 k tris total). Props cast no shadow except rocks/trees (shadow budget).
**R6 Light/palette.** One `DirectionalLight` (shadow-casting, PCF soft, existing quality tiers), warm white, plus hemisphere fill. Sky/clear = sand `#FFE1B3`. Palette tokens (sampled from refs, `[verified: towerwar_01.jpg pixels]` unless noted):

| Token | Hex | Source |
|---|---|---|
| grass | `#A3D419` (+ variation `#9DCB10`) | towerwar_01 |
| sand | `#FFE1B3` / shade `#FFCF8D` | towerwar_01 |
| rock | `#BC5439` | towerwar_01 |
| tree | `#028C1D` | towerwar_01 |
| crate | `#FD8539` | towerwar_01 |
| player.1 blue | `#2E8BFF` | brief / REFERENCE.md CT `#1E9BFF` (TW blue sample unreliable) |
| player.2 red | `#F0313F` (TW roof sample `#FF3939`) | brief |
| player.3 yellow | `#FDC534` | towerwar_01 |
| player.4 green | `#35B84A` [unverified] | REFERENCE.md CT `#2FB84A` |
| neutral | `#A8ABB0` (roof `#F5F5F5` trim) | REFERENCE.md |

Colourblind palette (Okabe-Ito, existing) kept; roof glyph added.
**R7 Towers.** Code-built `tower-mesh.ts`: octagonal prism floors (bevelled via chamfered `ExtrudeGeometry` or 8-sided `CylinderGeometry` + smaller lighter trim ring), floor height ~0.9 u, dark window-slit strip per floor, base plinth, door, roof plate. Body + roof plate in team colour (`MeshStandardMaterial`, flat shading); trim `lighten(team, .35)`; neutral = grey body, `#F5F5F5` trim. Width from archetype: small/standard/large footprint radius (`footprintRadius` ×~0.9). **Contract for SP04/SP01:** `tower-mesh.ts` sets `userData.visualWidth` (world u, across-flats incl. scale) on each tower root and `towers.visualWidth(id)` returns it (SP04 lane width = 0.33 × mean of endpoints); roots carry `userData.visualRole='tower'`, the roof decal mesh `visualRole='count'`; probe fields `floors`, `cap`, `countOnRoof`, `slotDots`, `visualWidthWorld`, `hasCard=false` must be non-null (SP01 contract). Screen width ≥ 6% of viewport (standard) — tune `footprint` scale not camera.
*Floor bands* (cap-relative so small cap 20 / standard 50 / large 80 each span 1–5): `floors = clamp(ceil(5 × count / cap), 1, 5)`. Floors are shown/hidden (not rebuilt); gaining a floor does a 150 ms scale-pop. Capture: recolour + 250 ms pop (scale 1→1.12→1) on owner change.
*Roof decal*: one shared per-tower `CanvasTexture` (128×128 SRGB, mipmapped, anisotropy 4) redrawn only on text/dots/glyph change; text = bold sans 72 px, white fill, black 8 px stroke (outlined like TW), drawn flat on the roof plate, so it foreshortens with the tilt. Canvas chosen over SDF text: no font dependency, ≤ 14 small textures at L18, redraw only on change, 65° pitch keeps foreshortening mild. "Max" when `count >= cap`. Slot dots below the number: dot count = current `slots` (1–3); filled white = used line, hollow/dim = free (matches existing `drawsLines` overlay semantics; TW shows slots as dots [verified: towerwar_yt1.jpg]). Neutral shows 0 lines but its slot dots stay hidden (can't draw).
*Colourblind*: shape glyph (▲■●◆○ from `teamMarkers`) in the top-left of the roof, ~25% size; shown only when `colorblind` setting on.
**R8 Labels removed.** Delete `render/labels.ts`, `labelLayer`, `projectLabels`, `TowerPresentation.label`; the overlay registry stays (`garrison`, `drawsLines` readers feed the roof texture). `aria-label`/screen-reader text moves to one visually-hidden live region `[data-tower-summary]` updated on change (keeps accessible description). [verified: no label dependency in `input/index.ts` — hit-testing uses raycast/world coords; `main.tsx`/`App.tsx` hits are unrelated `aria-label`s.] `test-harness/index.ts:49` reads `label…` and must be updated.
**R9 Theme data.** [verified] level JSON already carries `"visual"` = manifest theme key (`city.day/dusk/overcast/night`). Reuse it: add manifest theme `grass`; repoint all 20 levels `"visual": "grass"` (presentation-only edit, no layout/balance change); retire `city.*`. CONTENT_GUIDE says reskins don't bump `contentVersion` and lock hashes stay identical — task must run `pnpm content:lock` + `check:content --base HEAD~` and confirm unchanged `simHash`; if hashes move, follow the version process (bump `contentVersion`, relock). Manifest theme schema gains optional fields (`palette`, `scatter {seed, density}`); schema change ⇒ `schemaVersion` bump + `pnpm content:schemas`. Tower `build: "stacked"` is added to the visual schema likewise; the `block`/primitive fixture path stays for tests.

## Architecture
```
manifest.themes.grass ─▶ scene.ts ─▶ ground.ts (sand plane, grass patch, rocks)
                                   ─▶ props.ts  (seeded scatter → InstancedMesh)
                                   ─▶ light/clear colour
manifest.camera + level bounds ─▶ camera.ts fitCamera (towers only)
SimView ─▶ towers.ts ─▶ tower-mesh.ts (floors) + roof-texture.ts (canvas) ; no DOM labels
```
`towers.update(view, {colorblind})` keeps its signature; it now diffs `(owner, count, cap, slots, lines, colorblind)` per tower and only then repaints/rebuilds floor visibility. Scatter takes `(levelId, bounds, towers[], theme)` and returns instance matrices — pure, unit-testable.

## Iteration protocol
Visual loop per task with a visual outcome:
1. Capture: `pnpm --filter @node-arena/web visual:capture [--scene <id>]` — deterministic (fixed seed, paused at fixed tick, 1920×1080 and 1366×768); PNGs + `metrics.json` to `apps/web/visual-out/` (git-ignored).
2. Compose: `pnpm --filter @node-arena/web visual:compose` → `visual-out/compare-<scene>.png` (current | reference).
3. Score: view each composite; score every task-relevant item of `<BF>/01-visual-qa-harness/CHECKLIST.md` 0–10 against the reference; read `metrics.json` against thresholds.
4. Log: append to `<BF>/03-diorama-and-towers/iteration-log.md`: iter #, date, commit, scores, metrics, top 3 gaps, planned change.
5. Change only the top 1–3 gaps, smallest change; run unit/e2e for the touched area.
6. Commit each improving iteration: `03-diorama-and-towers: Task N — iter k: <change>`. Revert an iteration that lowers any score.
7. Exit: all task-relevant items ≥ 8 AND metrics pass AND tests green. Stuck rule: 3 iterations without improvement → log hypotheses, switch approach (different asset/param/technique). Cap 12 iterations/task → mark `Blocked-visual` in TASKS.md with the log, continue.
8. Never edit reference images, lower thresholds, or delete tests. Screenshot baselines are updated only in SP05 (or when a task says so, with a logged reason).
9. SP05 compiles `final-review.md`.

SP03 specifics:
- **Scenes**: L1 first (slice, both viewports) until exit; then L10 and L18 as smoke only (must render, no void, no overlap catastrophe; scores ≥ 6 acceptable, gaps handed to SP05).
- **References**: ground/props/border → `towerwar_01.jpg`, `towerwar_yt1.jpg`; towers/roof → `towerwar_03.jpg`, `towerwar_06.jpg`, `towerwar_yt1.jpg` (zoomed floors); density at scale → `towerwar_07.jpg`, `citytakeover_01.jpg` (count/dots). Baseline: `v1_playtest_1.png`.
- **Checklist items scored (≥ 8)** (V01–V09 plus the label/road/grey-plane part of V22; each on the scene its SP01 row names, e.g. V09 on `l10cb`): steep camera; no void/board edge; edge props present; ground colour/variation; towers team-painted + large; floors match count band; roof number readable; slot dots visible; colourblind glyph; saturated palette; shadows soft/no acne.
- **Metrics (thresholds)**: SP01 M07 (void share, magenta-clear pass) passes at 1920×1080, 1366×768 and the 16:10 aspect-check viewport 1920×1200 (SP01 captures it for l01/l10/l18); standard tower screen width ≥ 6% of viewport width at 1920×1080 and ≥ 5.5% at 1366×768; roof number glyph height ≥ 14 px at 1366×768 (L1) and ≥ 11 px at L18; label cards = 0 (DOM `[data-tower-index]` count 0) so label/tower ratio metric = 0; all towers fully inside frame with ≥ 2% margin; grass share of frame between 35–65%; draw calls ≤ 100 and SP01 M13 on L18 (sampled; final fps gate in SP05).
- **Order inside SP03** (each its own task): T1 palette/theme/camera + road removal → T2 ground → T3 props import+scatter → T4 tower meshes → T5 roof texture/dots/Max/colourblind/pop → T6 label removal + spec updates → T7 L10/L18 smoke + perf sample.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Theme data location | Reuse `level.visual` → manifest `grass` theme | New `theme` field in level JSON | Field and resolver already exist; no schema change on level side |
| 2 | Road cause | Manifest theme props (not scene.ts) | Hide in render | Delete data at source |
| 3 | Floor bands | `ceil(5·count/cap)`, 1–5 | 1 per 10 troops | Caps 20/50/80 would make small towers 2 floors |
| 4 | Roof text | Canvas texture, redraw on change | SDF/troika text, DOM | No deps, outlined easily, cheap at ≤14 towers |
| 5 | Dots | = slots; filled = used lines | = used only | Matches TW and existing overlay |
| 6 | Towers | Code-built octagonal stacks | Kenney buildings | Whole-tower recolour, floor control |
| 7 | Props | Nature Kit + Survival Kit, tyres in code | One pack only | Reference needs crates/barrels |
| 8 | Keep-out | Tower disc + short-pair corridor only | All pair corridors | Would clear whole interior |
| 9 | Scatter | Seeded, instanced, pure function | Hand-authored per level | 20 levels, deterministic |
| 10 | Clear colour | Sand | Sky blue | Matches border; no seam |
| 11 | Hit-testing | Unchanged (no label use) | Rewrite | Verified |

## Risks / Open Questions
- [RESOLVED: reuse `level.visual`; hashes verified by `check:content`] theme field placement.
- [RESOLVED: crates from Survival Kit, tyres in code] no single pack has all props.
- [RESOLVED: footprint-based width, tune scale] tower width target vs 120×80 bounds with 14 towers at L18 (crowding): towers may overlap lanes; accept, check L18 smoke.
- Roof number at steep tilt/L18 small towers may fail 11 px → fallback: enlarge roof plate, drop dots on `small` at < 1366 px. [DEFERRED to iteration]
- Instancing + shadow cost on integrated GPU → quality tier 'low' disables prop shadows. [RESOLVED]
- Nature/Survival Kit filenames unverified until download [RESOLVED: executor picks the closest visual match to refs (Kenney, Quaternius or code-built) and notes the source in CREDITS].

## Acceptance Criteria
- L1 at 1920×1080, 1366×768 and 1920×1200 (16:10): no void; grass patch, sand border, ≥ 20 prop instances and rocks visible; no road slab; palette matches table.
- Towers painted team/neutral colour; floor count follows bands; capture recolours with pop; roof shows outlined count, "Max" at cap, slot dots; colourblind on → glyph on roof.
- Zero `[data-tower-index]` DOM nodes; `labels.ts` deleted; `[data-tower-summary]` live region present.
- L10/L18 render without errors, no void.
- Checklist items ≥ 8 on L1, metrics pass, iteration-log.md present.
- Unit test: scatter is deterministic per level and respects keep-out; floor-band function table test.
- Content: 20 levels use `grass`; `pnpm validate:content`, `check:content`, `check:manifest`, `check:schemas`, `sim:golden` green; sim hashes unchanged.
- Spec impact (must be updated deliberately, never deleted; owner = SP03 for everything below except HUD/menu leftovers, which are SP05): `towers.spec.ts` (label/glyph/projection assertions → roof marker/texture state; task T6), `scene.spec.ts` (camera fit/pitch/ground bounds; T1–T2), `acceptance.spec.ts` + `acceptance.spec.ts-snapshots` (capture, clash, colorblind, greybox, glb-fixture; menu/picker untouched until SP05) — snapshots regenerated only in SP05; `slice.spec.ts`, `boot.spec.ts`, `dev.spec.ts`, `cache-regressions.spec.ts` (grep `label` hits; T6); `assets.spec.ts` (manifest/asset list; T3); `test-harness/index.ts` (T6). Until SP05, affected snapshot tests are marked `test.fixme(true, 'SP05 baseline refresh: <reason>')` (exact prefix, greppable), not removed; snapshot files are not touched; SP05 restores every one.
