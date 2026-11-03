---
status: approved
summary: Enlarge tower pick radius so drags start from towers, enforce a 3.5-unit minimum tower spacing (formal rule R-ENT-05, hard validation error, 3 shipped levels nudged), replace the thin white cut line with a fading glow ribbon, and remove Credits from the web UI only.
date: 2026-11-03
---
# PRD: SP02 Battle input (hit radius, min spacing, cut trail, Credits removal)
Repo/branch: node-arena / `feat/online-polish` · Depends on: none · Consumed by: SP04 (runs after 01+02; resets all versions), SP03 (doc deltas only). Execution order: 01 ∥ 02 -> 04 -> 03.
Owns: `apps/web/src/input/{index,gestures,geometry}.ts`, new `apps/web/src/input/trail.ts`, `apps/web/src/editor/model.ts` (placement), `packages/content/src/level.ts`, `packages/content/data/balance.json`, `packages/content/data/levels/levelview-{5,14,49}.json`, `docs/GAME_RULES.md` (new rule + changelog + `RULES_VERSION`), `packages/content/src/versioning.ts` (RULES_VERSION), the test carrying `covers R-ENT-05`, `tools/src/editor-validation.ts` (+finalize if needed), locks/goldens, `apps/web/src/ui/{Credits,Picker,App}.tsx`, `apps/web/src/style.css` (credits rules only), tests `apps/web/test/credits.test.ts`, `apps/web/test/sp08/picker*.ts`.
Shared with other SPs: `apps/web/src/ui/App.tsx`, `style.css` (SP01 touches pvp UI there; credits edits are disjoint lines). Not touched: `docs/CREDITS.md`, `tools/src/credits.ts`, manifest credits checks, README link, `check:docs`.

## TL;DR
- Pick radius = building footprint radius + 0.35 world units (0.75 -> 1.10), with a ~22 px on-screen floor for touch.
- New formal rule `R-ENT-05` in `GAME_RULES.md`: every building pair center distance >= 3.5 units; violation = ERROR for campaign and custom (no migration for existing violating saved custom levels). Today's min is 3.00; 3 campaign levels (positions 8, 16, 20) get nudged and relocked. Normal version bumps per repo rules (RULES minor 3.3.0 -> 3.4.0, contentVersion, etc.) so each commit passes gates; SP04 later resets all to 1.0.0.
- Cut line becomes a camera-facing ribbon (core + glow), ~0.18 units wide, fades over ~250 ms, also after release.
- Credits button/panel/styles removed from web UI; all credits docs/tooling kept.

## Problem
- Pointer-down only selects a tower on a direct mesh hit or inside the ground footprint circle `hypot(hit-pos)/radius <= 1`, radius = `max(w,d)/2` = 0.75 [verified: input/index.ts local(); render/world.ts:79 radiusOf; house-wt1/tower footprint box 1.5x1.5]. A box's corners and any press just outside the roof/footprint get `building=null`, so `gestures.down` enters `pending-cut` [verified: gestures.ts `mode = ... source===-1 ? 'pending-cut' : 'pending-draw'`]. After 1% of the screen diagonal of movement it becomes `cut` and draws the white trail (and cuts own lines within 8 px); held still 700 ms it becomes `eraser`. So a slightly-off drag start silently cuts instead of drawing.
- No spacing rule: `validateLevel` errors only on identical coordinates and merely WARNS on footprint overlap [verified: content/src/level.ts ~127-135]. Editor `placeCenter` only avoids footprint-occupied points [verified: editor/model.ts placeCenter `occupied`]. Enlarged hit areas could overlap on dense maps.
- Cut trail is a 1 px `THREE.Line` (WebGL ignores linewidth), white 0.8 opacity, 128-point ring, hidden instantly on `clear()` [verified: input/index.ts trail setup, `clear`, `trail`].
- Credits UI still exists after #44: `Picker.tsx` footer button, `App.tsx` `credits` state, `Credits.tsx`, `.credits`/`.credit-list` CSS [verified: grep].

## Goals / Non-Goals
Goals: reliable drag-from-tower; spacing guarantee everywhere; clearly visible, cheap cut animation; Credits gone from UI.
Non-goals: changing gesture timings (200 ms touch delay, 700 ms eraser), lane/cut sim rules, cut hit tolerance (8 px swipe), redesigning the editor, deleting credits docs/tooling.

## Requirements
| # | Requirement |
|---|---|
| R1 | Pointer-down on a building resolves if within `radius + PICK_MARGIN` (0.35 units) of its center; nearest wins; mesh hit still wins first. On-screen radius never below 22 px (projected via existing `screens[i].radius`). |
| R2 | Non-owned buildings keep current behavior (press on them is ignored, not a cut start) now over the enlarged area. |
| R3 | `minBuildingDistance` (default 3.5, world units, center-to-center, all archetypes) in content; `validateLevel` emits an ERROR per violating pair (pointer = later building, message names the other and distance). Applies to campaign, PvP and custom levels. Formalized as `GAME_RULES.md` rule `R-ENT-05` (implementer confirms the ID is free in the ENT area; else next free) with rule text + changelog + `RULES_VERSION` minor bump first, then a test whose title contains `covers R-ENT-05`, then code. Saved custom levels that violate: hard validation error on load/Check/Finalize; no migration, auto-nudge or compat; user deletes them. |
| R4 | Editor `placeCenter` and drag-move reject/snap away from spots < min of any building; invalid drag shows red/blocked and reverts. Elements/obstacles are not constrained. |
| R5 | `levelview-5`, `-14`, `-49` nudged minimally (>=3.5, keep lane topology/solvability), relocked. |
| R6 | Cut trail: ribbon of >=2 layers (white core ~0.08, colored/white glow ~0.25 units), points age and fade over ~250 ms; on release/cancel the remaining trail fades out instead of vanishing. Max 128 points, 1 draw call set, no per-frame allocation. Respects `prefers-reduced-motion` (short fade, no glow pulse). |
| R7 | Credits: remove `Credits.tsx`, Picker footer button + `onCredits` prop, App `credits` state/branch, `.credits/.credit-list` CSS and `credits.test.ts`; update picker tests. `Credits.tsx`-only exports (`parseCredits`) deleted with it; `docs/CREDITS.md` unchanged. |

## Architecture
- Pick: add `PICK_MARGIN` in `input/geometry.ts`; in `local()` fallback loop use `(a.radius + PICK_MARGIN)`; touch floor: if `screens[i].radius + marginPx < 22` compare in screen space against `screens[i]` instead. Screen-space is already projected each frame (`projectAnchors`), so no new cost. Mesh raycast unchanged.
- Spacing: `balance.json` gets `minBuildingDistance` (tunable value lives in content per GAME_RULES versioning note); `validateLevel` reads it via the catalog; editor `model.ts` imports the same value from the compiled catalog so UI and validator cannot drift. Check: `dist < min - 1e-6` -> error (na-pvp-cross sits at exactly 3.50 and must pass).
- Trail: new `input/trail.ts` owning a preallocated `BufferGeometry` quad strip (2 verts/point, per-vertex alpha = age fade), expanded each frame in screen-facing direction using camera right vector; `MeshBasicMaterial` `transparent`, `depthWrite:false`, additive for glow layer; `refresh()` ticks fade. `input/index.ts` `trail`/`clear` callbacks delegate to it; `clear` calls `trail.release()` (fade) not hide; `dispose` frees it.
- Credits: pure deletion; keep `apps/web/src/manifest/resolve.ts` untouched (credits-related manifest checks stay).

## Measurements [verified: script over `packages/content/data/levels/*.json`]
Footprint 1.5x1.5 box for all archetypes. Min pairwise center distance per level: campaign min 3.00 (`levelview-49`, pos 20); `-5` 3.25 (pos 8); `-14` 3.27 (pos 16); next `-15` 3.53, `-10` 3.59; `na-pvp-cross` 3.50; rest >= 3.74. At 3.5: violating pairs `-49`:1, `-5`:2, `-14`:2; no `na-*` map violates.
Hit diameters: 2 x 1.10 = 2.2 << 3.5, leaving >= 1.3 units dead zone between enlarged areas (a cut start between towers stays possible).

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Hit margin | +0.35 world units (r 1.10) + 22 px floor | +px only; box-shaped hit area; 0.5 | "Tiny portion"; world units track zoom; 0.35 stays well under spacing; floor protects phones. |
| D2 | Min spacing | 3.5 center-to-center | 3.0 (no level violates); 4.0 | 3.0 fails "much bigger than hit radius"; 4.0 would move ~10 levels; 3.5 moves 3. |
| D3 | Severity | Hard error | Warning | Locked by owner. |
| D4 | Constant home | `balance.json` `minBuildingDistance` | `packages/defs` const | Tunable numbers live in content; editor+validator share catalog. |
| D5 | Rule status | Formal `R-ENT-05` in `GAME_RULES.md`; RULES_VERSION minor bump (3.3.0 -> 3.4.0), later reset by SP04; also documented in `CONTENT_GUIDE.md` | Content-validation contract only, no `R-` ID | Owner decision 2026-11-03. Additive (minor); refresh golden/replay headers per repo rules. |
| D6 | Trail tech | Camera-facing quad-strip ribbon, 2 layers | `Line2`/fat lines (addon), HTML canvas overlay, CSS | No new deps, stays in scene depth/layers, cheap. |
| D7 | Fade after release | Fade out ~250 ms | Instant hide (today) | Gives the "slash" feel. |

## Risks / Open Questions
- 1. Spacing as formal rule? [RESOLVED: yes, owner 2026-11-03: new `R-` ID (R-ENT-05), rules text + test `covers R-ENT-05`, RULES_VERSION minor bump per repo rules, refresh golden/replay headers; SP04 later resets to 1.0.0]
- Content identity changes (nudged levels + new balance key): contentVersion minor (2.6.1 -> 2.7.0), `pnpm content:lock`, `pnpm levels:lock --levels levelview-5,levelview-14,levelview-49`, `sim:golden`/`bots:golden` refresh (envelopes embed contentVersion), `BOT_VERSION` bump per tools/README finalize order, `replay:verify golden`, `validate:content/check:content --base HEAD`. [RESOLVED: expected; unmoved levels' outcomes unchanged, only the 3 moved levels' lock entries change.]
- Nudges could break solvability or campaign feel. [RESOLVED: run `pnpm validate:levels`; proxy solvability must hold; owner replays positions 8, 16, 20.]
- 2. Existing user custom levels (saved JSON) that violate? [RESOLVED: owner 2026-11-03: hard validation error; no migration, auto-nudge or compat; user deletes them. Shipped violating levels are fixed (nudged) and relocked (R5)]
- Mobile: 22 px floor may overlap on tiny screens at heavy zoom-out. [RESOLVED: nearest-center wins, floor only as lower bound.]
- Glow ribbon cost on low-end GPU. [RESOLVED: <=128 points, 2 layers, no post-processing; disabled glow under reduced motion.]
- [DEFERRED] Tuning the 8 px cut tolerance and swipe radii.

## Acceptance Criteria
- Unit: press at 1.05 units from a tower center (outside 0.75, inside 1.10) starts `pending-draw`; at 1.2 starts `pending-cut`. 22 px floor test at a small projected radius.
- `R-ENT-05` in `GAME_RULES.md` with a test titled `covers R-ENT-05`; `pnpm check:rules` green.
- `validateLevel` errors on a pair at 3.49 and passes at 3.50 (incl. `na-pvp-cross`); message names both ids.
- Editor: placing/moving within 3.5 of a building is blocked; Check/Finalize error for violating doc.
- All 24 shipped levels pass `pnpm validate:levels`; locks/goldens/content hash gates green (`pnpm run ci`).
- Playwright: dragging tower-to-tower draws a lane; empty-space drag shows a visible ribbon (>=3 px thick on screen) that fades within ~300 ms of release.
- `grep -ri credits apps/web/src` returns nothing user-facing; `pnpm check:docs`, `check:manifest` still pass; `docs/CREDITS.md` and `tools/src/credits.ts` unchanged.
- Doc deltas: `GAME_RULES.md` (R-ENT-05 + changelog; edited by SP02 itself), SP03: `CONTENT_GUIDE.md` (spacing contract, balance key), `LEVELS_GUIDE.md` (nudged levels, editor spacing).
