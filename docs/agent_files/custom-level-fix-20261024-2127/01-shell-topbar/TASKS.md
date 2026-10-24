---
status: done
summary: 9 tasks, DocOp reformat first, then lifted EditorContext, shell/theme, save model + top bar chip, Check/Finalize popovers, File modal, autosave, toasts, verification.
date: 2026-10-24
---
# Tasks: Editor shell, top bar, File modal, theme, autosave
Source of truth: docs/agent_files/custom-level-fix-20261024-2127/01-shell-topbar/PRD.md. Replaces the centered dark page and start screen with a full-viewport Canva-style shell and lifts shared state into one EditorContext for SP02/SP03. Each task keeps the repo e2e green by updating the affected specs in the same commit; temporary legacy UI is removed by the task that replaces it.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Mechanical DocOp reformat | - | done |
| 2 | Lift EditorContext, LegacyPanel, canvas-only Viewport | 1 | done |
| 3 | Shell layout, theme tokens, root data attrs | 2 | done |
| 4 | Dirty/saved model and top bar with save chip | 3 | done |
| 5 | Check and Finalize popovers | 4 | done |
| 6 | File modal and URL flows | 4 | done |
| 7 | Autosave and beforeunload | 4, 5 | done |
| 8 | Toasts for banner and misc errors | 4 | done |
| 9 | Visual and e2e verification | 5, 6, 7, 8 | done |

## Task 1 — Mechanical DocOp reformat
What it is / what it means: R11(a), the first SP01 commit. SP02 then SP03 build on it sequentially, so the shared union must be diff-friendly.
What changes at a high level: the `DocOp` union in the editor `model.ts` is reformatted to one member per line. No behavior, type or export change.
Done when: the diff is whitespace/line-break only; typecheck, lint and the existing editor e2e pass unchanged.

## Task 2 — Lift EditorContext, LegacyPanel, canvas-only Viewport
What it is / what it means: Decisions 1-4, R10, R11(b)-(e). Selection, clipboard and viewport handle move out of the viewport so a separate left panel can read them; nothing visible changes.
What changes at a high level: add the Preact `EditorContext` and `useEditor()` with the agreed interface (doc, history, dispatch, edit, deleteSelection, area, selection, select, clipboard, copy/paste, viewport ref, locked, save state, themes, colors, status routing). `Editor.tsx` becomes the provider and sole history owner. The sidebar JSX, item properties and level properties forms move unchanged into `LegacyPanel`; `Viewport.tsx` keeps only engine ownership. Add `data-ready` on the canvas host and keep `viewport-status` as an sr-only element.
Done when: the interface exists exactly as in the PRD, `area` is 40x30, `edit` forwards the area, single-selection delete works; all existing e2e pass with the old layout.

## Task 3 — Shell layout, theme tokens, root data attrs
What it is / what it means: R1, R7, R8 (partial). The page stops looking like a centered dark page.
What changes at a high level: a `Shell` grid (56px top row, 300px scrolling left slot, canvas slot) with no page scroll, hosting LegacyPanel and the viewport. Editor-scoped main-menu tokens (greens sampled from the level card button) and reusable button, chip, popover, modal and panel classes, Coiny for headings. Root data attributes for building, obstacle and player counts replace the draft summary; the specs that read it switch over, and the standalone header and name paragraph go.
Done when: no document scroll at 1280x720 and 1920x1080, left panel scrolls alone, canvas fills the rest; specs using the old summary pass on the new attributes.

## Task 4 — Dirty/saved model and top bar with save chip
What it is / what it means: R2 (bar, chip, Save, Undo/Redo, Play), R5 dirty rules, Decisions 5, 7, 10. This is the race-safe save core autosave later reuses.
What changes at a high level: derived dirty against a saved-document ref (reference check, then JSON compare), a single-flight save queue that swaps in the normalized result only when no edit happened during flight, client-side validation debounced 300ms. `TopBar` shows `← Game`, the level name button (name text, id in tooltip), Undo, Redo, green Save, Play and the chip with its four states and an issues popover; the old Save text lines are removed. Check and Finalize stay as their current controls until Task 5; the name button keeps today's start-screen behavior until Task 6. Specs move to `level-name` and the chip.
Done when: chip walks Unsaved, Saving, Saved and shows issue list for an invalid blank; an edit during a stalled save survives; the e2e pass.

## Task 5 — Check and Finalize popovers
What it is / what it means: R2 Check/Finalize, R8, Decision 8. The remaining status noise moves into popovers.
What changes at a high level: Check runs on the working copy with a spinner and a popover holding the evidence text, run lines, report details and Cancel; the Proxy evidence region stays and clears on edit. Finalize is enabled only when clean and idle, sends the saved document, and its popover auto-opens with the step log (Finalize output label) and holds lock status, fetched lazily on open and after completion. Closing never cancels. The finalize-status line, standalone Cancel check and old Finalize text are removed; finalize and solvable specs update.
Done when: Finalize disabled until saved and again after an edit; lock text appears only in its popover; Check makes zero save requests and Cancel aborts.

## Task 6 — File modal and URL flows
What it is / what it means: R3, R4, Decision 11. Replaces the start screen and discard-on-reset.
What changes at a high level: `FileModal` with New blank, Copy level and Open custom level, id prefilled with the next free custom id, same visible labels where possible, errors as alerts in the modal. Standalone and non-dismissible when no doc is open, dismissible otherwise, with an inline Discard/Cancel step when dirty. Initial URL handling (template, level, unknown id alert) moves to an initial-load hook with behavior preserved. The name button opens the modal; entry, shell, play and viewport specs update.
Done when: all three paths create a doc, bad or existing id alerts show, dirty replace prompts, and the three URL cases behave as in the PRD.

## Task 7 — Autosave and beforeunload
What it is / what it means: R5 autosave, R6, Decisions 6, 7, 12.
What changes at a high level: a 5s interval tick that saves only when armed by a prior manual Save of this doc, dirty, valid, idle and not in flight; it never locks editing, never finalizes, no retry for the same revision after failure, and treats a 409 as transient. Arming resets when the modal swaps docs. A beforeunload guard is registered only while dirty. New `editor-shell-ui` spec covers chip, autosave with a fake clock, modal and beforeunload; the shared e2e helper accepts dialogs.
Done when: a new doc sees zero save requests; after Save plus edit one save lands within ~5s; no autosave during Check or Finalize.

## Task 8 — Toasts for banner and misc errors
What it is / what it means: R9, Decision 9.
What changes at a high level: the script-removal banner is a top-center toast stack in the canvas slot, still derived from history and gone on the next edit or undo. Manifest and list load errors become dismissible toasts; manual Save failure auto-opens the chip popover.
Done when: the banner shows on deleting a scripted building and vanishes on Undo; forms spec passes.

## Task 9 — Visual and e2e verification
What it is / what it means: the PRD acceptance criteria, including ref screenshot match and the green gates.
What changes at a high level: only fixes found while verifying. Take screenshots at 1280x720 and 1920x1080 and compare to `ref/` (top bar, chip, green Save, sky theme); run the full acceptance list.
Done when: screenshots match within tolerance at both sizes; `pnpm typecheck`, `pnpm lint`, `pnpm test:web:e2e` are green and `pnpm check:docs` is unaffected.
