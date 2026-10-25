---
status: draft
summary: Full-viewport Canva-style editor shell (top bar, File modal, save chip, autosave, main-menu theme) plus the lifted shared EditorContext that the left panel (SP02) and canvas (SP03) plug into.
date: 2026-10-24
---
# PRD: Editor shell, top bar, File modal, theme, autosave

Repo/branch: node-arena, `custom-level-fix` (PR #24) · Depends on: none (Phase 1) · Owns: `apps/web/src/editor/{Editor.tsx, Shell.tsx, TopBar.tsx, FileModal.tsx, EditorContext.ts, useAutosave.ts, LegacyPanel.tsx, style.css}` (new files marked in Architecture), e2e spec edits listed below.
Does not own: `Properties.tsx` + new left-panel sections + `model.ts` player/multi-delete ops (SP02); `viewport-engine.ts`, canvas controls, shortcuts, `model.ts` clamp/grow-only (SP03); `api.ts`, `editor-middleware.ts`, `tools/src/editor-*.ts` (unchanged).

## Scope: cross-SP seams (SP01 owns all)
- First commit of SP01: mechanical reformat of the `DocOp` union in `apps/web/src/editor/model.ts` (line 8) to one member per line; no behavior change. SP02 then SP03 build on it sequentially.
- `EditorContext` additionally exposes `deleteSelection()`, `area`, and `edit(op)` forwarding `{type:'edit', op, area}` (see Architecture).
- Ready signal: `data-ready="true"` on the canvas host when preview rebuild finished; `[data-testid=viewport-status]` kept as visually-hidden (sr-only) element, message only.

## TL;DR
Replace the centered dark page + start screen with a full-viewport shell: sticky top bar, ~300px scrollable left-panel slot, canvas slot. Move selection, clipboard, viewport handle and job/save state into one `EditorContext` so SP02/SP03 never reach into each other. Add File modal, save chip with issue list, Check/Finalize popovers, 5s autosave (post first manual Save), `beforeunload`, main-menu theme. Left panel temporarily hosts today's sidebar verbatim (`LegacyPanel`) so nothing regresses.

## Problem
- `Editor.tsx` (180 lines) mixes doc history, save/finalize/solvable/lock state, start screen and stacked status text; "Start screen" discards the draft [verified: Editor.tsx:111,116 `setDoc(null)`].
- Selection, clipboard, snap, LOS state live inside `Viewport.tsx`, so a separate left panel cannot read them [verified: Viewport.tsx:12-22].
- No autosave; no leave-page guard; lock status/draft summary/proxy text are noise the owner does not want (brief decision log).

## Goals / Non-Goals
Goals: shell layout, TopBar, FileModal, autosave, theme, lifted state interface, no behavior regression in Save/Check/Finalize/Play/undo.
Non-goals: left-panel redesign (SP02), canvas behavior/overlays/shortcuts (SP03), new server endpoints, auto-finalize, multi-doc.

## Requirements
**R1 Shell.** `.ed-shell` = CSS grid `100vw×100vh`, rows `[top bar 56px][1fr]`, columns `[300px][1fr]`; `overflow:hidden` (no page scroll); left slot `overflow-y:auto`; canvas slot `min-width:0;min-height:0` (engine already uses ResizeObserver on its parent [verified: viewport-engine.ts:105]). Root carries `data-buildings/-obstacles/-players` attrs (replaces `draft-summary` for tests).
**R2 TopBar.** Left: `← Game` (`href="/"`), level name button (opens FileModal; `data-testid="level-name"`, id in `title`), Undo, Redo. Right: save chip, Check, Finalize, Play, Save (green).
- Save chip (`role=status`, `data-testid="save-chip"`): `Saved ✓` · `Saving…` · `Unsaved` · `Can't save · N issues`. Click opens issues/warnings popover (items keep `data-item=<pointer>`, label via `issueLabel`). Network/non-issue save errors show in the same popover as one message row.
- Check = today's Solvable? on the working copy (no save). Spinner while running. Popover holds "Evidence only…" text, per-run lines, full report `<details>`, **Cancel** (aborts via existing `AbortController`). Region keeps `aria-label="Proxy evidence"`. Cleared on any doc edit (current behavior).
- Finalize: enabled only when clean (see R5) and no job running; click runs `finalizeLevel(savedDoc)`, spinner, popover auto-opens with step log (`aria-label="Finalize output"`). Closing the popover never cancels. Lock status (`current/unfinalized/checking/unknown` + `lockOutput` details) appears ONLY inside this popover, fetched on open and after a Finalize completes (no per-edit polling).
- Play: opens `PlayOverlay` on the working copy (unchanged). Disabled while busy.
- Save: green primary; `Ctrl+S` is wired by SP03 to `ctx.save()`.
**R3 FileModal.** Replaces start screen. Tabs/sections: New blank (`New level id`, Theme, Size), Copy level (select of all levels; uses same id field), Open custom level (select of `na-*`). Same visible labels as today where possible (`New level id`, `Theme`, `Size`, `Create blank`, `Copy level`) to minimize spec churn; Reopen → `Open level`. Id prefilled with next free `na-custom-N`. Standalone (non-dismissible, over sky background, no top bar) when `doc===null`; dismissible (Esc/backdrop/Cancel) otherwise. If dirty, any action that replaces the doc first shows inline "Discard unsaved changes?" (Discard and continue / Cancel). Errors (bad id, id exists, load failure) render `role="alert"` inside the modal.
**R4 URL flows.** `?template=<id>` → copy into new `na-custom-N` named `Custom N`, unsaved [verified: Editor.tsx:97-103]; `?level=na-*` → open as saved; `?level=<levelview-*>`/unknown id → no doc, modal open with `role=alert` "Unknown level…" (entry spec asserts alert text and no doc). Behavior preserved byte-for-byte; code moves to `useInitialLoad`.
**R5 Dirty/saved model + autosave.** See Architecture. Rules: interval tick every 5s; runs only if armed (≥1 successful manual Save of this doc id this session), dirty, client-valid, no job (Finalize/Check/manual save) running, no save in flight. Never calls finalize. Failure → chip `Can't save`, no retry for the same doc revision (retry on next edit or manual Save). A 409 "job already running" is transient: retry next tick.
**R6 beforeunload.** Registered while dirty (including an unsaved new/template doc); sets `returnValue`.
**R7 Theme.** Replace dark slate with main-menu look: `body` sky gradient `#73c7e6→#ccecf2` (already set by game `style.css` imported in `main.tsx` [verified: main.tsx:3, style.css:3]); editor-scoped tokens `--ed-sky-*, --ed-green, --ed-green-dark, --ed-panel, --ed-ink, --ed-border`; Coiny for headings, buttons, chip, modal title; `system-ui` for inputs/labels/selects. Reusable classes: `.ed-btn`, `.ed-btn-primary` (green, SP02 Apply buttons), `.ed-chip`, `.ed-popover`, `.ed-modal`, `.ed-panel`. Green values sampled from the level-card button in `apps/web/src/style.css`. Play overlay styling untouched.
**R8 Removed.** `finalize-status` line, `Saved. Run Finalize…` line, `draft-summary`, `<p>{doc.name}</p>`, standalone header/h1/"Local development", "Start screen" button, `Cancel check` standalone button (moves into popover).
**R9 Banners/errors.** Script-removal banner (`data-testid="script-removal-banner"`, `role=status`) stays derived from history via `scriptRemovalMessages`; renders as a toast stack pinned top-center of the canvas slot (always visible, disappears on next edit/undo). Save errors → chip popover (auto-opens on a manual Save failure). Misc errors (manifest/list load) → toast with dismiss.
**R11 Cross-SP seams.** (a) First SP01 commit reformats the `DocOp` union in `model.ts` one member per line, no behavior change. (b) `ctx.deleteSelection()` dispatches delete for the current selection; SP01 may implement it by dispatching existing single `delete` ops only if selection length is 1; SP02 swaps to `delete-many`. (c) `ctx.area` = 40×30 buildable area `{minX,maxX,minZ,maxZ}` computed once per doc open from bounds centre. (d) `ctx.edit(op)` forwards `{type:'edit', op, area}` to the history reducer (reducer may ignore `area` until SP03). (e) Canvas host carries `data-ready="true"` when the preview finished rebuilding; `viewport-status` stays as sr-only element (same testid, message only).
**R10 LegacyPanel.** `Viewport.tsx`'s sidebar JSX + `ItemProperties` + `LevelPropertiesForm` move unchanged into `LegacyPanel.tsx`, consuming `EditorContext`; its local-only state (snap, mirror, LOS, center) stays inside it. SP02 deletes this file.

## Architecture
New/changed files: `Editor.tsx` (provider + orchestration), `EditorContext.ts` (types + `useEditor()`), `Shell.tsx`, `TopBar.tsx`, `FileModal.tsx`, `useAutosave.ts`, `LegacyPanel.tsx` (temp), `Viewport.tsx` reduced to canvas-only host (SP03 then owns it), `style.css` tokens/layout.

Shared interface (SP02/SP03 assume exactly this; fields marked `temp` are removed by their owners):
```ts
interface EditorContext {
  doc: LevelDoc;                         // history.present; never null inside the shell
  history: DocHistory;                   // for banners/undo-ability
  dispatch(a: HistoryAction): void;      // edit/undo/redo; no-op while `locked`
  edit(op: DocOp): void;                 // dispatch({type:'edit',op,area}); reducer may ignore area until SP03
  deleteSelection(): void;               // delete current selection; SP01: single `delete` only if selection.length===1; SP02 swaps to `delete-many`
  area: { minX: number; maxX: number; minZ: number; maxZ: number }; // 40x30, computed once per doc open from bounds centre
  selection: Selection[];                // mirror of engine selection callback
  select(next: Selection[]): void;       // delegates to viewport.current.select -> echoes via callback
  clipboard?: Clipboard;
  copy(): void;                          // copySelection(doc, selection); resets pasteCount
  paste(): void;                         // edit({type:'paste', offset .5*n}); n resets on doc.id change
  viewport: { current?: EditorViewport };// set by Viewport.tsx on mount; SP02 drag-to-place + SP03 controls use it
  locked: boolean;                       // Finalize | Check | manual-save in flight
  save(): Promise<void>; saveState: 'saved'|'saving'|'unsaved'|'error'; dirty: boolean;
  themes: string[]; colors: string[];
  viewportStatus: ViewportStatus; losStatus: string;  // temp, engine -> Editor routing for LegacyPanel/tests
}
```
Rules: only `Editor.tsx` calls `setHistory`; only `Viewport.tsx` creates/disposes the engine and assigns `ctx.viewport.current`; engine `edit`/`selection`/`status`/`los` callbacks route to ctx (`edit` ignored when `locked`). Selection is cleared when `doc.id` changes. Autosave does NOT set `locked` (user keeps editing during the 5s save).

Dirty/save model (the race analysis):
- `savedRef: LevelDoc | null` = last doc known to equal disk. `dirty = !savedRef || (history.present !== savedRef && stable(history.present) !== stable(savedRef))` (reference check first, JSON compare fallback so undo back to the saved state reads clean).
- `doSave(source)`: single-flight via a promise queue (a manual Save during an autosave waits, then re-saves only if still dirty). Captures `sent = history.present`; validates client-side (`validateEditorDocument`, catalog cached); POSTs. On success: `savedRef = result.level`; replace `present` with `result.level` only if `history.present === sent` (no edits during flight; no history entry pushed, as today); otherwise leave the user's newer edits untouched (they stay dirty and the next tick saves them). So an in-flight save can never clobber later edits or undo steps.
- Finalize/Check sent doc: Finalize sends `savedRef` (server deep-compares to disk [verified: editor-middleware.ts finalize `isDeepStrictEqual`]); Check sends `present`.
- Server serialization: `acquireSave` 409s while a Finalize/Check holds the gate [verified: editor-middleware.ts:80-83], so Save is disabled while those run and autosave pauses.
- First-save-creates-file: autosave `armed` flips only after a successful manual Save for that doc id; a brand-new blank/template doc is therefore never written by a timer. `armed` resets when FileModal swaps docs.
- Validity: `validateEditorDocument(catalog, doc, doc.id)` debounced 300ms yields `issues/warnings`; chip shows `Can't save · N issues` when armed-or-failed-attempt and invalid; before first save an invalid doc reads just `Unsaved` (no nagging a fresh blank with 0 buildings).

Which e2e hooks change: `draft-id` → `level-name` (text = level name, not id); `draft-summary` → root data attrs; `finalize-status` removed (lock text asserted inside Finalize popover); text `Saved.` → chip `Saved ✓`; `Start screen` button → click `level-name` then FileModal; `Reopen level` → `Open level`; `Level properties` details/`Selected item`/`Mirror`/`Auto-fit`/`bounds-preview` untouched by SP01 (LegacyPanel) until SP02/SP03 remove them.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Shared state mechanism | Preact context built in `Editor.tsx` | Zustand/new store; prop drilling | Brief: restructure, no central-store rewrite; context is enough for 2 consumers |
| 2 | Engine ownership | `Viewport.tsx` sole owner; handle exposed as `ctx.viewport` ref | Editor creates engine | Keeps SP03's file self-contained; ref avoids re-render churn |
| 3 | Selection source of truth | Engine callback → Editor state; `select()` delegates to engine | Editor-owned selection pushed into engine | Engine already handles marquee/shift/picking; zero engine change |
| 4 | Legacy sidebar | Moved to `LegacyPanel.tsx`, deleted by SP02 | Leave in Viewport.tsx | Separate file ownership; SP03 can strip Viewport freely |
| 5 | Dirty detection | Reference + JSON fallback vs `savedRef` | Revision counter | Undo-to-saved reads clean; survives normalization swap |
| 6 | Autosave cadence | 5s interval tick reading refs | Debounce after last edit | Brief says "every 5s"; debounce starves under continuous drag/edit |
| 7 | Autosave vs edits | Autosave doesn't lock editing; swap-in of normalized doc only if `present===sent` | Lock UI while saving | Never block the user, never lose edits |
| 8 | Lock status | Popover only, lazy fetch | Poll on every edit | Fewer `/__editor/status` calls (409s while saves bump revision); brief says popover-only |
| 9 | Banner/toast home | Canvas-slot top-center toast, derived from history | Chip popover | Banner must be visible at the moment of delete and vanish on undo |
| 10 | Top bar name | Shows `doc.name`; id in tooltip + modal | Show id | Brief: "level name"; new testid `level-name` |
| 11 | Unsaved confirm | Inline step in FileModal | `window.confirm` | Testable, themed |
| 12 | Failed autosave | No retry until doc changes or manual Save | Retry every tick | Avoid hammering/looping on a persistent validation/IO error |

## Risks / Open Questions
- [RESOLVED: derived dirty + conditional swap-in] autosave clobbering in-flight edits/undo.
- [RESOLVED: hidden root data attrs] e2e needs counts after `draft-summary` removal; SP02/SP03 specs should reuse `data-buildings/-obstacles`.
- [RESOLVED: keep sr-only element, same testid; also data-ready on host (SP03 agrees)] `viewport-status` ("Ready"/"Add a building") is used by ~10 e2e waits.
- [RESOLVED: shared e2e helper accepts dialogs] `beforeunload` in Playwright: dialogs auto-dismiss, which can block `page.goto` between steps.
- [RESOLVED: no; Discard/Cancel only] File → Copy/Open "Save & continue" when dirty and valid.
- [DEFERRED] Extracting Check/Finalize job hooks to their own file; do only if `Editor.tsx` exceeds ~300 lines.
- Risk: `ctx.locked` during manual Save means edits are rejected for a moment; same as today (`disabled=busy`).

## Acceptance Criteria
- Viewport 1280×720 and 1920×1080: no document scroll; top bar 56px; left panel scrolls independently; canvas fills remainder; screenshot matches `ref/` layout (top bar, chip, green Save, sky theme) and stays within tolerance across both sizes.
- With no doc: only FileModal over sky background; Create blank / Copy / Open each produce a doc; bad id and existing id show `role=alert` in the modal; with unsaved edits, replacing the doc prompts Discard/Cancel.
- `?template=na-trial` opens an unsaved `Custom N` doc (chip `Unsaved`); `?level=na-trial` opens saved; `?level=..%2Fcontent` shows alert "Unknown level" and no `level-name`.
- Chip: Unsaved → Saving… → Saved ✓ on Save; edit → Unsaved; invalid save (blank, 0 buildings) → `Can't save · N issues`, click lists `/buildings … must NOT have fewer than 1 items`.
- Autosave (e2e with fake clock/`page.clock`): new doc never written before manual Save (zero `/__editor/save` requests after 15s); after manual Save + edit, one save occurs within ~5s and chip returns to Saved; no autosave while Check/Finalize running; edit made while a delayed (route-stalled) save is in flight remains in the doc and the chip shows `Unsaved` afterwards; Finalize is never called by autosave.
- Finalize disabled until saved; after click spinner + popover log; lock status text only in popover; edit after Finalize disables it again.
- Check: popover shows `Proxy wins:`, `Evidence only`, `seed`, Cancel aborts; zero save requests; editing clears evidence.
- `beforeunload` handler registered iff dirty (evaluate `window.onbeforeunload`/dispatch event in test).
- `model.ts` `DocOp` union is one member per line after SP01's first commit (no behavior change; diff is whitespace-only in semantics).
- `ctx.deleteSelection()`, `ctx.area` (40×30) and `ctx.edit(op)` forwarding `{type:'edit', op, area}` exist; canvas host has `data-ready="true"` after preview rebuild; `[data-testid=viewport-status]` present as sr-only.
- Script-removal banner appears on deleting a scripted building, disappears on Undo.
- Existing specs updated (testids above): `editor-shell.spec.ts`, `editor-entry.spec.ts`, `editor-finalize.spec.ts`, `editor-solvable.spec.ts`, `editor-forms.spec.ts` (draft-summary, banner), `editor-model.spec.ts` & `editor-layout.spec.ts` (draft-summary), `editor-play.spec.ts` (create-blank flow, `Saved.` → chip), `editor-viewport.spec.ts` (Start screen). New `editor-shell-ui.spec.ts` for chip/autosave/modal/beforeunload.
- `pnpm typecheck && pnpm lint && pnpm test:web:e2e` green; `pnpm check:docs` unaffected.
