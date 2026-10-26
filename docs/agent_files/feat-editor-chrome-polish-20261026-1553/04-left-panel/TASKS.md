---
status: in-progress
summary: Five tasks - param label table, label rendering and selectors, read-only troop, level id row, SP01 restyle with 1440x900 screenshots.
date: 2026-10-26
---
# Tasks: SP04 Editor left panel
Source of truth: `docs/agent_files/feat-editor-chrome-polish-20261026-1553/04-left-panel/PRD.md`. Content-only polish of LevelSection/SelectionSection plus SP01 restyle; no schema, content, or rules changes. Depends on SP01 tokens; lands after 01, 02, 05; before 03.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Param label table and helper | - | done |
| 2 | Render labels, tooltips, selectors | 1 | done |
| 3 | Read-only troop row | 2 | done |
| 4 | Level id row | - | done |
| 5 | SP01 restyle and screenshots | 2, 3, 4, SP01 | in-progress |

## Task 1 — Param label table and helper
What it is / what it means: One source of human labels and tooltips, kept out of defs/content so identities do not move (R2, D1, D7).
What changes at a high level: In `labels.ts` add `PARAM_LABELS` keyed `module.field` with the PRD table (label + one-line tooltip) and `paramLabel(module, field)` falling back to humanized camelCase. Verify tooltip wording against GAME_RULES (R-TWR-01 etc.).
Done when: `labels*.test.ts` asserts every field of every archetype module has an entry, fallback humanizes (`growTime` -> "Grow time"), and no label matches the `module field` identifier pattern.

## Task 2 — Render labels, tooltips, selectors
What it is / what it means: Parameters show plain English with hover help (R3, R4, R6, D2, D6).
What changes at a high level: `ParamsGroup` renders `label` and sets native `title` tooltip on the `<label>`; boolean selects keep "Default (Yes/No)". `OwnerGroup` ignoreForWin checkbox becomes "Optional target (not needed to win)" with tooltip, accessible name = label. Field order and the archetype-default hint unchanged. Update old-label selectors in `editor-forms.spec.ts` (lines ~42, 44) and any in `editor-selection`/`editor-level-section` specs.
Done when: the four verbatim labels appear; vitest editor suite and Playwright `editor-{level-section,selection,forms}.spec.ts` green.

## Task 3 — Read-only troop row
What it is / what it means: No way to type an invalid unit; overrides survive (R5, D3, D4).
What changes at a high level: In `SelectionSection`, replace the `spawns.troop` input with a read-only "Unit produced" row showing the humanized effective unit (`params.spawns.troop ?? archetype default`); append "(override)" with tooltip when set. `change()` never touches troop; params clone round-trips. No clear-override.
Done when: component test: no input, default shows archetype unit, `troop='tank'` shows Tank "(override)", saved JSON still contains the override; e2e selection spec green.

## Task 4 — Level id row
What it is / what it means: Immutable id visible above the name (R1, D5).
What changes at a high level: `LevelSection` gets first row "Level id" showing `doc.id` as plain selectable read-only text with `title` "Fixed when the level is created". `toDraft`/`LevelProperties`/Apply payload untouched.
Done when: test asserts the row precedes "Level name", is not editable, and the Apply payload is unchanged; `editor-level-section.spec.ts` updated and green.

## Task 5 — SP01 restyle and screenshots
What it is / what it means: Left panel uses shared tokens/primitives only (R8).
What changes at a high level: In the left-panel block of `style.css` delete bespoke button/chip/input rules (`.ed-level*`, `.ed-hint`, params/selection); use `.ed-section*`, fields, `.ed-field-hint`, Apply as `.ed-btn-primary`, `Add AI`/`Delete`/confirm as `.ed-btn`. Panel width stays 300px; edit only the left-panel block.
Done when: `editor-shell.spec.ts` 300px assertion passes; Playwright captures 1440x900 screenshots of Level section and building Parameters into `docs/agent_files/feat-editor-chrome-polish-20261026-1553/after/`, matching the SP01 look (no Coiny, tokens only); full `editor-*.spec.ts`, `pnpm test`, `lint`, `typecheck` green.
