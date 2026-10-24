---
status: draft
summary: Two dev-only tools — an in-app level editor (edit/play/save/finalize na-* levels) and an art-override layer (manifest.art.json + showcase levels).
date: 2026-10-24
---

# Brainstorm — Level editor + art overrides

## TL;DR
Two separate projects, designed together, built separately. **(1) Level editor:** a dev-only `editor.html` page in `apps/web`. It reuses the game's renderer and runtime. You drag buildings and obstacles from a library, edit them in forms, Play in place without saving, Save (fast checks), check Solvable? (bot proxy), and Finalize (locks plus version bumps). Custom `na-*` levels appear in a separate, always-unlocked list below the campaign. **(2) Art overrides:** your own art lives in `apps/web/assets/art/` and is declared in `manifest.art.json`. `pnpm assets:manifest` merges that file into `manifest.json` after the TW fragment. Two playable showcase levels (green and snow) show every art piece. An "art:status" command lists art that is still original.

## Problem
- **Levels:** new levels are authored by hand-editing JSON (copy a levelview, fix `requires`, lock, bump versions, validate), with no visual feedback until you play. `docs/FUTURES.md` lists an editor as a deferred product decision; this brief makes that decision.
- **Art:** the importer owns `models/tw/`, `textures/tw/`, `fx/`, and `manifest.json`'s `visuals`/`themes`/`fx` (`mergeManifest` in `tools/src/assets-tw/manifest-fragment.ts` replaces them whole from `manifest.tw.json`). Any hand-swapped file fails the hash lock (`tools/src/manifest-assets.ts`), any hand-edited visual fails the merge check, and re-running the importer overwrites it. There is no legal way to replace art. The current art is Vaveda's and must be replaced before anything goes public.
- **User:** the repo owner, authoring levels and art locally. Not players.

## Decision log

### Level editor
| Decision | Alternative rejected | Why |
|---|---|---|
| Build our own editor | Tiled/LDtk plus a converter | Generic editors are 2D, can't run our rules (live validation, line-of-sight, solvability), have no Play, and still need a converter |
| `apps/web/editor.html` reusing the game renderer and runtime, with a Vite dev middleware for fs ops | Standalone app under `tools/` (like `assets:validate`) | Play must use the exact game runtime (no drift); avoids duplicated wiring |
| Dev-only (DEV / test-hooks gated, kept out of the prod rollup like the `parity` entry) | Public tool | Private repo, no public deploy |
| v1 = layout + player/AI settings + Play | Layout-only; AI settings without Play | Fast tweak-play loop is the point |
| Start from blank, copy of any level, or reopen `na-*` | Copy only | All needed; `levelview-*` always forces save-as-copy |
| Play runs in-editor from the in-memory level (no save); Esc returns with edits intact | Save, then open the game in a new tab | Faster loop |
| Edit in game camera view, plus editor-only zoom/pan | Top-down ortho edit view | Owner prefers seeing the real look; zoom/pan fixes small targets on big maps |
| Drag-and-drop library: `house-wt1`, `house-wt2`, `tower`, obstacle small/big; set owner/level after drop | Pre-coloured variants per owner | Fewer items; owner is one click |
| Form fields for building/obstacle props, including per-building `params` overrides | Raw JSON box; none | Owner doesn't want to see JSON; forms are cheap |
| Multi-select move, copy/paste, mirror tool, grid snap, auto-fit bounds, line-of-sight preview, undo/redo all in v1 | Defer some | Each is small; owner wants them all |
| Deleting a building used by a bot script removes that script, shown in a top banner ("AI 2 script removed") | Block the delete; keep a broken script | Broken script refs are a validation error that would block Save; the AI still plays without a script |
| Save = write `packages/content/data/levels/na-<id>.json` + fast checks (schema, bounds, overlaps, recomputed `requires`, canonical key order) | Run the bot check on save | Bot proxy check is slow |
| Separate **Solvable?** button runs the proxy-bot check server-side | Automatic on save | Owner can also play-test manually |
| Separate **Finalize** button: `content:lock`, `levels:lock`, `contentVersion` bump, `BOT_VERSION` bump when AI seats changed | Bump on every save | Avoids version churn |
| Tools never `git commit`; the owner commits | Auto-commit on Finalize | Owner control |
| Custom levels in a separate list (e.g. `campaigns/custom.json`), shown below the 20 campaign levels, always unlocked | Add to the Common campaign | Keeps the 20-level tests and campaign intact |
| Dev-only **Edit** button on the main page (and per level card) opens the editor | URL-only access | Owner request |

### Art overrides
| Decision | Alternative rejected | Why |
|---|---|---|
| `apps/web/assets/art/` folder that the importer and hash lock ignore | Edit files in place under `models/tw/` etc. | In-place edits fail the lock and get overwritten |
| `manifest.art.json` merged by `pnpm assets:manifest` **after** the TW fragment into the single `manifest.json` | Browser-side merge at load | One source for the game and the checks; mirrors the existing TW fragment pattern |
| Field-level overrides (e.g. only the model, or only the blue skin) | Whole-visual replace only | Smallest useful swap |
| v1 scope: models, team skins, theme ground/sky/obstacles (per theme, independently), fx, audio | Include UI images (`assets/ui/*.png`) | UI is fine as-is; it has its own pipeline |
| Replace existing visuals only | Add new building/unit types | New types are a content change, not art |
| Team colour: existing 5-skin swap **or** new 1-skin + tint mask | 5-skin only | One image instead of five; small renderer change (first cut if needed) |
| Game-compat checks still apply to art files: triangle budgets (unit 1100, building 1200, obstacle 300, ground 500), PNG ≤256px, stage nodes `stage0..2`, clips `Run`/`Death` | No checks on owner art | Broken names silently break upgrades/animations |
| CREDITS.md check becomes a **warning** for all assets, not an error | Keep it mandatory | Owner's own art needs no credit |
| No preview page; instead two playable **showcase levels** (green, snow) in the custom list: all 3 building types at low/mid/high level (every stage), human + 3 AIs + neutral gray (all colours), small and big obstacles; units, projectiles and fx appear in play | Turntable preview page | Seeing art in a real playable level is what matters |
| Reload the page to see changes | Live hot-swap | Much simpler |
| Override pointing at a key/node the importer no longer has → **fail loudly** | Silently drop with a warning | No silent art regressions |
| `art:status` command lists visuals still using original TW art | None | To-do list before going public |

## Design

### Level editor (project 01)
| Part | Does | Depends on |
|---|---|---|
| `editor.html` + `src/editor/` (Preact) | Library panel, property forms, toolbar (New/Open/Copy, Save, Solvable?, Finalize, Play), top banner, undo/redo stack over an immutable level doc | `@node-arena/content` browser fns |
| Edit viewport | `createWorldRenderer` on the game camera, plus zoom/pan; ground-plane raycast for drag (reuse the `groundAt` math from `input/index.ts`); pick meshes for buildings, plus new pick boxes for obstacles; z is mirrored (world z = −data z) | renderer |
| Live preview state | On each structural edit: `loadLevel` → `compileLevel` → `sim.create(compiled, seed)` → `world.setLevel` + `update(view)` for colours, labels and stages; line-of-sight via `canDraw`/`explainDraw` | sim |
| Play mode | Mounts the game's real `createRuntime` with the in-memory compiled level; Esc tears it down and returns | `app/runtime.ts` |
| Dev middleware (Vite plugin, dev-only) | `GET` level list/file; `POST save` (write JSON, `JSON.stringify(…,2)+"\n"`, canonical key order); `POST solvable` (`tools/src/levels.ts` proxy check, async); `POST finalize` (locks + version bumps) | tools, fs |
| Custom list | `campaigns/custom.json` (or equivalent), loaded by the app and shown below the campaign, always unlocked; excluded from the 20-level assertions | content loader, level-select UI |

**Failure:** Save errors show inline per item and nothing is written. A failed Solvable? or Finalize shows the CLI output in a panel. **Verification:** round-trip tests (load → edit → save is byte-identical when nothing changed), coordinate mirror and yaw tests, an e2e test that places, saves, plays and reloads, and a test that Play uses the shared runtime.

### Art overrides (project 02)
| Part | Does |
|---|---|
| `assets/art/` + `manifest.art.json` | Owner files and field-level overrides keyed like `manifest.tw.json` |
| `mergeManifest` extension | base ← TW fragment ← art fragment; the merge check accepts the three-way merge |
| `check:manifest` changes | Exempt `art/` from the hash lock; run budget/node/clip/PNG checks on art files; fail on overrides whose target key or node is gone; credits become a warning |
| Tint-mask team mode | New `team.mode` (e.g. `tintMask`): one base PNG plus a mask; the renderer tints by the palette colour |
| Showcase levels | `na-showcase-green`, `na-showcase-snow` in the custom list (depends on project 01's custom list; if 02 ships first, it adds the list itself) |
| `art:status` | Lists every visual/theme/fx field still served from `models/tw`, `textures/tw` or `fx` |

**Verification:** unit tests for the merge order and the check exemptions; a fixture override (a replacement GLB and texture) passes all checks; a broken-name fixture fails loudly; a tint-mask render test; showcase levels pass `validate:content`.

## Non-goals
- Bot script editing
- Campaign ordering
- UI images
- New building or unit types
- Live art hot-swap
- Any public or production build of either tool
- Git commits from tools
- Licensing enforcement beyond the warning

## Open risks
| Risk | Cheapest test |
|---|---|
| Play in the editor diverges from the real game | Play must call the same `createRuntime`; e2e: same seed gives the same hash in the editor and the game |
| Full `setLevel` rebuild per edit feels laggy on big maps | Time a rebuild on the largest levelview; add incremental updates only if over ~50 ms |
| Mirror/yaw/fx3 rounding breaks round-trips | Round-trip test over all 20 levels |
| Finalize version bumps conflict with concurrent branches | Finalize prints the diff; the owner commits |
| Owner art often trips node/clip-name rules | Clear error text naming the missing node; a Blender export note in `CONTENT_GUIDE` |
| Custom list or showcase levels trip the 20-level tests or `validate:levels` | Run `pnpm test` and `validate:levels` with one `na-*` level early |
| Tint-mask renderer change regresses existing skins | Keep `textureSwap` default; screenshot-diff via `campaign:verify` |
