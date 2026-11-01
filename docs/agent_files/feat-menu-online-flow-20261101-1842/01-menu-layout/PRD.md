---
status: draft
summary: Main menu becomes three stacked full-width rectangular buttons; Custom hidden outside dev builds and shows map thumbnails instead of names; ships the shared map-thumbnail service reused by online map picker.
date: 2026-11-01
---
# PRD: SP01 Menu layout + shared map thumbnails
Repo/branch: node-arena / `feat/menu-online-flow` · Depends on: none · Consumed by: SP03 (thumbnail service, `menu-tile` style)
Owns: `apps/web/src/ui/Picker.tsx`, `apps/web/src/style.css`, `apps/web/src/render/level-thumbnail.ts` (new), `apps/web/src/editor/thumbnails.ts` (refactor onto shared core), `apps/web/src/app/state.ts` (only if thumbnail data needs plumbing), web unit + e2e specs touching the picker.

## TL;DR
- Campaign / Custom / Play online: vertical stack, full-width rectangles (not 172px grid squares).
- Custom button + custom view are DEV-only (`import.meta.env.DEV`); production never shows them.
- Custom cards: no visible name; small map thumbnail; name stays in `aria-label`.
- New shared `LevelThumbnailService` (full-level offscreen render, cached, sequential) also used by SP03's map picker.

## Problem
- Main menu is `level-grid menu` of `level-card menu-button` squares in a 2-col 172px grid [verified: Picker.tsx:14, style.css `.level-grid.menu{grid-template-columns:repeat(2,172px)}`].
- Custom is visible in production although the editor links are already DEV-gated [verified: Picker.tsx:9,29 use `import.meta.env.DEV`; the Custom menu button is ungated].
- Custom cards print `level.name` (Picker.tsx:26).
- Thumbnail code exists only for editor library items, not whole levels [verified: editor/thumbnails.ts `LIBRARY_ITEMS`, `createWebGlThumbnailRenderer`].

## Goals / Non-Goals
Goals: items 1-2 of the owner brief; reusable level-thumbnail primitive; keep a11y (names in aria-labels, focus behavior).
Non-goals: online screens (SP03); changing campaign grid; changing editor behavior or its thumbnails output; persisting thumbnails across sessions (see Decisions).

## Requirements
| # | Requirement |
|---|---|
| R1 | Main view renders Campaign, Custom (dev only), Play online (when `onPlayOnline`) as a single column of full-width buttons (max ~560px centered, consistent height ~96px, gap 16px). Same green style, keep `data-testid="pvp-play"`. |
| R2 | Production build (`import.meta.env.DEV` false): no Custom button; `setPickerView('custom')` is never reachable from UI; `openPicker()` must not land on `custom` (map to `main`). Dev (`pnpm dev`): unchanged behavior. |
| R3 | Custom view cards: thumbnail `<img alt="">` filling the card, completed state keeps gold style + a check badge, small `Play` text may remain; no `level.name` text. `aria-label` = existing `${name}${completed?', completed':''}`. Edit link and "Create custom level" card remain DEV-only. |
| R4 | Thumbnail not ready/failed: neutral placeholder tile (no name printed; aria-label still carries it). |
| R5 | `LevelThumbnailService`: `get(levelId): string | undefined`, `request(levelId)`, `subscribe(cb)`; renders sequentially off one offscreen GL host, caches data URLs in memory by `levelId` + content version, disposes on app dispose. |

## Architecture
- Extract the generic part of `createWebGlThumbnailRenderer` (manifest, catalog, texture loader, offscreen host, `createLevelScene`, `fitCamera`, `toDataURL`) into `render/level-thumbnail.ts`. Editor item thumbnails keep calling it with `itemDoc(...)` + per-item camera box; no change to editor outputs.
- New function `renderLevelThumbnail(level: CompiledLevel, size)`: `create(level, 1)` initial view, labels hidden, camera fit to `level.bounds` (top-down iso as in-game), size ~256x160 (map aspect ~ bounds ratio, letterboxed). Only reads compiled level; works for campaign, custom and PvP maps.
- Service is constructed once in `main.tsx` beside the app and passed to `Picker` (prop `thumbs`) and, later, SP03. Lazy: renders on first `request`, so production never pays for custom levels. Queue is sequential; one WebGL context at a time (browser context limit); host is torn down when queue idles >5s.
- Picker uses `useEffect` to `request()` each visible custom level; re-render via `subscribe`.
- CSS: new `.menu-stack` (flex column, `align-items:stretch`), `.menu-tile` (full-width rect variant of `level-card`: `height:96px;width:100%;flex-direction:row`), `.level-thumb` (img, `object-fit:cover;border-radius:14px`). `menu-tile` and `level-thumb` are reused by SP03.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Hide Custom | `import.meta.env.DEV` | `VITE_TEST_HOOKS`; runtime flag | Owner: available "when running locally"; consistent with existing editor gating [verified Picker.tsx:9]. Built-preview e2e (`pnpm preview:test`) loses Custom, see risk. |
| D2 | Thumbnail source | Live offscreen WebGL render of compiled level | Pre-baked PNGs per map; SVG minimap | Works for user-authored levels with zero asset pipeline; code largely exists (editor/thumbnails.ts). |
| D3 | Cache | In-memory per session only | localStorage / IndexedDB | Simplest; maps are few; avoids stale-content bugs. [DEFERRED] persistent cache if render cost shows up. |
| D4 | Shared module location | `src/render/level-thumbnail.ts` | keep in `editor/` | Production bundle must not import editor chunk. |
| D5 | Name hidden but kept | `aria-label` + `title` (dev tooltips) | drop entirely | Accessibility. |

## Risks / Open Questions
- Multiple WebGL contexts (main arena + thumbnail host) on weak devices. [RESOLVED: single reusable host, sequential, disposed on idle; failure -> placeholder (R4)]
- E2E specs that open Custom against `pnpm preview:test` (z-custom-create, editor-*, boot specs) would break in prod-like builds. [RESOLVED: those specs already require editor/dev; confirm in task which run on `development` Playwright mode (`playwright.config.ts` runs `pnpm dev` when `development`); move any prod-mode ones to dev mode or assert Custom absent.]
- Editor `ThumbnailRenderer` contract must stay stable (editor tests). [RESOLVED: refactor behind existing factory type; run editor specs]
- Thumbnails inside a headless CI Chromium (SwiftShader). [RESOLVED: placeholder fallback; e2e asserts `img` or placeholder, not pixels]

## Acceptance Criteria
- Dev: main menu shows 3 stacked full-width tiles; each click opens same view as before.
- `pnpm build && preview`: main menu shows Campaign + Play online only; no "Custom" text in DOM; `import.meta.env.DEV` branch tree-shaken (grep dist for "Custom levels" -> 0).
- Dev Custom view: each card has an `img` thumbnail (or placeholder), no visible level name, `aria-label` contains name.
- Editor library thumbnails render identically (existing editor specs green).
- Unit test for service: dedupe requests, sequential order, failure -> undefined + no throw.
- `pnpm lint typecheck test test:web:e2e` green.
