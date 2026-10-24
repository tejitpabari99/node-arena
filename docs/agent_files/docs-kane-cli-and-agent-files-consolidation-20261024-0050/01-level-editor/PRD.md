---
status: draft
summary: Dev-only apps/web/editor.html level editor (drag-drop layout, forms, in-place Play via real runtime, Save/Solvable?/Finalize through a Vite dev middleware) plus a `campaigns/custom.json` custom-level list shown below the 20 campaign levels.
date: 2026-10-24
---
# PRD: Level editor

Repo/branch: node-arena, `docs/kane-cli-and-agent-files-consolidation` · Depends on: none (sibling 02 depends on this PRD's §Custom-list contract)
Owns: `apps/web/editor.html`, `apps/web/src/editor/**`, `apps/web/vite.config.ts` (editor entry + middleware plugin), `apps/web/src/dev/editor-middleware.ts` (new), custom-list wiring in `apps/web/src/app/{boot,state}.ts` + `ui/Picker.tsx` + `ui/App.tsx` (Edit buttons), `tools/src/levels.ts` (`campaignLevels` union), `tools/src/editor-ops.ts` (new: save/finalize helpers), tests that hard-code 20 cards, `docs/LEVELS_GUIDE.md` §4/§6 + `tools/README.md` + `docs/FUTURES.md` entry
Does not own: sim/bots/rules, level schema, renderer internals (read-only reuse), art pipeline (02)

## TL;DR
Dev-only editor page: drag buildings/obstacles from a library onto the real game view, edit in forms, **Play** in place with the real `createBrowserRuntime`, **Save** writes `na-<id>.json`, **Solvable?** runs the proxy bots, **Finalize** does locks + version bumps (no git). Custom levels are listed in a new `custom` campaign below the 20, always unlocked.

## Problem
- New levels = hand-copying JSON, fixing `requires`, locking, bumping versions, with no visual feedback [verified: docs/LEVELS_GUIDE.md §4 steps 1-6].
- `docs/FUTURES.md:39` lists an editor as deferred; brief decides it.
- Owner-only tool: not players, never deployed.

## Goals
1. Author a valid `na-*` level without seeing JSON; Save output is byte-stable (`JSON.stringify(...,2)+"\n"`, canonical key order).
2. Tweak-Play loop with no save and no drift from the real game.
3. Owner gets a one-click path to a committable state (locks + bumps), never an auto-commit.
4. 20-level campaign, its tests and its locks keep working untouched.

## Non-Goals
Bot script editing (scripts only *removed* on delete); campaign ordering; new building/unit types; theme/art editing (02); prod/public build; git commits; touch UX.

## Requirements

### R1 Editor page (dev-only)
- `apps/web/editor.html` + `src/editor/` (Preact). Not in the prod rollup. Gate: Vite `configureServer`/`apply:'serve'` plus `import.meta.env.DEV`; build input added only when `VITE_TEST_HOOKS==='1'` (same pattern as `parity`) [verified: vite.config.ts rollup input].
- Start: Blank (pick theme, size preset, 2 players) / Copy of any level / Reopen `na-*`. `levelview-*` and `na-*` copies always prompt a new id; levelview can only be saved as copy. Id = `na-[a-z0-9-]{1,40}`; filename = id.
- Library (drag-drop): `house-wt1`, `house-wt2`, `tower`, obstacle small, obstacle big. Dropped item is unowned/neutral, level default from archetype; owner/level set in form.
- Forms: level (name, theme, objective fixed `captureAll`, timeLimitSec, players: colorKey, kind, bot `actionDelayMs`/`behavior`), building (owner, level, `ignoreForWin`, per-building `params` overrides), obstacle (variant, yaw, footprint). No JSON box.
- Tools: multi-select move, copy/paste, mirror, grid snap, auto-fit bounds, line-of-sight preview, undo/redo, zoom/pan (editor-only), game-camera framing.
- Delete of a building referenced by a bot script removes that player's script, top banner "AI 2 script removed" (undoable).
- Save inline errors per item; nothing written on error.

### R2 Middleware (`/__editor/*`, dev only)
| Endpoint | Does |
|---|---|
| `GET levels` / `GET level/:id` | list `data/levels/*.json`; read one |
| `POST save` | validate, canonicalize, write `data/levels/na-<id>.json`, upsert `data/campaigns/custom.json` entry |
| `POST solvable` | proxy check for one level (`validateLevel` from `tools/src/levels.ts`), streamed result, one job at a time |
| `POST finalize` | lock + bump sequence (R5), returns diff summary + CLI output |
| `DELETE level/:id` | (v1.1) remove level + custom entry; refuses non-`na-` |
- Security: bind `127.0.0.1` explicitly (`server.host`); reject requests whose `Host` is not localhost/127.0.0.1 (DNS rebinding) and any POST lacking `X-NA-Editor: 1` + same `Origin`; id must match `^na-[a-z0-9-]{1,40}$`, path built from id only (never from client path), resolved path must stay inside `data/levels`; refuse overwrite of non-`na-` files; body cap 1 MB; child processes via `execFile` with fixed argv, no shell; the plugin is not registered outside `serve`.

### R3 Edit viewport
- Reuse `createLevelScene` with a `SimView` from `sim.create(compiled, seed)`; owner colour/labels/stages are only updated through `update(frame)` so every structural edit needs a rebuild [verified: render/world.ts setLevel rebuilds all].
- Pointer→ground: reuse `groundAt` math (plane intersect then `inverse` of `worldRoot` matrix, i.e. data z = −world z) [verified: input/index.ts:45-50]; copy the ~6 lines into the editor rather than refactoring the sim-coupled gesture machine.
- Picking: buildings via `world.pickMeshes`; obstacles (no meshes) via nearest-footprint ground hit (editor-side, no renderer change). Marquee select on empty ground.
- Coordinates are 2-decimal, written as-is (`pos.x/z`, `yawDeg`); editor stores level doc as the JSON shape; round to 0.01 on write to stay round-trip stable.

### R4 Play
- Editor mounts the real app controller (`createAppController` + `createBrowserRuntime` + real input) as a full-screen overlay with **options.files = shipped files + working copy overlaid as `data/levels/na-<id>.json` + a synthetic `data/campaigns/custom.json` containing it**, `campaignId:'custom'`, and an in-memory `SaveStore` (existing `options.save` seam [verified: state.ts:24]). No injection API, no new code path: identical load/compile/validate as shipping.
- Pause menu (d2d674b) intercepts Esc; "Levels" (screen→`picker`) is the exit: editor listens to controller and tears down on `picker`. Plus an editor-bar "Back to editor" button. Edits intact (doc lives in editor state).
- Cost: one `loadContent` of all files per Play; fallback if slow = cache catalog and compile only the draft (see [OPEN]).

### R5 Finalize
Sequence (each step's output shown; abort on first failure): `validate` level → bump `contentVersion` patch in `packages/content/content.json` → bump `BOT_VERSION` when the bots hash map in `hashes.lock.json` changes (any new/changed `na-*` level with AI seats) → `content:lock` → `levels:lock` → run `validate:content --base HEAD` + `check:content --base HEAD` as verification → print `git diff --stat`. Never commits. Version bumps are skipped if already bumped vs HEAD (idempotent).

### R6 Custom list contract (shared with 02)
| Item | Contract |
|---|---|
| File | `packages/content/data/campaigns/custom.json`, campaign schema, `id:"custom"`, `entries:[{level,position}]` (position ≥1, unique within file; schema requires `minItems:1` [verified: schemas.ts CampaignSchema]) |
| Existence | File absent = no custom levels. Editor/02 create it on first entry; removing last entry deletes file. No schema change |
| Level files | `data/levels/na-*.json`, listed in `custom.json` only (never in `common.json`; legacy guide step that adds `na-` to common is superseded) |
| Loader | `loadContent` already ingests any `data/campaigns/*.json` and checks refs; web boot glob already picks it up [verified: catalog.ts DIR_SCHEMA, boot.ts glob] |
| App state | `AppSnapshot` gains `customLevels: CampaignLevel[]` built from `catalog.campaigns.custom` sorted by position; `levels` stays the Common list (so `next()`, unlock chain, `number=position-3` unchanged) |
| Unlock | custom levels always unlocked; `isLevelUnlocked` early-returns true for ids in `customLevels`; completion recorded in save as usual (no gating effect) |
| UI | Picker: 20-card campaign grid unchanged; below it a section "Custom levels" with `.level-grid.custom` cards labelled by level `name`; absent section when empty. Campaign grid gets a stable selector (`.level-grid.campaign`) |
| Next/Result | `next()` on custom level goes to next custom entry, last → no `hasNext` |
| Tools | `campaignLevels(data)` keeps returning exactly Common (tests still assert 20) but its integrity check becomes `files == Common ∪ custom entries`; new `customLevels(data)`. `validate:levels --levels all` = Common + custom; `levels:lock` writes `na-*` entries into `tools/levels-lock.json`; `unsolved-by-proxy.json` allowed for na-* ids |
| Hash lock | custom levels ARE in content hash lock / `contentVersion` guard (`generateHashes` iterates all `compiled` [verified: versioning.ts:24-31]); any new/changed na-* needs a version bump → Finalize |
| Tests | 20-card assertions switch to `.level-grid.campaign .level-card`; add custom-section tests |
| Hand-off to 02 | 02 adds `na-showcase-green/snow` via the same file and same rules; if 02 lands first it creates `custom.json` + the UI/tool changes above itself (identical contract) |

## Architecture
```
editor.html → editor/ (Preact: Library, Forms, Toolbar, Banner) ── undo stack over LevelDoc
   │ structural edit → loadLevel → compileLevel → sim.create → scene.setLevel + update(view)
   ├─ line-of-sight: sim.canDraw/explainDraw on the preview sim
   ├─ Play: createAppController(files+draft overlay, mem save) + createBrowserRuntime (real)
   └─ fetch /__editor/* ──► Vite plugin (serve only) ──► fs + tools/src/{levels,editor-ops}.ts
```
- **Doc model:** `LevelDoc` = level JSON shape (`NextLevel`). Edits are pure reducer ops `Op → LevelDoc`; undo/redo = bounded stack (100) of snapshots (docs are small, structural sharing). Drag coalesces to one entry on drop. Delete-with-script removal is one compound undo step.
- **Preview rebuild:** full `setLevel` on drop/form commit; during drag move a lightweight ghost (translucent disc/box) and rebuild once on release. Incremental update only if rebuild exceeds ~50 ms on the largest levelview.
- **requires:** recomputed with `computeRequires` on every save; `id` always = filename; `source` omitted for new levels, dropped on copy.
- **Mirror:** reflect about a user-chosen axis (default: vertical centre line of bounds, x→cx−(x−cx); horizontal option for z). Reflect pos; yaw reflect (`yaw'=180−yaw` for x-axis, `−yaw` for z-axis, normalised); owners kept by default with an opt-in "swap p1↔p2 owners" checkbox (two-player symmetry). Applies to selection or whole level.
- **Auto-fit bounds:** `boundsFromPositions` + margin, preview only until Save writes it [verified: bounds.ts exports].
- **Save fast checks:** `validateLevel` errors block (OOB, coincident, unknown refs, level>max, script refs); footprint-overlap/elements-OOB warnings shown, not blocking.

## Phases (guidance, not tasks)
| Phase | Scope |
|---|---|
| P0 | Custom-list contract: `custom.json` loader/UI/Edit-button stub, `campaignLevels` union, test selector change, one hand-made `na-*` proving `test`, `validate:levels`, `validate:content` stay green (also unblocks 02) |
| P1 | Viewer + Save: editor.html, middleware (list/read/save), open/copy/new, canonical write, round-trip test over all 20 levels |
| P2 | Editing: library drag-drop, forms, select/move/copy/paste/mirror/snap/auto-fit/LOS, undo/redo, banner |
| P3 | Play overlay, Solvable?, Finalize, Edit buttons, docs |

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Play loading | Overlay working copy into `files`, run normal controller | Add `startCompiled(level)` injection API | Zero new code path; same validation; `options.files`/`save` seams already exist; injection would touch unlock/save/next |
| D2 | Draft id in Play | Real `na-<id>` (id chosen at New/Copy) | Fake `editor-draft` id | Same sim hash as shipped → parity test meaningful |
| D3 | Custom list storage | `campaigns/custom.json` (campaign schema) | New schema/folder; entries in `common.json` | No schema change; loader/refs check free; keeps `common` = 20 |
| D4 | Custom in hash/level locks | Included | Exclude from content lock | Excluding means editing `generateHashes`; inclusion keeps one rule and Finalize already bumps |
| D5 | `campaignLevels` | Common-only return, union integrity check | Return all levels | 20-level test + `levels:lock` consumers keep semantics |
| D6 | Obstacle picking | Editor-side nearest-footprint on ground hit | Add pick meshes to renderer | No render-unit changes (07 owned) |
| D7 | Mirror | Axis reflect, yaw reflect, optional owner swap | Always swap owners | Layout symmetry vs ownership are separate intents |
| D8 | Undo | Immutable snapshot stack over doc | Command/inverse ops | Simple, small docs, compound ops free |
| D9 | Esc in Play | Pause menu → Levels, plus editor button | Esc exits directly | d2d674b made Esc the pause toggle; don't fork runtime behaviour |
| D10 | Edit coordinates | Copy `groundAt` math | Extract from input/index.ts | Input module is gesture-coupled; avoid regression risk |
| D11 | Security | localhost bind + Host/Origin/header checks + id regex | Open dev server | Writes files and spawns processes |

## Manual steps
- Owner reviews `git diff` after Finalize and commits (tools never commit).
- Owner plays and signs off solvability; proxy is evidence only (tools/README).
- Owner-only art/credits: none here.

## Risks
| Risk | Mitigation |
|---|---|
| Hard-coded 20-card/20-level tests break (`tools/test/levels.test.ts:18-20`, e2e boot/app-flow/acceptance, `test/sp08/state-v2.test.ts`) | P0 first; scoped selectors; `campaignLevels` stays Common |
| `validate:content` fails after any na-* edit until Finalize | Edit/Save docs; Finalize idempotent; banner "unfinalized changes" via `validate:content` dry-run |
| Finalize bump conflicts across branches | Prints diff, no commit |
| Rebuild latency while editing | ghost drag + measure; incremental only if >50 ms |
| Round-trip drift (2-decimal, yaw, key order) | byte-identical test over all 20 levels |
| Importer/guide still tell people to put `na-` in common.json | update LEVELS_GUIDE §4; importer keeps tolerating |
| Dev middleware abuse | R2 security list; plugin absent from build |

## Open Questions
1. [RESOLVED: yes — docs/CONTENT_GUIDE.md "Verified: adding a second level ... needs a contentVersion bump and a BOT_VERSION bump" and BOT_VERSION rule "including adding or removing an AI seat via a new level"; Finalize bumps BOT_VERSION whenever the bots lock map changes, not only when seat count changes] Does `checkBotVersion` demand a `BOT_VERSION` bump when a *new* level adds `botHash` entries only (not changing existing)? Finalize must call it rather than guess; verify with one trial level in P0.
2. [OPEN] `levels:lock` rewrites the whole lock (slow: 20 levels × proxies). Add `--levels <id>` merge mode, or accept full run? Measure in P0.
3. [OPEN] Play cost of full `loadContent` per press; fall back to cached catalog + single-level compile if >~1 s.
4. [OPEN] Grid snap default (0.5? 0.25?) and whether snapping applies to yaw; owner preference.
5. [OPEN] `custom.json` entry `position` for new levels: auto = max+1; does anything outside Picker order read it (`number = position−3` is Common-only)?
6. [OPEN] `levels:lock` position arg for custom levels (used for reporting only [verified: validateLevel `position`]); confirm no gating.
7. [RESOLVED: D9] Esc vs pause menu.
8. [DEFERRED] Bot script editing, level delete UI beyond P3, campaign reorder, live-hot-reload of external file edits.

## Acceptance Criteria
- `/editor.html` works under `pnpm dev`; 404 / absent in `pnpm build` output; middleware refuses non-localhost Host, missing header, ids not matching regex, and `levelview-*` writes.
- Open each of the 20 levels, Save-as-copy with no edits: output equals source modulo id/`source` (round-trip test), canonical key order.
- Place/move/delete/mirror/copy-paste/undo/redo each covered by unit tests on the reducer; mirror coordinate + yaw tests.
- Deleting a scripted building removes the script and shows the banner; Save then passes.
- e2e: new level → place buildings → Save → Play (real runtime, win/lose result shown, save store not polluted) → back → reload → level in custom section, always unlocked.
- Same seed in editor Play vs main-game start of the same level yields equal state hash.
- With one `na-*` level present: `pnpm test`, `validate:levels`, `check:content --base HEAD`, `validate:content --base HEAD` green after Finalize; campaign still shows exactly 20 cards in `.level-grid.campaign`.
- Dev-only Edit button on main page and each card; absent in production build.
- 02 can add `na-showcase-*` using only §R6 with no further tool changes.
