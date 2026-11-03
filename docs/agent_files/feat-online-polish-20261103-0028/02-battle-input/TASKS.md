---
status: done
summary: 4 tasks for SP02 battle input: min tower spacing rule + level nudges + editor, bigger pick radius, fading cut ribbon, Credits UI removal.
date: 2026-11-03
---
# Tasks: SP02 Battle input
Source of truth: docs/agent_files/feat-online-polish-20261103-0028/02-battle-input/PRD.md. No [OPEN] items; all [RESOLVED] entries are binding. SP02 runs in parallel with SP01 (shared `App.tsx`, `style.css`; keep edits to credits lines only); SP04 later resets versions to 1.0.0.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Min tower spacing (R-ENT-05) end to end | none | done |
| 2 | Enlarged tower pick radius | none | done |
| 3 | Fading glow cut ribbon | none | done |
| 4 | Remove Credits from web UI | none | done |

## Task 1 — Min tower spacing (R-ENT-05) end to end
What it is / what it means: Every building pair must be at least 3.5 world units apart, center to center, as a formal rule enforced as a hard error everywhere (D2, D3, D4, D5).
What changes at a high level: Following the repo's mechanics order: add R-ENT-05 to `GAME_RULES.md` (confirm ID free) with changelog and a RULES_VERSION minor bump, then a test titled `covers R-ENT-05`, then code. Add `minBuildingDistance` to `balance.json`; `validateLevel` errors per violating pair, naming both ids (`na-pvp-cross` at exactly 3.50 must pass). Editor placement and drag-move reject or snap away from too-close spots, with red/revert on an invalid drag; Check/Finalize error on violating docs; no migration for saved custom levels. Nudge `levelview-5`, `-14`, `-49` minimally, preserving topology and solvability. Bump contentVersion, `BOT_VERSION` if required, then refresh locks, goldens and replay headers per `tools/README.md`.
Done when: validator unit cases at 3.49 (error) and 3.50 (pass) green; editor blocks close placement; all 24 shipped levels pass `validate:levels`; `check:rules`, content/lock/golden/replay gates green.

## Task 2 — Enlarged tower pick radius
What it is / what it means: A drag starting just outside a tower's footprint should draw a lane, not silently become a cut (D1).
What changes at a high level: Add `PICK_MARGIN` (0.35 units, radius 0.75 to 1.10) in input geometry and use it in the ground-fallback pick; nearest center wins; mesh hit still wins first. Add a 22 px on-screen floor using the already projected screen radius. Non-owned buildings keep ignore-on-press behavior over the larger area. Gesture timings unchanged.
Done when: unit tests show a press at 1.05 units starts `pending-draw` and at 1.2 starts `pending-cut`, plus a small-projected-radius test for the 22 px floor; Playwright tower-to-tower drag draws a lane.

## Task 3 — Fading glow cut ribbon
What it is / what it means: Replace the 1 px white line with a visible slash ribbon that fades (D6, D7).
What changes at a high level: New `input/trail.ts` owning a preallocated camera-facing quad-strip (core about 0.08 units plus glow about 0.25, max 128 points, no per-frame allocation, no new deps). Points age and fade over about 250 ms; on release or cancel the remaining trail fades instead of vanishing. Input `trail`/`clear`/`dispose` delegate to it. Under `prefers-reduced-motion`: short fade, no glow pulse.
Done when: unit test on fade/release behavior; Playwright empty-space drag shows a ribbon at least 3 px thick that is gone within about 300 ms of release.

## Task 4 — Remove Credits from web UI
What it is / what it means: Delete the Credits UI only; credits docs and tooling stay (R7).
What changes at a high level: Remove `Credits.tsx` (including `parseCredits`), the Picker footer button and `onCredits` prop, the App `credits` state and branch, the `.credits`/`.credit-list` CSS, and `credits.test.ts`; update picker tests. Leave `docs/CREDITS.md`, `tools/src/credits.ts`, manifest resolve and credits checks, and the README link untouched. Keep App/style edits confined to credits lines to avoid conflicts with SP01.
Done when: `grep -ri credits apps/web/src` shows nothing user-facing; picker tests, `check:docs` and `check:manifest` pass.
