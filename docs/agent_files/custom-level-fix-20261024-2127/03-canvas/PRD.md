---
status: draft
summary: Full-bleed pan/zoom editor canvas with a fixed 40x30 buildable area, clamped placement, grow-only bounds, grid, canvas controls and keyboard shortcuts; fixes the out-of-bounds blank render.
date: 2026-10-24
---
# PRD: Canvas (buildable area, camera, grow-only bounds, controls, shortcuts)

Repo/branch: node-arena, `custom-level-fix` (PR #24) · Depends on: SP01 (EditorContext, canvas-only `Viewport.tsx`) · Parallel with SP02 (shared file `model.ts`, see Risks)
Owns: `apps/web/src/editor/{viewport-engine.ts, Viewport.tsx}`, new `CanvasControls.tsx`, new `useShortcuts.ts`, `style.css` canvas rules (`.editor-workspace*`, `.canvas-*`), in `model.ts` only: area/clamp helpers, grow-only bounds, removal of `auto-fit`, snap simplification; small optional edit in `render/world.ts`+`ground-renderer.ts` (ground extent, R9).
Does not own: Editor.tsx/TopBar/FileModal (SP01), left panel / Properties / player + multi-delete + mirror-removal ops (SP02), `api.ts`, middleware, tools.

## TL;DR
Canvas fills the slot. A 40x30 buildable rectangle (fixed at doc open, centred on the then-bounds centre) is outlined; drops/moves/pastes are clamped into it in the engine ghost AND defensively in the reducer. Bounds only grow (2-unit margin), so the level always compiles and the preview never blanks; if it still fails, the last good render stays with an error badge. Camera: Space/middle/right/hand pan, cursor-anchored wheel zoom, limits fit-area .. 4x game camera, default geometric mean. Top-right icon controls, grid overlay, window shortcuts.

## Problem
- Dragging a building outside bounds commits an invalid doc; compile throws "Building position lies outside bounds" and the engine blanks the scene [verified: level.ts:103; viewport-engine.ts catch → `clearScene(); frameCamera()`; before/editor-out-of-bounds.png].
- Same blanking on any compile error (e.g. coincident buildings, level.ts "Coincident with building").
- Camera re-fits the game frame on every rebuild (`frameCamera` → `fitCamera(levelVisualBounds(...))`), so adding a building near an edge shifts the view under the user [verified: viewport-engine.ts:frameCamera]. Zoom is a bare clamp `.35–3` on `camera.zoom` [verified: `zoomBy`], unrelated to the playable area.
- No hand tool, no grid, snap is a checkbox, no shortcuts; zoom/pan controls live in the sidebar [verified: Viewport.tsx "View" block].

## Goals / Non-Goals
Goals: items can never be placed outside the 40x30 area; no blank preview; Canva-like navigation; shortcuts; grow-only bounds without user bounds management.
Non-goals: resize/rotate handles; touch/pinch; zoom % readout; per-level custom area size; mirroring (SP02 removes); auto-pan at edge during drag (DEFERRED).

## Requirements
**R1 Buildable area.** `AREA_W=40, AREA_H=30`. `buildableArea(bounds)` = rect centred on `((minX+maxX)/2, (minZ+maxZ)/2)` rounded to 0.25. Computed once per doc open by Editor (`ctx.area`, see Architecture), never recomputed on bounds growth, save, undo or redo. SVG overlay draws it as a solid 2px light-green/white outline with a faint outside shade (evenodd path) — distinct from the old dashed grey bounds. **Level bounds outline is removed** (user does not manage bounds; its only effect is invisible growth). Debug: bounds still reachable via `data-bounds` on the host.
**R2 Clamping.** Pure helpers in `model.ts`: `clampPoint(p, area)`, `clampDelta(points, delta, area)` (delta clamped per axis so the group's min/max stay inside; if the group is wider than the area on an axis, delta on that axis = 0). Applied: engine ghost/drag-preview + drop (`snapPosition` then clamp), reducer `place`, `move` (clampPoint), `move-selection` (clampDelta over selected items), `paste` (clampDelta over the offset clones; pasted group shifted as a unit). Reducer clamps only when the edit carries an area (below); items already outside the area (legacy import) are pulled in only when the op moves them.
**R3 Grow-only bounds.** `growBounds(doc)` runs as the last step of `reduceDocument` for `place`, `move`, `move-selection`, `paste`, `mirror` (until SP02 removes it): take buildings+elements whose pos lies outside `doc.bounds`; if none, return the same doc object (keeps `present === state.present` no-op semantics); else `bounds = union(doc.bounds, boundsFromPositions(offending))` (2-unit pad, floor/ceil — the existing `auto-fit` constants). Only offending points drive growth, so items that are merely inside never move an edge. Never shrinks; imported/opened docs are untouched until an edit pushes past an edge. Delete/undo never shrink (undo restores the prior snapshot incl. bounds).
**R4 Resilience.** On compile/scene failure keep the previous `scene/level/sim` rendered; set `stale=true`; picking, drag-move and marquee are disabled while stale (they would target ids from the old level); placement still works. `ViewportStatus` gains `error?: string`. `Viewport.tsx` renders a top-left badge `data-testid="preview-error"` ("Preview out of date — <message>", `role=alert`) while stale; cleared by the next good rebuild. Blank (0 buildings) path unchanged (outline + area only).
**R5 Camera model.** Replace implicit "refit every rebuild" with a cached **frame box**: visual bounds (`levelVisualBounds`) unioned with a 21x15 box centred on the area centre (largest campaign bounds), computed on the first successful rebuild of a doc id and on **Game camera**; edits no longer move the view. `fitCamera(...)` still builds the base pose from the frame box on resize. View state `{zoom, pan}` unchanged in meaning (`camera.zoom`, scene-frame x/z translation after `fitCamera`).
- `zoomMax = 4`. `zoomMin`: project the 4 area corners (y=0) at zoom 1; NDC scales linearly with `camera.zoom`, so `zoomMin = 0.96 / max(|ndc.x|/fracX, |ndc.y|/fracY)` over corners with the area centre as view centre (HUD padding fractions as in `fitCamera`). Recomputed on resize/area change. `zoomDefault = sqrt(zoomMin*zoomMax)`.
- **Fit area** = `zoom=zoomMin`, pan centres the area. **Game camera** = frame box recomputed from current content, `zoom=1`, pan 0. Initial view on doc open = default zoom, pan centred on frame box.
- Pan clamp: view-centre ground point kept inside the area (pan clamped in scene frame; z sign follows existing `pan.z -= …` convention).
- Wheel: `zoom *= exp(-deltaY*.001)` clamped, anchored to cursor: ground point under cursor before (`at()`), re-frame, ground point after, `pan += before − after` using the drag sign convention.
- Engine emits `callbacks.view({zoom, min, max, atMin, atMax})` after every frame; blank docs (no scene) use `blankCamera` with the same `camera.zoom`, game camera := fit-area pose.
**R6 Gestures.** Mode fixed at pointerdown (mid-gesture key changes ignored):
| Input | Result |
|---|---|
| Left on item (hand off, no Space) | select (+Shift toggles); drag moves selection (clamped) |
| Left on empty | clear selection; drag ≥5px = marquee (unchanged) |
| Left + Hand toggle on, or Space held | pan; no pick/select change |
| Middle / right / Alt+left | pan (Alt kept: zero cost, existing muscle memory) |
| Library drag (SP02 `beginPlacement`) | placement ghost clamped; canvas pointerdown ignored while placing; Esc cancels |
Pointer capture stays on the canvas element (`setPointerCapture`); `lostpointercapture` cancels. Cursor: `grab/grabbing` for pan modes. `contextmenu` suppressed (kept).
**R7 Canvas controls** (`CanvasControls.tsx`, absolute top-right of the canvas slot, white rounded pill cluster, inline-SVG icons, `aria-label` + `title`): Zoom out (−), Zoom in (+) — `disabled` at `atMin/atMax` (from `callbacks.view`); Fit area; Game camera; Hand (`aria-pressed`); Show grid (`aria-pressed`, default off, persisted in `localStorage` try/catch). Step factor 1.25. No zoom %.
**R8 Grid.** SVG overlay lines every 1 unit across the area (z‑order below selection rings), 25% opacity, major line every 5 units slightly stronger; hidden when less than 8px apart (lines at 1 unit only; snap stays 0.25 — grid is a reference, not the snap lattice). Pure overlay (no geometry). Snap is unconditional: remove `setSnap`, `snap` variable and the `snap` arg paths; `snapPosition(point)` always snaps to 0.25, `snapYaw(v)` always 15° (keep optional `enabled` param for test compatibility, default true; callers stop passing it).
**R9 Ground coverage.** Ground plane is `max(prefab ±50 x ±30 data units, bounds+12)` around the level origin [verified: planGround]. A 40x30 area centred near origin is covered, but at zoom-min the perspective view shows beyond it, and an area centre offset >~10 units could reveal void. Add optional `groundExtent?: Bounds` to `world.setLevel` (union with bounds in the ground call only; no sim change) and have the engine pass the area ±12. Visual-only; no content/RULES version impact.
**R10 Shortcuts** (`useShortcuts.ts`, `window` keydown, mounted by `Viewport.tsx`; no-op when `event.target` is input/select/textarea/contenteditable or a modal (`[aria-modal=true]`) is open, or `ctx.locked`): Delete/Backspace → delete selection; Ctrl/Cmd+C/V → `ctx.copy()/paste()`; Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z (and Ctrl+Y) redo; Ctrl/Cmd+S → `preventDefault`, `ctx.save()`; Esc → cancel placement else clear selection; Space (hold) → pan mode, only while the pointer is over the canvas and focus is not a text field (so Space still activates focused buttons elsewhere); `preventDefault` on keydown+keyup in that case; `window blur` clears it. Delete uses SP02's multi-delete op (assumed `ctx.deleteSelection()`; fallback `edit({type:'delete-selection', targets})`).

## Architecture
Engine API changes: `setArea(area)`, `setGrid(bool)`, `setHand(bool)`, `zoomBy`, `fitArea()`, `gameCamera()`, `cancelPlacement()`; callbacks gain `view`, status gains `error`; removed `setSnap`, `pointer` callback (SP02 removes readout; keep as optional unused-safe), `setLos` kept for SP02.

Cross-SP contract additions (SP01 file, minimal):
```ts
interface Area { minX: number; maxX: number; minZ: number; maxZ: number }
// EditorContext additions
area: Area;                  // buildableArea(doc.bounds) captured at doc open only
// HistoryAction edit carries it so the reducer can clamp defensively
{ type: 'edit'; op: DocOp; area?: Area }   // ctx.edit() attaches ctx.area
```
`Viewport.tsx` (canvas-only): creates engine once, assigns `ctx.viewport.current`, pushes `doc`/`area` via effects, renders host div, `CanvasControls`, error badge, hidden status element, calls `useShortcuts()`. Sidebar-state it used to own is gone (SP01).

Camera decision detail: zoom limits are in `camera.zoom` units relative to the frame box (consistent with existing `gameCamera()` zoom=1 and the e2e assertion `camera.zoom === 1`). Default-zoom check (estimate, to be measured in task 1): frame 21x15 + camera margin 3, framing .87 vs area 40x30 → `zoomMin ≈ 0.5–0.6`, default ≈ √(0.55·4) ≈ 1.5 > 1 (current default 1) — satisfies "a bit more zoomed in". For levels whose real visual bounds are tiny the 21x15 floor keeps min ≥ ~.5 so default never drops below 1.4.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Area anchoring | Fixed at doc open, from bounds centre | Follow bounds as they grow | Stable spatial frame; clamp/undo deterministic; growth is bounded anyway (items live inside the area) |
| 2 | Where area lives | `ctx.area` + `area` on edit action | Engine-only clamp; derive from bounds in reducer | Reducer stays pure/defensive; derive-from-bounds would drift after growth |
| 3 | Level bounds outline | Removed | Keep dashed | Brief: user doesn't manage bounds; two rectangles confuse |
| 4 | Growth trigger | Only offending points, union | Recompute from all items | Existing levels/edges untouched unless pushed |
| 5 | `auto-fit` DocOp | Remove (op, union member, layout.test.ts:52 case); SP02 removes button | Keep op | Dead path; grow-only replaces it |
| 6 | Camera refit on edit | Cached frame box (doc open / Game camera) | Refit every rebuild (today) | View must not jump while editing; limits need a stable reference |
| 7 | Zoom default | Geometric mean of min,max | Arithmetic mean | Zoom is multiplicative: equal steps each way |
| 8 | Zoom limits | `camera.zoom` relative to frame box, min from corner projection | World-unit distance | Keeps existing `gameCamera` semantics + e2e; projection is exact for perspective |
| 9 | Grid | 1-unit lines, snap 0.25 | Draw 0.25 lattice | 0.25 lines are noise at all but max zoom |
| 10 | Alt+drag pan | Kept | Remove | Free, no conflict |
| 11 | Wheel zoom | Cursor-anchored via ground raycast | Centre zoom | Raycast helper already exists; feasible |
| 12 | Failed compile | Keep last render + badge, disable pick/drag | Blank (today) | Brief: no blank; clamp+grow make it rare, badge covers the rest |
| 13 | `viewport-status` testid | Keep as visually hidden (`sr-only`) element in `Viewport.tsx`, text = message only (no ms) | Remove; replace with `data-ready` | ~10 specs wait on it; visible status is gone, so hidden hook costs nothing. Also add `data-ready="true"` on host for SP02 |
| 14 | Space with focused button | Pan only when pointer over canvas | Always capture Space | Keeps keyboard activation of toolbar buttons |

## Manual steps
None.

## Risks / Open Questions
- [RESOLVED: keep hidden `viewport-status`, per Decision 13 — answers SP01 OPEN] 
- [RESOLVED: SP01 supplies `ctx.area`/`area` on edit, SP03 supplies helpers] cross-SP contract above; SP01 must accept it.
- [RESOLVED: SP01 reformat commit; SP02→SP03 sequential] `model.ts` line 8 single-line `DocOp` union edited by SP02 and SP03 (SP02 already flagged): agree one mechanical reformat commit first, then SP02 and SP03 merge sequentially (not parallel on this file).
- [RESOLVED: SP01 adds deleteSelection] SP02 expects `ctx.deleteSelection()`; SP01 interface lacks it. Whoever lands first adds it; shortcut uses it.
- [RESOLVED: pull in on edit only] legacy docs with items outside area: untouched until moved; group wider than area → axis delta 0.
- [RESOLVED: 21x15 floor] tiny/blank levels give a sensible game frame.
- Risk: overlap of group ghosts with clamp at edge shows ghost at clamped spot, not the cursor — intended; no extra cue.
- Risk: ground extent change touches shared render code; guarded by optional param, game path passes nothing.
- [DEFERRED] auto-pan at edge while dragging; touch/pinch.

## Acceptance Criteria
- Unit (`test/editor/model.test.ts`, `layout.test.ts`): `clampPoint/clampDelta` (inside, outside, group wider than area); reducer clamps place/move/move-selection/paste with area, no clamp without; `growBounds`: no-op returns same doc, one-side growth uses 2-pad + floor/ceil, never shrinks, ignores inside items, undo restores bounds, no-op move still returns same doc; `auto-fit` tests replaced.
- E2E (`editor-viewport.spec.ts` new cases): drag/drop a building far outside area → lands on area edge, preview stays rendered (no `Preview unavailable`), bounds grew; coincident-building drop keeps last render + `preview-error` badge, picking disabled, fixed by undo; Space+drag, hand toggle, middle/right drag pan; marquee still works with hand off; wheel zoom keeps point under cursor (±2px); zoom stops at limits, − / + `disabled` at min / max; Fit area shows whole outline in viewport; Game camera → `camera.zoom === 1`; default zoom > 1 on `na-trial` and on a blank doc (measured and recorded); area outline present and distinct, grid toggle draws lines; shortcuts: Delete removes selection, Ctrl+C/V adds clamped copies, Ctrl+Z/Ctrl+Shift+Z, Ctrl+S saves (page not blocked), none fire while typing in an input or with FileModal open, Esc cancels placement then clears selection.
- Screenshot at 1280x720 and 1920x1080 vs `ref/canva-editor-01.jpg`: controls cluster top-right, area outline visible, ground covers viewport at Fit area for `na-trial` and a blank-with-one-building doc.
- Existing specs to update: `editor-viewport.spec.ts` (zoomBy/gameCamera calls remain valid; pan via `button: 'middle'` still valid; add Start screen change from SP01), `editor-layout.spec.ts` (remove `Grid snap` checks lines 26/38, `Auto-fit bounds`/`bounds-preview` lines 52–57 → replace with grow-only assertion), `editor-model.spec.ts` (`viewport.setSnap(false)` line 62 → remove), plus any spec using sidebar `Zoom in`/`Game camera` labels (move to canvas controls, same aria-labels).
- `pnpm typecheck && pnpm lint && pnpm test:web:e2e` green; unit tests green.
