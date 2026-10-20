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

## Task 4 (HUD) — scenes l01, l01-tip, l10 @1920x1080 + 1366x768
| iter | change | self/blind V18, V19 | pixel checks | notes |
|---|---|---|---|---|
| 1 | initial HUD (21722a7) | self 8/8; blind 7/8 | H01-H07 pass (l01, l01-tip, l10) | blind: pill text small, bar thin vs ref capsule, buttons small |
| 2 | bigger pill/bar/buttons (30px bar) | 7/8 | H pass | same gaps |
| 3 | white buttons, 34px bar | 7/7 | H04 tip@1366 fail then fixed | V19 down: tip text small |
| 4 | vh-scaled sizes, tip 760px | 7/8 | pass | |
| 5 | bar becomes the pill (text overlaid on bar, stroke text) | 7/8 | pass | stuck x3 -> switched approach |
| 6-7 | wider pill, separators, gloss/uppercase (reverted) | 7/8 | pass | gloss no gain, reverted |
| 8 (kept) | font clamp 24px min, tip .72em | 7/8 | H04 tip@1366 9.2% pass | final CSS |
| 9 | text row above 1.9em bar (reverted) | 7/7 | pass | V19 down -> reverted to 8 |

Differences (blind, consistent): ref pill has no timer/1x button (PRD mandates both); ref bar is bare tri-colour capsule; ref buttons single undo; tip is a card (PRD R3) vs ref banner art. V18 Blocked-visual at merged 7; V19 merged 8 (self 8, blind 8; diffs: tip card vs banner, small text at 1366, overlaps border props).
H01-H07 pass on l01, l01-tip, l10 both viewports. l18/l10cb H rows fail only because those scenes were not recaptured (no pill in stale metrics).

## Task 5 (palette restyle) — scenes menu, picker, pause, results @1920x1080 + 1366x768
| iter | change | self/blind (menu V20, picker V21, pause V20, results V20) | notes |
|---|---|---|---|
| 1 | :root tokens (--c-*), sand/grass gradient bg, navy rimmed 24px panels, blue primary / sand secondary chunky buttons, outlined headings, UI_TOKENS + ui-tokens.test.ts (all pairs >= 4.5:1, strict AA, no large-text allowance) | self 8/8/8/8; blind 7/7/7/7 | blind gaps: heading outline invisible on navy, sentence case, buttons thin/small, tiny body text. App.tsx untouched (selectors unchanged). Web unit 348/348, typecheck/lint pass |
