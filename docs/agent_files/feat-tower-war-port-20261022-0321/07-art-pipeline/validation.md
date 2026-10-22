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
