---
status: draft
summary: Validate and productionise Tower War art (units, houses, tower, obstacles, ground, FX) into committed GLB/texture assets via a reproducible JS importer, plus instanced team-texture renderers that match reference screenshots.
date: 2026-10-22
---
# PRD: 07 Art pipeline (Tower War look in our renderer)

Repo/branch: node-arena, `feat/tower-war-port` · Depends on: 02 (soft: manifest schema opening; can start on its own branch of schema work, see Contract) · Feeds: 08 (consumes renderers/assets)
Owns: `tools/assets/**` (TW importer, validators), `apps/web/assets/{models,textures,fx,licenses}/**`, `apps/web/assets/manifest.json` visual entries, `apps/web/src/render/**` for units/buildings/elements/ground/lanes/FX, `apps/web/src/manifest/**` (resolve/validate/assets), `docs/CREDITS.md`, `ref/` folder in this branch's agent_files.
Does not own: camera, canvas/WebGLRenderer setup, HUD, input, app shell, level picker (08); sim/content/level files/campaign list (02-05); bots (06); CI gate wiring beyond `check:manifest` (09).

## TL;DR
Ship Tower War's own meshes and per-team textures for the 20 levels (positions 4-23) as committed assets. A JS importer reads `TW_EXTRACT`, converts to GLB, and is re-runnable. Units render as one `InstancedMesh` per (part, team), animated from baked rigid-part Run/Death tables. Task 1 is validating the never-rendered prototypes against references. All old Kenney/diorama art and code is deleted.

## Problem
- Prototype GLBs (43 skins, 15 buildings) were never opened in a renderer [verified: 01#8.2]; orientation/winding/UV are reasoned, not seen.
- Our pipeline is static GLB + material tint + `none|bob` anim, troop <=300 tris, code-built stacked tower [verified: manifest.schema.ts closed enums, towers.ts, import-art.mjs]. TW needs texture-swap teams, 3-stage buildings, part animation, 400-2,300 tri units.
- Particles are not extractable (1,150 ParticleSystems); only 85 FX textures are [verified: 01#8.2].
- Environment/ground/obstacle prefab mapping is partly unresolved (Addressables GUIDs; see Open Questions).

## Goals
1. Validated, committed assets for exactly what the 20 levels render (inventory below).
2. `pnpm assets:tw` reproduces them byte-identically from `TW_EXTRACT`.
3. Renderers for unit / building / obstacle / ground / lane / FX that look like the reference shots under the SP08 camera.
4. Fits the browser: <=60 draw calls for units, <=300k tris total, total new assets <=3 MB gzip.
5. Art never touches `simHash` (render reads the sim's read views only).

## Non-Goals
Skins other than default; garage/skinned models; artillery unit; rocket/fortress/boss/trolley/flag/cargo/river/mine/wall/sheep art; bomb/speed booster VFX and falling-bomb rendering ([RESOLVED: owner — boosters deferred], FUTURES); festival variants; sim/camera/HUD; particle-system fidelity (we approximate with sprites).

## Requirements

### R1 Asset inventory (what 20 levels need)
| Visual | Source (under `_extract`) | Notes |
|---|---|---|
| Soldier, default skin (id 1, 9 parts, 1,036 tris) | `catalog/skins.json`, `prefab_parts_scenes.json`, OBJ in `assets/defaultlocalgroup_scenes/Mesh` | 4 team textures (blue/green/red/yellow) 256x256 `…SkinTexture<Colour>` |
| Tank, default skin (id 1 "T-72", 4 parts, 408 tris) | same | static parts, no clips; turret yaw by renderer if a part is flagged |
| House WT1 (barracks) 3 stages 310/470/630 tris | `building_prefabs.json` (`barrack_level1..3`) | 5 colours incl. neutral gray: `MilitaryDefaultHouse{Blue,Green,Red,Yellow,Neutral}Texture` |
| House WT2 (tank factory) 3 stages, base 200 + pipes | `factory_base` + enable-lists | `MilitaryAttHouse*Texture`; stage = child enable-list, not mesh swap |
| Shooting tower 3 stages 118/168/182 | `watch_tower_level1..3` | `MilitaryTower*Texture`; shot projectile `TowerProjectile*` (cannonball) + radius ring |
| Obstacles (OBS) | `Prefabs/Game/Obstacle.prefab` (8 children, `smallObstacles`/`bigObstacles` lists) + env meshes | Obstacle look is **env-driven, not per-id**: OBS JSON carries no theme id (02#3.6, dump ObstacleContainer) |
| Environment 0 Green/Military and 1 Snow | `EnvironmentData{Green,Snow}`: ground mesh + `MilitaryGroundTexture`/`MilitartEnvironmentTexture`, `snow_ground` (200 tris), `snow_obstacle` (66 tris) | Positions 4-20 -> env 0 (green); 21-23 -> env 1 (snow): `(levelIndex/20)%6`, `levelIndex = pos-1` [verified: 02#4.4]. 05's `ENV_SHIFT` constant is the only knob |
| Lane ribbon | `WayBaseStandard` prefab (`pathNormal`/`pathOpposite`), textures `arrow`, `waveArrow`, `wave`, `trail` | per-team colour, scrolling UV |
| Level-number label on buildings | none (Unity UI text) | Sprite text, anchor `uiPosition` y 0.8 houses / 0.6 towers [verified: 01#3.3]; font OPEN |
| VFX | FX textures: capture/stage = `CFX3_T_HollowCircle`, `CFX_T_Star Add`, `glow_2`; death = `smoke`, `Spark`; shield n/a | Sprite/billboard pool, not particle ports |
| HP bar, parachute, cargo, shield | not needed | skipped |

### R2 Validation (Task 1, gate for everything else)
- Headless Playwright harness `tools/assets/validate/` loads each in-scope proto GLB in three.js (FrontSide, no tint) and renders fixed turntable views to `ref/` sibling `proto-check/`.
- Frame: validation uses the **02 Frame contract** (data frame = Unity coords rotated `(x,z)->(z,-x)`, yaw `(Y+90)`; assets imported RAW; 08 owns the single mirror at `worldRoot`). The turntable is rendered under that same mirrored root (consume 08's root; it is a few lines, provided in Task 1) so winding/handedness is judged as the game will see it.
- Automated: signed volume > 0 per mesh (winding, evaluated under the mirrored root), UVs within [0,1] and texel colour at part centroid is non-transparent, bbox within known size (Cowboy ~0.6x0.9x0.85; tank ~0.94x1.0x1.6 [verified: 01#8.1]), left/right asymmetry check (weapon hand) vs `Sprite` icon `1_*` from `assets/defaultlocalgroup_assets/Sprite`.
- Visual: side-by-side vs icon sprites and App Store refs `towerwar_01/09`. Failure => fix the importer (UV flip, quaternion convert, node transforms), never hand-edit GLBs. The importer does **not** x-negate meshes or fix winding (assets RAW; the mirror is 08's, B3).
- Pass criteria and findings are recorded in a `validation.md` under BF/07-art-pipeline. Prototypes are treated as untrusted until this passes.

### R3 Importer (`tools/assets`, replaces `import-art.mjs`, `build-troop-chibi.mjs`)
- Command: `TW_EXTRACT=/root/projects/tower-war/_extract pnpm --filter @node-arena/tools assets:tw` (+ `assets:tw:check`).
- JS (Node ESM, existing `@gltf-transform/*`, `meshoptimizer`, `sharp` deps) reading `_extract/catalog/*.json` + OBJ + PNG. No UnityPy at repo build time: the catalogs are already JSON. Python `_tools/p1_*` writers are a spec/oracle only (test compares node count, tri count, bbox of JS vs proto output).
- Assets are imported **RAW**: no x-negate, no winding fix (02 Frame contract). 08 owns the single LH->RH mirror at `worldRoot` (three.js flips face winding for negative-determinant objects); label/text sprites stay outside the mirrored root.
- Output: `apps/web/assets/models/tw/*.glb` (rigid nodes per part; glTF animations Run/Death kept for tooling; stage meshes as named nodes `stage0..2`, enable-lists as `extras.stageNodes`), `textures/tw/<family>-<team>.png` (original 256px, sRGB, no recompress), `fx/*.png`, and manifest fragment `apps/web/assets/manifest.tw.json` merged by a tiny script (single manifest remains).
- Reproducible: sorted traversal, no timestamps, `tools/assets/tw-extract.lock.json` records sha256 of every input read. `assets:tw:check` (needs env) regenerates to temp and diffs; without env, `check:manifest` still validates committed output hashes, so CI needs no extract.
- Credits: `docs/CREDITS.md` rewritten: one block "Tower War 1.29.3 (Vaveda) extracted art, private repo, not redistributable" + per-file table. Licence-gate keeps working.

### R4 Team colour, instancing, animation
- Team = per-team texture, **not tint**. Geometry shared; one `MeshLambertMaterial({map})` per (family, team) [5 colours buildings, 4 units]. Buildings: one mesh per (stage, team) swapped on capture/level cross (<=120 objects, plain meshes).
- Units: `InstancedMesh` per (part, team): soldier 9x3 teams (+gray unused), tank 4x3 => <=39 draw calls for 3 AI + blue worst case 48. Instance matrix = unit world transform x baked part-local matrix for clip frame.
- Baked clip table at load: Run 0.533-0.567 s loop, Death 1.13-1.72 s, sampled 30 fps from glTF tracks [verified: 01#1.4] into `Float32Array[frames][parts][16]`. Per frame CPU cost 270 x 9 matrix multiplies ~ trivial. Phase per unit = hash(unitId) so units desync.
- Death: sim removes unit instantly; renderer owns a ghost pool that plays Death on the `TroopDied{channel,seq,owner,kind,cause,x,z}` event (03 CUT payload), at its `x,z`, then recycles. Cap 64 ghosts. No sim coupling.
- Interpolation: `readTroops` gives per-troop `speed` (progress/tick); render position = `progress + speed*alpha`, clamped to lane length (20 Hz -> 60 fps).
- Capacity: each `InstancedMesh` capacity = houses x `aliveCap` for the level (grow-only, never shrinks); perf scene is **720 troops** (matches 03/09 budgets).
- Colour space: textures `SRGBColorSpace`, `renderer.outputColorSpace = SRGB`; Mobile/Diffuse -> Lambert; light intensities tuned by screenshot compare, not assumed (Unity colour space is OPEN; verify against `BF/ref/tw-yt` frames in task 1).
- Budgets as named classes in manifest: `unit` 1,100 tris/model, `building` 1,200, `obstacle` 300, `ground` 500; 256px textures (mip on, aniso 4). Frame target: 60 fps on integrated laptop GPU with 720 troops; measured in a perf scene.

### R5 Renderer seam with SP08
07 exports `createWorldRenderer(scene, manifest)` returning `{ setLevel(levelDef, themeId), update(frame, events, dtMs), anchors, dispose() }`. 08 owns canvas, `WebGLRenderer`, camera (any `PerspectiveCamera`), HUD, input, resize. 07 exports `anchors.building(id) -> {pos, radius, labelPos}` and `pickMeshes` for hit-testing, and a `previewLane(from,to,team)` for the drag preview. 07 adds lights/ground/obstacles/lanes/units/buildings/FX to the passed scene and nothing else. Art must be tuned for FOV 21 / 55 deg pitch [verified: 05#6]; the 07 perf and ref scene uses that camera, rotated-map layout is 08's. FX are driven only by events defined in 03's CUT: `Clash{kind:'headon'|'crossing',a,b,x,z}`, `TroopDied{...,x,z}`, `TowerShot{tower,target,x,z}`; the range ring uses `sim.towerRadiusMilli(view,i)` (04). Labels/text sprites sit outside the mirrored `worldRoot` (08). `frame = {view: SimView, troops: TroopBuffer, n, alpha}` is built by 08 (`n` rows from `sim.readTroops`, `alpha` = interpolation fraction; draw `min(progress + speed*alpha, length)` using the `laneLength` column); `sim.snapshot()` is persistence/debug only, never per frame. [RESOLVED: review 2026-10-22 — renderer takes `frame`, not a snapshot]

### R6 Reference images and compare loop
- **Primary refs (owner-supplied)**: frames extracted from the owner's YouTube walkthrough playlist of all levels (https://www.youtube.com/playlist?list=PL734Sy01N1F2H78gYnOZaczQXHAvJOsgE) in `BF/ref/tw-yt/`, indexed by `BF/ref/tw-yt/INDEX.md` (file -> level). Compare loop uses these. [RESOLVED: owner supplied video refs]
- Secondary: seed `BF/ref/` by copying `docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318/ref/towerwar_{01,02,03,06,07,09,10}.jpg` + `towerwar_yt*.jpg` (real TW App Store/YouTube shots) with an index `ref/README.md` mapping image -> level/env/feature. `citytakeover_*` not copied (other game).
- Gap: refs are low-res and mostly not our 20 levels. Add synthetic references: "Unity-parity renders" of single assets (icon sprites, bbox, texture swatches) for asset checks only.
- Visual refs (`BF/ref/tw-yt/INDEX.md`) are portrait (phone); our game is landscape. Match style/content (art, colours, building/unit looks, labels, HUD elements, effects), adapt layout/HUD placement to landscape (owner-approved).
- Loop: Playwright captures fixed scenes (L4 Green, L21 Snow, unit lineup, stage ladder, capture/shot FX) at 1600x900 -> `ref/out/`; agent compares side-by-side with named reference and iterates (AGENTS.md workflow). Compare against `BF/ref/tw-yt/` frames for the matching level (no owner screenshots needed).

### R7 Deletions
`apps/web/src/render/{towers,tower-mesh,roof-texture,troops,troop-lod,troop-material,props,ground,lane-material,lane-split,lines,brawl,puffs,fx}.ts` (rewritten, not patched), `apps/web/assets/models/*` (8 Kenney/chibi GLBs), `apps/web/assets/licenses/kenney-*` and `opengameart` only if audio unused (audio stays: not in scope), CREDITS rows for models, `tools/assets/{import-art,build-troop-chibi}.mjs`, manifest `models`/`visuals`/`themes` old entries (and `levelVisuals`), `BUILTIN_FX` closed set in `manifest/resolve.ts`, `camera.ts`/`scene.ts` stay for 08 to rework. Deletion happens in the same commit as each replacement lands.

## Architecture
```
TW_EXTRACT/{catalog,assets} --importer (tools/assets/tw)--> assets/models/tw/*.glb
                                                          textures/tw/*.png, fx/*.png
                                                          manifest.tw.json -> manifest.json
manifest -> resolve.ts (open kinds) -> render registry: unit | building | element | ground | lane | fx
frame {view, troops: TroopBuffer, n, alpha} (built by 08 from 03's read API) -> world renderer -> three scene (instanced parts)
```
Registry: `registerRenderer(kind, factory)`; kinds `unit`, `building`, `element`, `ground`, `lane`, `fx`. `team.mode`: `textureSwap` only (the `tint` path is deleted).

### Contract SP02 must provide (manifest + schema)
| Item | Requirement |
|---|---|
| `visuals.<id>.kind` | open string, validated against registered renderer kinds (replace closed `tower|troop`) |
| `model` | `{ parts: "models/tw/x.glb", budget: "unit" }` plus `stages[]: { mesh \| enable[] }` **indexed by `view.buildings.stage`** (no `minLevel`; thresholds live in content only, 02 D5/R7) |
| `team` | `{ mode: "textureSwap", textures: { blue, green, red, yellow, gray } }` (paths) |
| `anim` | `{ mode: "node-tracks", clips: { run, death } }` (no `bob`) |
| `themes.<id>` | `{ ground: {mesh,texture}, obstacle: {small,big,texture}, light, fog, sky, fx }`; the theme id is on the level (no `levelVisuals`) |
| `fx` | open registry id -> `{ texture, kind, params }`; `kind` is defined once in `defs/VISUAL.FX_KINDS` (07 lists its 3 values to 02: `sprite-burst`, `ring`, `beam`); events map to fx ids |
| Budgets | named classes, `check:manifest` updated |
| Level -> visuals | each level def references `theme` id; unit/building visual ids by `kind`+`warriorType` (soldier/tank, WT1/WT2) |
This table = 02 R7 (single contract). Stage thresholds 10/30 are content data (`balance.stageThresholds`) surfaced as `view.buildings.stage`; they are not manifest data and not hardcoded in 07.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Importer language | JS port reading `_extract/catalog` JSON/OBJ/PNG | keep Python UnityPy; hybrid | repo already has gltf-transform pipeline; no UnityPy in CI; catalogs already JSON |
| D2 | Team swap in instancing | one InstancedMesh per (part, team), per-team material | atlas array + instance attribute; tint | zero shader hacks, ~48 draws is fine; atlas kept as fallback if draw calls bite |
| D3 | Unit animation | CPU-baked per-frame part matrices, rigid parts | vertex-animation texture; skinned | 9 parts x 270 units trivial; no skin needed; data from existing clip decode |
| D4 | Source of truth for runtime anim | glTF animations sampled at load | custom JSON | keeps GLBs viewable in Blender; one format |
| D5 | Stage mesh storage | named stage nodes + enable lists in one GLB per house | one GLB per stage | one load, shared textures |
| D6 | Obstacle theming | per-theme (env) mesh+texture via manifest `themes`; per-level OBS positions only | per-obstacle-id models | data has no id; env-driven in original |
| D7 | Particles | sprite/billboard FX from 85 textures | port ParticleSystems (impossible) | not extractable |
| D8 | Refs | seed from existing repo refs + automated asset checks; owner real shots as upgrade | run APK (impossible here) | no emulator available |
| D9 | Compression | meshopt + keep 256px PNG as is | KTX2 | assets tiny; KTX2 adds toolchain |
| D10 | Prototypes | untrusted until R2 passes | trust | never rendered |

## Manual steps (owner)
- None. [RESOLVED: owner supplied YouTube walkthrough refs, `BF/ref/tw-yt/`]
- [RESOLVED: owner — repo stays private; committing extracted TW art is OK]

## Risks
| Risk | Mitigation |
|---|---|
| Prototype orientation/UV wrong | R2 first, validated under 08's mirrored root; fix importer (RAW assets, no x-negate) |
| Environment mapping burns days | time-boxed to one task; fallback ground mesh + `MilitaryGroundTexture` scaled to `view.bounds` + margin; recorded in `validation.md` |
| Mixed-quality references hide mismatches | asset-level automated checks + owner shots |
| Lambert + our lighting looks different from Unity | tune against refs; allow per-theme light in manifest |
| Instanced rigid parts desync at rest pose (seams) | validate Run frame 0 vs bind pose in R2 |
| Gray/neutral unit texture absent (units never neutral) | not needed; lint rejects |
| 720 troops x 9 parts perf on integrated GPU | perf scene gate; fallback atlas + merged LOD body for far units |
| Private-repo art committed | licence block in CREDITS; repo stays private [RESOLVED: owner] |

## Open Questions
- [RESOLVED: verify in Task 1; fallback skin id 1 per type] Is "default skin" = skin id 1 per type (John Doe, T-72)? Verify via `WarriorSkinSettings.defaultWarriorSkinsData` pids 2404/2394/2415 (MB, not hierarchy) in Task 1.
- [RESOLVED: time-boxed one task with the stated fallback] Env 0 prefab/mesh/material mapping: `EnvironmentData.environmentPrefab` is an Addressables GUID (`6a009fe9...` Green, `eac05a39...` Snow); `catalog.bin` unparsed [verified: 01#9]. **Time-boxed to one task (S3).** Fallback (named ground mesh + `MilitaryGroundTexture`, scaled/tiled to `view.bounds` + margin so rotated landscape bounds never show void) is taken if the box expires; outcome recorded in `validation.md`.
- [RESOLVED: N1 env boundary: positions 4-20 green, 21-23 snow (`levelIndex = pos-1`); 05 `ENV_SHIFT` is the only knob]
- [RESOLVED: B3 handedness: assets RAW, 08 owns the single mirror at `worldRoot`, per 02 Frame contract]
- [RESOLVED: read from prefab dump in a 07 task (same UnityPy dump as 05 Task 0); respect `S[]` inactive flags] Which `Obstacle.prefab` children are small vs big and their local scale; `S[]` inactive flags (20% inactive) respected.
- [RESOLVED: verify vs BF/ref/tw-yt frames in task 1, pick closest match, record in validation.md] Unity colour space (gamma vs linear) for lighting parity. Verify against `BF/ref/tw-yt` frames in task 1.
- [RESOLVED: verify vs BF/ref/tw-yt frames in task 1, pick closest match, record in validation.md] Level-number font/outline and stage-transition ring colour; lane texture/material of `WayBaseStandard`. Verify against `BF/ref/tw-yt` frames in task 1.
- [RESOLVED: verify vs BF/ref/tw-yt frames in task 1, pick closest match, record in validation.md] Exact tank turret part (rotating vs static) in `1_BaseAttackSkin`. Verify against `BF/ref/tw-yt` frames in task 1.
- [DEFERRED] Other skins, artillery, rocket tower, river, walls, mines art.
- [RESOLVED: JS port] importer language (D1).

## Acceptance Criteria
- R2 validation report exists (turntable rendered under 08's mirrored root; env-mapping outcome recorded); all in-scope assets pass automated checks and visual compare.
- `pnpm assets:tw` + `assets:tw:check` reproduce committed assets with identical hashes; `pnpm check:manifest` passes with named budgets and rewritten CREDITS.
- Perf scene: 720 animated troops + 20 buildings at 60 fps target on reference laptop GPU, <=60 draws for units, tris <=300k; measured, recorded.
- Manifest passes 02's schema (stage-indexed, no `minLevel`/`levelVisuals`, `themes.<id>.sky`, FX kinds from `defs/VISUAL.FX_KINDS`). InstancedMesh capacity = houses x `aliveCap` (grow-only); interpolation clamped.
- Side-by-side captures of L4 (Green) and a Snow level versus named refs are in `BF/ref/out/` with owner-visible diffs noted.
- Team colour switch on capture shows correct per-team texture for houses and tower; stage changes at 10/30.
- Capture, tower-shot, death FX visible and pooled; no allocation per frame in steady state.
- No file under the R7 deletion list remains; grep for `kenney`, `tower-mesh`, `BUILTIN_FX` finds none outside history.
- `sim:golden`, `replay:verify golden`, `simHash` unchanged by any 07 change.
