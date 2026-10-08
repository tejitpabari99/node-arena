---
status: draft
summary: 15 tasks — apps/web shell, troop spike, manifest pipeline, driver, saves, generic Three.js renderer, input, Preact UI, audio, a11y, dev panel, test suites
date: 2026-10-08
---
# Tasks: Web Client (SP03)
Source of truth: docs/agent_files/feat-game-design-20261006-0617/03-web-client/PRD.md. Browser client over the SP02 sim; everything visual resolves through `manifest.json`, with no archetype or troop ids in renderer code. No open items. Resolved items are folded in: instanced-troop spike first, tinted base plate + roof marker as team-colour default, `createBotDriver` hook, screenshots with structural-assert fallback. Deferred items (pan/zoom, VAT, instanced digit labels, worker sim, label declutter, clash clamp) get no tasks.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | App scaffold + tooling | SP01 | todo |
| 2 | Instanced-troop performance spike | T1 | todo |
| 3 | Manifest loader, resolver, `validateManifest`, greybox manifest | T1, SP01 | todo |
| 4 | Fixed-step `GameDriver` + bot hook | T1, SP02, SP04 | todo |
| 5 | Versioned saves | T1 | todo |
| 6 | Asset loading, errors, `Disposables` | T3 | todo |
| 7 | Scene, camera, themes, quality | T3, T6 | todo |
| 8 | Towers, overlay registry, labels | T4, T7 | todo |
| 9 | Troop renderer | T2, T4, T7 | todo |
| 10 | Lines + clash/capture fx | T8, T9 | todo |
| 11 | Input: draw, swipe-cut, right-click cut | T8, T10 | todo |
| 12 | App state machine + Preact UI | T4, T5, T6 | todo |
| 13 | Audio | T3, T12 | todo |
| 14 | Accessibility + dev panel + perf HUD | T8, T9, T12, SP01 | todo |
| 15 | Test harness + Playwright/unit/perf/leak suites | T11, T12, T13, T14 | todo |

## Task 1 — App scaffold + tooling
What it is / what it means: Stand up `apps/web` per the PRD layout rule that `render/` and `input/` know columns and component names only via registries.
What changes at a high level: Vite + TypeScript + Preact + Three.js app, folder skeleton, vitest and Playwright configs, workspace links to content and sim. Empty boot screen proves the workspace imports resolve in a browser build.
Done when: dev server and production build run; a vitest smoke test passes; importing content and sim works in-browser.

## Task 2 — Instanced-troop performance spike
What it is / what it means: First renderer task (Risk, resolved; Decisions 1, 2). Gates the renderer design before it locks.
What changes at a high level: Throwaway page with 2,000 instanced troops per (visual × team) mesh, custom `(x,z,yaw,phase)` attribute, and a patched standard material doing procedural bob and sway. Measure JS ms/frame, draw calls, and fps in software GL and, manually, on a laptop. Record the outcome and fallback decision (static-bob, no-bob, or VAT) in a committed spike report.
Done when: the report is committed with numbers and a go/fallback decision.

## Task 3 — Manifest loader, resolver, `validateManifest`, greybox manifest
What it is / what it means: Data-driven visuals contract (Manifest contract; Decision 9; AC1, AC2). Schema and types come from SP01.
What changes at a high level: Own `apps/web/assets/manifest.json` using `primitive` models only (placeholder art through the same pipeline). Loader and key resolver for visuals, themes, palettes, events and camera. Node-safe `validateManifest(manifest, {assetsDir, credits})` checking file existence, budgets (troop ≤300 tris, tower ≤5k, texture ≤1024²) and CREDITS listing, for SP04's `check:manifest` runner. Invalid manifest yields typed errors.
Done when: unit tests cover resolve and validate failures (unresolved key, missing palette colour, missing file, over-budget); the greybox manifest validates against the SP01 schema.

## Task 4 — Fixed-step `GameDriver` + bot hook
What it is / what it means: Deterministic stepping with responsive feel (Requirements 1, 2; Decision 8; AC3).
What changes at a high level: rAF accumulator at 20 Hz with frame clamp, max 5 steps and spill dropped, 1×/2×, pause, `alpha` for rendering, `tick` stamped on commands, auto-pause when the tab is hidden (no catch-up). At level start create `createBotDriver(level, matchSeed)` and merge `driver.commands(sim)` with player commands before each step. The web never reads bot profiles.
Done when: tests show clamp, 2×, pause, hidden-tab, and that split-step runs hash-equal to an unthrottled run.

## Task 5 — Versioned saves
What it is / what it means: Progress and settings persistence (Requirement 7; Decision 11; AC7).
What changes at a high level: `nodearena:save` v1 keyed by level id, pure migration array with per-version fixtures, corrupt/future-version handling (raw copy to `.bak`, reset, one-time notice), try/catch writes with in-memory fallback. Completion recorded only on `won`, never when dev-tuned or in replay.
Done when: every fixture version migrates; a corrupt save resets with notice and `.bak`; blocked storage degrades gracefully.

## Task 6 — Asset loading, errors, `Disposables`
What it is / what it means: Per-level resource lifecycle (Asset loading and errors; Disposal).
What changes at a high level: `resolveLevelAssets(level)` to a key set, parallel GLTF (meshopt) and audio decode with 2 retries and typed `AssetError{key, src, cause}`. Refcounted shared asset cache by `src`. A `Disposables` scope that frees geometries, materials, textures, instanced meshes and DOM labels on level change or restart. Failures route to the `error` screen contract (failed asset, Retry for failed only, Back to menu).
Done when: forced failure produces the typed error and Retry reloads only the failed assets; disposal frees a level's resources.

## Task 7 — Scene, camera, themes, quality
What it is / what it means: Renderer foundation (Generic rendering: Camera, Quality; Decision 3).
What changes at a high level: Scene setup from theme key (ground, sky, light, fog, props), one directional light, fixed perspective camera with manifest pitch/fov/margin auto-fit to level tower bounds on resize, no pan/zoom. Quality low/med/high controlling pixel ratio, shadow map and antialias.
Done when: a compiled level shows a themed ground fitted in view across window resizes; quality changes apply.

## Task 8 — Towers, overlay registry, labels
What it is / what it means: Generic tower rendering (Decisions 4, 5, 6; AC1).
What changes at a high level: Tower groups built from `towerStatic` to visual to model clone with per-owner material clones. Team colour default is a tinted base plate + roof marker; `teamMask` recolour only where a pack material split works. Owner change swaps colour and marker. Overlay registry keyed by component name (`garrison` count label, `drawsLines` slot pips, `capturable` none; unknown components ignored). DOM label layer with high-contrast chips, ≥14 px, updated only on change, viewport-clamped.
Done when: a fixture archetype plus visual key renders with no code change; capture recolours; the renderer source contains no archetype or troop ids.

## Task 9 — Troop renderer
What it is / what it means: The 2,000-troop path (Decisions 1, 2); uses the spike outcome from Task 2.
What changes at a high level: Read `readTroops` into preallocated typed arrays; extrapolate `progress + alpha·speedPerTick`; write per-(visual × owner) `InstancedBufferAttribute` with doubling capacity, fixed bounds, `frustumCulled=false`; patched-material bob and sway (or the spike's fallback). Troops cast no shadows.
Done when: stress level at 2,000 troops meets draw calls <100 and JS <4 ms/frame; head-on fronts visibly meet.

## Task 10 — Lines + clash/capture fx
What it is / what it means: Line visuals and event feedback (Lines, Clash; Decision 7; AC7).
What changes at a high level: Flat chevron ribbons per `view.lines` in team colour under troops, A→B and B→A laterally offset; rebuild on `LineDrawn`/`LineCut` only. Preallocated fx pool for `Clash` (at `progA/length`), `Captured` and other manifest `events` entries; shorter under reduced motion.
Done when: opposite lines are both visible; clash sparks appear at the midpoint; capture plays its fx.

## Task 11 — Input: draw, swipe-cut, right-click cut
What it is / what it means: Pointer gestures (Requirement 5, Input; Decision 6).
What changes at a high level: Pointer events only; ground-plane picking against `footprintRadius`; drag draw with preview ribbon, snap, `sim.canDraw` valid/invalid states with reason tooltip, Esc cancel, optional click-click. Swipe-cut with trail and per-stroke dedupe, right-click cut with `contextmenu` suppressed and hover highlight. Input blocked when paused or on results; commands queued to the next tick. Cut geometry unit-tested.
Done when: all three gestures issue the right commands; invalid targets show reasons; blocked states ignore input.

## Task 12 — App state machine + Preact UI
What it is / what it means: Screens and flow (Requirements 3, 6).
What changes at a high level: `boot → menu → picker → loading → playing ⇄ paused → results`, plus `error`, settings from menu and pause. Menu; picker (all 20 selectable, completed marker, content order/name); HUD (countdown from `timeLimitTicks`, 1×/2×, pause, perf toggle); pause; results (won/lost/timeout, draw as "Mutual defeat — not completed", retry/next/menu); settings. No ad, payment or energy UI anywhere. Keyboard navigation and Esc = pause.
Done when: a full menu-to-results loop works with saves applied; results show no interstitial.

## Task 13 — Audio
What it is / what it means: WebAudio wrapper (Audio section; Decision 12).
What changes at a high level: Own thin wrapper (no library), SFX mapped via manifest `events`, voice cap and per-event cooldown, one looping music track, separate volume and mute for music and SFX, context resumed on first gesture. CC0 files supplied by SP05.
Done when: events trigger mapped sfx within the voice cap; mute and volume persist through settings.

## Task 14 — Accessibility + dev panel + perf HUD
What it is / what it means: Remaining user-visible modes and tooling (Accessibility; Dev panel; AC8, AC9).
What changes at a high level: Colourblind palette swap plus non-colour team glyph on tower base and label chip; reduced motion (no bob, sway or shake; shorter fx); contrast ≥4.5:1 via chip. `?dev=1` panel generated from SP01 JSON Schema: edit an in-memory content copy, recompile, restart level, "tuned" badge, completion disabled, Export downloads JSON. Perf HUD (fps, frame p95, JS ms, sim step ms, draw calls, triangles, troops).
Done when: colourblind mode swaps colours and shows glyphs; editing `generates.ratePerSec` changes behaviour after restart and Export reproduces the JSON.

## Task 15 — Test harness + Playwright/unit/perf/leak suites
What it is / what it means: Test plan mapping to brief ACs 1–8 (Test plan; AC3–AC7).
What changes at a high level: `?test=1` mode (fixed seed, rAF driver off, `window.__na.{step, hash, view}`, software GL). Playwright flows for draw/hash-replay, both cuts, capture, completion persistence with 20-level picker, no-ad DOM assertion, timeout results. Screenshot scenes (capture, themes, colourblind, head-on clash) at ≤1% tolerance, falling back to structural asserts if flaky. Stress-level perf check, 20-level-switch memory-baseline leak test, asset-failure Retry test, and the committed spike report.
Done when: suites pass in CI; leak counts return to baseline; stress level meets the draw-call and JS budgets.

## Manual steps (owner)
- Real-GPU laptop playtest for 60 fps and readability sign-off (record result with the spike report).
