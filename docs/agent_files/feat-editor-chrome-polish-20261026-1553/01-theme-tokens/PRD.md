---
status: draft
summary: Neutral, Inter/system-ui editor design system (tokens + base button/input/menu/popover/modal/toast/panel styles) replacing the Coiny "main-menu" look; foundation for SP03-05.
date: 2026-10-26
---
# PRD: Editor theme tokens & typography (SP01)

Repo/branch: node-arena · `feat/editor-chrome-polish` · Depends on: none · Owns: `apps/web/src/editor/style.css` (all of it), `apps/web/src/editor/FileModal.tsx` (class hooks only: `editor-shell` wrapper)

## TL;DR
Rewrite the editor's CSS foundation: a `--ed-*` token set (font, type scale, greys, blue accent, green/red semantic, radii, shadows, spacing, hairline) plus shared primitives (`.ed-btn*`, inputs, `.ed-menu`, `.ed-popover`, `.ed-modal`, `.ed-toast`, `.ed-panel`, section headers, focus ring). Drop Coiny, hard 3px button shadows, 999px pills. System-ui stack (no webfont). Light only. SP03/04/05 consume primitives and add no new tokens.

## Problem
- Editor chrome reads as main-menu game UI: Coiny on h1-h3/buttons/chips/modal titles/section titles/`.ed-group > summary`, green gradient primary buttons with text-shadow, `box-shadow:0 3px` slab buttons, 12-20px radii, pill chips (`style.css` "Editor theme: main-menu look" block).
- Tokens are ad hoc: sky-blue palette, `--ed-border #9ec3d1`, hard-coded hexes scattered (`#f3f6f8`, `#c0394d`, `#1d4ed8`, `#fff1c9`).
- No menu or toast primitive exists; SP03 (File menu, Share panel, Check toast) and SP05 would each invent their own -> churn.
- Editor imports the game sheet (`main.tsx` imports `../style.css`): `:root{font-family:Coiny;color:#fff}` and sky `body` gradient leak in; editor only overrides under `.ed-shell`.

## Goals / Non-Goals
**Goals**
- One token set + primitives, all in `editor/style.css`; no Coiny in chrome.
- Define primitives SP03-05 need *now* (menu, popover, toast, icon button, tooltip-friendly label/field, section header).
- Accessible: text >= 4.5:1, UI boundaries >= 3:1 where it is the only affordance, visible `:focus-visible` ring.
- Delete dead legacy CSS.

**Non-Goals**
- Dark mode (state: not supported; keep `color-scheme: light`). Revisit only if game gets one.
- Changing game (non-editor) styles or `apps/web/src/style.css`.
- Canvas/three.js art, `.editor-play-overlay` look (keeps Coiny + game sky; it is the game).
- Component logic/markup for TopBar/Share/File menu (SP03), left panel content (SP04), map-control layout (SP05). SP01 only supplies visual primitives.

## Requirements
1. **Tokens** (below) defined on `.ed-shell, .editor-shell` (FileModal standalone also wraps in `.editor-shell`). Old tokens (`--ed-sky-*`, `--ed-green-light/dark`, `--ed-panel`, `--ed-ink`, `--ed-border`) removed or aliased only if still referenced after the rewrite (grep gate).
2. **Base reset inside `.ed-shell/.editor-shell`**: `font: 13px/1.4 var(--ed-font)`, color `--ed-text`, headings same family, weight 600; override leaked game `:root` color/font. Native `button` reset so unclassed buttons look like `.ed-btn` default (existing TSX uses bare `<button>`; avoid touching every file).
3. **Buttons**: `.ed-btn` (white, hairline border, sm shadow none, 6px radius, 28px height, hover grey-50, active grey-100, disabled .45), `.ed-btn-primary` (solid accent, white text, no gradient/text-shadow), `.ed-btn-ghost` (transparent, hover grey-100), `.ed-btn-icon` (28/32px square, ghost). Keep class names (`ed-btn-primary`, `ed-caret`) so existing TSX/e2e selectors survive.
4. **Fields**: input/select/textarea 28px, 1px border grey-300, 6px radius, accent focus ring; labels 12px/500 grey-600; `.ed-field-hint` for tooltip-less helper text; `[title]`-based tooltips are enough (SP04 uses native `title`).
5. **`.ed-menu`** (container: white, hairline, 8px radius, `--ed-shadow-md`, 4px padding, min-width 200px), `.ed-menu-item` (full-width, 28-32px, 6px radius, hover grey-100, `[disabled]` dim, optional trailing `.ed-menu-kbd` for Undo/Redo shortcuts, `.ed-menu-icon`), `.ed-menu-sep` (1px divider). Position is the caller's job (absolute under trigger).
6. **`.ed-popover`** (menu-like surface, 8px/md shadow, padding 12) and **`.ed-popover-title`/rows** (`.ed-row`: flex, label left, action right, 8px gap, hairline between) for Share rows; popovers get `z-index: var(--ed-z-pop)`.
7. **`.ed-modal`** (12px radius per D5, lg shadow, 20px padding), `.ed-modal-title` 16px/600, `.ed-modal-backdrop` rgba(15,23,42,.4), `.ed-modal-actions` (footer right-aligned), `.ed-divider-or` ("or" divider for Create dialog), `.ed-group-box` (boxed field group for Theme+Size).
8. **`.ed-toast`**: keep current top-center slot (`.ed-toasts`); dark grey-900 surface, white text, 8px radius, md shadow, optional `.ed-toast-action` link button (accent-on-dark), `-error` / `-success` left-accent variants.
9. **Panels/sections**: `.ed-panel`, `.ed-section` (flat: bottom hairline, no nested cards unless needed), `.ed-section-title` 13px/600 text, not Coiny. `.ed-group > summary` same.
10. **Status text** classes for SP03: `.ed-status` (plain text, no border/bg), `[data-state=saved]` green with check, `saving` grey, `unsaved`/`issues` amber/red. Replaces `.ed-chip` look (keep `.ed-chip` selector until SP03 swaps markup; restyle it borderless text).
11. **Focus**: `:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 1px }` on all interactive chrome.
12. **Remove Coiny** from every editor-chrome rule (list: h1-h3, `.ed-btn`, `.ed-chip`, `.ed-modal-title`, `button`, `.ed-section-title`, `.ed-group > summary`). `.editor-play-overlay` rule untouched (line has Coiny + `#73c7e6`).
13. **Legacy cleanup**: delete unreferenced rules (see Decisions D6).
14. **Scrim/overlay colors** for SVG layout overlay (`.editor-area`, `.editor-grid-line`, selection ring) unchanged (on canvas art).

## Architecture
Single file, sectioned: `tokens` -> `base reset` -> `primitives` -> `shell grid` -> `feature blocks (file/left/canvas-controls/play)`. Primitives precede feature blocks so feature CSS can override minimally.

```css
.ed-shell, .editor-shell {
  --ed-font: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --ed-fs-xs:11px; --ed-fs-sm:12px; --ed-fs:13px; --ed-fs-md:14px; --ed-fs-lg:16px;
  --ed-g-0:#fff; --ed-g-50:#f8f9fa; --ed-g-100:#f1f3f5; --ed-g-200:#e5e8eb; --ed-g-300:#d0d5db;
  --ed-g-500:#6b7280; --ed-g-600:#4b5563; --ed-g-800:#1f2937; --ed-g-900:#111827;
  --ed-text:var(--ed-g-800); --ed-muted:var(--ed-g-600); --ed-border:var(--ed-g-200); --ed-border-strong:var(--ed-g-300);
  --ed-accent:#2563c9; --ed-accent-hover:#1e54ac; --ed-accent-soft:#e7effc;   /* white-on-accent ~5.9:1 (verify) */
  --ed-success:#15803d; --ed-warn:#b45309; --ed-danger:#c0392b; --ed-danger-soft:#fdecea;
  --ed-r-sm:4px; --ed-r:6px; --ed-r-lg:8px;
  --ed-sh-sm:0 1px 2px rgba(16,24,40,.08); --ed-sh-md:0 4px 12px rgba(16,24,40,.12),0 0 0 1px rgba(16,24,40,.04); --ed-sh-lg:0 12px 32px rgba(16,24,40,.18);
  --ed-s-1:4px; --ed-s-2:8px; --ed-s-3:12px; --ed-s-4:16px; --ed-s-5:24px;
  --ed-z-pop:5; --ed-z-toast:15; --ed-z-modal:20;
  --ed-controls-gutter:56px;   /* SP05 map-controls column: 12 inset + 36 card + 8 gap; controls z=3, popovers z=--ed-z-pop; right-anchored panels keep right >= this */
}
```
Primitive->consumer map: `.ed-menu*` -> SP03 File menu (+ optional Share overflow); `.ed-popover/.ed-row` -> SP03 Share panel + Check results; `.ed-toast*` -> SP03 Check toast (Toasts.tsx); `.ed-btn-icon` + `--ed-sh-sm`/`--ed-r` -> SP05 map-control cards (SP05 owns `.canvas-controls` layout in same file; coordinate ordering); `.ed-field/.ed-section/.ed-hint` -> SP04.

**Font**: no `apps/web/public` dir and Inter is not shipped (`apps/web/assets/fonts/` holds only Coiny; no `@fontsource` dep). Stack starts with `Inter` for machines that have it, falls back to system-ui. No network fetch, works offline/dev/CI (dev-only page, no CSP concerns). Self-hosting Inter (woff2 ~100KB, needs license note + Vite asset path) deferred.

**Game-sheet leak**: scope overrides with `body:has(.ed-shell)` (pattern already used) to set neutral `background: var(--ed-g-50)` and `color`. Canvas keeps sky because three.js renders its own clear color/art; `.ed-canvas` background stays transparent over the existing body gradient only if the canvas is not full-bleed; otherwise no change visible.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Font | `Inter, ui-sans-serif, system-ui…` stack, no webfont | Google Fonts link; self-host Inter woff2; `@fontsource/inter` | Offline/CI-safe, zero deps/licensing; system-ui is near-identical on mac/Win; self-host is a cheap later follow-up |
| D2 | Base size / scale | 13px base; 11/12/13/14/16 | 14px base | Dense tool UI; matches Canva/Figma panels |
| D3 | Accent | `#2563c9` desaturated game blue (game uses `#0A3FD0` lane blue in `lane-renderer.ts`, `#4d9de0` HUD disc, `#1d4ed8` already in canvas buttons) | `#0A3FD0` literal (too saturated/dark); `#4d9de0` (white text fails 3:1) | Recognizably "game blue" but passes 4.5:1 with white |
| D4 | Semantics | green `#15803d` only for success/saved; red `#c0392b` danger/errors; amber warn | Keep game green `#43af4d` | Game green is 2.9:1 on white as text; darker green passes |
| D5 | Radii | 4 / 6 / 8; modal 12 (only exception) | 4/6/8 everywhere | Modal sits over canvas; 12 reads softer without being childish. |
| D6 | Legacy `.editor-*` rules | Keep: `editor-workspace`, `-marquee`, `-ghost`, `-library-item`, `-layout-overlay`, `-area*`, `-grid-*`, `-selection-ring`, `-play-*`, `-properties`(verify), `-script-banner`(verify). **Delete**: `.editor-start-grid`, `.editor-hint`, `.editor-shell header span`, `.editor-shell label/input/select/button/[role=alert]` blocks. Keep the `.editor-shell` *class* as token scope because `FileModal.tsx:89-90` wraps in it | Delete all `.editor-*`; leave untouched | Grep: `editor-shell` referenced only in FileModal.tsx; `editor-play-overlay` in play.ts + editor-play.spec; start-grid/hint/alert no TSX hits. Task must re-grep each selector before deleting |
| D7 | Shadow style | Soft blur shadows + 1px hairline border; no hard offset slab | Border only | Matches Canva/GMaps refs |
| D8 | Canvas bg | Keep game sky (art backdrop) | Neutral grey canvas | Sky is part of game rendering/preview fidelity; chrome frames it. Only chrome goes neutral |
| D9 | Dark mode | Not supported | prefers-color-scheme | Dev-only tool; game is light; `color-scheme: light` stays |
| D10 | Bare `<button>` | Style `.ed-shell button` as default `.ed-btn` | Add class to every TSX button | Minimizes TSX churn and merge conflicts with SP03-05 |
| D11 | Tooltips | Native `title` | Custom tooltip component | Cheap; sufficient for SP04 |

## Risks / Open Questions
- [RESOLVED: no webfont; stack `Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; font variance accepted.]
- [RESOLVED: start with proposed `#2563c9`, tune during screenshot iteration with user review; measure contrast by script.]
- [RESOLVED: tests] No e2e asserts font/color/Coiny. Style asserts found are non-theme: `editor-shell.spec.ts:73` (left `overflowY`, left width 300px, top height 56px, canvas bounds), `editor-viewport.spec.ts` cursor, `editor-model.spec.ts:161` stroke-dasharray, `editor-library.spec.ts:13` touch-action. Keep grid (56px/300px), library tile `touch-action:none`, `.editor-area` unchanged.
- [RESOLVED: legacy] See D6; `.editor-play-overlay` stays (class used in `play.ts:14`, `editor-play.spec.ts`).
- [OPEN] Interdependency with SP05: both edit `.canvas-controls` region of `style.css`. Proposal: SP01 lands first and leaves that block alone except token swaps; SP05 rewrites it. Sequence SP01 -> SP05 -> SP03/04 to avoid conflicts on the single file.
- [RESOLVED: 56px top bar stays.]
- [DEFERRED] Self-hosted Inter, dark mode, density toggle.
- Merge risk: one shared CSS file across 5 sub-projects; mitigate by section headers + SP01 merging first.

## Acceptance Criteria
- `grep -n Coiny apps/web/src/editor/style.css` returns only the `.editor-play-overlay` line.
- No hard `box-shadow:0 3px`, no `border-radius:999px`, no gradient/`text-shadow` buttons in chrome CSS.
- All tokens above exist; all primitives (`.ed-btn`, `-primary`, `-ghost`, `-icon`, inputs, `.ed-menu`, `-item`, `-sep`, `.ed-popover`, `.ed-row`, `.ed-modal`, `.ed-toast`, `.ed-panel`, `.ed-section-title`, `.ed-status`) exist and render in a throwaway demo state or existing UI.
- Measured contrast: body text, muted text, white-on-accent, saved green on white, toast text all >= 4.5:1 (script output in code artifact).
- `:focus-visible` ring visible on buttons, inputs, menu items.
- Unreferenced legacy selectors removed (re-grep proof); `pnpm -C apps/web test` editor suite stays 103 passing; Playwright `editor-*.spec.ts` green, incl. editor-play and editor-shell.
- Screenshots 1440x900 of the nine `before/` states (default, save popover, check/finalize popovers, file modal, level box, selected building) re-captured to `01-theme-tokens/screens/` and visually compared with `before/` + `ref/canva.png`: no Coiny, no pills, no green slab buttons; play overlay screenshot unchanged.
- Game UI (`/`) screenshot unchanged (game sheet untouched).
