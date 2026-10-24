---
status: draft
summary: 9 tasks - pure clamp/grow-only bounds first (fixes blank render), then resilience, camera, area/grid overlay, gestures, controls, shortcuts, final verification.
date: 2026-10-24
---
# Tasks: Canvas (buildable area, camera, grow-only bounds, controls, shortcuts)
Source of truth: docs/agent_files/custom-level-fix-20261024-2127/03-canvas/PRD.md. SP01 (EditorContext with area, edit forwarding, data-ready, sr-only viewport-status, deleteSelection) and SP02 (delete-many, mirror removed, auto-fit left for this SP) are fully implemented first. Tasks 1-2 are pure model work and fix the out-of-bounds blank bug on their own.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Area helpers and reducer clamping | - | todo |
| 2 | Grow-only bounds, remove auto-fit | 1 | todo |
| 3 | Resilient preview with error badge | 2 | todo |
| 4 | Camera model: frame box, zoom limits, anchored wheel | 3 | todo |
| 5 | Buildable-area outline, ghost clamp, always-on snap, ground extent | 1, 4 | todo |
| 6 | Pan gestures, hand mode, grid overlay | 4, 5 | todo |
| 7 | Canvas controls cluster | 4, 6 | todo |
| 8 | Keyboard shortcuts | 6, 7 | todo |
| 9 | Final verification: e2e and screenshots | 1-8 | todo |

## Task 1 — Area helpers and reducer clamping
What it is / what it means: R1 (area math), R2, Decision 2. Pure model layer; items can no longer commit outside the 40x30 area.
What changes at a high level: add the area type constants and `buildableArea(bounds)` (centred, rounded to 0.25), `clampPoint`, `clampDelta` (per-axis, zero delta when the group is wider than the area). The reducer uses the `area` carried on the edit action to clamp `place`, `move`, `move-selection` and `paste` (pasted group shifted as a unit); with no area, no clamping. Legacy items outside the area are pulled in only when an op moves them. Unit tests added.
Done when: model/layout unit tests cover inside, outside and wider-than-area cases and the with/without-area reducer behavior; typecheck and lint green.

## Task 2 — Grow-only bounds, remove auto-fit
What it is / what it means: R3, Decisions 4 and 5. Bounds only expand, so the level always compiles and never errors on bounds.
What changes at a high level: `growBounds` runs last in `reduceDocument` for place, move, move-selection, paste (and mirror if still present), driven only by offending points, 2-unit pad with floor/ceil, never shrinking, returning the same doc object when nothing is outside. Remove the `auto-fit` op, its union member and the layout test case. Undo restores prior bounds via the snapshot.
Done when: unit tests cover no-op identity, one-side growth, no shrink, inside items ignored, undo restores bounds; auto-fit tests replaced; `editor-layout.spec.ts` auto-fit/`bounds-preview` checks replaced by a grow-only assertion.

## Task 3 — Resilient preview with error badge
What it is / what it means: R4, Decision 12. A failed compile no longer blanks the scene.
What changes at a high level: on compile/scene failure the engine keeps the last scene, level and sim, sets stale, and disables picking, drag-move and marquee while stale (placement still works). Status gains an error message; `Viewport.tsx` shows the top-left `preview-error` alert badge until the next good rebuild. The blank (0 buildings) path is unchanged. The hidden `viewport-status` element and `data-ready` stay as SP01 defined.
Done when: e2e drops a coincident building, sees last render plus badge, picking disabled, undo clears the badge; out-of-bounds drop no longer shows `Preview unavailable`.

## Task 4 — Camera model: frame box, zoom limits, anchored wheel
What it is / what it means: R5, Decisions 6, 7, 8, 11. Stable view that does not jump on edit.
What changes at a high level: replace refit-on-every-rebuild with a cached frame box (visual bounds unioned with the 21x15 floor box at the area centre), recomputed on first good rebuild of a doc and on Game camera. Zoom max 4, zoom min from area-corner projection, default the geometric mean. Add Fit area and Game camera operations, pan clamped to keep view centre inside the area, cursor-anchored wheel zoom, and a view callback (zoom, min, max, atMin, atMax) after each frame. Blank docs use the blank camera with the same zoom semantics. Measure and record default zoom on `na-trial` and a blank doc.
Done when: e2e shows edits do not move the view, wheel keeps the cursor point within 2px, zoom stops at limits, Fit area shows the whole area, Game camera gives `camera.zoom === 1`, default zoom above 1.

## Task 5 — Buildable-area outline, ghost clamp, always-on snap, ground extent
What it is / what it means: R1 overlay, R2 engine side, R8 snap, R9, Decision 3.
What changes at a high level: engine gets `setArea`; the SVG overlay draws the solid 2px area outline with faint outside shade and drops the old dashed bounds outline (bounds stay in `data-bounds`). Drop and drag ghosts snap then clamp to the area. Remove `setSnap` and the snap arg paths; snapping is unconditional. Add the optional `groundExtent` to the world level setup so the ground covers area plus 12 at Fit area; game path unchanged.
Done when: e2e drag/drop far outside lands on the area edge with bounds grown and preview intact; outline visible and distinct; `setSnap(false)` use removed from `editor-model.spec.ts` and Grid snap checks removed from `editor-layout.spec.ts`.

## Task 6 — Pan gestures, hand mode, grid overlay
What it is / what it means: R6, R8 grid, Decisions 10 and 14.
What changes at a high level: engine gains `setHand`, `setGrid`, `cancelPlacement`. Gesture mode is fixed at pointerdown: left on item selects or drags (clamped); left with hand on or Space held pans; middle, right and Alt+left pan; canvas pointerdown ignored while placing. Pointer capture and lostpointercapture cancel are kept, with grab/grabbing cursors. Grid draws 1-unit lines with a stronger line every 5 under the selection rings, hidden when under 8px apart.
Done when: e2e covers hand-toggle pan, Space+drag, middle/right drag, marquee still working with hand off, and the grid drawing lines when enabled.

## Task 7 — Canvas controls cluster
What it is / what it means: R7. Zoom and view controls move from the old sidebar to the canvas.
What changes at a high level: new `CanvasControls.tsx`, top-right pill cluster with icon buttons and aria-label/title: Zoom out, Zoom in (disabled at limits via the view callback, step 1.25), Fit area, Game camera, Hand (`aria-pressed`), Show grid (`aria-pressed`, default off, persisted in localStorage with try/catch). No zoom percentage. Specs that used sidebar `Zoom in`/`Game camera` labels point at the canvas controls.
Done when: e2e shows each control working, +/- disabled at max/min, grid toggle persisted across reload.

## Task 8 — Keyboard shortcuts
What it is / what it means: R10. Window-level editing shortcuts.
What changes at a high level: new `useShortcuts.ts` mounted by `Viewport.tsx`: Delete/Backspace via `ctx.deleteSelection()`, Ctrl/Cmd+C/V, Z, Shift+Z, Y, S (preventDefault, `ctx.save()`), Esc cancels placement then clears selection, Space hold pans only while the pointer is over the canvas and focus is not a text field, cleared on window blur. No-op in inputs, with an open modal, or when `ctx.locked`.
Done when: e2e covers each shortcut, including none firing while typing or with FileModal open, Ctrl+S saving without blocking the page, and Space still activating a focused button elsewhere.

## Task 9 — Final verification: e2e and screenshots
What it is / what it means: PRD acceptance sweep, no new features.
What changes at a high level: reconcile remaining spec edits across `editor-viewport`, `editor-layout`, `editor-model` and any sidebar-label users; run typecheck, lint, unit and e2e. Capture screenshots at 1280x720 and 1920x1080 for `na-trial` and a blank-with-one-building doc and compare against `ref/canva-editor-01.jpg` (controls top-right, outline visible, ground covers the viewport at Fit area); iterate on mismatches.
Done when: `pnpm typecheck && pnpm lint && pnpm test:web:e2e` and unit tests are green; screenshots match the reference; measured default zoom recorded.
