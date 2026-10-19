# Credits

Every shipped asset is CC0 1.0 (public domain dedication). `pnpm check:manifest` fails when a manifest `src`, or any file under `apps/web/assets/{models,audio}/`, is missing from this file. Licence texts are copied from each pack zip into `apps/web/assets/licenses/`. Licence was re-verified on each pack page at download time (page states "CC0 licensed", Creative Commons CC0).

Model files below were produced by `tools/assets/import-art.mjs` (`pnpm --filter @node-arena/tools assets:import -- <packs dir>`): dedupe, prune, tangents/extra UVs dropped, texture capped at 1024x1024 (the 512x512 source palettes are unchanged), position/normal/uv quantised, meshopt-compressed.

| File | Pack | Author | URL | Licence | Downloaded | Modifications |
|---|---|---|---|---|---|---|
| models/tower-small.glb | City Kit Commercial 2.1 (`building-d.glb`) | Kenney | https://kenney.nl/assets/city-kit-commercial | CC0 1.0 | 2026-10-09 | Standard pipeline only |
| models/tower-standard.glb | City Kit Commercial 2.1 (`building-g.glb`) | Kenney | https://kenney.nl/assets/city-kit-commercial | CC0 1.0 | 2026-10-09 | Standard pipeline only |
| models/tower-large.glb | City Kit Commercial 2.1 (`building-skyscraper-a.glb`) | Kenney | https://kenney.nl/assets/city-kit-commercial | CC0 1.0 | 2026-10-09 | Standard pipeline only |
| models/troop-regular.glb | Mini Characters 1.0 (`character-male-a.glb`) | Kenney | https://kenney.nl/assets/mini-characters | CC0 1.0 | 2026-10-09 | Standard pipeline; skin, rig and animations removed (static rest pose; `bob` is procedural); body mesh material renamed `Shirt` (team colour); body UVs remapped to the white palette swatch so the shirt takes the team colour cleanly; meshes simplified to 288 triangles (budget 300) |
| models/prop-tree-pine.glb | Nature Kit 2.1 (`tree_pineTallA.glb`) | Kenney | https://kenney.nl/assets/nature-kit | CC0 1.0 | 2026-10-19 | Standard pipeline only |
| models/prop-tree-pine-round.glb | Nature Kit 2.1 (`tree_pineRoundC.glb`) | Kenney | https://kenney.nl/assets/nature-kit | CC0 1.0 | 2026-10-19 | Standard pipeline only |
| models/prop-tree-round.glb | Nature Kit 2.1 (`tree_default.glb`) | Kenney | https://kenney.nl/assets/nature-kit | CC0 1.0 | 2026-10-19 | Standard pipeline only |
| models/prop-stump.glb | Nature Kit 2.1 (`stump_round.glb`) | Kenney | https://kenney.nl/assets/nature-kit | CC0 1.0 | 2026-10-19 | Standard pipeline only |
| models/prop-crate.glb | Survival Kit (`box.glb`) | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | 2026-10-19 | Standard pipeline only |
| models/prop-barrel.glb | Survival Kit (`barrel.glb`) | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | 2026-10-19 | Standard pipeline only |
| audio/clash.ogg | Impact Sounds 1.0 (`impactMetal_light_002.ogg`) | Kenney | https://kenney.nl/assets/impact-sounds | CC0 1.0 | 2026-10-09 | None (renamed) |
| audio/capture.ogg | Impact Sounds 1.0 (`impactBell_heavy_000.ogg`) | Kenney | https://kenney.nl/assets/impact-sounds | CC0 1.0 | 2026-10-09 | None (renamed) |
| audio/cut.ogg | Impact Sounds 1.0 (`impactGlass_light_002.ogg`) | Kenney | https://kenney.nl/assets/impact-sounds | CC0 1.0 | 2026-10-09 | None (renamed) |
| audio/ui-click.ogg | UI Audio (`click2.ogg`) | Kenney | https://kenney.nl/assets/ui-audio | CC0 1.0 | 2026-10-09 | None (renamed) |
| audio/gameover.ogg | Interface Sounds 1.0 (`confirmation_003.ogg`) | Kenney | https://kenney.nl/assets/interface-sounds | CC0 1.0 | 2026-10-09 | None (renamed) |
| audio/music-insistent.ogg | Insistent: background loop (`Insistent.ogg`) | yd (submitted by qubodup) | https://opengameart.org/content/insistent-background-loop | CC0 1.0 (asset page lists "License(s): CC0") | 2026-10-09 | None (renamed); 128.7 s Vorbis, lazy-loaded with the level, not in the boot bundle |

## Licence copies
- `apps/web/assets/licenses/kenney-city-kit-commercial-LICENSE.txt`
- `apps/web/assets/licenses/kenney-mini-characters-LICENSE.txt`
- `apps/web/assets/licenses/kenney-nature-kit-LICENSE.txt`
- `apps/web/assets/licenses/kenney-survival-kit-LICENSE.txt`
- `apps/web/assets/licenses/kenney-impact-sounds-LICENSE.txt`
- `apps/web/assets/licenses/kenney-ui-audio-LICENSE.txt`
- `apps/web/assets/licenses/kenney-interface-sounds-LICENSE.txt`
- `apps/web/assets/licenses/opengameart-insistent-LICENSE.txt` (note recording the asset-page CC0 statement; OpenGameArt ships no licence file)
