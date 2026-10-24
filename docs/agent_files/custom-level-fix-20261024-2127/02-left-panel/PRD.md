---
status: draft
summary: Replace the temporary editor sidebar with three collapsible Canva-style sections (Level with player cards, Library with game-art thumbnails, Selection with friendly-label dropdown and per-group Apply), plus player add/remove, multi-delete, and mirror/auto-fit removal.
date: 2026-10-24
---
# PRD: Editor left panel sections (Level / Library / Selection)

Repo/branch: node-arena, `custom-level-fix` (PR #24) · Depends on: SP01 (shell + lifted state) · Parallel with SP03 (shared file: `model.ts`)
Owns: `apps/web/src/editor/Properties.tsx` (split into section components), new `LeftPanel.tsx`, `LevelSection.tsx`, `LibrarySection.tsx`, `SelectionSection.tsx`, `thumbnails.ts`, `labels.ts`; in `model.ts`: players/multi-delete ops, partial property ops, mirror removal. Does not own: Editor.tsx, TopBar/FileModal, style.css theme tokens (SP01); viewport-engine.ts, Viewport.tsx canvas, bounds/clamp logic (SP03).

## TL;DR
Left panel = 3 collapsible sections. Level: compact, boxless, player cards (Human fixed, AI1..AI3) with Add/Delete AI. Library: 5 thumbnails rendered once from real game art. Selection: dropdown of friendly names + "Multi-select", per-group Apply forms, Copy/Paste/Delete. Mirror, auto-fit button, readouts, LOS sidebar section and help text are removed.

## Problem
- Sidebar is a long button list; items are labelled by id (`b0`, `crossing`) [verified: Viewport.tsx `Building {item.id}` options].
- Level form has per-player kind selector and fixed ids with no way to add/remove AI [verified: Properties.tsx `p.id kind` select; no add/remove].
- Building form submits owner+level+win+params together as one Apply [verified: model.ts `building-properties` value type; Properties.tsx BuildingForm onSubmit].
- No multi-delete: `delete` takes one target [verified: model.ts DocOp `delete`; Viewport "Delete selected" disabled unless `selection.length === 1`].

## Goals / Non-Goals
Goals: brief's Level/Library/Selection design; one undo step per Apply/delete; no regression in validation (unique colors, 1 human first, 1–3 AI, owners valid).
Non-goals: bot script editing; new objective/human seats; canvas gestures, bounds, clamping, shortcuts (SP03); shell/top bar (SP01); thumbnails persisted across sessions.

## Requirements

### R1 Section shell
`LeftPanel` renders three `<details>`-style sections (Level, Library, Selection), each collapsible, default open; headings use Coiny (SP01 tokens); Level has no surrounding box. Scrolls internally (~300px wide).

### R2 Level section
- Fields: name, theme, time limit (blank = unlimited). Objective is not shown (fixed `captureAll`; brief allows hidden).
- Player cards from `doc.players` order. Index 0 = "Human": only color select. Index i≥1 = "AI{i}": color, action delay (ms, min 50), behavior (Full / Attack only); kind never editable.
- Collapsed card: tag chip (Human/AI) + color swatch + (AI only) delete button on right. Expanded: delete button inside card. Swatch color from manifest `palettes[colorKey]`.
- **Add AI**: disabled at 3 AI. New player = `{ id: nextId, kind:'ai', colorKey: first manifest palette key not used, bot:{kind:'tw', actionDelayMs:4000, behavior:'full'} }`; `nextId` = lowest unused `pN` (N≥2) so ids are never reused while present.
- **Delete AI**: disabled when it is the only AI. Click opens confirm: "Delete AI2? Its N buildings become Neutral." (N = buildings with that owner in the current doc; omit count text when 0).
- Card edits, Add and Delete only change the section's local draft; **Apply level properties** (green, primary class from SP01, bottom) commits one `level-properties` op → one undo step. Apply disabled when the draft has duplicate colors (inline note) or is unchanged.
- Labels: pure function `playerLabel(players, index)` → `Human` / `AI{index}`. Internal ids (`p1`, `p2`, `p3`) never change; after deleting AI1 of [p1,p2,p3], p3 displays as AI1.

### R3 Library section
5 tiles in order: house-wt1, house-wt2, tower, obstacle-small, obstacle-big; image + label under it ("House 1", "House 2", "Tower", "Small obstacle", "Big obstacle"). Tile is a `<button aria-label="Place {item}">` (name unchanged so existing e2e keep working); `onPointerDown` (primary button) → `viewport.beginPlacement(item, event.pointerId)`; `touch-action:none`. Neutral color. If thumbnail render fails or is pending: text tile with the label (drag still works).

### R4 Selection section
- Dropdown (`aria-label="Selected item"`): "Nothing selected" placeholder, every item, then "Multi-select". Two-way sync with canvas through the shared selection state.
- **Label rule** (`itemLabels(doc)`, doc order): `{Owner} {noun} {n}` where Owner = `Neutral` | `Human` | `AI{k}`; noun = `house` (house-wt1/wt2), `tower`; n = 1-based count among earlier buildings with the same (Owner, noun). Obstacles: `{Small|Big} obstacle {n}` counted per variant (unset variant → "Obstacle n"). Labels follow ownership edits (an item changing owner is renumbered in its new group); selection is by id, never by label.
- Single item → groups (all collapsed by default):
  - Building: **Owner & level** (owner, level, ignore for win), **Parameters** (archetype param overrides, existing field generation), **Line of sight** (target-building dropdown → `viewport.setLos({from: selected, to})`; status text `los-status` shown inside; no doc edit, no history).
  - Obstacle: **Shape** (variant, yaw, footprint).
  - Each group has own green Apply submitting only its fields. Below groups: Copy, Paste, Delete.
- Multi-select mode (≥2 selected, or user chose the entry with 0 selected): "N selected", Select all, Clear, Copy, Paste, Delete. Flag clears when selection becomes exactly 1.
- Delete (single or multi) → one undo step; script-removal banner behavior unchanged.

### R5 Removals (each grep-verified)
| Remove | Evidence |
|---|---|
| Mirror UI | [verified: grep `Mirror` → Viewport.tsx:53-57 (axis, centre, swap, button, help)] |
| `'mirror'` DocOp + branch | [verified: model.ts:8 union, :27-32 shared branch with `move-selection`; split so `move-selection` stays] |
| Mirror tests | [verified: test/editor/layout.test.ts:16-24 (4 mirror cases), :26-29 (mirror half of combined test; keep move-selection/undo half)] |
| Auto-fit button + readout | [verified: Viewport.tsx:58-60 button, help, `bounds-preview`; e2e editor-layout.spec.ts:52-53] |
| Pointer readout, status line | [verified: Viewport.tsx last two `<p>` ; `pointer`/`status` callbacks] |
| LOS sidebar section | [verified: Viewport.tsx "Line of sight" h3 block → moved into R4 group] |
| "Selected item" select, "Delete selected", help `<p>`s | [verified: Viewport.tsx] |
| Grid snap toggle | [verified: Viewport.tsx `snap` state; SP01/SP03 decide engine side; SP02 only deletes the control and always snaps yaw] |
`'auto-fit'` reducer branch + its test (layout.test.ts:52-56) are **left untouched by SP02**; SP03 replaces them with grow-only bounds (cross-SP assumption, see Risks).

## Architecture
Assumed SP01 interface (props passed to `LeftPanel`; Viewport becomes canvas-only):
```ts
interface EditorShared {
  doc: LevelDoc; disabled: boolean;
  dispatch(op: DocOp): void;                       // history edit
  selection: Selection[]; select(items: Selection[]): void;  // select() => viewport.select(); engine callback updates selection
  viewport: { current?: EditorViewport };          // beginPlacement, setLos
  clipboard?: Clipboard; copy(): void; paste(): void; deleteSelection(): void; // same handlers as SP03 shortcuts
}
```
If SP01 omits `copy/paste/deleteSelection`, SP02 supplies them from `copySelection` + paste-offset counter; they must be shared with shortcuts either way.

**Model ops (model.ts):**
- `level-properties`: after spreading, any building whose `owner` is not in the new `players` ids is set to `null` (single reducer pass → one history entry). [verified: level.ts:91 rejects unknown owners; today the op does not reassign]. Script-removal: deleted AI's script vanishes with the player; no message needed.
- `building-properties` / `obstacle-properties`: `value` becomes `Partial`; absent key = untouched, present-with-`undefined` = clear (`cleanOptional` already deletes undefined keys). Groups send disjoint key sets: Owner&level `{owner, level, ignoreForWin}`, Parameters `{params}`, Shape `{variant, yawDeg, footprint}`. Each group is keyed by JSON of its own fields so another group's Apply doesn't discard its draft.
- `delete-many { targets: Selection[] }`: folds the existing `delete` logic (script stripping for each building) in one pass; no-op returns same doc.
- `scriptRemovalMessages` text changes to `AI{index} script removed` (index from `playerLabel`). [verified: model.ts:83-86 uses `index + 1`; model.test.ts:66,71; e2e editor-forms.spec.ts `AI 2 script removed`.]

**Thumbnails (`thumbnails.ts`):** one async `getThumbnails()` memoized at module level → `Record<LibraryItem, string>` data URLs. Create one offscreen host (128×128, `position:fixed; left:-9999px`, laid out so ResizeObserver sizes it), one `createLevelScene` (reuses `render/scene.ts`, real `loadManifest()`, `loadCatalog`, `compileLevel` + `create` sim, as viewport-engine rebuild does), then per item `world.setLevel(...)` → render → `canvas.toDataURL()` synchronously after `scene.render()`; dispose scene (calls `forceContextLoss`) when done, so at most 2 WebGL contexts (canvas + thumbs) ever coexist [verified: scene.ts dispose → `renderer.forceContextLoss()`]. Each item is a tiny doc with theme = first manifest theme, one neutral building (houses/tower at origin) or, for obstacles, an obstacle plus a neutral house (camera framing uses building bounds: `levelVisualBounds(view, ids, anchors)`); implementer verifies whether the helper house can be hidden, else crops via tight camera; fallback text tile on any throw. Kick off after first manifest load, not blocking panel render.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Player id stability | Ids fixed; labels derived from position | Renumber ids on delete | Owners/scripts/bot refs key on ids [level.ts:133] |
| 2 | New AI id | lowest unused `pN`, N≥2 | max+1 | Deterministic; nothing keeps deleted ids (owners nulled) |
| 3 | Owner reassignment | In `level-properties` reducer | Separate op / dispatch two ops | One undo step, cannot leave invalid owners |
| 4 | Add/Delete staging | Draft until Apply | Immediate dispatch | Matches explicit-Apply form; single history entry |
| 5 | Partial group Apply | Partial op values | One op per group type | Smallest change; existing op reused |
| 6 | LOS group Apply | Apply sets preview only, no history | Live on change | Brief: every group has own Apply; keeps consistency |
| 7 | Label numbering | Per (owner, noun) in doc order | Global counter | Matches brief examples ("AI1 tower 1") |
| 8 | Multi-delete | New `delete-many` op | N dispatches | One undo step |
| 9 | Thumbnails | One scene, sequential, in-memory cache | One context per item; static PNGs | Context limits; "real game art" |
| 10 | Tile a11y name | Keep `Place {item}` | Friendly name | Existing e2e (editor-model:17,107,129; editor-play:33; z-custom-create:33) unchanged |
| 11 | Yaw snap | Always `snapYaw` on Shape apply | Toggle | Snap always on (brief) |
| 12 | `auto-fit` | SP02 leaves reducer; removes UI only | Remove op | SP03 owns bounds |

## Risks / Open Questions
- [RESOLVED: SP01 provides copy/paste/deleteSelection, data-ready, sr-only viewport-status] SP01 must expose `copy/paste/deleteSelection` and a ready signal; e2e currently wait on `viewport-status` "Ready" and `draft-summary` (forms:28,34, layout:57), both removed by SP01 — need replacement test hook (e.g. `data-ready` on canvas host).
- [RESOLVED: try helper framing in implementation; text tile fallback acceptable] Obstacle thumbnail framing with the helper house.
- [RESOLVED: SP01 first commit reformats; SP02 then SP03 run sequentially] Cross-SP: `model.ts` line 8 is one giant `DocOp` union line; SP02 and SP03 both edit it. Recommend first task of whichever lands first: reformat to one member per line (mechanical), then merge sequentially.
- [RESOLVED: SP03 removes 'auto-fit' op and its test, replaced by grow-only bounds] SP03 assumed to delete or replace `'auto-fit'` and its test (layout.test.ts:52); if it keeps it, no action.
- [RESOLVED: brief] Objective field hidden. [RESOLVED] Banner text becomes `AI{n}`.
- [DEFERRED] Persist thumbnail cache (sessionStorage) if load time matters; time it per brief risk table.

## Acceptance Criteria
- Unit (vitest): `level-properties` nulls owners of removed player and is one undo step (undo restores owners); add-AI id/color helpers; `delete-many` (scripts stripped, one undo, absent ids no-op); partial `building-properties` leaves other fields; `itemLabels` and `playerLabel` rules incl. renumber after delete; mirror cases removed, move-selection/undo test kept.
- E2E: add AI (disabled at 3, new color unique), delete AI with confirm count N, last AI delete disabled, Apply saves owners null; library drag places item and thumbnails are `<img>` (or text fallback) ; dropdown ↔ canvas click sync both ways; each group Apply changes only its fields; LOS group sets `.editor-los`; multi-select N/Select all/Clear/Copy/Paste/Delete with one Undo; no mirror/auto-fit/pointer text in DOM.
- Update specs: `editor-forms.spec.ts` (Level section, `p2`→AI1 labels, open groups, banner text, "Delete selected"→Delete), `editor-layout.spec.ts` (LOS selects, Grid snap :41, Copy selected, mirror/auto-fit :46-58 dropped), `editor-solvable.spec.ts:17-19`, `editor-finalize.spec.ts:35-37` (`Level properties` summary click), `editor-play.spec.ts:40-52`, `editor-model.spec.ts`/`z-custom-create.spec.ts` (selection hook), unit `layout.test.ts`, `model.test.ts:66,71`.
- Screenshot compare Level/Library/Selection panels vs `ref/` Canva references; green Apply buttons use SP01 primary class.
