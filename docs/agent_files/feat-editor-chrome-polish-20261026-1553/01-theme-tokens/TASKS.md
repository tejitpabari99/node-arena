---
status: done
summary: Task breakdown for the editor theme tokens and base primitives (SP01), foundation for SP02-05.
date: 2026-10-26
---
# Tasks: Editor theme tokens & typography (SP01)
Source of truth: [PRD.md](PRD.md). Rewrites `apps/web/src/editor/style.css` into a token set plus shared primitives with a neutral Inter/system-ui look. Lands first (order 01 → 02 → 05 → 04 → 03); the `.canvas-controls` block is left alone except tokens.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Tokens, base reset, game-sheet leak override | - | done |
| 2 | Button, field and focus primitives | 1 | done |
| 3 | Menu, popover and row primitives | 1 | done |
| 4 | Modal, toast, panel/section and status primitives | 1 | done |
| 5 | Remove Coiny and delete dead legacy CSS | 2, 3, 4 | done |
| 6 | Verification: contrast, tests, screenshots | 5 | done |

## Task 1 — Tokens, base reset, game-sheet leak
What it is / what it means: The `--ed-*` design token set (font stack, type scale, greys, accent, semantics, radii, shadows, spacing, z-index, controls gutter) that every later primitive and sibling project consumes (PRD Req 1, 2; D1-D5, D9, D10).
What changes at a high level: Define tokens on `.ed-shell, .editor-shell` in a sectioned `style.css`. Add base reset (13px font, text colour, 600-weight headings, `color-scheme: light`). Style bare `button` as the default `.ed-btn`. Neutralise leaked game `:root` font/colour and sky body via `body:has(.ed-shell)`. Old tokens removed or aliased only if a grep shows references. Include `--ed-controls-gutter`. Leave the `.canvas-controls` block alone except token swaps.
Done when: All PRD tokens exist; editor body is neutral; no Coiny inherited by chrome text; old-token grep is clean or aliased; editor still renders.

## Task 2 — Button, field and focus primitives
What it is / what it means: Core interactive controls used everywhere (PRD Req 3, 4, 11; D7, D10, D11).
What changes at a high level: Add `.ed-btn`, `-primary`, `-ghost`, `-icon` with hover/active/disabled states, no slab shadows, gradients or pills. Keep `ed-btn-primary` and `ed-caret` class names for existing TSX/e2e selectors. Style inputs/selects/textareas (28px, accent focus ring), labels, and `.ed-field-hint`. Add a global `:focus-visible` ring on interactive chrome.
Done when: Buttons and fields render per spec in existing UI; focus ring is visible on buttons and inputs; existing selectors still resolve.

## Task 3 — Menu, popover and row primitives
What it is / what it means: Surfaces SP03 needs for the File menu, Share panel and Check results, defined now so SP03 invents none (PRD Req 5, 6).
What changes at a high level: Add `.ed-menu`, `.ed-menu-item` (disabled state, `.ed-menu-kbd`, `.ed-menu-icon`), `.ed-menu-sep`, `.ed-popover`, `.ed-popover-title`, `.ed-row`. Popovers use `z-index: var(--ed-z-pop)`. Positioning is left to callers.
Done when: Primitives exist and render correctly in a throwaway demo state or existing UI; keyboard focus shows the ring on menu items.

## Task 4 — Modal, toast, panel/section and status primitives
What it is / what it means: Remaining shared surfaces and text states (PRD Req 7-10; D5).
What changes at a high level: Add `.ed-modal` (12px radius exception), title, backdrop, actions, `.ed-divider-or`, `.ed-group-box`. Restyle `.ed-toast` (dark surface, action link, error/success variants; same top-center slot). Add `.ed-panel`, flat `.ed-section`, `.ed-section-title`, `.ed-group > summary`. Add `.ed-status` with saved/saving/unsaved/issues states; restyle `.ed-chip` borderless. `FileModal.tsx` keeps its `editor-shell` wrapper as token scope (class hook only).
Done when: Each primitive exists and renders in existing UI; toast slot unchanged; FileModal picks up tokens.

## Task 5 — Remove Coiny and delete dead legacy CSS
What it is / what it means: Cleanup so no old game-menu look remains (PRD Req 12, 13; D6).
What changes at a high level: Strip Coiny from every chrome rule. Re-grep each selector before deleting the D6 delete-list (`.editor-start-grid`, `.editor-hint`, `.editor-shell header span`, legacy `.editor-shell` label/input/select/button/`[role=alert]` blocks). Keep the D6 keep-list, `.editor-play-overlay` and canvas overlay rules untouched.
Done when: `grep -n Coiny apps/web/src/editor/style.css` returns only the play-overlay line; no `box-shadow:0 3px`, `999px` radius or gradient/text-shadow buttons in chrome CSS; re-grep proof recorded.

## Task 6 — Verification: contrast, tests, screenshots
What it is / what it means: Evidence the foundation is accessible and regression-free (PRD Acceptance Criteria; resolved tests/accent items).
What changes at a high level: Run a contrast script (body, muted, white-on-accent, saved green, toast text all ≥ 4.5:1; tune accent if needed). Run the editor unit suite (103 passing) and Playwright `editor-*.spec.ts`. Capture Playwright screenshots at 1440x900 of the nine `before/` states into `F/after/`, compared against `F/before/` and `F/ref/` (canva.png); also confirm the play overlay and game `/` UI are unchanged.
Done when: Contrast ≥ 4.5:1 for all listed pairs; all tests green; screenshots in `F/after/` show no Coiny, pills or green slab buttons.
