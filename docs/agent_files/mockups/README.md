# Theme / re-art / model mockups (concepts, NOT applied)

Nothing here changes the game. Archive for reuse.

## Canvases (private claude.ai artifacts; owner must share for others)
- Theme directions + re-art + model sets A/B: https://claude.ai/artifact/CphZQpQSPSCimJNdpwMCYQ
- Future theme: https://claude.ai/artifact/6u9LpDW2iSNp7YLUncarsB
- Christmas theme: https://claude.ai/artifact/L6v1rtD1URuCMSnbULa3Mv

## Contents
- UI themes 1-4 (Iron Brigade / Command Gold / Field Manual / Tabletop): real screenshots + CSS grading. Files `canvases/directions/t{1-4}-*`.
- Re-art (render style, `?art=v1..v4`): V1 painted miniature, V2 toon outlines, V3 realistic-lite, V4 clay + team accents. `r{1-4}-*`.
- Model sets: A Modern Outpost, B Frontier Stronghold (`m-a-*`, `m-b-*`); Future set (`canvases/future`); Christmas set (`canvases/christmas`).
- `current-*` = baseline screenshots.

## Layout
- `canvases/{directions,future,christmas}/` .dc.html + canvas.json (canvas sources)
- `renders/{shots,reart,remodel,future,xmas}/` PNG renders (local copies of canvas images)
- `scripts/capture-*/` Playwright capture scripts; `scripts/scratch-reart-tools/` copy of generator source
- `reart.patch` full `git format-patch main..scratch/reart` (4 commits, incl. generated GLBs/binaries, ~1.2 MB)

## Blob map
Canvas HTML refs images as `/_blob/<id>` (stored in canvas). Local copies in `renders/` (by upload order). Dirs relative to `renders/`; ext `.png`.

Directions canvas:
| blob | file |
|---|---|
| dfd12b1be7478ef9f23a8d94fb4938ca | shots/grass-clean |
| 95bd4faa87bd32740050720807687632 | shots/snow-clean |
| 3880c5d1f76eea94a45607ab62d379b4 | shots/grass-battle |
| d450dbacb23a1b2116e9f2069df42be3 | shots/snow-battle |
| 3b40fd61d8352ccbdd1d152773893424 | reart/v1-grass |
| 77e4b03de101863a45237efc19cd21c5 | reart/v1-snow |
| 4557a817c1c8cc0a36912cca781c7675 | reart/v2-grass |
| a561111c4aaf259861d28bd6ee1a6af6 | reart/v2-snow |
| f13cea9024fde9d11a6d154cba5f47da | reart/v3-grass |
| 908717d8a0073f7ec1fcc77ce112ee63 | reart/v3-snow |
| 96f3ae6461746b9b41b81b5b5ab5db4c | reart/v4-grass |
| 18abe5c963bd2aed353435cc5ae37012 | reart/v4-snow |
| 7824720a06c0e8c8df71061fb1e5661d | remodel/a-grass |
| 2d4513657ff2a351185a997b93afec8a | remodel/a-snow |
| 85f2596f909f5a430afa7a5e0eecf3ce | remodel/a-lineup |
| 60b4491ca1d50225a04e7c1eaa61d351 | remodel/a-lineup-units |
| 9c42e97ecdb0df2537ca44e821fd1a9c | remodel/b-grass |
| 9706813ac19ae567bb21437a89349afb | remodel/b-snow |
| 92037a14b507845cdadc46e2ea6bdbde | remodel/b-lineup |
| 88838d661963f74aed97f61096e2637f | remodel/b-lineup-units |

Future canvas (ids not present in the .html: `ed638a5c…` snow-hud):
| blob | file |
|---|---|
| 8486c76dd5f124ae562a87e9219686ad | future/grass-clean |
| 282cfa4b33e2eba6422ccfc08b52b244 | future/grass-hud |
| 949f93db9f4c12b01257fb877784901f | future/snow-clean |
| ed638a5c… | future/snow-hud |
| 669d234aff26e40504686fc1b6c6d874 | future/lineup-buildings |
| b07f755a44b08044665fd04f106034c9 | future/lineup-units |

Christmas canvas (`f76a1f75…` map19-hud not referenced in html):
| blob | file |
|---|---|
| a24f171aecdf3080771b341a5ddf62ea | xmas/map3-clean |
| 393efb4d3ebd3e4eea4cf631a2736245 | xmas/map3-hud |
| 18285e59b02b560307b500e2ccbb0046 | xmas/map19-clean |
| f76a1f75… | xmas/map19-hud |
| 263ddcfe5bc7f83efbafc6153544a442 | xmas/lineup-buildings |
| 7b2b5e24925f4f2683d3f1cbe87cb5c1 | xmas/lineup-units |
| 63ffed9e7f8b8c9e100c01ffed3ec53c | xmas/lineup-buildings-snow |

Mapping by upload order; verify visually if a canvas image looks mismatched. Extra renders (e.g. future/lineup-*-red, *-snow) have no blob.

## Regenerate
- Branch `scratch/reart` (pushed to origin, not for merge): 4 commits (re-art variants, model sets A/B, future, christmas).
- Or apply to fresh branch: `git checkout -b x origin/main && git am docs/agent_files/mockups/reart.patch` (or `git apply`).
- Query params: `?art=v1..v4`, `?models=a|b|future|xmas`.
- Lineup page: `apps/web/reart-lineup.html?set=...`
- Generator: `tools/scratch-reart/build.mjs` (+ buildfuture/buildxmas, seta/setb/setfuture/setxmas, lib, groundtex, xmasground, lineup); `merge.sh`; `check.sh <set>`; `cap.mjs` capture.
- Capture scripts: `scripts/capture-*/` (paths inside are scratch-local; adjust).

## Productionising notes
- Artist Blender pass for real models (generator output is placeholder).
- tintMask textures for team colour.
- Tank anim clips: importer gap.
- Move `art.ts` hacks into theme data.
- Bloom low-spec toggle.

Round-1 flat-node themes (rejected by owner) intentionally omitted.
