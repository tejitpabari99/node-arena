---
status: approved
summary: Editor chrome polish — File/Share menus, versioning, map controls, theme
date: 2026-10-26
---

# Editor chrome polish

Brief: `brainstorm.md`. Screenshots: `before/` (current editor, 9 shots), `ref/` (`canva.png` Share panel, `gmaps.png` map controls).

## Sub-projects
| # | Name | Scope | Depends | Status |
|---|---|---|---|---|
| 01 | theme-tokens | `--ed-*` tokens, Inter/system stack, base button/input/menu/popover/modal/toast styles | none | done |
| 02 | versioning-save | `editorVersion` 0.0.N, 30s autosave, Finalize saves first, server Duplicate op | none | done |
| 03 | topbar-menus | Back + File menu, dialogs, Share panel, Check flow, save status | 01, 02, 05 | draft |
| 04 | left-panel | Read-only level id, param labels/tooltips, read-only troop | 01 | done |
| 05 | map-controls | Vertical map-style canvas controls | 01 | done |

## Dependency graph
```mermaid
graph LR
  01 --> 05
  05 --> 03
  05 --> 04
  01 --> 03
  01 --> 04
  02 --> 03
```
Recommended landing order: 01, 02, 05, 04, 03 (single shared `style.css`; 01 first).

## Locked decisions
Base origin/main (#24 merged). Back + File top-left (Create/Duplicate/Open/Undo/Redo). Canva-style Share panel top-right (Save, Finalize without gate and saving first, Check with spinner/toast/results popover, nothing persisted). Plain "✓ Saved" status. Play kept. `editorVersion` 0.0.N per real save, no-op when unchanged, new/copies 0.0.1, missing 0.0.0; autosave 30s; no schemaVersion bump. Back confirms if unsaved; Duplicate-when-dirty = Save & duplicate / Cancel. Neutral theme, no webfont, accent `#2563c9` tuned in review, 56px bar. Details in `brainstorm.md`.

## z / gutter contract
- `--ed-controls-gutter: 56px` (12 inset + 36 card + 8 gap), defined in SP01 tokens.
- Map controls `z-index: 3`.
- Popovers, Share panel, Check flyout: `z-index: var(--ed-z-pop)` (5). Toasts 15, modals 20.
- Right-anchored panels keep `right >= var(--ed-controls-gutter)` so the column stays visible.

## Remaining cross-cutting risks / open questions
- Open: SP01 `.canvas-controls` block in `style.css` shared with SP05; SP01 only swaps tokens, SP05 rewrites (order 01 -> 05).
- Open: SP05 assumes SP01 tokens (`--ed-sh-md`, `--ed-r-lg`, `--ed-accent-soft`, `--ed-g-*`) exist; SP05 task must follow SP01.
- Verify (SP02 task): content gates (`check:content`, `validate:content --base HEAD`, `tools/test/gates.test.ts`) vs level file change with unchanged simHash; exempt editorVersion if flagged.
- Verify (SP04): tooltip wording vs R-TWR-01 / GAME_RULES.
- Risk: one shared CSS file across 5 sub-projects; large e2e churn (shared helper `apps/web/e2e/editor-helpers.ts`).
- Deferred: self-hosted Inter, dark mode, arrow-key nav in Share panel, map-control extras (minimap, tooltips with shortcuts).

## Folder contents
- `brainstorm.md`, `README.md`
- `01-theme-tokens/` ... `05-map-controls/` (each `PRD.md`)
- `before/` current-editor screenshots; `ref/` reference screenshots

## SP01 implementation and review artifacts
- [Implementation run (all six tasks)](01-theme-tokens/code-20261026-1714.md)
- [Legacy cleanup proof](01-theme-tokens/code-20261026-1655.md)
- [Verification, contrast and captures](01-theme-tokens/code-20261026-1705.md)
- [Initial review — NEEDS_CHANGES, one stacking fix](01-theme-tokens/review-2026-10-26-1714.md)
- [Verification results](01-theme-tokens/verification-results.json), [browser harness](01-theme-tokens/verify-theme.mjs)
- [SP01 screenshots and protected baselines](01-theme-tokens/screens/), [nine after states and additional captures](after/)

SP01's six planned tasks and stacking review fix are complete; all three final reviewers PASS.

- [Final SP01 review — PASS](01-theme-tokens/review-2026-10-26-1718.md)

## SP02 implementation artifacts
- [Implementation run (all six tasks)](02-versioning-save/code-2026-10-26-1745.md)
- [Save-first Finalize and full final verification](02-versioning-save/code-2026-10-26-1743.md)

SP02's six tasks are complete; Bug Hunter, Security and Architect PASS.

- [Final SP02 review — PASS](02-versioning-save/review-2026-10-26-1746.md)

## SP05 implementation artifacts
- [Implementation run (all four tasks)](05-map-controls/code-2026-10-26-1759.md)
- [Layout regression, captures and final verification](05-map-controls/code-2026-10-26-1755.md)
- [Eleven screenshots](05-map-controls/screens/), [browser harness](05-map-controls/verify-controls.mjs), [machine results](05-map-controls/verification-results.json)

SP05's four tasks are complete; Bug Hunter, Security and Architect PASS. Share/Check gutter integration remains a cross-cutting SP03 follow-up, as explicitly permitted by SP05 Task 4.

- [Final SP05 review — PASS](05-map-controls/review-2026-10-26-1759.md)

## SP04 implementation artifacts
- [Implementation run (all five tasks)](04-left-panel/code-2026-10-26-1829.md)
- [Styling, captures and full verification](04-left-panel/code-2026-10-26-1818.md)
- [Three screenshots](04-left-panel/screens/), [browser harness](04-left-panel/verify-left-panel.mjs), [machine results](04-left-panel/verification-results.json)

SP04's five tasks are complete; Bug Hunter, Security and Architect PASS.

- [Final SP04 review — PASS](04-left-panel/review-2026-10-26-1829.md)
