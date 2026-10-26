---
status: in-progress
summary: Task breakdown for Google-Maps-style vertical canvas controls (SP05); requires SP01 merged first.
date: 2026-10-26
---
# Tasks: Map-style canvas controls (SP05)
Source of truth: [PRD.md](PRD.md). Replaces the horizontal pill of canvas controls with a top-right column of 36px cards. Depends on SP01 being merged first (landing order 01 → 02 → 05 → 04 → 03); SP05 owns the `.canvas-controls` / `.canvas-btn` CSS block.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Restructure markup, icons and DOM order | SP01 merged | done |
| 2 | Column, card and button styling with stacking contract | 1 | done |
| 3 | Update viewport tests for stacking and inset | 2 | in-progress |
| 4 | Verification and screenshots | 3 | in-progress |

## Task 1 — Restructure markup, icons and DOM order
What it is / what it means: Group the six buttons into cards while keeping all behaviour, labels and test ids (PRD Req 1, 3, 6; D2, D3, D8).
What changes at a high level: In `CanvasControls.tsx`, wrap Zoom in + Zoom out in a joined zoom card (in that DOM order), and give Fit area, Game camera, Hand, Show grid one card each. Container keeps `data-testid`, `role="group"` and `aria-label`. Zoom icons become plain `+` / `−` glyphs; other icon paths unchanged. Every button keeps exact `aria-label`/`title` and `aria-pressed` on toggles. No viewport-engine or localStorage change.
Done when: Tab order is Zoom in, Zoom out, Fit, Game camera, Hand, Grid; labels and titles match exactly; behaviour is unchanged.

## Task 2 — Column, card and button styling with stacking contract
What it is / what it means: The Maps-like visual and the collision contract with SP03 popovers (PRD Req 2, 4, 5, 7, 8; D1, D4-D7).
What changes at a high level: Rewrite the `.canvas-controls` / `.canvas-btn` block using SP01 tokens only: absolute top/right at `--ed-s-3`, flex column with 8px gap, no container background, `pointer-events:none` on container and `auto` on cards. Cards 36px with `--ed-r-lg` radius and `--ed-sh-md`; zoom divider hairline. Icons 20px, grey default, hover, accent-soft pressed, disabled .35, inset focus ring. Controls z-index 3, below `--ed-z-pop`; right-anchored popovers honour `--ed-controls-gutter`.
Done when: No hardcoded hex, `999px` or `50%` in the block; column renders at 12px inset; focus ring is unclipped on every button.

## Task 3 — Update viewport tests for stacking and inset
What it is / what it means: Lock the new layout in with automated checks (PRD Acceptance, tests item).
What changes at a high level: In the canvas-controls test in `editor-viewport.spec.ts`, add assertions that the six buttons are vertically stacked (strictly increasing `y`, equal `x` and width) and inset 12px from the `.ed-canvas` top/right, reusing layout bounds helpers if present. Existing assertions (including `title === name`) and `editor-model.spec.ts` stay unchanged and passing.
Done when: `editor-viewport.spec.ts`, `editor-model.spec.ts` and `editor-shell-ui.spec.ts` pass with the new assertions.

## Task 4 — Verification and screenshots
What it is / what it means: Visual evidence against references (PRD Acceptance, screenshots).
What changes at a high level: Capture Playwright screenshots at 1440x900 into `F/after/`, compared against `F/before/1-default.png`, `F/before/8-building-selected-level-box.png` and `F/ref/gmaps.png`. Check pressed toggles, disabled zoom at limits and focus ring. Manually confirm that, with SP03 Share/Check panels open (once landed), the column is not covered.
Done when: Screenshots saved in `F/after/` and visually match the Maps reference; gutter check recorded (or noted as pending SP03).
