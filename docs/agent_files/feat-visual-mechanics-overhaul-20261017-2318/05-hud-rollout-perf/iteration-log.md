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
