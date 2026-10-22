---
status: draft
summary: 12 tasks - refs seed, prototype validation gate, JS importer, env mapping, manifest/CREDITS, instanced unit/building/ground/lane/FX renderers, world-renderer seam, compare+perf acceptance.
date: 2026-10-22
---
# Tasks: 07 Art pipeline

Source of truth: [PRD.md](PRD.md). Order follows the PRD: validation (R2) gates everything, then importer (R3), manifest, renderers (R4/R5), compare loop and perf (R6). Deletions (R7) land in the same commit as each replacement. Depends on 02 (manifest schema contract), 03 (event payloads), 04 (`towerRadiusMilli`), 05 (`ENV_SHIFT`, prefab dump); feeds 08.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Seed refs + capture/compare harness | none | done |
| 2 | Prototype validation gate (R2) | 1 | done |
| 3 | JS importer + lock + check | 2 | done |
| 4 | Environment/obstacle mapping (time-boxed) | 3, 05#0 | done |
| 5 | Manifest fragment, budgets, CREDITS | 3, 02#schema | in-progress |
| 6 | Renderer registry + manifest resolve rewrite | 5 | todo |
| 7 | Building + tower renderer (stages, labels) | 6 | todo |
| 8 | Unit renderer (instancing, baked anim, ghosts) | 6, 03#CUT events | todo |
| 9 | Ground, obstacle, lane renderers | 4, 6 | todo |
| 10 | FX sprite pool | 6, 04#radius | todo |
| 11 | `createWorldRenderer` seam + legacy deletion | 7, 8, 9, 10 | todo |
| 12 | Compare loop, perf scene, acceptance | 11 | todo |

## Task 1 — Seed refs + capture/compare harness
What it is / what it means: Reference material and the Playwright loop every later visual judgement uses (R6, D8).
What changes at a high level: Copy the secondary refs from the prior branch's `ref/` into this branch's `ref/` with an index mapping image to level/env/feature (not `citytakeover_*`). Confirm `ref/tw-yt/INDEX.md` is the primary compare source. Add a headless Playwright capture script at 1600x900 for fixed scenes (L4 Green, L21 Snow, unit lineup, stage ladder, FX) writing to `ref/out/`. Refs are portrait; compare style/content, not layout.
Done when: ref index exists; capture script runs against a stub scene and writes images; owner-free (no owner screenshots needed).

## Task 2 — Prototype validation gate (R2)
What it is / what it means: Prototype GLBs were never rendered; they are untrusted (D10). This gates all other tasks.
What changes at a high level: Build `tools/assets/validate/`: turntable renders under a mirrored root per the 02 Frame contract (assets RAW, 08 owns the real mirror). Automated checks: signed volume per mesh, UVs in range and non-transparent centroid texels, bbox vs known sizes, left/right asymmetry vs icon sprites, Run frame 0 vs bind pose. Verify and record in `validation.md`: default skin (id 1 fallback), colour space (gamma vs linear), tank turret part, level-label font/ring colour, lane material, all against `ref/tw-yt` frames. Failures are fixed in the importer, never by hand-editing GLBs.
Done when: `validation.md` lists pass criteria and findings for every in-scope asset; open verifications all recorded; findings handed to Task 3.

## Task 3 — JS importer + lock + check (R3, D1, D5)
What it is / what it means: Reproducible port of the Python prototype writers into `tools/assets`, replacing `import-art.mjs` and `build-troop-chibi.mjs`.
What changes at a high level: Node ESM importer reading `TW_EXTRACT` catalogs/OBJ/PNG and emitting RAW GLBs (rigid part nodes, Run/Death animations, `stage0..2` nodes + `extras.stageNodes`), 256px sRGB team textures, FX PNGs. Apply Task 2 fixes (UV flip, quaternion, transforms). Sorted traversal, no timestamps, `tw-extract.lock.json` with input sha256. Add `assets:tw` and `assets:tw:check` (skips without env). Test compares node/tri/bbox against the Python oracle output. Remove the two old scripts.
Done when: two runs byte-identical; check diffs clean; skip works without env; oracle test passes.

## Task 4 — Environment/obstacle mapping (time-boxed)
What it is / what it means: Resolve the ground meshes/materials and `Obstacle.prefab` children for Green and Snow (D6); one task only.
What changes at a high level: Use the prefab dump shared with 05 Task 0 to map small/big obstacle lists, local scales and `S[]` inactive flags, plus ground mesh and textures per env. Positions 4-20 map to env 0, 21-23 to env 1 (`ENV_SHIFT` is 05's knob). If the box expires, take the fallback: named ground mesh with `MilitaryGroundTexture` tiled to `view.bounds` plus margin so rotated bounds show no void. Importer emits the chosen assets.
Done when: outcome (mapped or fallback) recorded in `validation.md`; both themes have ground and obstacle assets committed.

## Task 5 — Manifest fragment, budgets, CREDITS (R3, R4)
What it is / what it means: Visual data conforming to 02's single manifest contract; makes `check:manifest` pass again (un-parked by SP07).
What changes at a high level: Importer emits `manifest.tw.json` merged into the single manifest by a small script: open `visuals` kinds, `model` parts plus stage-indexed `stages[]` (no `minLevel`), `team` textureSwap incl. gray, `anim` node-tracks, `themes.<id>` incl. `sky`/light/fog/fx, `fx` with kinds `sprite-burst|ring|beam`. Named budget classes unit 1100 / building 1200 / obstacle 300 / ground 500 tris, 256px. Remove old `models/visuals/themes/levelVisuals` entries. Rewrite `docs/CREDITS.md` (Tower War block + per-file table); `check:manifest` validates hashes against the lock without the extract.
Done when: `check:manifest` passes with no env; CREDITS covers every asset; schema accepts the manifest.

## Task 6 — Renderer registry + resolve rewrite
What it is / what it means: Foundation for all renderers (Architecture, R4).
What changes at a high level: `registerRenderer(kind, factory)` for kinds unit/building/element/ground/lane/fx; `manifest/resolve.ts` validates open kinds against the registry and drops `BUILTIN_FX`. Loader builds one `MeshLambertMaterial({map})` per (family, team), SRGB textures, mip on, aniso 4; the tint path is gone. Colour-space and light setup follow Task 2's recorded decision.
Done when: unit tests cover registry, unknown-kind rejection, material cache; `BUILTIN_FX` gone.

## Task 7 — Building + tower renderer
What it is / what it means: WT1 barracks, WT2 factory and shooting tower with 3 stages and team textures (R1, R4).
What changes at a high level: One plain mesh per (stage, team), swapped on capture or on `view.buildings.stage` change (thresholds stay in content, not in 07). WT2 stage via enable-lists. Neutral gray variant, tower projectile and range ring from `sim.towerRadiusMilli`. Level-number sprite labels outside the mirrored root at the `uiPosition` heights. Expose `anchors.building` and `pickMeshes`. Delete `towers.ts`, `tower-mesh.ts`, `roof-texture.ts`.
Done when: capture swaps team texture correctly; stage changes at 10/30; labels readable; old files removed.

## Task 8 — Unit renderer (instancing, baked anim, ghosts)
What it is / what it means: Soldier and tank at <=60 unit draw calls (R4, D2, D3, D4).
What changes at a high level: `InstancedMesh` per (part, team), capacity = houses x `aliveCap`, grow-only. Bake Run/Death from glTF tracks at 30 fps into per-frame part-matrix tables; per-unit phase from hash(unitId). Position = `progress + speed*alpha` clamped to lane length. Death ghost pool (cap 64) driven by `TroopDied` events at `x,z`, recycled. No sim coupling, no `simHash` effect. Tank turret per Task 2 finding. Delete `troops.ts`, `troop-lod.ts`, `troop-material.ts`.
Done when: lineup capture matches refs; 720-unit stress runs allocation-free in steady state; seams absent at rest.

## Task 9 — Ground, obstacle, lane renderers
What it is / what it means: Diorama replacement per theme, plus coloured lane ribbons (R1, D6).
What changes at a high level: Ground sized to `view.bounds` plus margin; small/big obstacles from per-theme meshes at OBS positions (inactive flags respected); `WayBaseStandard` ribbon with scrolling UV per team colour (arrow/wave/trail textures); `previewLane(from,to,team)` for drag preview. Delete `props.ts`, `ground.ts`, `lane-material.ts`, `lane-split.ts`, `lines.ts`.
Done when: L4 Green and L21 Snow ground/obstacles/lane render without void; preview lane works.

## Task 10 — FX sprite pool
What it is / what it means: Approximate TW particles with pooled sprites (D7).
What changes at a high level: Three kinds (`sprite-burst`, `ring`, `beam`) from the 85 FX textures, triggered only by `Clash`, `TroopDied`, `TowerShot` and capture/stage events. Pooled, no per-frame allocation. Delete `brawl.ts`, `puffs.ts`, `fx.ts`.
Done when: capture, tower-shot, death FX visible in captures and pool never grows in steady state.

## Task 11 — `createWorldRenderer` seam + legacy deletion (R5, R7)
What it is / what it means: The single API SP08 consumes.
What changes at a high level: Export `createWorldRenderer(scene, manifest)` returning `setLevel(levelDef, themeId)`, `update(frame, events, dtMs)`, `anchors`, `dispose()`; adds only lights/ground/obstacles/lanes/units/buildings/FX to the passed scene; any `PerspectiveCamera`; tuned for FOV 21 / 55 deg. Remove the 8 Kenney/chibi GLBs and their licence rows (keep audio), leaving `camera.ts`/`scene.ts` for 08. Confirm no file in the R7 list remains.
Done when: grep for `kenney`, `tower-mesh`, `BUILTIN_FX` is empty; render unit tests pass; `sim:golden`, `replay:verify golden` and `simHash` unchanged.

## Task 12 — Compare loop, perf scene, acceptance
What it is / what it means: Evidence that goals 3 and 4 are met.
What changes at a high level: Run the capture loop for L4 and a Snow level, compare against named `ref/tw-yt` frames, iterate on lights/colour, store diffs in `ref/out/` with notes. Perf scene: 720 animated troops + 20 buildings under the SP08-style camera; record draw calls (<=60 units), tris (<=300k), 60 fps target and total gzip assets (<=3 MB). Un-park confirmation of `check:manifest` and `assets:tw:check` in the gate chain with 09.
Done when: captures and perf numbers recorded; all PRD acceptance criteria checked.

Also (05 review 2026-10-22): wire importer theme registration from manifest v2 `themes` and remove `REGISTERED_THEMES_PRE_SP07` in the importer.

## Owner steps
- Before merge (shared with 09): run `TW_EXTRACT=... pnpm assets:tw:check` locally; CI skips it.
- Final visual approval is SP08/09's; no 07-specific owner steps.
