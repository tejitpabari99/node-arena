---
status: done
summary: SP07 R2 prototype validation gate. Prototype GLBs are NOT raw (x-negated); under the 02 Frame contract mirror they render left/right swapped. A RAW candidate transform passes every automated check. Open verifications (default skin, colour space, turret, label, rings, lane) recorded.
date: 2026-10-22
---
# 07 Art pipeline: prototype validation (Task 2, R2)

Command: `TW_EXTRACT=/root/projects/tower-war/_extract pnpm assets:validate [--no-render]` (skips with exit 0 when `TW_EXTRACT` is unset).
Code: `tools/assets/validate/` (`run.mjs` orchestrator, `analyze.mjs` per-GLB checks, `candidate.mjs` RAW transform, `page.js`+`shots.mjs` Playwright/three turntable, `world-root.js` mirror helper), pure checks `tools/src/assets-validate/checks.ts` (unit tests `tools/test/assets-validate.test.ts`).
Evidence: `BF/ref/proto-check/` (`report.json` + PNG sheets). `report.json` is deterministic (no timestamps).

## Method
- Judged **as the game sees it**: under the mirrored `worldRoot` (`scale.z = -1`, `tools/assets/validate/world-root.js`, exported for SP08), FrontSide, `MeshLambertMaterial`, no tint. Winding "as seen" = `signedVolume(world) * sign(det(world))` (three.js flips front-face for negative-determinant parents).
- Two variants per asset: **PROTO** (prototype GLB on disk, never edited) and **RAW candidate** (in-memory transform in `candidate.mjs`, written only to the gitignored `BF/ref/out/proto-check-raw/`). The RAW candidate is what the Task 3 importer must emit.
- Camera: FOV 21 / pitch 55 for the "game cam" tile; yaw 0/90/180/270 turntable at pitch 20. Model forward is **+z** in model space for both soldier and tank (verified: side view at yaw 90 faces screen right; tank muzzle at yaw 180 faces camera). So "front" tiles are yaw ~180.
- Lights (see Colour space) are the game's own: Directional 0.2 + flat ambient 0.8962.

## Pass criteria
| # | Check | Pass when |
|---|---|---|
| P1 | winding | every mesh as-seen signed volume > 0 (open/planar meshes with |vol| < 1e-9 exempt) |
| P2 | UV range | all UVs within [0,1] (+1e-4) |
| P3 | centroid texel | texel at the UV of the vertex nearest the part centroid has alpha >= 128 (colour also eyeballed: belt brown, gun grey, skin tone, tank blue/grey) |
| P4 | bbox | as-seen size within 15% per axis (sorted) of the known size: Cowboy ~0.6x0.9x0.85, tank ~0.94x1.0x1.6 (01#8.1) |
| P5 | handedness | `hand_right` lies on the character right (facing = model +z, right = facing x up) as seen under the mirrored root. Cross-check (calibration, out of scope): Cowboy `holster` on the character right |
| P6 | weapon side vs icon | far end of the weapon from the `hand_right` grip lies on the character left (icon `1_Base`: stock at the right hand, muzzle toward the character's left, viewer-right in front view). Corroborates P5 (icon pose differs from the Run pose, hence only the side is compared) |
| P7 | Run frame 0 vs bind | max node pos delta <= 0.01 and max angle <= 2 deg (instanced rigid parts must not seam against bind pose) |

## Result: in-scope assets
| Asset (GLB) | PROTO as authored | RAW candidate | Notes |
|---|---|---|---|
| soldier default (`1_MilitaryDefaultWarriorSkinData`, 9 parts, 1,036 tris) | **FAIL** P5 (-0.293), P6 (+1); P1-P4, P7 pass | **pass** P1-P7 | bbox as seen 0.572x0.883x0.766. Run: 26 channels / 11 nodes, 0.567 s, frame 0 == bind (0 pos, 0.53 deg), no static mesh parts |
| tank default (`1_MilitaryAttackWarriorSkinData`, 4 parts, 408 tris) | pass P1-P4 (symmetric: handedness not testable) | pass | bbox 0.942x1.009x1.594 vs known 0.94x1.0x1.6; no animations (static parts) |
| barracks WT1 (`House_Default__None_`, stage meshes 310/470/630 tris) | pass P1-P3 | pass | stage sizes 1.81x1.874x1.81 / 1.81x2.639x1.81 / 1.81x3.404x1.81; 4-fold symmetric door ring |
| factory WT2 (`House_Attack__None_`, base 200 tris + pipes) | pass P1-P3 | pass | total active 964 tris incl. 3 `main_pipe` (60) + 3 `ThirdLevelSmallPipe` (128); stage meshes identical (see Findings #3) |
| watch tower (`Tower`, stage meshes 118/168/182 tris) | pass P1-P3 (no embedded texture, resolved from extract) | pass | stage sizes 1.839x2.604x1.839 / 1.999x3.365x1.999 / 2.141x4.403x2.141 |
| calibration only: Cowboy (`10_CowboyDefault...`) | FAIL P1 (`head_2` volume -0.010), P5, holster side | FAIL P1 (`head_2`), others pass | out of scope; `head_2` negative volume is in the source mesh (not caused by the transform). bbox 0.536x0.898x0.777 within 15% of 0.6x0.9x0.85 |

Why winding passes for PROTO yet it is wrong: UnityPy exports OBJ with x negated and faces reversed, which is a proper RH mesh (visible under identity). Under the mirrored root it is shown mirrored (left/right swapped) but still front-facing, so P1 cannot catch it; P5/P6 and the holster cross-check can. Visuals: `soldier-default-turntable.png`, `soldier-default-vs-icon.png` (RAW at front views: muzzle/barrel at the character's left like the icon; PROTO: opposite).

Visual sheets (all under `BF/ref/proto-check/`): `soldier-default-turntable.png` (PROTO, RAW, RAW Run frame 0), `soldier-default-vs-icon.png`, `tank-default-turntable.png`, `tank-default-vs-icon.png` (3/4 front matches the icon sprite incl. barrel up-right), `barracks-wt1-turntable.png` (stage 0/1/2), `factory-wt2-turntable.png` (+ all-nodes row), `watch-tower-turntable.png` (stage 0/1/2), `calibration-cowboy-turntable.png`, `colorspace-and-ref-compare.png`.

## Findings for Task 3 (importer)
The importer reads `catalog/*.json` + OBJ + PNG (not the prototype GLBs), so these are the exact conversions from OBJ/prefab JSON to RAW:
1. **Prototypes are not RAW; the importer must emit RAW Unity geometry** (so the single `worldRoot` mirror shows them correctly). From OBJ (UnityPy `MeshExporter.py` lines 33/45/54: `v = (-x,y,z)`, `vn = (-nx,ny,nz)`, faces written `(c,b,a)`):
   - POSITION and NORMAL: `x = -obj.x` (undo UnityPy).
   - Triangle indices: restore the Unity order `(a,b,c)`, i.e. reverse each OBJ face triple. Verified: with raw x and OBJ face order the as-seen volume would be negative (inside-out); with restored order it is positive.
   - Node transforms from the prefab JSON: use `lp`, `lr`, `ls` **directly** (the prototype writer negated `lp.x` and conjugated `lr` to `(x,-y,-z,w)`; do neither). Animation tracks likewise raw (translation x as is, quaternion as is).
   - UV: keep `(u, 1-v)` (OBJ `vt` is Unity v-up; glTF is v-down). Verified: centroid texels have the right part colours and renders are textured correctly; all UVs within [0,1]; clamp-to-edge sampler as in the prototype.
   - Do NOT x-negate nodes/meshes or "fix winding" beyond restoring Unity's original index order. `tools/assets/validate/candidate.mjs` implements the inverse operation on the prototype GLB and is the executable spec (same maths, test by comparing counts/bbox, plus P1-P7 via `pnpm assets:validate`).
2. **Tower (and artillery house) prototype has no embedded texture** (`images` empty; `building_prefabs.json` `textureFile: null`). Importer must resolve `MilitaryTower{Blue,Green,Red,Yellow,Neutral}Texture` (and house `MilitaryDefaultHouse*`, factory `MilitaryAttHouse*`, all 5 colours present in `assets/defaultlocalgroup_assets/Texture2D`) by name, not rely on the embedded one. Unit team textures (4 colours, `...@sh.png` under `defaultlocalgroup_scenes/Texture2D`) are present.
3. **Stage meshes are duplicated in the prototype.** `House_Default`/`Tower`: node `Art` already carries the stage-0 mesh and also has child `stageMesh_0` (same mesh), so the prototype double-counts (620 / 236 tris vs real 310 / 118). `HouseArt.meshesByLevelHouse` swaps the `Art` mesh by stage: emit nodes `stage0..2` once (310/470/630 and 118/168/182), no own mesh on `Art`. Factory: all three `stageMesh_N` are the same `factory_base` (200 tris): stage is an **enable-list** (child nodes), as the PRD says. Prefab default actives: `main_pipe1-3` and `ThirdLevelSmallPipe` x3 on; `SecondLevelSmallPipe` x2 and `windows_` off. The enable-lists per stage still have to be read from the `HouseArt` component (prototype only flags `activeInPrefab`). Note the two `SecondLevelSmallPipe` and three `ThirdLevelSmallPipe` nodes share names (identify by order/index).
4. **Facing:** soldier and tank both face **+z** in raw model space (tank muzzle +z; soldier chest/toes +z, gun slung on the back). Soldier raw nodes keep the 180 deg `character` node rotation (scale 0.36); keep it (do not bake it away differently from the clip tracks, which are authored under it).
5. **Run frame 0 == bind pose** (soldier 0 pos / 0.53 deg; cowboy 1.1 deg): baking Run at frame 0 introduces no seam. Every mesh part of the soldier is animated (no static parts). Run durations: 0.567 s (soldier), 0.533 s (cowboy), matching PRD. Death/ParachuteFly clips exist but were not validated here (Task 8).
6. **Tank is rigid and clip-less** (4 parts `base`, `gun`, `track`, `wheels`, constant node transforms: each part node has a fixed 90 deg y rotation under the `1_tank` node, which is itself rotated 180 deg and scaled 0.4/0.45/0.4). Part `gun` is barrel + mount (centre y 0.814, z +0.332 in raw frame); the hex plate/turret box is in `base`.
7. Texture sampler: clamp-to-edge both axes (UVs never exceed [0,1]). 256px textures as in the PRD.
8. Mirror helper for SP08: `tools/assets/validate/world-root.js` (`createMirroredWorldRoot()`, `scale.z = -1`). Lights must be children of that root when authored in Unity space; labels/sprites outside it.

## Open verifications (all resolved or recorded)
### Default skin = skin id 1 per type? **Verified**
`assets/defaultlocalgroup_scenes/MonoBehaviour/Game.Main.Settings.Warriors.WarriorSkinSettings/_WarriorSkinsSettings_5325@sh.json`: `defaultWarriorSkinsData = [2404, 2394, 2415]`; `catalog/skins.json` maps pid 2404 = `1_MilitaryAttackWarriorSkinData` (Attack, tank "T-72", id 1, Grey rarity), 2394 = `1_MilitaryDefaultWarriorSkinData` (soldier, id 1), 2415 = `1_MilitaryArtilleryWarriorSkinData` (id 1, artillery, out of scope). So default = skin id 1 per type; no fallback needed.

### Colour space and lighting: **gamma (Unity gamma) marginally closest; difference from linear is small**
- The game's own scene (read with UnityPy from the `defaultlocalgroup_scenes` bundle, `Light` 286 + `RenderSettings` 285): one **Directional** light, colour white, **intensity 0.2**, shadows type 1 (hard), strength 0.829, rotation quat (0.5016, 0.3786, -0.2589, 0.7335) (hierarchy `Directional Light_4@main.json`, position y 3.0); ambient mode 3 (flat), **ambient colour 0.8962264** (sky/flat), intensity 1.0; fog off. So shading is nearly ambient-only: top ~1.0, sides ~0.9. Implemented as `rig: 'tw'` in `page.js` (`AmbientLight(0.8962 * PI)`, `DirectionalLight(0.2 * PI)`, light inside the mirrored root; `* PI` compensates three's physical-light Lambert).
- `PlayerSettings` (`m_ActiveColorSpace`) could not be read (typetree read fails in UnityPy), so the project setting is not directly verified.
- A/B in `colorspace-and-ref-compare.png` vs `BF/ref/tw-yt/d-house-levels-11.jpg` (JPEG crops, patch means): ref red roof (243,92,76), blue roof (71,141,233); linear workflow (SRGB textures + sRGB out) red (230,57,57), blue (62,119,200); gamma (raw texels, no sRGB decode, no output encode) red (240,60,60), blue (65,124,209). Summed abs RGB error over 5 patches (2 roofs, 2 walls, grass): linear 342, gamma 326. Gamma is closer on the buildings (ref is brighter/more saturated than both), linear slightly closer on the grass; margin is ~5%, inside JPEG/video noise. Neutral factory and tower greys match in both.
- **Decision for Tasks 6/7:** use the game rig above; gamma is the closest pick (world pass: `texture.colorSpace = NoColorSpace`, `renderer.outputColorSpace = LinearSRGBColorSpace`, i.e. no encode), but the difference from the R4 default (SRGB textures + sRGB output) is within ~4% per channel on these assets, so if the HUD/sprite pipeline needs sRGB output keep R4 and re-check in Task 12's compare loop. The harness switch is `color: 'srgb' | 'gamma'` (`shots.mjs` opts).
- Shadows: the ref shows a soft dark ground blob right/below each building (not a hard directional shadow map); treat as a blob decal (Task 7).

### Tank turret part: **static, no separate turret**
`1_BaseAttackSkin` has 4 mesh parts (`base`, `gun`, `track`, `wheels`), no animation clips, constant part transforms; `gun` = barrel + mount, hex plate in `base`. In the refs (`d-tank-house.jpg`, `d-battle-lanes.jpg`) the barrel always points along the travel direction (forward). Renderer: no turret yaw; the whole unit yaws to heading, parts stay rigid. Nothing needs flagging in the manifest.

### Level-number label font / outline: **Coiny Regular, white face, dark outline (verified in data); pips = stage + 1**
- `HouseUiView.counterText` (`Game.UI.Windows.LevelWindow.TextOnHouseController`, `defaultlocalgroup_scenes/MonoBehaviour/...HouseUiView_5492@sh.json`) is a `TextMeshProUGUI` with font asset `Coiny-Regular SDF` (`TMPro.TMP_FontAsset/Coiny-Regular SDF_-6137360622856080469.json`; other TMP fonts in the game: Noto Sans Black, Rajdhani Bold), font size 50, material `Coiny-Regular SDF Material Outline`: face colour white, outline colour black alpha 0.553, outline width 0.18, face dilate 0.075, no underlay. Refs agree: chunky rounded white digits with a dark soft outline (L19, L01, d-house-levels-11).
- Placement (refs): on the roof top, centred over the team-coloured cap; towers show only the number (no pips); barracks/factories show 1 to 3 white dots under it. Dot counts in the refs match stage = 0/1/2 by count 10/30 thresholds (5/9 -> 1 dot; 10/15/19/25 -> 2 dots; 30 -> 3 dots, first dot bright). Factory label reads "up N" (arrow + number).
- Outcome: Task 7 label sprite = Coiny Regular (OFL, Google Fonts; needs a licence line in CREDITS), white fill, ~0.18 em black 55% outline, pips as small white discs (dimmed when not reached). The font file itself is not in the extract (only an SDF atlas `Coiny-Regular SDF Atlas_-294699176288488533.png`), so use the Google Fonts TTF or the SDF atlas.

### Stage / selection / range rings: **recorded from refs (colours approximate, JPEG)**
- Range ring (tower): white translucent filled disc (~15-20% white) with a thin brighter white edge (L01, L19, d-tower-firing). Radius from `sim.towerRadiusMilli`.
- Selected own building: solid light-blue (team colour) ring around the base (d-house-levels-11 blue 5). Team-coloured.
- Stage-up/"ready" glow: soft pale yellow-green translucent disc with a lighter rim around the factory base (d-tank-house, "up 30"); shape source `CFX3_T_HollowCircle` (additive). Exact hex not recoverable from JPEG; use ~#F2F08A at ~0.35 alpha and tune in Task 12.

### Lane material `WayBaseStandard`: **recorded from data**
`Prefabs/Game/WayBaseStandard` -> `PathNormal`/`PathOpposite` -> `Path Draw` `LineRenderer` (PathIDs 5302/5303): width multiplier 0.6, texture mode Tile (1), alignment Local/flat (1), width curve constant 1, white colour gradient (team colour applied at runtime). Material `WayBaseStandard` (pid 203): `_MainTex` = `wave` (125x125: translucent band with light edge stripes and white dots), `_Color` white, `_TintColor` (0.5, 0.5, 0.5, 0.502) (half-alpha tint, particle-style shader), `_EmisColor` 0.2. Refs agree: translucent team-coloured ribbon with lighter edges, dots, direction chevrons. Other textures in scope: `arrow`, `waveArrow`, `trail`.

## For Task 4 (env/obstacle mesh inventory; not validated here)
Present in `assets/defaultlocalgroup_assets/Mesh` (all OBJ) and prefab catalog:
| Env | Data | Meshes (tris) |
|---|---|---|
| Green (0) | `EnvironmentDataGreen` (pid 5354): prefab GUID `6a009fe9...` (Addressables, unresolved); `smallObstacleMesh` pid 1959946065686190299 = `green_obstacle_1` (40), `bigObstacleMesh` 6488534389935003867 = `green_obstacle_2` (56) | Candidate prefab by name: `Environment military green for screen` (`Ground` 200, `top_part_2` 5,280, `bottom_part_2` 4,182, green_obstacle_1/2); `multi_stage_environment` uses the same meshes. Textures `MilitaryGroundTexture` (grass band + sand edges), `MilitartEnvironmentTexture` |
| Snow (1) | `EnvironmentDataSnow` (pid 5348): prefab GUID `eac05a39...`; small = big = `snow_obstacle` (66) pid -2846296784030547687 | `env snow optimized for screen`: `snow_ground` 200, `ice_cube` 66, `top_part_2` 3,716, `bottom_part_2` 1,782. Textures `SnowGroundTexture`, `SnowEnvironmentTexture` |
| `Obstacle.prefab` | 8 children `Obstacle/Military/tree_big*` alternating `green_obstacle_1/2` | confirms env-driven obstacles |
The refs (L01/L19: sand border with red canyon rocks, crates, tyres, barrels, sandbags, tree rows) are the `top_part_2`/`bottom_part_2` dressing; both exceed the PRD `ground` budget (500 tris), so Task 4 must decide to drop/simplify them (fallback: `Ground` + `MilitaryGroundTexture` tiled to `view.bounds` + margin).

## Deviations / notes
- The PRD says prototypes may need "UV flip, quaternion convert, node transforms"; the actual required fix is un-negating x (positions, normals, node translations), no quaternion conjugation, and restoring Unity index order. UV flip stays as in the prototype.
- Winding and mirror: the as-seen winding check alone cannot detect the x-negation; hence P5/P6 (handedness) are part of the gate.
- `pnpm assets:validate` exits 1 only if a RAW candidate fails an in-scope check; PROTO failures are reported findings, not failures.

## Task 4 — env/obstacle mapping
Code: `tools/src/assets-tw/env.ts` (`envJob`, appended to `JOBS`), preview `tools/assets/validate/env-preview.mjs` (`TW_EXTRACT=... node tools/assets/validate/env-preview.mjs`), tests in `tools/test/assets-tw.test.ts` (`env:` tests + inventory + determinism). Evidence: `BF/ref/proto-check/env-green-preview.png`, `env-snow-preview.png` (ground pitch 85/55 under the mirrored root, then small yaw 0/90/180, big yaw 0/90/180).

### Outcome: MAPPED BY NAME (Addressables GUID unresolved), ground not simplified-away
- `EnvironmentData.environmentPrefab` GUIDs (`6a009fe9...` green, `eac05a39...` snow) appear only in `raw/catalog_bin_strings.txt` as bare GUID strings adjacent to each other; `catalog.bin` is unparsed and no GUID -> key link is recoverable from the extract in reasonable effort. Time box hit, not pursued further.
- Name mapping is corroborated by data: the only env-themed prefabs are `Environment military green for screen` and `env snow optimized for screen` (also `container_all.tsv` has `...for screen.fbx` for both); `Obstacle.prefab` children use exactly the mesh pids that `EnvironmentDataGreen.smallObstacleMesh/bigObstacleMesh` name (1959946065686190299 / 6488534389935003867); ground materials `MilitaryGround.mat` / `SnowGround.mat` `_MainTex` = `MilitaryGroundTexture` / `SnowGroundTexture` (asserted in the importer), `MilitaryEnvironment.mat` / `SnowEnvironment.mat` `_MainTex` = `MilitartEnvironmentTexture` / `SnowEnvironmentTexture`. Residual risk: the prefab's MeshRenderer -> material link is by name, not read.
- Dressing dropped (budget): `top_part_2` (5,280 / 3,716 tris), `bottom_part_2` (4,182 / 1,782), `ice_cube` (66), green env duplicates of the obstacle meshes. The refs' canyon rocks/crates/tyres/sand border are this dressing and will not appear (visual gap for Task 12 to judge; ground sand/grass band texture is kept).

### Assets (importer output, `pnpm assets:tw`)
| File | Content | Tris | Bytes |
|---|---|---|---|
| `models/tw/ground-green.glb` | node `ground`: `Ground` plane 10x10 (y=0), node scale (6,1,10), translation 0 | 200 | 6,400 |
| `models/tw/ground-snow.glb` | `snow_ground` plane 10x10, node scale (18.8618,1.2009,15.7) | 200 | 6,416 |
| `models/tw/obstacle-green.glb` | nodes `small` = `green_obstacle_1`, `big` = `green_obstacle_2`, unit scale, base at y~0.08-0.10 | 40 / 56 | 6,256 |
| `models/tw/obstacle-snow.glb` | nodes `small` and `big` both = `snow_obstacle` (shared mesh) | 66 / 66 | 4,508 |
| `textures/tw/ground-{green,snow}.png` | 256x256 (source 1024x1024) | | 68 KB / 29 KB |
| `textures/tw/obstacle-{green,snow}.png` | 256x256 atlas (source 1024x1024) | | 60 KB / 106 KB |
Budgets: ground 200 <= 500, obstacles 40-66 <= 300, textures 256px. Source textures are 1024px: decision = downscale with sharp (lanczos3, PNG level 9; deterministic, `assets:tw:check` + two-run test), recorded here. Obstacle UV islands span only ~0.2x0.4 of the atlas, so each obstacle gets ~50x100 texels at 256px: acceptable at game camera distance (previews). Raise `ENV_TEXTURE_PX` if Task 12 compare shows blur. All meshes RAW (x un-negated, faces restored), UV v-flipped; no textures embedded in GLBs (resolved by name `ground-<theme>.png` / `obstacle-<theme>.png`, same convention as other families).

### Ground contract for Task 9
- Prefab facts: ground = flat 10x10 grid (-5..5, 200 tris, UV 0..1). Green prefab scale (6,1,10) = 60x100 world units, snow (18.86,1.2,15.7) = 189x157. Material `_MainTex` tiling (3,3), offset (0,-0.05) (GLB extras `uvRepeat`, `uvOffset`; sampler must be Repeat; glTF UV is v-down so mind the offset sign). Texture = horizontal grass/ice band with sand/white edges along v; at (3,3) the plane has 3 bands and the centre (level origin) is mid-grass.
- The GLB node keeps the prefab scale but zero translation (prefab world pos in `ground` extras `prefabWorldPos`: green (0,0,0), snow (-2.23,0,1.55)). Fallback rule stands: the renderer sizes/tiles the plane to cover `view.bounds` + margin so rotated landscape bounds show no void (bounds are post-rotation; ground is RAW: apply the same (x,z)->(z,-x) quarter turn as the level import to the ground node before the single mirror, or tile independently of orientation). Renderer decides; assets don't change.
- Lit by the game rig (ambient 0.896 + directional 0.2), Lambert, no tint.

### Obstacle contract for Task 9 (level JSON -> what to place)
- Level element: `{ id: 'o<cluster>-<k>', archetype: 'obstacle', pos, yawDeg, footprint: box w,d, variant: 'small'|'big' }` (`packages/content/data/elements/obstacle.json`, `variants: ['small','big']`). Importer (`import-tw/map-level.ts emitObstacles`): `k` = child index of `Obstacle.prefab` = position in `ObstacleContainer.allElements` = level JSON `OCP/OCR/S` index; variant taken from the frozen collider dump (`import-tw/prefab/colliders.json`), `S[k]` false = inactive child, not emitted (not rendered).
- Renderer: choose node `small` or `big` from `elements[].variant`, rotate by `yawDeg`, scale by the prefab child scale for index `k` (GLB root extras `children[k].scale`, parse `k` from the id suffix after `-`), position `pos` (TW `OCP` already world and rotated; prefab `localPosition` is only the authoring layout, ignore). Both themes share the same 8 scales: big = children 0,2,4,5 (1.018/0.919/1.018, 1.194^3, 0.96/0.867/0.96, 1.082/0.977/1.082), small = 1,3,6,7 (0.855/0.772/0.855, 0.6^3 x3). Snow: `small` and `big` are the same ice-cube mesh (66 tris) differing only by scale. Theme = level `theme` ('green' positions 4-20, 'snow' 21-23; `ENV_SHIFT` unchanged).
- Footprint (collision) is independent of art: it comes from the collider box x effective scale, not the mesh.

### Open / notes
- GUID -> prefab remains unproven (name mapping); if Addressables resolution ever shows `environmentPrefab` is a different prefab (e.g. `multi_stage_environment`), ground meshes (same `Ground` plane) are unaffected; only the dropped dressing would differ.
- River obstacles (`ROBS`, `riverObstacleMaterial`), `multi_stage_environment`, other themes (lava, mine, jungle, darkmine) out of scope (only green + snow registered).

## Task 12 — compare + perf
Captures: `pnpm assets:capture --scene all --compare` (1600x900, SwiftShader) -> `ref/out/`; per-capture notes in `ref/out/NOTES.md`. Perf scene: `--scene perf` (`tools/assets/capture/scenes/perf.js`).

### Lighting / colour decision: **sRGB pipeline kept (R4 default); light intensities x PI**
- Root cause of "everything far too dark/dull": three >= r155 has no legacy-light PI factor (Lambert divides irradiance by PI), so Unity's legacy intensities (ambient 0.896 + directional 0.2, pi-free) rendered ~3.14x too dark. Fix in `light-rig.ts`: `UNITY_LIGHT_SCALE = Math.PI` multiplies both ambient and directional. Theme data stays Unity-true (manifest `light` unchanged: 0.2 / 0.896).
- Before/after: l4 grass olive (~(105,125,40)) -> (155,185,46) vs ref grass ~(178,200,56); buildings now bright saturated team colours, snow pale blue like the refs.
- Gamma vs sRGB re-check: after the PI fix the sRGB pipeline matches the refs closely by eye on buildings/units/grass/snow, and Task 1's gamma advantage was ~5% (inside JPEG noise) and was measured against the broken (too-dark) scale. Keeping SRGB textures + sRGB output also keeps HUD/sprites (label sprites, Coiny text) correct, so **no gamma switch**. Remaining: our grass is ~10% darker/greener than the ref (ref (178,200,56) vs ours (155,185,46)); snow slightly bluer (ours is a blue-tinted ice texture, ref nearly white). Acceptable; per-theme tweak possible via manifest `light.ambient` if owner wants brighter (not done, no value fits both).

### Known issues resolved
1. Dark/dull: fixed (above).
2. FX tuned (manifest fragment `FX_ENTRIES`): clash-spark count 8->10, size 0.35->0.7, spread 0.8->1.0, 0.4 s; clash-glow size 1.2->2.0; tower-shot beam width 0.12->0.45, 0.2 s. Visible in `fx.compare.png` (sparks/glow clear; beam still lighter/thinner than the ref's solid green lane + cannonball, since the beam is a short-lived flash by design).
3. L4/L21 captures now at tick 45 (troops in flight visible).
4. Green-ground seam: cause = ground texture not tileable along u (edge columns differ (173,202,57) vs (154,186,44)). Fix: `MirroredRepeatWrapping` on u in `ground-renderer.ts` (v bands keep plain repeat). Seam gone in `l4-green.png`.
5. Env dressing dropped (rocks/crates/tyres/sand-border props, canyon, trees): **visible gap, moderate**. Refs' top/bottom bands carry red canyon rocks, crates, barrels, sandbags, tree rows (green) and snow cliffs, igloo, campfire, snowmen (snow). Ours shows plain sand/ice edges; gameplay area (grass/ice, buildings, lanes, units) matches. Not added (out of scope, tri budget). **Follow-up**: dressing pass as merged/instanced low-poly props (`top_part_2`/`bottom_part_2` are 5.3k/4.2k tris green, 3.7k/1.8k snow, i.e. well within 300k total if instanced once; budget class `ground` 500 is the blocker) — new budget class + task.
6. Obstacle atlas 256px: ice cubes (snow) and bushes render crisp enough at the SP08 camera (`obstacles-snow.png`); no blur seen, `ENV_TEXTURE_PX` unchanged. Note ice cubes read more saturated blue than the ref's pale ice.

### Perf scene (`perf`): 720 troops (600 soldier + 120 tank, animated Run, 36 lanes) + 20 buildings (houses WT1/WT2, towers, 4 teams, mixed stages), snow theme, FOV 21 / 55 deg
| Metric | Measured | Budget | |
|---|---|---|---|
| Unit draw calls (InstancedMesh) | 52 (soldier 9x4 + tank 4x4) | <= 60 | met |
| Total draw calls (units + buildings + labels + lanes + ground + fx) | 189 (was 181; +8 range discs) | n/a | info |
| Triangles (`renderer.info.render.triangles`) | **233,410** (was 678,098 before unit LOD) | <= 300,000 | met |
| CPU `world.update` (720 troops, bake+matrix) | 0.6 ms/frame | | fine |
| Frame time, headless SwiftShader 1600x900 (software rasteriser, `readPixels` sync) | ~920 ms | 60 fps on iGPU | not measurable here (software); **owner check on a real iGPU** |
| Total gzip of new SP07 assets (models/tw 95 KB + textures/tw 1,644 KB + fx 55 KB + Coiny font 69 KB, manifest ~10 KB) | ~1.87 MB | <= 3 MB | met |
Tris breakdown before LOD: soldiers 600 x 1,036 = 622k + tanks 120 x 408 = 49k + buildings/ground/fx ~7k. After LOD: soldiers 600 x 294 = 176k + tanks 49k + rest ~8k = 233k.
**LOD decision (fix-up):** importer emits `models/tw/soldier-lod1.glb` (same 9 part nodes/names, UVs + normals kept, no clips): per-part `MeshoptSimplifier.simplifyWithAttributes` (uv weights 0.5, target ratio 0.25, error 0.15), 1,036 -> 294 tris, deterministic (`assets:tw:check` OK). Manifest: additive optional `visuals.<id>.model.lod` (schema regenerated, schemaVersion unchanged); `check:manifest` verifies part-node parity and fewer tris. Renderer: GLOBAL switch, not per-unit distance (two LOD sets would double InstancedMeshes, 52 -> ~104 draws): when alive troops of the visual > 200 (`LOD_ON`) every part's InstancedMesh swaps `geometry` to the LOD one; back to full at <= 150 (`LOD_OFF`, hysteresis). Draw calls unchanged (unit 52). Tank kept full (408 tris, <=120 units, 49k). Worst case all-soldier 720 = 212k. Visual: perf.png soldiers still read as team-coloured TW soldiers at the SP08 camera; the unit-lineup (few units) stays on the full mesh.
**Range ring:** now a translucent white fill disc (opacity 0.18, child `range-disc`) under the brighter edge ring (0.55), team-neutral, matching refs L04/L09/d-tower-firing (see l4-green.compare.png); selection ring gets a yellow 0.2 fill.

### Un-park confirmation
- `scripts/ci.sh`: `step check:manifest pnpm check:manifest` runs live (line ~113); `check:manifest:SP07` is not in `PARKED`.
- `pnpm assets:tw:check` runnable locally with `TW_EXTRACT=/root/projects/tower-war/_extract` (output OK this task); CI skips it without the extract (not wired further; 09 owns CI).

### PRD Acceptance Criteria
| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | R2 validation report; turntable under mirrored root; env-mapping outcome | met | this file (Tasks 1-4 sections), `ref/proto-check/` |
| 2 | `assets:tw` + `:check` reproduce hashes; `check:manifest` passes, named budgets, CREDITS | met | `pnpm assets:tw:check` OK, `pnpm check:manifest` pass (run notes below) |
| 3 | Perf: 720 troops + 20 buildings, 60 fps, <=60 unit draws, tris <=300k, recorded | met except fps | draws 52 met; tris 233,410 met (unit LOD); fps not measurable headless (owner iGPU check); numbers recorded |
| 4 | Manifest passes 02 schema (stage-indexed, no minLevel/levelVisuals, themes.sky, FX kinds); capacity = houses x aliveCap grow-only; interpolation clamped | met | `check:manifest`, sp07 tests (unit-renderer capacity/clamp tests) |
| 5 | L4 + Snow side-by-side vs named refs in `ref/out/` with diffs noted | met | `l4-green.compare.png` (L04), `l21-snow.compare.png` (L21), `ref/out/NOTES.md` |
| 6 | Team colour switch on capture: per-team texture for houses and tower; stage at 10/30 | met | `stage-ladder.png` (5/10/30 all teams, 3 families), `fx.png` capture; sp07 building tests |
| 7 | Capture / tower-shot / death FX visible and pooled; no per-frame alloc | met | `fx.png` (pool stats `created` = cap, no growth); fx-pool tests |
| 8 | R7 deletion list gone; grep kenney / tower-mesh / BUILTIN_FX none outside history | partial | deletion list gone; residue: `render/camera.ts` still imports deleted `tower-mesh.js` (SP08-owned, legacy parked, not in sp07 tsc); `acceptance.spec.ts` comment (SP08 e2e); audio credits (Kenney sounds, kept by design) |
| 9 | `sim:golden`, `replay:verify golden`, simHash unchanged | met | both pass; no sim/content change |
