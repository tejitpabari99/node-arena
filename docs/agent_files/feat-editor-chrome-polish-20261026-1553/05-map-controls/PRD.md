---
status: draft
summary: Replace the horizontal white pill of canvas controls with a Google-Maps-style vertical stack of square cards (zoom +/- joined, then fit / game camera / hand / grid), top-right with 12px inset and a z-index/gutter contract vs SP03 popovers.
date: 2026-10-26
---
# PRD: Map-style canvas controls (SP05)

Repo/branch: node-arena · `feat/editor-chrome-polish` · Depends on: 01-theme-tokens (tokens, `.ed-btn-icon` conventions) · Owns: `apps/web/src/editor/CanvasControls.tsx`, the `.canvas-controls` / `.canvas-btn` block of `apps/web/src/editor/style.css` (lines ~135-140), and the `.canvas-controls` test updates

## TL;DR
Turn the single 6-button pill into a vertical column anchored top-right of the canvas, `ref/gmaps.png` style: card 1 = `+` over `−` with a hairline divider; then Fit area, Game camera, Hand, Grid each as own ~36px card. 8px gaps, soft shadow, 6-8px radius, grey icons, accent fill on pressed toggles. Behavior, labels, test ids and localStorage key unchanged.

## Problem
- `style.css:135` `.canvas-controls`: `display:flex` row, `padding:4px`, `border-radius:999px`, `box-shadow:0 1px 4px #0004`, `gap:2px`. Six actions of unrelated kinds (zoom, framing, tool mode, overlay toggle) read as one undifferentiated pill; toggles (Hand, Grid) look like actions.
- `style.css:136` `.canvas-btn`: 30px circle, `border-radius:50%`; `:137-139` hardcoded `#eef0f3`/`#dbe7ff`/`#1d4ed8`/`#1f2937` (not tokens). Dark `#1f2937` icons are heavier than the muted grey of the reference.
- Inset is `top:8px; right:8px` (`:135`) vs `12px` for toasts (`.ed-toasts` `top:12px`, line 22) and the play bar. Inconsistent.
- Icons are inline 24-viewBox stroke SVGs inside `Btn` (`CanvasControls.tsx:11-15`), stroke 1.8, 18px; zoom icons are magnifier-plus/minus (`circle` + `M16.5 16.5L21 21`), which do not stack cleanly as a `+`/`−` pair and read as "search".
- Cover risk: popovers (`.ed-popover`, `z-index:5`, line 50) are children of top-bar items and drop below the bar over the canvas; controls are `z-index:3`, so SP03's Share/Check panels would sit on top of the column unpredictably.

## Goals / Non-Goals
**Goals**: Maps-like grouping and alignment; token-driven styling; keyboard/tooltips retained; defined stacking contract with SP03.
**Non-Goals**: new controls or behavior (viewport engine, `viewport-engine.ts`, hand/grid semantics untouched); minimap, compass, fullscreen; top bar/menus (SP03), left panel (SP04), tokens/primitives (SP01); touch-specific sizing; dark mode.

## Requirements
1. Container `.canvas-controls` stays `data-testid="canvas-controls"`, `role="group"`, `aria-label="Canvas controls"`; positioned `top/right: var(--ed-s-3)` (12px) inside `.ed-canvas` (already `position:relative`, `Shell.tsx`/`style.css:62`).
2. Column, `align-items:stretch`, `gap: var(--ed-s-2)`, no background/shadow/padding on the container itself (no outer boundary). `pointer-events:none` on container, `auto` on cards so the empty gutter never blocks canvas pointer gestures.
3. Cards, all identical width/height 36px: (a) zoom card `+`/`−` (two 36x36 buttons, 1px divider `--ed-border`); (b) Fit area; (c) Game camera; (d) Hand; (e) Grid. Optional visual separator between the framing pair and the toggle pair is spacing only (gap 8px); toggles are not additionally grouped (D3).
4. Card surface: `--ed-g-0`, radius `--ed-r-lg` (8px), `--ed-sh-md`; buttons inside cards have no own radius except first/last inherit via `overflow:hidden` on the card.
5. Icons 20px, stroke 1.75, `currentColor`, default `--ed-g-600`; hover bg `--ed-g-100` + icon `--ed-g-800`; pressed (`aria-pressed=true`) bg `--ed-accent-soft` + icon `--ed-accent`; disabled opacity .35 (zoom limits); `:focus-visible` uses SP01 ring (inset on joined buttons so it is not clipped by `overflow:hidden`).
6. Each button keeps `aria-label` + `title` (exact strings below); toggle buttons keep `aria-pressed`. Native `<button>`, Tab order top-to-bottom = DOM order.
7. Stacking contract (see Architecture): column never obscured by SP03 popovers.
8. Reflow: column height = 72 + 4*36 + 4*8 = 248px; hide nothing at the min editor height (workspace min-height 360px, `style.css:13`).

## Architecture
Markup (single component, `Btn` gains `class` variants; zoom pair wrapped):
```tsx
<div class="canvas-controls" role="group" aria-label="Canvas controls" data-testid="canvas-controls">
  <div class="canvas-card canvas-card-zoom">
    <Btn label="Zoom in" …>{plus}</Btn><Btn label="Zoom out" …>{minus}</Btn>
  </div>
  <div class="canvas-card"><Btn label="Fit area" …/></div>
  <div class="canvas-card"><Btn label="Game camera" …/></div>
  <div class="canvas-card"><Btn label="Hand" pressed …/></div>
  <div class="canvas-card"><Btn label="Show grid" pressed …/></div>
</div>
```
DOM order: Zoom in, Zoom out (matches visual `+` over `−`; current DOM is out-then-in, so Tab order changes - intentional).
```css
.canvas-controls { position:absolute; top:var(--ed-s-3); right:var(--ed-s-3); z-index:3;
  display:flex; flex-direction:column; gap:var(--ed-s-2); width:36px; pointer-events:none; }
.canvas-card { background:var(--ed-g-0); border-radius:var(--ed-r-lg); box-shadow:var(--ed-sh-md);
  overflow:hidden; pointer-events:auto; }
.canvas-card-zoom .canvas-btn + .canvas-btn { border-top:1px solid var(--ed-border); }
.canvas-btn { width:36px; height:36px; display:grid; place-items:center; padding:0; border:0;
  border-radius:0; background:transparent; color:var(--ed-g-600); cursor:pointer; }
.canvas-btn:hover:not(:disabled){ background:var(--ed-g-100); color:var(--ed-g-800); }
.canvas-btn[aria-pressed="true"]{ background:var(--ed-accent-soft); color:var(--ed-accent); }
.canvas-btn:focus-visible{ outline-offset:-2px; }
.canvas-btn svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:1.75; … }
```
**Icons**: no icon library; icons are hand-inlined SVG paths in `CanvasControls.tsx`. Keep Fit, Game camera, Hand, Grid paths as-is. Replace Zoom in/out with plain `M12 5v14M5 12h14` / `M5 12h14` (Maps-style). No new dependency.

**Stacking/offset contract (interface assumption for SP03)**: `.ed-canvas` starts below the 56px top bar, so the column never collides with the bar itself. Share panel and Check flyout drop *over* the canvas top-right. Contract: (1) SP03 popovers use `z-index: var(--ed-z-pop)` (5) > controls (3), toasts 15, modals 20 (SP01 tokens); (2) to keep the column visible, any SP03 popover/flyout anchored to the right edge must set `right >= var(--ed-controls-gutter)` where `--ed-controls-gutter: 56px` (12 inset + 36 + 8) is defined in the SP01 token set, or be placed left of it; (3) `max-width` of such panels is SP03's call. If SP03 cannot honor it, fallback: popover open => `.canvas-controls` gets `[data-dimmed]`/hidden (see [OPEN]). Toasts are top-center and cannot collide above ~600px canvas width.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Layout | Vertical column top-right | Horizontal pill; bottom-right | Locked; matches Maps |
| D2 | Zoom | `+` over `−` single card, plain glyphs | Magnifier icons | Maps convention; stacks cleanly |
| D3 | View toggles | Own cards, no extra group | Group Hand+Grid in one card | Locked: simple; separate toggle semantics visible by accent fill |
| D4 | Size | 36px cards, 8px radius, 8px gap | 40px (Maps) | Dense tool UI, matches 28-32px chrome from SP01 |
| D5 | Inset | 12px = `--ed-s-3` | 8px (today) | Matches toasts/popovers |
| D6 | Styling | Tokens only, no hardcoded hex | Keep hexes | SP01 contract |
| D7 | Collision | Gutter token + z-order contract | Hide controls on popover open | Keeps controls usable; less JS coupling |
| D8 | Tab order | Zoom in before Zoom out | Keep out-first | Visual = DOM order |

## Risks / Open Questions
- [RESOLVED: single token `--ed-controls-gutter: 56px` defined in SP01 tokens; controls z 3; SP03 popovers z = `--ed-z-pop` (5) and right-anchored panels keep `right >= var(--ed-controls-gutter)`. Hide/dim fallback not needed.]
- [RESOLVED: SP05 tasks depend on SP01 being merged first (landing order 01 → 02 → 05 → 04 → 03)]
- [RESOLVED: tests] Existing specs query by role+name inside `data-testid=canvas-controls` (`editor-viewport.spec.ts:18-19, 366-385`, `editor-model.spec.ts:189`); none assert layout, order or size. `title === name` assertion (line 369) must stay true.
- [RESOLVED: pointer] Container `pointer-events:none` avoids a dead 36px-wide strip over the canvas.
- [DEFERRED] Hide-on-small-height, tooltips with shortcuts, minimap/compass, split Hand/Grid into a "View" menu.

## Acceptance Criteria
- Column renders top-right at 12px inset; all cards 36px wide, centered icons, 8px gaps, zoom card with hairline divider; no outer pill; no `border-radius:999px`/`50%`, no hardcoded hex in the block.
- Pressed Hand/Grid show accent fill; disabled zoom at limits dimmed; `:focus-visible` ring visible and unclipped on every button; Tab order Zoom in, Zoom out, Fit, Game camera, Hand, Grid.
- All six buttons keep exact `aria-label`/`title`: "Zoom out", "Zoom in", "Fit area", "Game camera", "Hand", "Show grid"; grid still persists via `node-arena.editor.grid`.
- `--ed-controls-gutter` consumed from SP01 tokens; manual check with SP03 Share/Check panels open: column not covered (or fallback applied).
- Tests: `editor-viewport.spec.ts` (canvas-controls test ~L360-400) and `editor-model.spec.ts:189` pass unchanged; add assertions in that test that the 6 buttons are vertically stacked (`boundingBox().y` strictly increasing, equal `x`/width) and inset 12px from `.ed-canvas` right/top (use `editor-layout.spec.ts` bounds helpers if present). `editor-shell-ui.spec.ts` green.
- Screenshots 1440x900 vs `ref/gmaps.png` and `before/1-default.png`, `before/8-building-selected-level-box.png` saved to `05-map-controls/screens/`.
