---
status: in-progress
summary: SP05 HUD/rollout/perf iteration log (non-visual tasks: one row per iteration).
date: 2026-10-20
---
# Iteration log — 05-hud-rollout-perf

| iter | date | task | commit | tests (run 1 / run 2) | typecheck/lint | change / notes |
|---|---|---|---|---|---|---|
| 1 | 2026-10-20 | T1 strength() + tokens | (this commit) | strength.test.ts 10/10, 10/10 | pass / pass | apps/web/src/ui/strength.ts (garrison.count + players[].transit, neutrals excluded, largest-remainder %), ui/tokens.ts (pill #1B5BC0 / #FFFFFF, WCAG helper) |
| 2 | 2026-10-20 | T2 tipSeen save setting | (this commit) | save.test.ts 39/39, 39/39; full web unit 316/316 | pass / pass | SaveSettings.tipSeen (default false); settings() accepts optional key (key-less v1/v0 load false, no v bump); fixtures untouched, expectations use v1Loaded; +2 tests |
| 3 | 2026-10-20 | T3 harness additions | (this commit) | web unit 330/330 (+visual-hud.test.ts); selfcheck full: 60/60 PNGs identical, 0 metrics diffs (27 jobs); selfcheck --all-levels: 80/80 identical, 0 metrics diffs (40 jobs) | pass / pass | scenes l01-tip/pause/results (frame `action` pause\|results; results = L1 timeout at tick 3600), `--all-levels` (lvl-NN, tick 400, 1920x1080+1366x768, single browser), tipSeen=true for every scene except l01-tip, `hud` record per frame (collectHud), H01-H07 in thresholds.json + CHECKLIST B/B.1/B.2 + `lib/hud-metrics.mjs` hooked into visual:check; test-harness `pause()`/`strength()`; ref-map l01-tip(V19)/pause,results(V20)/lvl-NN(items []). H01-H07 all FAIL on pre-HUD code (expected); checklist-vs-thresholds agrees (`--checklist-only`). Pre-existing M fails (clash/l10/l10cb/l18) unchanged. |
