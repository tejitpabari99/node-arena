---
status: in-progress
summary: Nine tasks - dismiss/menu primitives, confirm guard, Create/Open/start dialogs, save status, notices, Share panel, Check flyout, bar rewrite, visual verification.
date: 2026-10-26
---
# Tasks: SP03 Top bar menus, dialogs and Share panel
Source of truth: `docs/agent_files/feat-editor-chrome-polish-20261026-1553/03-topbar-menus/PRD.md`. Bar reduced to Back + File and status + Play + Share; FileModal and JobPopovers replaced by small props-driven components. Landing order 01 -> 02 -> 05 -> 04 -> 03, so this lands last and consumes SP01 primitives and SP02 save/duplicate/version APIs.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | useDismiss and Menu primitive | SP01 T3 | done |
| 2 | ConfirmDialog and guard state | SP01 T4 | done |
| 3 | Create/Open dialogs and start screen | 2, SP02 T3 | done |
| 4 | SaveStatus and chipText | SP01 T4 | done |
| 5 | Toast notices | SP01 T4 | done |
| 6 | Share panel (Save, Finalize, Check, version) | 1, 4, SP02 T4, SP02 T6 | in-progress |
| 7 | Check flyout and toast Details | 5, 6, SP05 T2 | todo |
| 8 | Top bar rewrite and File menu | 1, 2, 3, 6, 7 | todo |
| 9 | Verification and screenshots | 8, SP01 T6, SP04 T5 | todo |

## Execution staging
Early tasks build and verify props-driven foundations with real Vitest and Chromium fixtures. Keep legacy `FileModal`/`JobPopovers` and existing live wiring until Task 8; Task 8 integrates all new components, removes both legacy surfaces and migrates all affected selectors atomically. This staging overrides earlier per-task wording assigning live Editor state replacement, legacy deletion or selector migration before Task 8; final accepted behavior is unchanged. Duplicate-when-dirty is Save & duplicate / Cancel only.

## Task 1 — useDismiss and Menu primitive
What it is / what it means: Shared dismissal and menu behavior (R3, R17, D9, Architecture).
What changes at a high level: Add `useDismiss.ts` (outside click, Esc, focus return to trigger), extracted from the duplicated code in `TopBar.tsx` and `JobPopovers.tsx`. Add `Menu.tsx`: trigger, `.ed-menu` list from SP01, roving Up/Down focus, Enter/Space activate, Tab-out closes, `aria-haspopup`/`aria-expanded`, per-item disabled and kbd hint. No dependency library. Not yet wired into the bar. Add vitest `menu` keyboard tests.
Done when: new vitest cases (open/close, Esc returns focus, arrow roving, disabled skipped, outside click) pass; `pnpm typecheck` and `lint` pass.

## Task 2 — ConfirmDialog and guard state
What it is / what it means: One 3-way dirty prompt for Back, Create, Open, Duplicate (R2, R7, R8, D3).
What changes at a high level: Add `ConfirmDialog.tsx` (`aria-modal`, focus first control, restore focus; container testid `discard-confirm`; `confirm-save`, `confirm-discard`, `confirm-cancel`). In `Editor.tsx` replace `fileOpen`/`popover` with the `ui` object and add `guard(action)`: dirty opens confirm; Save awaits `doSave('manual')` and runs the action only if the doc is clean (no `failure`); Discard runs; Cancel clears. Duplicate-when-dirty offers Save and Cancel only (resolved open). Add `confirm-flow` vitest.
Done when: confirm-flow tests cover save-success, save-failure abort, discard, cancel; existing editor tests still green.

## Task 3 — Create/Open dialogs and start screen
What it is / what it means: Split FileModal into a Create flow and an Open flow, reused by the start state (R4, R5, R6, R9, D1, D2).
What changes at a high level: Add `CreateDialog.tsx` (id prefilled to first free `na-custom-N`, Theme/Size group box, "or" divider, "Copy existing level" select defaulting to None; choosing a source disables and dims the box with the hint; `create-confirm`; `EXISTS` error as today), `OpenDialog.tsx` (select, empty state, `open-confirm`), `StartScreen.tsx` (standalone non-dismissible card, Back link, both bodies). Docs are read before prompting; actions go through `guard`. Delete `FileModal.tsx`. Add `apps/web/e2e/editor-helpers.ts` (`openFile`, `createBlank`, `copyFrom`) and migrate the `Create blank`/`Copy level`/`Open level` selectors in the e2e specs listed in the PRD. Add `create-dialog` vitest (copy wins).
Done when: vitest and migrated editor e2e green; collision error shown; Theme/Size honored for blank.

## Task 4 — SaveStatus and chipText
What it is / what it means: Plain-text status with no false affordance (R10, D8).
What changes at a high level: Add `SaveStatus.tsx`: `.ed-status`, `save-chip` testid, `data-state`; `<button>` opening `save-popover` (right-aligned) only for error/issues/message states, else `<span role=status>`. Update `chipText` in `save-core.ts` to "✓ Saved", "Saving…", "Unsaved", "N issues", "Can't save". Update `chipText` unit cases and the `Saved ✓` assertion in `editor-play`.
Done when: vitest chipText cases pass; computed border width of the saved status is 0; editor-play and editor-shell save-chip assertions green.

## Task 5 — Toast notices
What it is / what it means: Transient notices carry Check results (R19).
What changes at a high level: Extend `Toasts.tsx` and Editor state with `notices` (id, kind, message, optional `{label,onClick}` action, 8s auto-dismiss, dismiss x). `error-toast` and `script-removal-banner` keep their testids and z-order (toasts 15, modals 20).
Done when: vitest covers add, auto-dismiss at 8s with fake timers, action callback, manual dismiss; existing toast tests unchanged.

## Task 6 — Share panel (Save, Finalize, Check, version)
What it is / what it means: One right-aligned panel replaces both job popovers (R11-R14, R16, D7, R18).
What changes at a high level: Add `SharePanel.tsx`: `.ed-popover`, `role=dialog`, 320px, title "Share", `share-panel`; rows Save (Ctrl+S hint, disabled only when locked), Finalize (`finalize-row`, `lock-status`, spinner/busy, collapsible output and `lockOutput` details, success toast), Check (`check-row`, spinner plus Cancel, "Details" link once results exist); footer `editor-version` from `versionOf(savedDoc)`. Add the `Share ▾` primary button (`share-button`) in place of the job carets; re-key the lock-status effect on `share`. Check/Finalize logic untouched. Delete `JobPopovers.tsx`; move its prop-contract tests to SharePanel. Update `editor-finalize` (use `share-panel`; drop dirty-disabled assertion) and `editor-solvable` entry steps.
Done when: finalize/solvable e2e green; panel z-index `--ed-z-pop` and `right >= --ed-controls-gutter`; vitest contract tests pass.

## Task 7 — Check flyout and toast Details
What it is / what it means: Compact panel, long results in a side flyout (R14, R15, D6).
What changes at a high level: Add `CheckFlyout.tsx` (testid `check-popover`, 400px, `right = panelWidth + 8px`, same top; issues, evidence note, progress, full report, Cancel). Esc, outside click or x closes it without cancelling the job; Esc order flyout -> panel. Check completion pushes toast `check-toast` "Check: AI won X/Y · Details" (`totalWins`/`runs`); errors push an error toast; Details sets `share` and `flyout`, reopening the panel if closed.
Done when: `editor-solvable` verifies toast text, Details opens the flyout with its right edge left of the panel's left edge, and Cancel works.

## Task 8 — Top bar rewrite and File menu
What it is / what it means: Final bar layout and safe navigation (R1, R2, R3, R7, D4, D5).
What changes at a high level: Add `FileMenu.tsx` on `Menu`: `file-menu-button`, items `menu-create`, `menu-duplicate`, `menu-open`, separator, `menu-undo`, `menu-redo` with Ctrl+Z/Ctrl+Y hints; undo/redo follow history, all disabled when locked, Duplicate disabled when `savedDoc===null`. Duplicate runs through `guard` then `duplicateLevel` and `replaceDoc(level, true)`. `TopBar.tsx` becomes: `back` button (guarded, `location.assign('/')`; `beforeunload` kept), File, spacer, SaveStatus, Play, Share. Remove level-name, Undo/Redo, Save and caret buttons. Add `undo`/`save` helpers to `editor-helpers.ts` and migrate the remaining specs (role Undo/Redo/Save, `level-name`, shell "start modal" -> `file-menu-button` count 0).
Done when: all `editor-*.spec.ts` plus `pnpm test`, `lint`, `typecheck` green; bar holds exactly the five controls; Esc returns focus to `file-menu-button`; duplicate opens `<id>-copy` at "Version 0.0.1".

## Task 9 — Verification and screenshots
What it is / what it means: Visual and layout acceptance against references.
What changes at a high level: Write a Playwright capture at 1440x900 into `docs/agent_files/feat-editor-chrome-polish-20261026-1553/after/`: top bar, File menu open, Create dialog, Open dialog, Share panel, Check toast plus flyout. Compare each with the matching `before/` image and `ref/canva.png`; iterate on CSS until aligned. Assert in a test that Share panel and SP05 map-controls boxes are disjoint and the panel sits above the canvas. Also copy the set to `03-topbar-menus/screens/`.
Done when: screenshots committed, no Coiny, pills or slab buttons visible, layout assertions pass, full `pnpm run ci` green.
