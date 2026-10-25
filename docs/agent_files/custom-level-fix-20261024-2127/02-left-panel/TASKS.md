---
status: draft
summary: 9 tasks, model ops and label helpers first, then thumbnails, the three panel sections, panel wiring with legacy removal, and a final e2e plus screenshot verification.
date: 2026-10-24
---
# Tasks: Editor left panel sections (Level / Library / Selection)
Source of truth: docs/agent_files/custom-level-fix-20261024-2127/02-left-panel/PRD.md. Replaces SP01's temporary LegacyPanel with three collapsible sections. Runs after SP01 (shared EditorContext, one-per-line DocOp union, data-ready hook, primary button class) and before SP03. No open questions remain in the PRD.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Model: level-properties owner nulling, delete-many, partial property ops | - | done |
| 2 | Model: mirror removal | 1 | done |
| 3 | Label and player helpers, banner text | 1 | done |
| 4 | Library thumbnails module | - | done |
| 5 | LeftPanel shell and Level section | 3 | done |
| 6 | Library section | 4, 5 | done |
| 7 | Selection section | 1, 3, 5 | done |
| 8 | Wire panel, delete legacy sidebar, update e2e specs | 2, 6, 7 | done |
| 9 | Final verification: e2e and screenshot comparison | 8 | done |

## Task 1 — Model: level-properties owner nulling, delete-many, partial property ops
What it is / what it means: Decisions 3, 5, 8 and the Model ops section. The reducer must guarantee one undo step and never leave invalid owners.
What changes at a high level: `level-properties` sets any building owner missing from the new player ids to null in the same pass. `building-properties` and `obstacle-properties` take partial values (absent key untouched, present-undefined clears). Add a `delete-many` op that folds the single-delete script-stripping over every target, returning the same doc on no-op. `ctx.deleteSelection` switches to `delete-many`. Unit tests added in the same commit.
Done when: unit tests cover owner nulling plus undo restoring owners, delete-many (scripts stripped, one undo, absent ids no-op), and partial properties leaving other fields intact; typecheck and unit suite green.

## Task 2 — Model: mirror removal
What it is / what it means: R5 mirror removal. Mirror is dropped from the product; move-selection must survive.
What changes at a high level: remove the `mirror` DocOp and split its shared reducer branch so `move-selection` keeps working. Delete the four mirror unit cases and the mirror half of the combined test, keeping the move-selection and undo half. The `auto-fit` op and its test are left alone (Decision 12).
Done when: no `mirror` references remain in model or unit tests; move-selection and undo tests pass; `auto-fit` untouched.

## Task 3 — Label and player helpers, banner text
What it is / what it means: R2 labels, R4 label rule, Decisions 1, 2, 7. Pure functions used by all sections.
What changes at a high level: add a labels module with `playerLabel` (Human / AI{index}, derived from position so ids stay stable), `itemLabels` (Owner noun n, per owner-and-noun counting in doc order, obstacle variants counted separately), and helpers for lowest-unused `pN` id (N at least 2) and first unused palette color. `scriptRemovalMessages` switches to `AI{index} script removed` via `playerLabel`. Update the related unit test expectations.
Done when: unit tests cover renumbering after deleting an AI, relabeling after an owner change, obstacle numbering, id and color helpers; banner text test updated.

## Task 4 — Library thumbnails module
What it is / what it means: R3 thumbnails and Decision 9. Real game art rendered once, cached in memory.
What changes at a high level: a thumbnails module with a memoized async `getThumbnails` returning data URLs for the five library items. One offscreen host, one scene, sequential per-item levels with a neutral building (obstacles get a helper house, framing tried in implementation), disposed when finished so at most two WebGL contexts coexist. Any failure resolves to a missing entry so the UI falls back to a text tile.
Done when: calling it in the browser yields five data URLs without leaving a lingering context; failure path returns a fallback signal; a smoke check or unit test covers memoization and fallback.

## Task 5 — LeftPanel shell and Level section
What it is / what it means: R1 and R2, Decisions 1, 2, 4. The first usable section and the container for the others.
What changes at a high level: new LeftPanel with three collapsible sections (default open, Coiny headings, internal scroll). Level section: name, theme, time limit, boxless player cards (Human color only; AI color, action delay min 50, behavior), collapsed chip and swatch, Add AI (disabled at 3), Delete AI with confirm showing owned-building count (disabled for the last AI), all staged in a local draft. Green Apply dispatches one `level-properties` op; disabled when unchanged or colors duplicate (inline note).
Done when: unit/component checks plus a focused e2e show add, delete with count, last-AI disabled, duplicate-color block, and one Apply producing one undo step.

## Task 6 — Library section
What it is / what it means: R3 and Decision 10. Drag-to-place tiles with real art.
What changes at a high level: five tiles in the specified order, each a button named `Place {item}` with a friendly label under it, neutral color, `touch-action:none`, primary-button pointerdown calling `viewport.beginPlacement`. Thumbnails load after first manifest load without blocking panel render; img when ready, text tile otherwise.
Done when: e2e drag from a tile places the item, tiles show img (or text fallback), and existing `Place {item}` selectors still resolve.

## Task 7 — Selection section
What it is / what it means: R4, Decisions 5, 6, 11. Friendly-label dropdown and per-group Apply forms.
What changes at a high level: dropdown (`Selected item`) with Nothing selected, all labelled items, Multi-select, synced both ways through `ctx.selection` and `ctx.select`. Single building shows collapsed groups Owner and level, Parameters, Line of sight (preview only via `viewport.setLos`, no history, `los-status` inside); obstacle shows Shape (always snapping yaw). Each group has its own green Apply sending only its fields, keyed by its own draft. Copy, Paste, Delete below. Multi mode (2 or more, or chosen with none) shows count, Select all, Clear, Copy, Paste, Delete; flag clears at exactly one selected.
Done when: e2e verifies dropdown and canvas click sync, each group Apply changes only its fields, LOS sets `.editor-los`, multi-select actions, and one Undo reverts a multi-delete.

## Task 8 — Wire panel, delete legacy sidebar, update e2e specs
What it is / what it means: R5 removals and the Acceptance specs list. Swap SP01's LegacyPanel for the new LeftPanel and retire dead controls.
What changes at a high level: mount LeftPanel in the shell slot; delete LegacyPanel and the old Properties form code; remove mirror, auto-fit button and readout, pointer and status lines, LOS sidebar block, old Selected-item select, Delete selected, help text, and grid-snap control. Update specs: forms, layout, solvable, finalize, play, model, and z-custom-create for new labels (`p2` shown as AI1), opened groups, banner text, Delete naming, and Level section interactions.
Done when: DOM has no mirror, auto-fit, pointer-readout text; typecheck, lint, unit, and all touched e2e specs are green.

## Task 9 — Final verification: e2e and screenshot comparison
What it is / what it means: Acceptance Criteria closing gate.
What changes at a high level: run the full e2e suite, review any gaps against the Acceptance list, and capture Level, Library, and Selection panel screenshots to compare against the Canva references in the branch `ref/` folder, iterating on styling until they match. Confirm green Apply buttons use the SP01 primary class.
Done when: `pnpm typecheck`, `pnpm lint`, unit tests and `pnpm test:web:e2e` are green and screenshots match the references within tolerance.
