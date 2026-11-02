# Re-art + procedural model sets

Boards: `r{1-4}-{grass,snow}.dc.html`, `m-{a,b}-{grass,snow,lineup,units}.dc.html`, `canvas.json` (16 boards, 6 notes).
Renders: `reart/*.png` (baseline + V1-V4), `remodel/*.png` (sets A/B). Baseline UI shots live in `../ui-themes/shots/`.
Canvas: https://claude.ai/artifact/CphZQpQSPSCimJNdpwMCYQ (shared with `../ui-themes/`). Not applied to game.

## Re-art variants (`?art=v1..v4`, change render style only)
- V1 painted miniature
- V2 stylized toon (outlines)
- V3 realistic-lite
- V4 clay + team accents
Technically: material/lighting overrides (hacks in `art.ts` on `scratch/reart`), no model changes.

## Model sets (`?models=a|b`)
- A Modern Outpost
- B Frontier Stronghold
Procedural GLBs from generator (`../tools/scratch-reart/seta.mjs`, `setb.mjs`); building stages + units lineup page.

Regenerate: see `../tools/README.md`.

## Blob map
Local copies by upload order.
| blob | file |
|---|---|
| 3b40fd61d8352ccbdd1d152773893424 | reart/v1-grass.png |
| 77e4b03de101863a45237efc19cd21c5 | reart/v1-snow.png |
| 4557a817c1c8cc0a36912cca781c7675 | reart/v2-grass.png |
| a561111c4aaf259861d28bd6ee1a6af6 | reart/v2-snow.png |
| f13cea9024fde9d11a6d154cba5f47da | reart/v3-grass.png |
| 908717d8a0073f7ec1fcc77ce112ee63 | reart/v3-snow.png |
| 96f3ae6461746b9b41b81b5b5ab5db4c | reart/v4-grass.png |
| 18abe5c963bd2aed353435cc5ae37012 | reart/v4-snow.png |
| 7824720a06c0e8c8df71061fb1e5661d | remodel/a-grass.png |
| 2d4513657ff2a351185a997b93afec8a | remodel/a-snow.png |
| 85f2596f909f5a430afa7a5e0eecf3ce | remodel/a-lineup.png |
| 60b4491ca1d50225a04e7c1eaa61d351 | remodel/a-lineup-units.png |
| 9c42e97ecdb0df2537ca44e821fd1a9c | remodel/b-grass.png |
| 9706813ac19ae567bb21437a89349afb | remodel/b-snow.png |
| 92037a14b507845cdadc46e2ea6bdbde | remodel/b-lineup.png |
| 88838d661963f74aed97f61096e2637f | remodel/b-lineup-units.png |

`reart/baseline-*.png` have no blob.
