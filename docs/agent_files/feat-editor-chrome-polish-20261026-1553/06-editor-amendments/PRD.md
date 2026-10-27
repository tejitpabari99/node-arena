---
status: done
summary: Owner amendments after SP01-05 - game-menu Create reuses the editor Create dialog, all Apply buttons removed (live edits with undo coalescing), Add AI auto-colours a neutral house, Check/Finalize fail when a player owns no house, toolbar icon/primary tweaks, three params hidden, grey house/tower thumbnails, "row" obstacles as one multi-tile element, double-click-to-place.
date: 2026-10-26
---
# PRD: SP06 Editor amendments

Repo/branch: node-arena · `feat/editor-chrome-polish` · Depends on: SP03, SP04, and the concurrent whole-branch review fixes (Editor.tsx confirm flow, `useInitialLoad` copyHint, `StartScreen`, `CreateDialog`) - read current files, not SP03 text · Owns: `ui/Picker.tsx`, `editor/{LevelSection,SelectionSection,LibrarySection,TopBar,SharePanel,labels,level-draft,model,thumbnails,useInitialLoad}`, `render/element-renderer.ts`, `tools/src/editor-solvable.ts`

## TL;DR
- Game menu Custom -> "Create custom level" opens the editor's Create dialog (`/editor.html?create=1`); Create lands in the editor.
- No Apply buttons anywhere; edits commit live, typing bursts coalesce into one undo step, invalid values show an inline error and are not committed.
- Add AI also owns a random neutral house. Check/Finalize fail if any player owns no house.
- Toolbar: blue **Save**, icon **Play**, grey **Share** (share icon) last. Three params hidden. Grey house/tower thumbnails.
- "Small/Big obstacle" become **Small/Big row**: one element, N tiles in a line, one box footprint, editable Length + Rotation. Double-click a library tile places it at map centre.

## Problem
Evidence (current files):
- `Picker.tsx:5,37-41` `templates` view -> `/editor.html?template=<id>`; differs from File -> Create (`CreateDialog.tsx`).
- `LevelSection.tsx` edits a local draft; `Apply level properties`. `SelectionSection.tsx` has `Apply parameters`, `Apply shape` and an owner/level Apply.
- `addAi` (`level-draft.ts`) adds a player owning nothing. A player with no house cannot play; nothing flags it.
- `TopBar.tsx`: plain `Play`; `SharePanel.tsx:56` Share is `ed-btn-primary`; no Save in bar.
- `LibrarySection`/`thumbnails.ts` render houses/towers in the default team colour.
- Obstacles are single 0.713x0.713 tiles (`obstacle.json`); walls need many placements.

Owner questions answered (`labels.ts`, `GAME_RULES.md`):
- **Max level (`level.maxLevel`)**: garrison cap; arrivals above it are forwarded/lost (R-CAP-01, R-CAP-03).
- **Regrow time multiplier (`grows.growTime`)**: scales time to regain a level while a house has no lines; higher = slower (R-GRW-01).
- **Per-extra-line slowdown (`spawns.lineSpawnPenalty`)**: spawn period `1000 + penalty x (lines-1)` (R-SPN-01).
All three are tuning knobs that only confuse level authors; hidden, not removed.

## Goals / Non-Goals
Goals: the nine owner requests below, no content/schema/rules change.
Non-goals: canvas rotate handle [DEFERRED]; changing campaign loader rules; changing Save/Share panel contents; per-tile deletion; editing hidden params.

## Requirements
| # | Requirement |
|---|---|
| R1 | Picker `custom` view: "Create custom level" navigates to `/editor.html?create=1` (no `templates` view/`TemplatePicker`, no `?template=`). With `create=1` and no `?level=`, Editor shows the same `CreateDialog` (blank theme/size or copy-existing, `Create` button) as the only surface; Create calls the normal `replaceDoc` path (editor opens with the new, unsaved level). Closing the dialog returns to `/`. |
| R2 | Remove every Apply button: Level section (name, theme, time limit, player colour/delay/behavior, Add/Delete AI), Selection owner/level, building Parameters, obstacle Shape. Each control commits immediately as one edit; ids/testids for fields stay. |
| R3 | Commit validity: empty name, duplicate player colours, AI delay < `MIN_DELAY` (50) or non-integer, and out-of-range numbers are NOT committed; field shows inline error (`aria-invalid` + message) and keeps its local text. Selects/booleans commit on change. |
| R4 | Undo coalescing: text/number inputs commit on a 400 ms debounce and on blur/Enter; consecutive commits to the same field of the same item merge into one history entry. Selects, Add/Delete AI, row-length/rotation +/- buttons are one step each. Switching selection flushes pending edits. |
| R5 | Add AI is one undo step: new AI (next unused colour) plus, if any neutral eligible building exists, one chosen at random gets `owner = newAi`. None eligible -> AI added, no recolour. Delete AI unchanged (buildings -> Neutral). |
| R6 | Check and Finalize fail when any player owns no eligible building. Eligible = building whose archetype has the `drawsLines` module (houses; towers excluded). Error per player, e.g. `AI3 has no starting house` (label via `playerLabel`). Save is unaffected. |
| R7 | Bar: `Back`, `File`, spacer, status, **Save** (`ed-btn-primary`, calls `save('manual')`), Play as icon button (`aria-label="Play"`, tooltip), Share (neutral `ed-btn` + share icon, `aria-label="Share"`) last. Share panel contents unchanged. |
| R8 | Hide from the parameter panel exactly: `level.maxLevel`, `grows.growTime`, `spawns.lineSpawnPenalty`. Existing overrides stay in the doc untouched; `building-properties` ops must not drop them. |
| R9 | House and tower thumbnails render in neutral grey (`gray`, `#8C8C8C`). |
| R10 | Library lists "Small row" / "Big row" (replace obstacle items). Placing creates ONE element: `variant`, `yawDeg: 0`, `footprint: {box, w: 5 x 0.713, d: 0.713}`. Labels `Small row N` / `Big row N`. |
| R11 | Row selection panel: Variant, **Length (tiles)** integer 1-10 (w = round(L x 0.713, 3 dp), d stays 0.713), **Rotation** number + `-15` / `+15` buttons (`snapYaw`), live. Raw footprint shape/w/d and free yaw fields removed for elements with archetype-default depth; no per-tile delete (one element). |
| R12 | Renderer draws `N = max(1, round(footprint.w / 0.713))` tiles per element, spaced 0.713 along local +x, centred on the element pos, rotated with yaw, in editor and game. Elements without override render 1 tile exactly as today. |
| R13 | Double-click a library tile: place at map-bounds centre (`buildableArea` centre, snapped 0.25); if the spot is occupied/coincident, nudge to the nearest free snap point (spiral, 0.25 step); select the new item; one undo step. Single pointer-drag placement unchanged. |

## Architecture
**Menu handoff (R1).** `Picker` links `<a href="/editor.html?create=1">`. `useInitialLoad` drops the `template` branch, adds `create` flag; `Editor` opens `dialog:'create'` with no doc and no Open body (distinct from `StartScreen`). Reuses `CreateDialog` unchanged, so both entry points share one component.

**Live edits (R2-R4).** New `useLiveField` hook in `editor/`: holds local text, validates with a per-field validator, debounces `edit(op)`, flushes on blur/unmount. `LevelSection` loses its draft/`canApply`/`draftChanged`; each control dispatches a granular op. Reuse `level-properties` op for name/theme/time/players (full value, validated first). Coalescing lives in `historyReducer`: `edit` actions carry optional `merge: string` key (`"<itemId>:<field>"`); if equal to the previous entry's key and within the same burst, replace `present` without pushing `past`. Keys are UI state only; not persisted. Autosave/dirty unchanged (any edit dirties).

**Add AI (R5).** New `DocOp` `add-ai {player, ownBuilding: string|null}`; the component picks the random neutral eligible id (`Math.random`, UI only, never sim) so the reducer stays pure/replayable. `level-draft.ts` keeps pure helpers (`addAi`, `canAddAi`, `deleteAi`, `delayValid`, `duplicateColors`); `canApply`/`draftChanged` removed.

**Validation (R6).** `prepareEditorProxy` (`editor-solvable.ts:20`) is the single choke point for Check and for Finalize's `validate` step (`editor-finalize-worker.ts:19`); Save uses `validateEditorDocument` directly (`editor-ops.ts:84`) and is untouched. Add `assertPlayersHaveHouses(catalog, level)` in `editor-validation.ts`, called only from `prepareEditorProxy`. It throws `ContentLoadError` with one issue per player; existing UI error path surfaces it (SP03 "real proxy errors").

**Params (R8).** `labels.ts` gets `HIDDEN_PARAMS` set; `ParamsGroup` filters. No change to `building-properties` merge semantics.

**Thumbnails (R9).** `thumbnails.ts` `itemDoc` sets `owner` to none and relies on `NEUTRAL_TEAM='gray'` (`render/building.ts:15`); confirm the neutral building art is gray (`manifest.json` `*-gray.png`), and cache key unchanged.

**Rows (R10-R12).** No schema change: `ElementSchema` already has optional `footprint` + `variant` + `yawDeg` (`schemas.ts:133-137`); `compile.ts:106` uses `e.footprint ?? arch.footprint`; sim box footprints take yaw (`geometry.ts` `yawMilliDeg`) so a rotated 1xN box blocks lines (R-OBS-01). Compiled `ElementInstance` gains `footprintW` (milli) so `placeObstacles` emits N placements per element, offset `(k - (N-1)/2) x 0.713` along yaw direction. Mesh sizes (glb accessors): small 0.597 wide, big 0.696 wide, vs 0.713 pitch -> small gap 0.116, big 0.017; pitch = footprint base width so the visual matches the collider. Instance count grows N-fold; negligible at <=10. Library item ids: keep `obstacle-small|big` internally; only labels/default footprint change (`place` op sets footprint).

**Double-click (R13).** `onDblClick` on tile -> new `place-center` helper in `model.ts` (pure: area centre, occupancy test against building footprints / element positions, spiral search) producing a `place` op with the resolved pos; Editor then selects the new id.

**Toolbar (R7).** `TopBar` adds Save + icon Play; `SharePanel` trigger loses `ed-btn-primary`, gets inline SVG icon, moved to the last slot (already last).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Menu Create | Link to `/editor.html?create=1`, CreateDialog reused | Embed dialog in game bundle | Same component; avoids pulling editor code into game |
| D2 | Eligible building | Archetype has `drawsLines` module | Name != tower; `kind` field | Rules define kinds house/tower (GAME_RULES l.113); module test follows content, survives new archetypes |
| D3 | Check rule | Every player owns >=1 eligible | Count players <= count houses | Names the culprit; pigeonhole is implied |
| D4 | Where | `prepareEditorProxy` only | Loader/Save | Owner: campaign and Save unchanged |
| D5 | Undo | Debounce 400 ms + same-field merge key | Commit on blur only | Immediate feedback (snow changes map) yet clean history |
| D6 | Invalid input | Do not commit, inline error | Commit and let Save fail | Matches old `canApply` gating |
| D7 | Random neutral pick | Component-side `Math.random`, passed in op | Random in reducer | Reducer pure |
| D8 | Row model | One element, `footprint.w = L x 0.713` | N elements grouped | Owner decision; no schema change |
| D9 | Row length | 1-10, default 5 | Free w | Keeps integer tiles; bounded instances |
| D10 | Tile pitch | 0.713 | Mesh width | Visual = collider; gap is small |
| D11 | Rotation UI | Number + +-15 buttons | Canvas handle | Handle [DEFERRED] |
| D12 | Share button | Neutral + icon | Primary | Save is primary now |

## Manual steps
None. Existing campaign levels unaffected (no override => 1 tile). No content version/hash, `RULES_VERSION` or `BOT_VERSION` change (renderer-only; footprint overrides are existing schema); verify `pnpm check:content --base HEAD` stays clean. Update e2e specs that click Apply or `?template=` (28 refs in `apps/web/e2e`).

## Risks / Open Questions
- [RESOLVED: rows with `footprint` override change sim footprint (sim-relevant, `variant` is not) - intended for new editor levels; Finalize locks regenerate as usual.]
- [RESOLVED: Add AI random choice excludes towers; if no neutral house, no recolour.]
- [RESOLVED: Check wording per player: "`<label>` has no starting house".]
- [RESOLVED: row Length > footprint cap; editor clamps to 1-10 and ignores hand-edited larger w (renders N=round).]
- [RESOLVED: depends on in-flight review fixes in Editor.tsx/useInitialLoad/CreateDialog; SP06 tasks must start after they land.]
- [DEFERRED: canvas rotate handle; Share panel Save row dedupe now that bar has Save.]
- Risk: debounce merge could lose the "undo returns previous value" expectation if a field is blurred mid-burst; mitigated by flush-on-blur creating the boundary.
- Risk: legacy levels with 1x1 obstacles keep "Small/Big obstacle"-style labels? [RESOLVED: all variant elements label "Small/Big row N", length 1 shown as Length 1.]

## Acceptance Criteria
1. Game menu Custom -> Create custom level shows the identical Create dialog; Create opens the editor with a new level; close returns to the game.
2. `grep -ri "apply" apps/web/src/editor/*.tsx` finds no Apply button; picking Snow changes the map immediately; Ctrl+Z reverts it in one step.
3. Typing a name / action delay over several keystrokes creates one undo entry; empty name, delay 49 and duplicate colours show an inline error and leave the doc unchanged.
4. Add AI on a map with a neutral house: that house takes the new colour; one undo removes both.
5. 2 houses (human+AI) + tower, add AI: Save works; Check shows "AI3 has no starting house"; Finalize fails at validate.
6. Bar shows blue Save, icon Play, grey share-icon Share at far right.
7. Parameters panel lacks the three labels; a level with `growTime` override saves it unchanged.
8. House/tower thumbnails are grey.
9. Library shows Small row / Big row; placing yields one selectable item of 5 tiles; Length 3 and Rotation 45 update the canvas and Play view live; deleting removes the whole row; a line through it is blocked.
10. Double-click a tile places at the centre, selected; repeated double-click nudges to a free spot; one undo each.
11. `pnpm typecheck`, `pnpm test`, `pnpm check:content --base HEAD`, `pnpm test:web:e2e` pass.
