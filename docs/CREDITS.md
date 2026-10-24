# Credits

`pnpm check:manifest` warns when a manifest asset path, or any file under `apps/web/assets/{models,textures,fx,audio}/`, is missing from this file. Licence texts for the CC0 packs are copied into `apps/web/assets/licenses/`.

## Tower War 1.29.3 (Vaveda) assets

Assets based on / motivated by Tower War.

All files in the table below are extracted from the Tower War 1.29.3 Android build by Vaveda. Regenerate with `TW_EXTRACT=<path to _extract> pnpm assets:tw` (input and output hashes in `tools/assets/tw-extract.lock.json`; `pnpm check:manifest` verifies the committed output hashes without the extract). Models are rebuilt as RAW glTF (no mirror), textures are the original 256px PNG bytes except environment textures (source 1024px, downscaled to 256px with sharp). `apps/web/assets/manifest.tw.json` (the manifest fragment) is generated data, not art. The level-number font (Coiny Regular, SIL OFL 1.1) is credited in the Fonts section below.

| File | Source in Tower War | Modifications |
|---|---|---|
| models/tw/barracks.glb | House_Default prefab (WT1), stage meshes `stage0..2` | Importer: OBJ -> RAW GLB, rigid part nodes, no embedded texture |
| models/tw/factory.glb | Factory prefab (WT2), stage enable-lists | Importer: OBJ -> RAW GLB, rigid part nodes, no embedded texture |
| models/tw/ground-green.glb | `Ground` plane of "Environment military green for screen" | Importer: OBJ -> RAW GLB, rigid part nodes, no embedded texture |
| models/tw/ground-snow.glb | `snow_ground` plane of "env snow optimized for screen" | Importer: OBJ -> RAW GLB, rigid part nodes, no embedded texture |
| models/tw/obstacle-green.glb | `green_obstacle_1` / `green_obstacle_2` (small / big) | Importer: OBJ -> RAW GLB, rigid part nodes, no embedded texture |
| models/tw/obstacle-snow.glb | `snow_obstacle` (small = big mesh) | Importer: OBJ -> RAW GLB, rigid part nodes, no embedded texture |
| models/tw/projectile.glb | Tower cannonball + trail | Importer: OBJ -> RAW GLB, rigid part nodes, no embedded texture |
| models/tw/soldier.glb | `1_MilitaryDefaultWarriorSkinData` (default soldier skin): 9 rigid parts, Run + Death clips | Importer: OBJ -> RAW GLB, rigid part nodes, no embedded texture |
| models/tw/soldier-lod1.glb | Same skin as soldier.glb, simplified (meshopt, 294 tris), same 9 part nodes, no clips | Importer: per-part meshopt simplify of the soldier OBJ meshes (unit LOD) |
| models/tw/tank.glb | `1_MilitaryAttackWarriorSkinData` (default tank skin): 4 rigid parts | Importer: OBJ -> RAW GLB, rigid part nodes, no embedded texture |
| models/tw/tower.glb | Tower prefab, stage meshes `stage0..2` | Importer: OBJ -> RAW GLB, rigid part nodes, no embedded texture |
| textures/tw/barracks-blue.png | WT1 barracks texture, blue team | None (original PNG bytes) |
| textures/tw/barracks-gray.png | WT1 barracks texture, neutral (gray) | None (original PNG bytes) |
| textures/tw/barracks-green.png | WT1 barracks texture, green team | None (original PNG bytes) |
| textures/tw/barracks-red.png | WT1 barracks texture, red team | None (original PNG bytes) |
| textures/tw/barracks-yellow.png | WT1 barracks texture, yellow team | None (original PNG bytes) |
| textures/tw/factory-blue.png | WT2 factory texture, blue team | None (original PNG bytes) |
| textures/tw/factory-gray.png | WT2 factory texture, neutral (gray) | None (original PNG bytes) |
| textures/tw/factory-green.png | WT2 factory texture, green team | None (original PNG bytes) |
| textures/tw/factory-red.png | WT2 factory texture, red team | None (original PNG bytes) |
| textures/tw/factory-yellow.png | WT2 factory texture, yellow team | None (original PNG bytes) |
| textures/tw/ground-green.png | ground ground texture (MilitaryGroundTexture) | Downscaled 1024px -> 256px (sharp, lanczos3) |
| textures/tw/ground-snow.png | ground ground texture (SnowGroundTexture) | Downscaled 1024px -> 256px (sharp, lanczos3) |
| textures/tw/obstacle-green.png | obstacle obstacle atlas texture (MilitartEnvironmentTexture) | Downscaled 1024px -> 256px (sharp, lanczos3) |
| textures/tw/obstacle-snow.png | obstacle obstacle atlas texture (SnowEnvironmentTexture) | Downscaled 1024px -> 256px (sharp, lanczos3) |
| textures/tw/projectile-blue.png | tower projectile texture, blue team | None (original PNG bytes) |
| textures/tw/projectile-gray.png | tower projectile texture, neutral (gray) | None (original PNG bytes) |
| textures/tw/projectile-green.png | tower projectile texture, green team | None (original PNG bytes) |
| textures/tw/projectile-red.png | tower projectile texture, red team | None (original PNG bytes) |
| textures/tw/projectile-yellow.png | tower projectile texture, yellow team | None (original PNG bytes) |
| textures/tw/soldier-blue.png | default soldier skin texture, blue team | None (original PNG bytes) |
| textures/tw/soldier-green.png | default soldier skin texture, green team | None (original PNG bytes) |
| textures/tw/soldier-red.png | default soldier skin texture, red team | None (original PNG bytes) |
| textures/tw/soldier-yellow.png | default soldier skin texture, yellow team | None (original PNG bytes) |
| textures/tw/tank-blue.png | default tank skin texture, blue team | None (original PNG bytes) |
| textures/tw/tank-green.png | default tank skin texture, green team | None (original PNG bytes) |
| textures/tw/tank-red.png | default tank skin texture, red team | None (original PNG bytes) |
| textures/tw/tank-yellow.png | default tank skin texture, yellow team | None (original PNG bytes) |
| textures/tw/tower-blue.png | tower texture, blue team | None (original PNG bytes) |
| textures/tw/tower-gray.png | tower texture, neutral (gray) | None (original PNG bytes) |
| textures/tw/tower-green.png | tower texture, green team | None (original PNG bytes) |
| textures/tw/tower-red.png | tower texture, red team | None (original PNG bytes) |
| textures/tw/tower-yellow.png | tower texture, yellow team | None (original PNG bytes) |
| fx/CFX3_T_HollowCircle.png | FX texture `CFX3_T_HollowCircle` | None (original PNG bytes), renamed |
| fx/CFX_T_Star_Add.png | FX texture `CFX_T_Star Add` | None (original PNG bytes), renamed |
| fx/Spark.png | FX texture `Spark` | None (original PNG bytes), renamed |
| fx/glow_2.png | FX texture `glow_2` | None (original PNG bytes), renamed |
| fx/lane-arrow.png | FX texture `arrow (lane)` | None (original PNG bytes), renamed |
| fx/lane-trail.png | FX texture `trail (lane)` | None (original PNG bytes), renamed |
| fx/lane-wave.png | FX texture `wave (lane ribbon, WayBaseStandard)` | None (original PNG bytes), renamed |
| fx/lane-waveArrow.png | FX texture `waveArrow (lane)` | None (original PNG bytes), renamed |
| fx/smoke.png | FX texture `smoke` | None (original PNG bytes), renamed |

## Fonts (SIL OFL 1.1)

| File | Source | Author | URL | Licence | Downloaded | Modifications |
|---|---|---|---|---|---|---|
| fonts/Coiny-Regular.ttf | Coiny Regular (level-number labels; the same font Tower War uses) | Marcelo Magalhaes | https://github.com/google/fonts/tree/main/ofl/coiny | SIL OFL 1.1 (`apps/web/assets/licenses/coiny-OFL.txt`) | 2026-10-22 | None |

## Audio (CC0)

| File | Pack | Author | URL | Licence | Downloaded | Modifications |
|---|---|---|---|---|---|---|
| audio/clash.ogg | Impact Sounds 1.0 (impactMetal_light_002.ogg) | Kenney | https://kenney.nl/assets/impact-sounds | CC0 1.0 | 2026-10-09 | None (renamed) |
| audio/capture.ogg | Impact Sounds 1.0 (impactBell_heavy_000.ogg) | Kenney | https://kenney.nl/assets/impact-sounds | CC0 1.0 | 2026-10-09 | None (renamed) |
| audio/cut.ogg | Impact Sounds 1.0 (impactGlass_light_002.ogg) | Kenney | https://kenney.nl/assets/impact-sounds | CC0 1.0 | 2026-10-09 | None (renamed) |
| audio/ui-click.ogg | UI Audio (click2.ogg) | Kenney | https://kenney.nl/assets/ui-audio | CC0 1.0 | 2026-10-09 | None (renamed) |
| audio/gameover.ogg | Interface Sounds 1.0 (confirmation_003.ogg) | Kenney | https://kenney.nl/assets/interface-sounds | CC0 1.0 | 2026-10-09 | None (renamed) |
| audio/music-insistent.ogg | Insistent: background loop (Insistent.ogg) | yd (submitted by qubodup) | https://opengameart.org/content/insistent-background-loop | CC0 1.0 (asset page lists "License(s): CC0") | 2026-10-09 | None (renamed); 128.7 s Vorbis, lazy-loaded with the level, not in the boot bundle |

## Licence copies

- `apps/web/assets/licenses/coiny-OFL.txt`
- `apps/web/assets/licenses/kenney-impact-sounds-LICENSE.txt`
- `apps/web/assets/licenses/kenney-interface-sounds-LICENSE.txt`
- `apps/web/assets/licenses/kenney-ui-audio-LICENSE.txt`
- `apps/web/assets/licenses/opengameart-insistent-LICENSE.txt` (note recording the asset-page CC0 statement; OpenGameArt ships no licence file)
