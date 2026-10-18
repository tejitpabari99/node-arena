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
| 2 | 2026-10-18 | Task 2 | (Task 2 commit) | test-first: visual-clash.test.ts 2/2 fail (no fixture: no Clash); then 3 fail: content schema rejects tower ids A-D (pattern ^[a-z0-9][a-z0-9-]*$) | 4-tower layout + idle bot gives a Clash with zero bot commands | `fixtureFiles(..., 'visual-clash')`: towers a(p1,-40,0) b(p2,40,0) c(p1,-20,-28) d(neutral,-20,28,g40); p2 = bot `idle` |
| 3 | 2026-10-18 | Task 2 | (Task 2 commit) | pass, run twice identical: first Clash tick 100, stepped to 120, 0 bot submissions, 0 rejects, 3 LineDrawn, hash 09019445aa0b70f7; real browser (?test=1&fixture=visual-clash, 2 page loads) same tick/hash, replay record = 3 commands all at tick 0; web unit 164/164 (22 files) x2; typecheck 0; lint 0 | lowercase ids fix schema | tower ids a/b/c/d; harness.test.ts mode list + 'visual-clash' |
