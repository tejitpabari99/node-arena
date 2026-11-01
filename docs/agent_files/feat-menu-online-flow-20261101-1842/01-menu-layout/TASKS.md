---
status: draft
summary: 4 tasks - shared level-thumbnail core + service, editor refactor onto it, stacked menu + DEV-gated Custom with thumbnail cards, e2e/gate fixups.
date: 2026-11-01
---
# Tasks: SP01 Menu layout + shared map thumbnails
Source of truth: docs/agent_files/feat-menu-online-flow-20261101-1842/01-menu-layout/PRD.md. No OPEN items. SP03 consumes `LevelThumbnailService`, `menu-tile`, `level-thumb`.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Shared level-thumbnail core + service | none | done |
| 2 | Editor thumbnails onto shared core | 1 | done |
| 3 | Stacked menu, DEV-only Custom, thumbnail cards | 1 | done |
| 4 | E2E and gate fixups | 2, 3 | done |

## Task 1 — Shared level-thumbnail core + service
What it is: new `render/level-thumbnail.ts` with `renderLevelThumbnail(level, size)` (full compiled level, top-down iso, labels hidden, camera fit to bounds, ~256x160) and `LevelThumbnailService` (`get`/`request`/`subscribe`).
What changes: extract generic offscreen-GL pieces (manifest, catalog, texture loader, host, createLevelScene, fitCamera, toDataURL) out of the editor renderer; service is lazy, sequential, single GL host torn down after ~5s idle, in-memory cache keyed by levelId + content version, disposed on app dispose, failure -> `undefined` with no throw. Constructed once in `main.tsx`, passed to `Picker` as `thumbs`.
Done when: service unit test covers request dedupe, sequential order, failure -> undefined/no throw; production bundle does not import the editor chunk; `pnpm lint typecheck test` green.

## Task 2 — Editor thumbnails onto shared core
What it is: refactor `editor/thumbnails.ts` `createWebGlThumbnailRenderer` to call the shared core.
What changes: editor keeps `itemDoc(...)` + per-item camera box; `ThumbnailRenderer` factory type and outputs unchanged.
Done when: existing editor unit + e2e specs green with unchanged behavior; `pnpm lint typecheck test test:web:e2e` green.

## Task 3 — Stacked menu, DEV-only Custom, thumbnail cards
What it is: main view = single column of full-width tiles (max ~560px centered, ~96px high, 16px gap) for Campaign, Custom (DEV only), Play online (when `onPlayOnline`, keep `data-testid="pvp-play"`).
What changes: `Picker` + `style.css` (`.menu-stack`, `.menu-tile`, `.level-thumb`); Custom button/view gated by `import.meta.env.DEV`; `openPicker()` maps `custom` -> `main` in prod; custom cards show thumbnail `<img alt="">` (placeholder tile on not-ready/failed), gold + check badge when completed, no name text, `aria-label` unchanged; Picker requests thumbs via effect + subscribe. Edit link/Create card remain DEV-only.
Done when: dev menu shows 3 stacked tiles opening the same views; `pnpm build` dist has no "Custom levels" string (grep -> 0) and preview menu shows Campaign + Play online only; picker unit tests updated; `pnpm lint typecheck test` green.

## Task 4 — E2E and gate fixups
What it is: align Playwright specs with Custom being absent in prod builds.
What changes: audit specs opening Custom (z-custom-create, editor-*, boot); move prod-mode ones to Playwright `development` mode or assert Custom absent in preview; e2e asserts thumb `img` or placeholder, not pixels; add test for prod absence.
Done when: `pnpm test:web:e2e` and `pnpm test:web:all` green; `pnpm campaign:verify` unaffected; `pnpm lint typecheck test` green.
