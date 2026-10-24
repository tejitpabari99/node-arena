---
status: done
summary: Imported eight locked UI sprites; reused bundled Coiny; fixed landscape HUD slots and captured static HUD/restart proof.
date: 2026-10-23
---
# Task 2 — UI art and landscape contract

`apps/web/assets/ui/manifest.json` is the public presentation contract for Tasks 4/5. All asset paths are relative to `apps/web/assets/`. No production HUD or flow is implemented here.

## Import and ownership

- Import: `TW_EXTRACT=/path/to/_extract node --import tsx tools/assets/ui-sprites.mjs`.
- Check: `node --import tsx tools/assets/ui-sprites.mjs --check`. Always verifies committed hashes and stale UI outputs, even without the extract; when `TW_EXTRACT` exists, also verifies source hashes.
- `tools/assets/ui-sprites.lock.json`: SHA256 of all eight source PNGs, emitted PNGs, source fragment, merged UI manifest, existing Coiny TTF and its OFL license. PNG bytes copied unchanged. Repeat import produced an identical lock.
- Shared `pnpm assets:manifest` / `--check` now merges UI fragment `manifest.ui.json` into `ui/manifest.json` alongside SP07's world merge. World fragment and main manifest unchanged.
- Approved implementation deviation: the closed v2 world manifest schema has no UI/font fields. UI uses its own namespace rather than extending SP02's schema. Main orchestrator approved this scoped choice.
- Coiny is already bundled by SP07 (`fonts/Coiny-Regular.ttf`, `licenses/coiny-OFL.txt`); reused and locked here, no external font request. CSS fallback: `system-ui, sans-serif`.

## Sprite mapping

| Slot/key | Extract sprite (unique suffix recorded in script/lock) | Use |
|---|---|---|
| `back` | `icon_replay` | White curved undo arrow, matches in-play reference |
| `backButton` | `back_button` | Optional blue square backing; not used for in-play undo |
| `barBack` | `bar_back` | White rounded backing behind ownership colours |
| `popup` | `bg_popup_1` | Lavender panel, nine-slice at 30 source pixels |
| `primary` | `LoseVictoryButton` | Green main action, nine-slice at 30 |
| `secondary` | `Button_Gray` | Gray secondary action, nine-slice at 26 |
| `soundOn` / `soundOff` | `sound_on_icon` / `sound_off_icon` | Corner audio toggle |

Each `sprites` entry exposes `{path,width,height}`. Runtime consumers should select by key rather than filenames.

## Landscape slots (reference 1600×900)

Scale all dimensions by `clamp(min(width/1600,height/900), .75, 1.2)`; use viewport centre for ownership/popup, viewport edges for corners. Mapping is exported as `layout` in the UI manifest.

| Slot | Placement and size |
|---|---|
| Back | left 28, top 24; 58×58 |
| Ownership | horizontally centred, top 24; 480×42; 4px white inset, 21px pill radius |
| Level | horizontally centred, top 74; 24px Coiny, white with dark outline |
| Mute | right 28, top 24; 48×48 |
| Popup | viewport centre; width 520, padding 32, radius 24 |
| Actions | width 360, height 70, gap 14 |
| Camera safe area | top 112, bottom/left/right 24 (existing Task 1 camera already reserves these) |

Ownership colours come from the main manifest palette. Four hardcoded sample segments in the mock show spacing only; Task 5 computes real shares from building levels. No neutral segment. Bottom boosters/currencies excluded as approved.

## Visual proof

Screenshots under branch `ref/out/`: `hud-mock.png`, `hud-mock.compare.png`, `restart-mock.png`, `restart-mock.compare.png`.

Reproduce: `node tools/assets/capture/capture.mjs --scene hud-mock,restart-mock --compare --out docs/agent_files/feat-tower-war-port-20261022-0321/08-web-client/ref/out`.

Compared against original `ref/tw-yt/d-hud-topbar-18.jpg`: curved white undo arrow, blue outline, white capsule border, bright team fills and rounded white display lettering retained. Level text moved beneath ownership bar per R3; mute occupies right corner. Landscape positions deliberately differ from portrait. First capture exposed white square edges on stretched bar backing; added pill clipping and recaptured. Both final mock screenshots inspected. Restart panel is a style proposal from extracted art and R3 wording; no original restart screenshot exists, so L07 comparison only establishes overall palette/style. Owner final visual approval remains.

## Verification

- Test-first: three tests initially failed on missing importer/UI outputs; after implementation all 3 passed. Tests cover committed verification without extract, tampered sprite/font plus stale output and drift without writes, and shared merge preserving SP07 fragment while restoring UI output. Included in tools' normal test discovery.
- `pnpm exec tsx --test tools/test/manifest-assets.test.ts tools/test/assets-tw.test.ts`: 16 pass, 13 source-dependent skips, zero failures.
- UI check with and without source extract: 12 locked outputs verified. Reimport/lock `cmp`: identical.
- Shared manifest `--check`, targeted ESLint and `pnpm typecheck:tools`: pass.
- Capture: both named scenes + comparison images produced at 1600×900. No full CI or intermediate review (per requested end-only review).
