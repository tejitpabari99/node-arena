---
status: draft
summary: 8 tasks - probe and harness hooks, clash fixture, deterministic capture, selfcheck, metrics/check, compose, CHECKLIST, iteration-0 baseline
date: 2026-10-17
---
# Tasks: Visual QA Harness (SP01)
Source of truth: docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318/01-visual-qa-harness/PRD.md. Tooling-only sub-project: no look change, no new dependencies, no e2e/snapshot edits. All tooling tasks share one loop: build, self-check (run twice, outputs must match), log in BF/01-visual-qa-harness/iteration-log.md, cap 12. No open items. Commit per task: `01-visual-qa-harness: Task N - <change>`.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Probe tags and `visualProbe()` + harness hooks | none | todo |
| 2 | `visual-clash` fixture | T1 | todo |
| 3 | Scenes + deterministic `visual:capture` | T1, T2 | todo |
| 4 | Pixel helper + `visual:selfcheck` (determinism loop) | T3 | todo |
| 5 | Metrics M01-M13, `thresholds.json`, `visual:check` | T3, T4 | todo |
| 6 | `ref-map.json` + `visual:compose` | T3 | todo |
| 7 | CHECKLIST.md (24 items, metrics table, probe contract) | T5, T6 | todo |
| 8 | Iteration-0 baseline + calibration + regression gate | T4, T5, T6, T7 | todo |

## Task 1 - Probe tags and `visualProbe()` + harness hooks
What it is / what it means: The projection-first metric source (Architecture: Probe; Decision 3). Test hooks only, absent in prod build.
What changes at a high level: Add tag-only `userData.visualRole` (tower, count, lane, troop, ground; lane also `pair`) in the v1 towers/lines/troops/scene renderers, with no look change. Add `window.__na.visualProbe()` returning the plain-JSON shape in the PRD, built from existing `inspect()` handles and the camera `project()`. v1 gaps (floors, splitScreen, ribbon width) return null. Add harness support for an optional `seed` on `load`, fixed-dt renderer time per stepped tick, and `render({settle})` (default true) calling each renderer module's optional `settle()`.
Done when: unit tests cover probe shape, null-for-gaps, and absence in prod build; existing unit tests unchanged-green.
Iteration: Non-visual tooling. Self-check: `pnpm --filter @node-arena/web test` then call `visualProbe()` twice on the same stepped state; JSON must be identical. Log each attempt as a row in BF/01-visual-qa-harness/iteration-log.md. Loop: change, re-run touched tests, commit if green, revert if a prior test breaks. Stuck rule: 3 iterations with no progress, write hypotheses to the log and switch approach. Cap 12; then mark `blocked`. Never delete tests.

## Task 2 - `visual-clash` fixture
What it is / what it means: Req 3. Four-tower scene for head-on and crossing-lane checks.
What changes at a high level: `fixtureFiles(..., 'visual-clash')` with A(p1), B(p2) hostile and A->B and B->A drawn, plus C(p1), D(p2 or neutral) with C->D crossing the A-B lane. Bots must emit no commands in the capture window; verify from the event log, else pick the least-active existing profile.
Done when: fixture loads, a `Clash` event occurs, and the event log shows zero bot commands through clash tick + 20.
Iteration: Non-visual tooling. Measure: load fixture, step to first `Clash` tick + 20, assert via test. Run the test twice, same result. Log in iteration-log.md. Stuck rule: 3 iterations with no progress, log hypotheses and switch approach (e.g. different bot profile). Cap 12, then `blocked`.

## Task 3 - Scenes + deterministic `visual:capture`
What it is / what it means: Req 1, 2, 4, 9; Decisions 1, 2, 6, 7. Plain `.mjs` on the chromium API, preview port 4174, outside `e2e/`, not in `scripts/ci.sh`.
What changes at a high level: `scenes.json` (l01 tick 240, l10 400, l18 600, clash = first Clash + 20, menu, picker, buildout +2/+6/+12 ticks, l10cb) with seed and scripted player lines at tick 0; 1920x1080 and 1366x768 for all, 1920x1200 also for l01/l10/l18. Implement the full determinism recipe (flags, DSF 1, pinned settings, `page.clock`, step-only sim, double render, fonts ready, parked mouse). `clash` writes a +6 PNG and a `splitTrace` for ticks T..T+9. Write `run.json` and `metrics.json`; add `visual-out/` to .gitignore; flags `--scene --viewport --headed --gpu --dev --no-build`.
Done when: `pnpm --filter @node-arena/web visual:capture` yields 8 scenes x 2 viewports (+3 at 1920x1200) headless; `--headed` and `--scene l01` work.
Iteration: Non-visual tooling. Command: `pnpm --filter @node-arena/web visual:capture` run twice. Check outputs exist, `run.json` records renderer/chromium/commit/font hash. Log in iteration-log.md. Stuck rule: 3 iterations with no progress, log hypotheses and switch approach. Cap 12, then `blocked`.

## Task 4 - Pixel helper + `visual:selfcheck` (determinism loop)
What it is / what it means: Acceptance criterion for same-machine byte-identical output; shared pixel helper (second blank page, PNG to canvas to getImageData).
What changes at a high level: `lib/pixels.mjs` and `selfcheck.mjs` (capture x2, compare SHA-256 of every PNG; fallback <=0.01% differing pixels with channel delta <=2 and metrics.json identical after dropping `perf`).
Done when: `visual:selfcheck` is green on two consecutive runs.
Iteration: Command: `pnpm --filter @node-arena/web visual:selfcheck`. Target: identical hashes. On any diff, find the source (clock, font, MSAA, shader time uniform, DOM transition), log it in iteration-log.md (iter #, date, commit, diff count, hypothesis, change), fix, repeat. Stuck rule: 3 iterations with no change in diff count, write hypotheses, switch approach (e.g. pin `quality:'low'` no-AA for capture). Cap 12, then `blocked` and proceed.

## Task 5 - Metrics M01-M13, `thresholds.json`, `visual:check`
What it is / what it means: Req 5, 6; Decisions 3, 5, 8. Null never passes.
What changes at a high level: Probe metrics M01-M06, M08, M12; pixel metrics M07 (extra magenta-clear pass), M09-M11; M13 perf (l18, 5 s real time, no clock; fps informational on SwiftShader, gated with `--gpu`). `thresholds.json` holds all thresholds (px scaled by viewport height); `visual:check` prints a pass/fail/informational table and exits 1 only with `--strict`.
Done when: with v1 code, M01, M02, M03, M05, M06, M07, M12 fail and null fields count as fail.
Iteration: Commands: `visual:capture` then `visual:check --strict` twice; the table must be identical (excluding M13 perf). Compare to the expected v1 failures; if any expected-fail passes, tighten the threshold (never loosen). Log in iteration-log.md. Stuck rule: 3 iterations with no progress, log hypotheses, switch approach. Cap 12, then `blocked`.

## Task 6 - `ref-map.json` + `visual:compose`
What it is / what it means: Req 7; Decision 4. No image libs.
What changes at a high level: `ref-map.json` per the PRD scene-to-refs table; reference dir by glob `docs/agent_files/*visual-mechanics-overhaul*/ref` (override `VISUAL_REF_DIR`). `compose.mjs` plus `compose.html.tpl` screenshots a labelled grid per scene: current (1920 primary, both viewports stacked) | refs scaled to equal height | detail strip (first owned tower, a lane midpoint, a troop cluster, clash point).
Done when: `compare-<scene>.png` exists for every scene.
Iteration: Commands: `visual:capture` then `visual:compose`; run twice, outputs identical. View every `compare-*.png` yourself: labels legible, refs undistorted, crops land on the right objects. Fix and re-run. Log in iteration-log.md. Stuck rule: 3 iterations with no progress, log hypotheses, switch approach. Cap 12, then `blocked`.

## Task 7 - CHECKLIST.md
What it is / what it means: Req 8; Decision 5. The scoring rubric that SP03-05 iterate against.
What changes at a high level: Write BF/01-visual-qa-harness/CHECKLIST.md with Appendix A verbatim (V01-V24, 4/6/8/10 anchors, owner SP), Appendix B metrics table with thresholds, the probe-contract section (tags and fields SP03/04/05 must keep non-null), and the header rules (never edit refs, never lower thresholds, baselines only in SP05, `test.fixme(true, 'SP05 baseline refresh: <reason>')` convention). `visual:check` must fail if CHECKLIST and `thresholds.json` disagree.
Done when: all 24 items and 13 metrics present; the disagree check works.
Iteration: Check command: `visual:check --strict` run against a deliberately altered copy of a threshold must report mismatch; the real files must report none. Log in iteration-log.md. Stuck rule: 3 iterations with no progress, switch approach (e.g. generate the table from `thresholds.json`). Cap 12, then `blocked`.

## Task 8 - Iteration-0 baseline + calibration + regression gate
What it is / what it means: Iteration protocol steps 3-5; Decision 9. Proves the harness discriminates.
What changes at a high level: On unmodified v1 visuals run capture and compose, view all composites, score every V01-V24 0-10 against its anchors, evaluate M01-M13, and write row 0 to iteration-log.md (iter #, date, commit, per-item scores, metrics, top 3 gaps, planned change). Expected: most items <=3, M01, M02, M03, M05, M06, M07, M12 fail. Anything passing at baseline gets a tightened anchor or threshold. Calibration: view-only score `towerwar_01.jpg` as a capture for V01-V13; every item must be >=8, else fix the rubric. Record calibration.
Done when: row 0 logged with all items and scenes; calibration recorded; `pnpm --filter @node-arena/web test`, `typecheck`, `lint`, `test:e2e` unchanged-green with no e2e file or snapshot modified.
Iteration: Visual-style loop. Commands: `pnpm --filter @node-arena/web visual:capture`, `visual:compose`, `visual:check`. Compare against refs per ref-map. Gated items: all V01-V24 scored; metrics M01-M13 per `thresholds.json`. Loop: capture, compose, view, score, fix rubric or thresholds (tighten only) on top 1-3 discrimination or calibration gaps, re-run touched tests, commit if improved, revert if worse. Exit: baseline discriminates, towerwar_01 self-scores >=8 on V01-V13, tests green. Stuck rule: 3 iterations with no improvement, log hypotheses, switch approach. Cap 12, then mark `Blocked-visual` here and continue. Never edit refs or delete tests.
