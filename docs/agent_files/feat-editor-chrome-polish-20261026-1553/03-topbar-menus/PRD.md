---
status: draft
summary: Top bar reduced to Back + File menu (Create/Duplicate/Open/Undo/Redo) on the left and plain save status + Play + Share panel (Save/Finalize/Check/version) on the right; replaces the Undo/Redo/name/Save/caret chrome and fixed job popovers.
date: 2026-10-26
---
# PRD: SP03 Top bar menus, dialogs and Share panel

Repo/branch: node-arena · `feat/editor-chrome-polish` · Depends on: SP01 (tokens/primitives), SP02 (`changed`, `duplicateLevel`, `versionOf`, Finalize saves first) · Owns: `apps/web/src/editor/{TopBar,FileModal,JobPopovers,Toasts}.tsx` (+ new files below), top-bar/dialog/share blocks of `style.css`, Editor.tsx wiring (props only), `save-core.ts` `chipText`

## TL;DR
- Left: `← Back`, `File ▾` only. File menu: Create…, Duplicate, Open…, ─, Undo, Redo (kbd hints).
- Right: plain-text save status, Play, primary `Share ▾`. Share panel (Canva-style, right-aligned) rows: Save, Finalize, Check; footer `Version 0.0.N`.
- Check = spinner row, then toast "Check: AI won X/Y · Details"; Details opens a flyout LEFT of the panel. Finalize = one action (save-then-finalize per SP02).
- FileModal splits into Create / Open / Confirm dialogs; start screen reuses them. Dirty guard everywhere is a 3-way Save / Discard / Cancel.

## Problem
Evidence (`TopBar.tsx`, `JobPopovers.tsx`, `FileModal.tsx`):
- 10 controls in the bar; Undo/Redo, level-name, Save, two carets compete; "Game" link leaves silently with unsaved work (only `beforeunload`).
- Check/Finalize popovers are `position:fixed; top:60px` with computed `left`, two separate carets, and no shared surface.
- FileModal shows three unrelated forms at once (New blank / Copy / Open) sharing one id field; "Copy" and "New" are one concept to users.
- Save chip is a bordered pill; Finalize disabled while dirty (SP02 removes the need).

## Goals / Non-Goals
Goals: minimal, scannable bar; one Create flow; safe navigation; Share panel consolidating persistence/validation jobs; keyboard-accessible menus; keep data-testids that still make sense.
Non-goals: real sharing/links; renaming/deleting levels; left panel (SP04), map controls (SP05), token/primitive CSS (SP01), version/duplicate server logic (SP02); changing Check/Finalize backends or event streams.

## Requirements
| # | Requirement |
|---|---|
| R1 | Bar order: `Back`, `File`, spacer, `SaveStatus`, `Play`, `Share`. No level-name, Undo, Redo, Save, or caret buttons. No name/id label in bar (name lives in left panel). |
| R2 | Back is `<button>` (testid `back`). If `dirty`: Confirm dialog (Save and leave / Leave without saving / Cancel); Save-and-leave awaits `doSave('manual')`, stays on failure. Clean: `location.assign('/')`. `beforeunload` guard stays. |
| R3 | File menu (`.ed-menu`, testid `file-menu`, trigger `file-menu-button`): items `menu-create`, `menu-duplicate`, `menu-open`, sep, `menu-undo`, `menu-redo` with `.ed-menu-kbd` "Ctrl+Z" / "Ctrl+Y". Undo/Redo disabled per `history.past/future`; all disabled when `locked`. Duplicate disabled if doc never saved (`savedDoc===null`) or locked. |
| R4 | Create dialog: `id` input (prefill first free `na-custom-N`), `.ed-group-box` with Theme (green, snow) + Size (small/medium/large), `.ed-divider-or`, `Copy existing level` select (first option "None"), `Create` button last (`create-confirm`). |
| R5 | Create semantics: copy source = None -> blank from Theme+Size. Source chosen -> copy wins; the Theme/Size box gets `disabled` + dimmed + hint "Copied from <id>; theme and size come from the source". Button label stays `Create`. Id collision error as today (`EXISTS`). |
| R6 | Open dialog: select of all `na-` levels + `Open level` (`open-confirm`); empty state "No custom levels yet." |
| R7 | Duplicate: if dirty -> 3-way Confirm; Save awaits `doSave`, aborts on failure; then `duplicateLevel(doc.id)` and `replaceDoc(level, true)` (opens immediately, version 0.0.1). Discard duplicates the disk copy (edits dropped). |
| R8 | Create/Open/Duplicate when dirty use the same Confirm dialog (testid `discard-confirm` kept on container) with `confirm-save`, `confirm-discard`, `confirm-cancel`. |
| R9 | Start state (no doc): standalone card on the editor backdrop with title "Level editor", a Back link, and the same CreateDialog body stacked above OpenDialog body, separated by a heading rule. Not dismissible. |
| R10 | SaveStatus: plain text (`.ed-status`, no border), `data-testid=save-chip`, `data-state`. Text via `chipText`: "✓ Saved", "Saving…", "Unsaved", "N issues", "Can't save". Only error/issues/message states are `<button>` opening `save-popover` (right-aligned under the text); other states are `<span role=status>`. |
| R11 | Share button `ed-btn-primary` (testid `share-button`, `aria-haspopup=dialog`, `aria-expanded`). Panel `.ed-popover` (testid `share-panel`), 320px, right-aligned under button, `role=dialog`, title "Share". |
| R12 | Save row: label, `Ctrl+S` hint, button -> `save('manual')`; disabled when `locked`. Not disabled when clean (SP02 makes it a no-op). |
| R13 | Finalize row (`finalize-row`): one button -> `finalize()` (SP02: saves first, aborts on save failure). Sub-line `lock-status` text (testid kept). Running: spinner, row buttons disabled (`busy`). Output: collapsible `<details>` in the panel (max-height 160px, scroll) for step/output events; result also fires a success toast. `lockOutput` stays in a details. |
| R14 | Check row (`check-row`): button -> `solvable()`; running: spinner + Cancel in row. Done: panel stays open or closed per user; toast `check-toast` "Check: AI won X/Y · Details" (X/Y = `report.totalWins`/`report.runs`); error -> error toast. Details (also a "Details" link in the row once results exist) opens `CheckFlyout`. |
| R15 | `CheckFlyout` (testid `check-popover` kept): `.ed-popover` positioned LEFT of Share panel (`right = panelWidth + 8px`, same top), 400px, shows existing content (issues, evidence note, progress `pre`, full report details, Cancel). Closes on Esc / outside click / x; never cancels the job. Details when panel closed: panel re-opens with flyout. |
| R16 | Footer: `Version {versionOf(savedDoc)}` (testid `editor-version`), read-only, muted. Savedoc, not `present`. |
| R17 | Accessibility: Esc closes topmost surface (flyout, then panel/menu) and returns focus to its trigger; menu/panel trap nothing but Tab leaves = close; Up/Down move between menu items (roving, optional but included); Enter/Space activate; Create/Open/Confirm dialogs `aria-modal`, focus first control, restore focus. Ctrl+S/Z/Y unchanged (`useShortcuts`). |
| R18 | Z-order/position: panel + flyout `z-index: var(--ed-z-pop)` (5) above canvas controls (z-index 3, SP05); toasts 15, modals 20. Right-anchored panel/flyout keep `right >= var(--ed-controls-gutter)` (56px, defined in SP01 tokens) so the map-controls column stays uncovered. |
| R19 | Toasts gain transient `notices` (id, kind, message, optional action `{label,onClick}`, 8s auto-dismiss, dismiss x); existing `error-toast`/`script-removal-banner` keep testids. |

## Architecture
New files in `apps/web/src/editor/`: `Menu.tsx` (trigger + `.ed-menu` + roving focus, outside-click/Esc, focus return; reused by File and reusable by SP05), `FileMenu.tsx`, `CreateDialog.tsx`, `OpenDialog.tsx`, `ConfirmDialog.tsx`, `StartScreen.tsx`, `SaveStatus.tsx`, `SharePanel.tsx`, `CheckFlyout.tsx`, `useDismiss.ts` (outside/Esc/focus-return hook, extracted from the duplicated code in TopBar and JobPopovers). `FileModal.tsx` and `JobPopovers.tsx` are deleted; `TopBar.tsx` becomes layout + wiring.

```
Bar (56px)
[← Back][File ▾]                      ✓ Saved  [Play] [Share ▾]
 +-File menu-----------+                          +-Share--------------------+
 | Create…             |      +-Check flyout--+   | Save           Ctrl+S [Save]
 | Duplicate           |      | Proxy evidence| <-| Finalize  Locks current [Finalize]
 | Open…               |      | …             |   | Check     ◌ Cancel / [Check]
 | ───────────────     |      +---------------+   | ──────────────────────── |
 | Undo         Ctrl+Z |       (left of panel)    | Version 0.0.7            |
 | Redo         Ctrl+Y |                          +--------------------------+
 +---------------------+             map-controls column stays clear at far right
```

State flow (all state stays in Editor.tsx; components are props-driven):
- `ui: {menu:boolean; share:boolean; flyout:boolean; dialog:'create'|'open'|null; confirm:{then:()=>Promise<void>}|null}` replaces `fileOpen` and `popover`.
- `guard(action)`: if `dirty` -> `confirm={action}`; else run. Confirm Save -> `await doSave('manual')`; run action only if the save left doc clean (no `failure`); Discard -> run; Cancel -> clear. One helper serves Back, Create, Open, Duplicate.
- Create/Open dialogs call `guard(() => replaceDoc(doc, saved))` after building/reading the doc (read before prompting, as today, so errors show in the dialog).
- Check/Finalize logic untouched (`solvable()`, `finalize()`, `proxyAbort`); only the surface changes. Lock status fetch (`Editor.tsx` effect keyed on `popover==='finalize'`) re-keys on `share` open.
- Check completion effect pushes the toast notice; Details sets `share=true, flyout=true`.
- Version: `versionOf(savedDoc)` from SP02 `api.ts`.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Create ambiguity | Copy select defaults "None"; choosing a source disables Theme/Size box with hint | Separate tabs; last-edited wins | Matches locked "or" divider layout; visible, no hidden precedence |
| D2 | Start screen | Same Create + Open bodies in a standalone card | Keep old 3-column FileModal | One mental model; removes divergent code |
| D3 | Dirty prompt | 3-way Save / Discard / Cancel | Keep 2-way discard | Duplicate needs Save; cheap everywhere |
| D4 | Name in bar | None | Muted id label | Locked: Back + File only; SP04 shows id |
| D5 | Undo/Redo | Menu items + shortcuts | Keep icon buttons | Locked |
| D6 | Check result | Toast + flyout | Inline results in panel | Panel stays compact; results are long |
| D7 | Finalize output | Inline collapsible in panel + success toast | Separate flyout | Short, linear log |
| D8 | Status clickability | Button only for error/issues | Always button | No false affordance when "Saved" |
| D9 | Menu primitive | Own `Menu.tsx` (no library) | Radix/Headless | Preact app, 6 items, zero deps |
| D10 | Panel vs map controls | Right-anchored panels keep `right >= var(--ed-controls-gutter)` | Overlap, close on map hover | Locked: must not cover column |

## Risks / Open Questions
- [RESOLVED: single token `--ed-controls-gutter: 56px` defined in SP01; controls z 3; popovers/Share/Check flyout z = `--ed-z-pop` (5); right-anchored panels keep `right >= var(--ed-controls-gutter)`.]
- [RESOLVED: Duplicate-when-dirty dialog offers "Save & duplicate / Cancel" only; no discard option.]
- [RESOLVED: check results not persisted; re-run overwrites (locked decision, accepted).]
- [RESOLVED: SP02 R8] Finalize not disabled by dirty; row only disabled while `busy`.
- [RESOLVED: SP02] Duplicate disabled for never-saved doc.
- [RESOLVED: Esc order] flyout -> panel/menu -> dialog.
- [DEFERRED] Arrow-key nav in Share panel; Create "Name" field (SP04 edits name); id-in-bar label.
- Risk: large e2e churn (below); mitigate with shared helper `apps/web/e2e/editor-helpers.ts` (`openFile(page,'create'|'open')`, `undo(page)`, `save(page)`, `createBlank(page)`, `copyFrom(page,id)`).

## E2E / unit impact
- Selectors using role `Undo`/`Redo` buttons: editor-layout, editor-forms, editor-model, editor-selection, editor-level-section, editor-play -> helper or Ctrl+Z/Y.
- Role `Save` button (editor-layout, -forms, -model, -finalize, -shell, -play, -level-section, -shortcuts:66 enabled check) -> `save` helper (Share > Save) or Ctrl+S.
- `Create blank` / `Copy level` / `Open level` labels (editor-model, -play, -shell, -layout, -finalize, -forms, -level-section, -solvable, z-custom-create) -> `Create` dialog flow; labels `New level id`, `Theme`, `Size`, `Copy existing level`.
- `level-name` testid (editor-entry:16,33; editor-shell:15-53; editor-shortcuts:78) removed -> assert via left-panel id (SP04) or `File > Open` / document title. Shell spec "start modal shown, level-name count 0" -> assert `file-menu-button` count 0.
- `save-chip` text `Saved ✓` (editor-play:46) -> `✓ Saved`; shell `Can't save` unchanged.
- editor-finalize: `finalize-popover` -> `share-panel` + `finalize-row`; remove dirty-disabled assertion (SP02).
- editor-solvable: `check-popover` stays (flyout), reached via toast Details.
- vitest `test/editor/*`: JobPopovers prop contract tests (SP02) move to SharePanel; add `confirm-flow`, `create-dialog` (copy wins), `menu` keyboard tests; `chipText` cases.

## Acceptance Criteria
- Bar at 1440x900 contains exactly: `back`, `file-menu-button`, `save-chip`, Play, `share-button`; no `level-name`, Undo, Redo, Save, caret.
- File menu opens under File; items present with kbd hints; Esc closes and focus returns to `file-menu-button`; Undo/Redo items enable/disable with history.
- Create: collision error shown; picking a copy source disables Theme/Size box; Create opens blank (theme/size honored) or copy (source ids).
- Dirty + Create/Open/Duplicate/Back shows `discard-confirm`; Save runs `doSave` first and aborts on failure; Discard proceeds; Cancel keeps doc.
- Duplicate on saved level opens `<id>-copy` with `editor-version` "Version 0.0.1"; disabled on never-saved doc.
- Share panel right-aligned under button, does not overlap SP05 map-controls column (bounding boxes disjoint) and sits above canvas.
- Check: row spinner while running, Cancel works; on finish toast text matches `Check: AI won X/Y`, Details opens `check-popover` left of `share-panel` (flyout right edge < panel left edge).
- Finalize on dirty doc saves then finalizes; `lock-status` visible in row; no dropdown.
- Save status has no border/background (computed `border-top-width` 0), green when saved.
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, updated `editor-*.spec.ts` green; screenshots vs `ref/canva.png` recorded under `03-topbar-menus/screens/`.
