---
status: draft
summary: 13 tasks - strength fn, tipSeen save, harness additions (scenes, all-levels, H metrics), HUD, restyle, spec updates, L1 slice gate, 20-level sweep, perf instrumentation + L18 tuning, baseline refresh, docs, final-review.md
date: 2026-10-17
---
# Tasks: HUD, Rollout, Perf, Final Review (SP05)
Source of truth: docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318/05-hud-rollout-perf/PRD.md. Last phase: new HUD and menu restyle, then gates (L1 slice, 20-level sweep, L18 perf), the single deliberate baseline refresh, and the one user approval package `BF/final-review.md`. No open items. The executing environment runs Playwright, captures and `--update-snapshots` (user-confirmed). Depends on SP03 and SP04 complete; SP01 tooling; SP02 `pnpm bots:churn` JSON for the final review.

Shared rules (repeated per task so each is executable alone). BF = docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318. Capture: `pnpm --filter @node-arena/web visual:capture [--scene <id>] [--viewport ...] [--headed --gpu]`. Compose: `pnpm --filter @node-arena/web visual:compose`. Metrics: `pnpm --filter @node-arena/web visual:check [--strict]`. Checklist: BF/01-visual-qa-harness/CHECKLIST.md. Log: BF/05-hud-rollout-perf/iteration-log.md (row: iter #, date, commit, per-item scores, metrics, top 3 gaps, planned change); rollout-log.md and perf-log.md for T8 and T10. Commit: `05-hud-rollout-perf: Task N - iter k: <change>`. Never edit refs, lower thresholds or delete tests. Stuck: 3 iterations without improvement, log hypotheses, switch approach. Default cap 12 iterations, then mark `Blocked-visual` (visual) or `blocked` (other) here and continue. Fixes to SP03/SP04 areas are tagged `05-... fix(SP03|SP04):`.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | `strength()` pure function + unit tests | SP04 T10 | todo |
| 2 | `tipSeen` save setting with default migration | none | todo |
| 3 | Harness additions: `l01-tip`, `pause`, `results`, `--all-levels`, H01-H07 | SP01 T8 | todo |
| 4 | HUD: pill, strength meter, round buttons, tip | T1, T2, T3 | todo |
| 5 | Palette restyle of menu, picker, results, pause | T3, T4 | todo |
| 6 | Update HUD/menu e2e specs to new selectors | T4, T5 | todo |
| 7 | L1 slice gate | T4, T5, T6, SP04 T10 | todo |
| 8 | 20-level rollout sweep | T7 | todo |
| 9 | Perf instrumentation (`frames[]`, p99) | T7 | todo |
| 10 | L18 60 fps tuning ladder | T8, T9 | todo |
| 11 | Restore fixme specs + regenerate 7 acceptance baselines | T8, T10 | todo |
| 12 | README, CREDITS check, `ci` and e2e green | T11 | todo |
| 13 | Final capture and `BF/final-review.md` | T12, SP02 T6 | todo |

## Task 1 - `strength()` pure function + unit tests
What it is / what it means: R1, Decision 1. Team share from `SimView`.
What changes at a high level: Pure `strength(view)` returning per-team share of owned troops (tower garrisons plus in-transit troops on all lines), neutrals excluded, zero total gives equal split. Also returns aria text such as "Blue 62%, Red 38%". Unit tests: normal, zero total, N teams, neutral-only towers, rounding sums to 100. Contrast unit test for pill text >= 4.5:1 from the style tokens.
Done when: unit tests green; no renderer or sim change.
Iteration: Non-visual. Measure: `pnpm --filter @node-arena/web test` (touched specs) run twice, identical result; plus `typecheck` and `lint`. Log in iteration-log.md. Loop: change, re-run, commit if green, revert if a prior test breaks. Stuck rule and cap 12 as in the shared rules.

## Task 2 - `tipSeen` save setting with default migration
What it is / what it means: R3, Decision 2. Remember the tip across reloads without a `v` bump.
What changes at a high level: Add `tipSeen: boolean` (default false) to `SaveSettings` in the save module; validation accepts v1 blobs lacking the key and loads them with `false` via the existing legacy/default path. Update the save spec, including a test that loads a key-less v1 blob.
Done when: key-less v1 save loads with `tipSeen === false`; round-trip keeps true; save spec green.
Iteration: Non-visual. Measure: `pnpm --filter @node-arena/web test` (save spec) twice, same result, plus `typecheck`. Log in iteration-log.md. Stuck rule and cap 12.

## Task 3 - Harness additions: `l01-tip`, `pause`, `results`, `--all-levels`, H01-H07
What it is / what it means: SP05 owns these because SP01 provides none (Owns list, R6, Iteration protocol SP05 specifics). Append-only.
What changes at a high level: In `scenes.json` add `l01-tip` (frame right after load, tip visible), `pause` (after `app.pause()`) and `results` (fast-forward to result) frames, both viewports. Add `visual:capture --all-levels` generating one entry per level from `content/levels`, capture tick 400, both viewports. Append HUD metrics H01-H07 to `thresholds.json` and CHECKLIST Appendix B (never edit existing rows): pill centre within +-2% of viewport centre x; pill top <= 4% of height; buttons >= 44 px and <= 64 px; HUD DOM area / viewport <= 12%; bottom help bar count 0; strength segment widths sum to bar width +-1 px and match `strength()` +-2%; pill text contrast >= 4.5:1. `visual:check` reads them; CHECKLIST and thresholds must agree.
Done when: new scenes and `--all-levels` produce PNGs and metrics at both viewports; H metrics report (expected fail on pre-HUD code); `visual:check --strict` consistency check passes.
Iteration: Tooling. Self-check: run `pnpm --filter @node-arena/web visual:selfcheck` and `visual:capture --all-levels` twice; hashes and `visual:check` tables must match (excluding perf). Log in iteration-log.md. Stuck rule and cap 12; then `blocked`.

## Task 4 - HUD: pill, strength meter, round buttons, tip
What it is / what it means: R1, R2, R3, Decision 3. Replaces the dark panel and bottom help bar.
What changes at a high level: New top-centre pill (`Level N - Name`, `m:ss` timer keeping role=timer, `role="meter"` strength bar with aria-valuetext, 250 ms ease, none under reducedMotion, updated at <= 10 Hz). Round Pause top-left (aria-label "Pause", Esc unchanged), round 1x/2x top-right (aria-label "Game speed", aria-pressed). Perf toggle moves into Settings; `?perf` still works. HUD container `pointer-events:none` except controls; 44 px targets; focus ring. Remove `.hud` and `.instructions`; hide brand header in play. First-level tip card (order 1 and not `tipSeen`), role=status, focusable Dismiss, fades on first successful DrawLine, sets `tipSeen`.
Done when: no `.hud` dark panel or `.instructions` bar in DOM; strength bar matches `strength()`; tip shows once on L1 only.
Iteration: Visual. Scenes `l01`, `l01-tip`, `l10` at 1920x1080 and 1366x768. Refs: `towerwar_yt1.jpg`, `citytakeover_01.jpg`, `towerwar_09.jpg`. Gated: V18, V19 >= 8; H01-H07 pass. Loop: `visual:capture --scene l01` (and `l01-tip`, `l10`), `visual:compose`, view `visual-out/compare-<scene>.png`, score, read `visual:check`, log, fix top 1-3 gaps, re-run touched tests, commit if improved, revert if any score dropped. Exit: gated items >= 8, metrics pass, tests green. Stuck rule and cap 12 as shared.

## Task 5 - Palette restyle of menu, picker, results, pause
What it is / what it means: R4. Colour, radius and type only; same markup and layout; no DOM, aria or test-id renames; `data-outcome` hooks kept.
What changes at a high level: `:root` tokens reusing the SP03 palette (blue `#2E8BFF`, sand `#FFE1B3`, grass `#A3D419`), 16-24 px rounded panels, bold sans, white outlined headings, chunky blue primary buttons, flat sand/grass gradient background.
Done when: V20, V21 pass and the four screens use the tokens; selectors unchanged.
Iteration: Visual. Scenes `menu`, `picker`, `pause`, `results` at both viewports. Refs: menu `towerwar_05.jpg`, `citytakeover_05.jpg`; picker `citytakeover_06.jpg`; pause and results `towerwar_08.jpg` (judged under V20). Gated: V20, V21 >= 8; H-contrast pass. Run the same capture, compose, view, score, log, fix, commit/revert loop as T4. Exit, stuck rule and cap 12 as shared.

## Task 6 - Update HUD/menu e2e specs to new selectors
What it is / what it means: R8 first half. Specs are updated, never deleted.
What changes at a high level: Update specs touching HUD or menu (`app-flow`, `input`, `slice`, `boot`, `dev`, `towers` leftovers) to the new pill, round buttons and perf-in-Settings. Add e2e coverage for tip-once-on-L1, meter aria, Esc pause. Snapshot specs are left for T11.
Done when: `pnpm --filter @node-arena/web test:e2e` passes except specs carrying `test.fixme(true, 'SP05 baseline refresh: ...')`; no spec removed.
Iteration: Non-visual. Measure: run `pnpm --filter @node-arena/web test:e2e` (and `typecheck`, `lint`) after each change; target all non-fixme specs green. Log failures and fixes in iteration-log.md. Stuck rule and cap 12; then `blocked`.

## Task 7 - L1 slice gate
What it is / what it means: R5(a), Decision 7. Gate 1 before rollout.
What changes at a high level: Score the whole L1 slice. Failing items are attributed to the owner SP area from the CHECKLIST owner column and fixed by the smallest change there, tagged `fix(SP03)` or `fix(SP04)`. V09 is scored on `l10cb`, V08 on `l10`/`l18`, V12 on `buildout`.
Done when: in one capture, `l01` V01-V09, V10-V13, V16, V18, V19, V22, V23 >= 8; `menu`/`picker` V20, V21 >= 8; `clash` V14, V15 >= 8; M01-M12 pass at 1920x1080 and 1366x768.
Iteration: Visual. Commands: `visual:capture --scene l01`, then `clash`, `buildout`, `menu`, `picker`, `l10`, `l10cb`, `l18`, then `visual:compose` and `visual:check --strict`. Refs per BF/01-visual-qa-harness/ref-map.json (e.g. `towerwar_01/03/06/yt1`, `citytakeover_01/04`). Loop: score all items, fix the worst first, log, re-run touched tests, commit if improved/revert if any score dropped. Budget: <= 12 iterations per failing item, <= 30 total; beyond that mark `Blocked-visual`, record for final-review, continue. Stuck rule as shared.

## Task 8 - 20-level rollout sweep
What it is / what it means: R6, Decision 5. Reduced checklist per level; L10 and L18 get the full checklist.
What changes at a high level: Capture all 20 levels at both viewports, view the 4x5 contact sheet first and full size only for failures. Per level R1 camera fit (M08 9/9 rays, >= 2% margin), R2 no void (M07), R3 no prop overlap with tower footprint or lane corridor (probe, 0 overlaps), R4 roof glyph height >= 11 px at 1366 (V07 >= 8), R5 lane overlap legibility (V16 >= 8), R6 LOD sanity. Fix only via render params (per-level theme `visual` overrides: camera margin, scatter density/keep-out, prop exclusions; SP04 LOD constants). Level JSON untouched; `check:content` simHash must not move. Batch fixes by shared cause.
Done when: `rollout-log.md` (level x R1-R6 matrix, fix applied) shows every level passing (>= 8, R1-R3 binary) or documented `Blocked-visual`; `pnpm check:content --base HEAD` unchanged simHash.
Iteration: Visual. Commands: `pnpm --filter @node-arena/web visual:capture --all-levels`, `visual:compose`, `visual:check`. Refs: `towerwar_01.jpg`, `towerwar_03.jpg` for look. Log in rollout-log.md and iteration-log.md. Per-level cap 6 iterations, global cap 25. Commit when improved, revert if any score dropped. Stuck rule as shared.

## Task 9 - Perf instrumentation (`frames[]`, p99)
What it is / what it means: R7 measurement support.
What changes at a high level: Extend `createPerfMetrics` snapshot with `frames[]` and p99 so mean fps, 1% low, p95 ms, drawCalls, triangles and jsMs can be derived from a 30 s sample after a 5 s warm-up. Unit tests for percentile maths.
Done when: snapshot exposes the new fields; unit tests green; no behaviour change when perf HUD is off.
Iteration: Non-visual. Self-check: unit tests twice identical; run `visual:capture --scene l18 --headed --gpu` twice and confirm both produce a populated perf snapshot. Log in iteration-log.md. Stuck rule and cap 12.

## Task 10 - L18 60 fps tuning ladder
What it is / what it means: R7, Decision 4. Gate 3. Target mean >= 58, 1% low >= 45, drawCalls <= 100 (M13), jsMs p95 <= 8.
What changes at a high level: Measure, then apply one rung per iteration and re-measure, stopping when met: (1) pixel-ratio cap 1.5 to 1.25; (2) shadow map 2048 to 1024, prop shadows off on `med`; (3) merge/instance remaining static meshes; (4) lower SP04 `LOD_LOW_COUNT` or force `lod:'low'` on L18; (5) roof-texture redraw throttle; (6) auto-detect low quality on < 60 fps for 3 s (user-overridable). Without an integrated GPU, use 4x CPU throttle plus DPR 2 as proxy and log it; fps on SwiftShader is informational.
Done when: perf-log.md shows targets met, or `Perf-open` with numbers and the measured bottleneck (GPU vs JS); flag "needs user spot-check on laptop" if proxy used. Any visual item affected stays >= 8.
Iteration: Non-visual loop. Measure: `pnpm --filter @node-arena/web visual:capture --scene l18 --headed --gpu` (perf HUD on, same seed and window every time). Log each measure in perf-log.md (rung, mean fps, 1% low, p95 ms, drawCalls, triangles, jsMs). Run touched tests each step; after visual-affecting rungs re-run `visual:capture`/`visual:compose` for `l18`, `l10` and re-score the affected items. Stuck: 3 steps with < 3% fps gain, skip to next rung. Cap 12 measures, then `Perf-open`.

## Task 11 - Restore fixme specs + regenerate 7 acceptance baselines
What it is / what it means: R8 second half, Decision 6. The only baseline change in the branch, after gates 1-2 pass.
What changes at a high level: `rg "SP05 baseline refresh"` finds all `test.fixme` markers; fix or restore each so none remain. Run `pnpm --filter @node-arena/web exec playwright test acceptance --update-snapshots` once; view old versus new for capture, clash, glb-fixture, menu, picker, greybox, colourblind; log each (old vs new viewed, reason "reskin") in iteration-log.md; one commit. `maxDiffPixelRatio` stays 0.01.
Done when: zero `SP05 baseline refresh` hits; 7 baselines regenerated with log lines; `pnpm --filter @node-arena/web test:e2e` green on a second plain run.
Iteration: Non-visual. Measure: `pnpm --filter @node-arena/web test:e2e` twice, both green (flake check). If a new baseline looks wrong (not the reskin), fix the render, not the snapshot, then regenerate. Stuck rule and cap 12; then `blocked`.

## Task 12 - README, CREDITS check, `ci` and e2e green
What it is / what it means: R9, Acceptance Criteria.
What changes at a high level: README replaces v1 look descriptions and adds 3 final composite screenshots copied to `docs/img/` from `BF/final/` (re-copy after T13 capture if needed). `docs/CREDITS.md` check: every GLB/texture under `apps/web/assets` has a source row (traceability only); city-kit roads row gone. Fix gaps found.
Done when: grep-compare of assets vs CREDITS clean; `pnpm check:manifest` green; `pnpm run ci` and `pnpm --filter @node-arena/web test:e2e` green; `check:content --base HEAD` simHash unchanged.
Iteration: Non-visual. Measure: `pnpm run ci` then e2e; on failure fix and re-run. Log in iteration-log.md. Stuck rule and cap 12.

## Task 13 - Final capture and `BF/final-review.md`
What it is / what it means: R10, Decision 8. The only user approval point; no approval inside any other task.
What changes at a high level: From a clean build (`pnpm install && pnpm build:prerequisites`), run one fresh `visual:capture` of all scenes at both viewports, `visual:compose`, `visual:check --strict`; copy PNGs and composites to `BF/final/<scene>-<viewport>.png` (committed). Write `BF/final-review.md` with: how to run locally (`pnpm install && pnpm --filter @node-arena/web dev`, URL, `?perf`, levels 1/10/18, colourblind toggle); per-scene final composite links plus ref side-by-sides; score table (V01-V24 x scenes, iteration-0 vs final); metrics M01-M13 and H01-H07 vs thresholds; perf numbers; bot churn before/after from SP02 `pnpm bots:churn` JSON and `packages/bots/churn-baseline-v1.json`; 20-level sweep table; every `Blocked-visual`/`blocked`/`Perf-open` task across all five TASKS.md with log links; known gaps; owner-only items; commit list. Numbers come from `metrics.json` and logs only, none hand-typed.
Done when: `final-review.md` and `final/*.png` committed with all R10 sections; `visual:check --strict` result recorded; commit `05-hud-rollout-perf: final review`.
Iteration: Visual. Commands: `pnpm --filter @node-arena/web visual:capture`, `visual:compose`, `visual:check --strict`. Gated: all V01-V24 scored on named scenes, M01-M13 and H01-H07 per thresholds. If any item < 8 or metric fails, fix by smallest change in owner area (tagged), re-capture, re-log; cap 12 iterations then record as `Blocked-visual` in the review and still write it. Stuck rule as shared. Re-run `pnpm run ci` and e2e after the last fix.
