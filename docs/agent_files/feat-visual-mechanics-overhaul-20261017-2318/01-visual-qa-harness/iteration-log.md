---
status: in-progress
summary: SP01 visual QA harness iteration log (one row per attempt)
date: 2026-10-18
---
# Iteration log — 01-visual-qa-harness

| iter # | date | task | commit | result/diff count | hypothesis | change |
|---|---|---|---|---|---|---|
| 0 | 2026-10-18 | baseline | f009317 | web unit 154/154 pass (20 files); typecheck 0; lint 0; e2e 14 pass / 3 fail / 22 skip (3 fails = pre-existing toHaveScreenshot diffs: capture.png, glb-fixture.png, menu.png) | — | none (clean HEAD) |
| 1 | 2026-10-18 | Task 1 | (Task 1 commit) | web unit 161/161 pass (21 files, +7 in visual-probe.test.ts); typecheck 0; lint 0; real-browser self-check: visualProbe() twice on the same stepped state JSON-identical (01-first-steps @240, 10-two-foes @600: 10 towers, 6 lanes, 17 troops, gaps null); e2e same 3 screenshot fails + perf p95<4 ms stress test flaky (4.0-6.5 ms under host load avg 6.4 on 4 CPUs; 4/7 runs pass with change, 3/3 baseline) | resumed interrupted attempt: probe.ts + tags + seed/settle hooks already complete; verify and finish | probe.ts buildVisualProbe(); __na.visualProbe(), load(id, seed), render({settle}), fixed-dt step for optional advance(); userData.visualRole tags in towers/lines/troops/scene; startLevel(id, seed=1) |
