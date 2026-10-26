---
status: done
summary: Ten tasks - live-edit/undo foundation, live Level and Selection panels, player-house validation, toolbar and thumbnails, menu Create handoff, row rendering, row authoring, double-click place, verification.
date: 2026-10-26
---
# Tasks: SP06 Editor amendments
Source of truth: `docs/agent_files/feat-editor-chrome-polish-20261026-1553/06-editor-amendments/PRD.md`. Nine owner amendments on top of SP01-05; no content/schema/rules change. Prerequisite: the whole-branch review fixes (Editor.tsx confirm flow, `useInitialLoad` copyHint, `StartScreen`, `CreateDialog`, proxy error surfacing) must have landed; coding agents read current files, not SP03 text. No task depends on another SP06 task for that prerequisite.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Live-edit foundation (useLiveField, undo merge) | review fixes | done |
| 2 | Live Level section and Add AI | 1 | done |
| 3 | Live Selection section and hidden params | 1 | done |
| 4 | Player-house validation in Check/Finalize | review fixes | done |
| 5 | Toolbar (Save, icon Play, Share) and grey thumbnails | review fixes | done |
| 6 | Game-menu Create handoff | 1 | done |
| 7 | Multi-tile row rendering | review fixes | done |
| 8 | Row library items and selection panel | 3, 7 | done |
| 9 | Double-click place at centre | 8 | done |
| 10 | Verification and screenshots | 1-9 | done |

## Execution staging
Tasks 2 and 3 (disjoint section files), 4, 5 and 7 touch disjoint areas and may run two at a time. `model.ts` is touched by 1, 2, 8, 9 and `Editor.tsx` by 1, 6, 9: those run in dependency order, never concurrently. `style.css` edits in 5 and 8 must not overlap. Task 3 removes the Shape Apply; Task 8 then replaces the shape fields for rows.

## Task 1 — Live-edit foundation
What it is / what it means: Shared mechanism that lets every control commit instantly yet keep clean undo (R3, R4, D5, D6).
What changes at a high level: Add a `useLiveField` hook (local text, per-field validator, 400 ms debounce, flush on blur/Enter/unmount/selection change, inline error with `aria-invalid`, no commit while invalid). Extend `edit` actions and `historyReducer` with an optional `merge` key (`"<itemId>:<field>"`) so consecutive same-key commits replace `present` without pushing `past`; keys are UI-only and never persisted. Selects, buttons and booleans commit as single steps. Add vitest for merge, burst boundary on blur and invalid-not-committed.
Done when: reducer and hook tests pass; autosave/dirty behaviour unchanged; typecheck and lint pass.

## Task 2 — Live Level section and Add AI
What it is / what it means: Level properties and players edit live; Add AI also claims a neutral house (R2, R3, R5, D7).
What changes at a high level: Remove the draft, `canApply`/`draftChanged` and the Apply button from `LevelSection`; name, theme, time limit, player colour/delay/behavior, Delete AI dispatch immediately through `level-properties` after validation (empty name, duplicate colours, delay below `MIN_DELAY` or non-integer, out-of-range numbers rejected inline). Add the `add-ai {player, ownBuilding}` op: the component picks a random neutral drawsLines building with `Math.random` and passes it in; none eligible means no recolour; one undo step. Field ids/testids stay.
Done when: Snow changes the map at once and one Ctrl+Z reverts it; a multi-keystroke name edit is one undo entry; Add AI plus recolour undoes in one step.

## Task 3 — Live Selection section and hidden params
What it is / what it means: Selection panel has no Apply buttons, and three tuning knobs disappear (R2, R3, R4, R8).
What changes at a high level: Owner/level, building Parameters and obstacle Shape controls commit live via `useLiveField` with merge keys. Add `HIDDEN_PARAMS` (`level.maxLevel`, `grows.growTime`, `spawns.lineSpawnPenalty`) in `labels.ts`, filtered in `ParamsGroup`; existing overrides stay in the doc and `building-properties` must not drop them.
Done when: no Apply button remains in `editor/*.tsx`; the three params are absent from the panel; a level with a `growTime` override saves it unchanged.

## Task 4 — Player-house validation in Check/Finalize
What it is / what it means: A player owning no house fails Check and Finalize but not Save (R6, D2, D3, D4).
What changes at a high level: Add `assertPlayersHaveHouses` in `editor-validation.ts` (eligible = archetype has `drawsLines`; towers excluded) throwing `ContentLoadError` with one issue per player (`<playerLabel> has no starting house`), called only from `prepareEditorProxy`. Existing error surfacing shows it. Add unit tests incl. the Save-unaffected case.
Done when: 2 houses plus tower plus extra AI: Save succeeds, Check shows `AI3 has no starting house`, Finalize fails at validate.

## Task 5 — Toolbar and grey thumbnails
What it is / what it means: Bar hierarchy and neutral library art (R7, R9, D12).
What changes at a high level: `TopBar` adds blue Save (`ed-btn-primary`, `save('manual')`) and Play as an icon button (`aria-label="Play"`, tooltip); the Share trigger becomes neutral `ed-btn` with an inline share icon, still last, panel contents unchanged. In `thumbnails.ts` set house/tower owner to none so they render `NEUTRAL_TEAM` grey; confirm the gray art exists in the manifest.
Done when: bar reads Back, File, status, Save, Play icon, Share icon; house/tower thumbnails are grey; e2e selectors for Play updated.

## Task 6 — Game-menu Create handoff
What it is / what it means: Custom -> Create custom level reuses the editor Create dialog (R1, D1).
What changes at a high level: `Picker` links to `/editor.html?create=1` and drops the `templates` view/`TemplatePicker` and `?template=`. `useInitialLoad` drops the template branch and adds a `create` flag; `Editor` opens the existing `CreateDialog` as the only surface (distinct from `StartScreen`), Create goes through `replaceDoc`, closing returns to `/`. Migrate e2e specs using `?template=`.
Done when: menu Create shows the identical dialog, Create opens a new unsaved level, close returns to the game.

## Task 7 — Multi-tile row rendering
What it is / what it means: An element with a wide footprint draws N tiles in a line, in editor and game (R12, D8, D10).
What changes at a high level: Compiled `ElementInstance` carries footprint width; placement emits `N = max(1, round(w / 0.713))` tiles spaced 0.713 along local +x, centred on the element, rotated by yaw, in `element-renderer`. Elements without an override render one tile exactly as today. No schema, content version, `RULES_VERSION` or `BOT_VERSION` change.
Done when: a test element with w = 5 x 0.713 draws 5 aligned tiles at any yaw; existing levels render unchanged; `pnpm check:content --base HEAD` clean.

## Task 8 — Row library items and selection panel
What it is / what it means: Authors place and tune rows as single elements (R10, R11, D8, D9, D11).
What changes at a high level: Library shows "Small row" / "Big row"; `place` sets `variant`, `yawDeg: 0`, box footprint 5 x 0.713 by 0.713; internal ids stay. Labels `Small row N` / `Big row N`, including legacy variant elements. Row selection panel: Variant, Length (integer 1-10, w = round(L x 0.713, 3 dp), d unchanged), Rotation number plus -15/+15 via `snapYaw`, all live; raw footprint and free yaw fields removed; hand-edited larger w is not clamped in rendering.
Done when: placing yields one selectable 5-tile item; Length 3 and Rotation 45 update canvas and Play view live; delete removes the whole row; a line through it is blocked.

## Task 9 — Double-click place at centre
What it is / what it means: Fast placement without dragging (R13).
What changes at a high level: Add a pure `place-center` helper in `model.ts` (buildable-area centre snapped 0.25, occupancy test, spiral nudge in 0.25 steps) producing a `place` op; library tiles get `onDblClick`; Editor selects the new item. One undo step each; drag placement unchanged. Add unit tests for the free, occupied and repeated cases.
Done when: repeated double-click yields distinct free positions, each selected and individually undoable.

## Task 10 — Verification and screenshots
What it is / what it means: Close all acceptance criteria with evidence (Acceptance Criteria 1-11).
What changes at a high level: Update remaining e2e specs that click Apply or use `?template=`; add e2e for menu Create, live edit plus undo, Add AI, no-house failure, rows and double-click. Capture screenshots (bar, Level panel, Selection with row panel, grey library, Check error) into `06-editor-amendments/screens/`. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm check:content --base HEAD`, `pnpm test:web:e2e`.
Done when: all gates pass and screenshots are committed.
