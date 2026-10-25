# custom-level-fix agent files

- `brainstorm.md` — design brief: Canva-style level editor workspace (decisions, design, risks).
- `before/` — screenshots of current editor and main menu (pre-change baseline).
- `ref/` — Canva editor reference images (`canva-editor-01.jpg`) + `ref/README.md` (sources, internal only).
- `01-shell-topbar/`, `02-left-panel/`, `03-canvas/` — sub-project PRDs (`PRD.md` each).

## Sub-projects
| # | Folder | Scope | Depends on | Phase |
|---|---|---|---|---|
| 01 | `01-shell-topbar/` | Full-viewport shell, top bar, File modal, save chip, autosave, theme, `EditorContext` (owns all cross-SP seams), model.ts `DocOp` reformat | none | 1 |
| 02 | `02-left-panel/` | Level/Library/Selection sections, player add/remove, `delete-many`, mirror removal | 01 | 2 |
| 03 | `03-canvas/` | Canvas controls, shortcuts, 40×30 clamp, grow-only bounds, `auto-fit` removal | 01, 02 (sequential) | 3 |

## Dependency graph
```
01 -> 02 -> 03
```
02 and 03 run sequentially: both edit `model.ts` and Viewport-related code. SP01's first commit reformats the `DocOp` union (model.ts:8) one member per line.

## Locked cross-cutting decisions
- Grow-only bounds (SP03): bounds never shrink; `auto-fit` op and its test removed.
- Buildable area 40×30, computed once per doc open from bounds centre (`ctx.area`); `edit(op)` forwards `{type:'edit', op, area}`.
- Autosave: 5s interval tick; only after a successful manual Save of that doc id; only if dirty + valid + no job/save in flight; never finalizes; failure not retried until doc changes or manual Save.
- `EditorContext` owned by SP01 (incl. `deleteSelection()`, `area`, `edit`, copy/paste); SP02/SP03 consume it.
- Test hook: `data-ready="true"` on canvas host; `[data-testid=viewport-status]` kept sr-only (message only).
- File modal dirty-replace: Discard/Cancel only; `beforeunload` accepted by shared e2e helper.

## Consolidated risks
- SP01: `ctx.locked` during manual Save rejects edits briefly (same as today's `disabled=busy`).
- SP01 (deferred): extract Check/Finalize job hooks only if `Editor.tsx` > ~300 lines.
- SP02 (deferred): persist thumbnail cache (sessionStorage) if load time matters.
- SP02: thumbnails rendered once from game art; obstacle framing may fall back to text tile.
- SP03: group ghosts at clamped edge show clamped spot, not cursor (intended).
- SP03: ground extent change touches shared render code; guarded by optional param, game path unchanged.
- SP03 (deferred): auto-pan at edge while dragging; touch/pinch.
- Cross: model.ts shared by SP02/SP03; sequential merge required.
