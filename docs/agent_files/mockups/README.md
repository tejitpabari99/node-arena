# Mockups (concepts, NOT applied)

Nothing here changes the game. Archive for reuse. One folder per mockup type.

| folder | type | what | canvas | regenerate |
|---|---|---|---|---|
| `ui-themes/` | UI themes | 4 UI directions (Iron Brigade, Command Gold, Field Manual, Tabletop) + current reference, on real screenshots | directions canvas | screenshots only (`tools/capture/main`) |
| `reart/` | Re-art + model sets | render-style variants V1-V4 (`?art=`) and procedural model sets A/B (`?models=a\|b`) | directions canvas | `?art=v1..v4`, `?models=a\|b` |
| `future/` | Future theme | models, palette, UI on real renders | Future canvas | `?models=future` |
| `christmas/` | Christmas theme | models, palette, UI on real renders | Christmas canvas | `?models=xmas` |
| `tools/` | shared tooling | `reart.patch`, generator source, capture scripts | n/a | see `tools/README.md` |

Each folder: `*.dc.html` canvas boards, `canvas.json` (filtered to that folder), renders (local copies of canvas images), `README.md` (blob-id -> file map).

## Canvases (private claude.ai artifacts; owner must share for others)
- Directions + re-art + model sets A/B (`ui-themes/` + `reart/`): https://claude.ai/artifact/CphZQpQSPSCimJNdpwMCYQ
- Future: https://claude.ai/artifact/6u9LpDW2iSNp7YLUncarsB
- Christmas: https://claude.ai/artifact/L6v1rtD1URuCMSnbULa3Mv

## Status
Concepts only; not applied to game. Source generator lives on branch `scratch/reart` (pushed to origin, not for merge).

## Productionising notes
- Artist Blender pass for real models (generator output is placeholder).
- tintMask textures for team colour.
- Tank anim clips: importer gap.
- Move `art.ts` hacks into theme data.
- Bloom low-spec toggle.

Round-1 flat-node themes (rejected by owner) intentionally omitted.
