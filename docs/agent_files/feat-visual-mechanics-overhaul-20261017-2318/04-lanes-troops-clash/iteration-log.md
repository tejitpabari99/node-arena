---
status: in-progress
summary: SP04 lanes/troops/clash iteration log (one row per iteration). Row 0 = post-SP03 baseline.
date: 2026-10-20
---
# Iteration log — 04-lanes-troops-clash

| iter | date | task | commit | self/blind/merged | difference log | pixel checks | metrics | top 3 gaps | planned change |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-10-20 | T1 baseline | d4111c8 (no code change) | V10 3/3/3, V11 2/4/2, V12 3/5/3, V13 3/3/3, V14 3/3/3, V15 1/2/1, V16 4/5/4, V17 2/3/2, V22 4/5/4, V24 4/6/4 | V10: ref wide translucent ribbon vs ours thin blue dashed line, hard dashes, no edge band. V11: no chevrons. V12: lane fully drawn at ticks 2/6/12 (pops in whole). V13: troops grey specks ~1.4% vh, untinted. V14: a-b is 2 parallel dashed lanes (red+blue), no split. V15: no puffs/marker. V16: c-d crosses a-b as thin dashes, no artifact. V17: cut lane vanishes, no flash/retract visible (laneCropDistinct=true). V22: offset dashed lanes remain. V24: lanes thin, troops specks | M05 FAIL (lane screenWidthPx null all scenes); M06 FAIL (troop h 0.014/0.010/0.009/0.011 of vh; 0.179/0.159/0.129/0.155 of tower w); M12 FAIL (a-b lanes 2, crossing 1, split err null); M13 PASS drawCalls 38, jsMs p95 7.7 (run 2: 15, SwiftShader noise), fps 4.8 info | M05 null, M06 FAIL, M12 FAIL, M13 PASS (expected pre-SP04: lane probe fields null) | one shared ribbon per pair, wide tinted + chevrons; bigger tinted troops; brawl FX + split | SP04 T2+: lane-material/lines.ts pair lanes first |

Notes (iter 0)
- Fixture caveat RESOLVED, no scenes.json edit: sim Clash events (fixture-1, seed 1) at ticks 100,120,140,160,180,200, all progA=progB=800000 (L=1.6M, exact midpoint, period 20). Capture tick 120 is itself a Clash; splitTrace 120..129 has clashTick 120 and eventScreen constant (960, 568.4) at both viewports. Successive clashes recur at one point.
- Capture-twice determinism: 36 of 36 PNGs byte-identical across 2 full runs (clash, buildout, cut, l01, l10, l18) and metrics.json equal except l18@1920x1080 (below). Tooling issue: l18-1920x1080.png (and -magenta) sha differs between runs; that frame is captured after the real-time perf window (ticks 119 vs 116, jsMs 7.7 vs 15), so it is not deterministic. Other l18 viewports are identical.
- Other visual:check fails unrelated to SP04: M02, M09 (l10@1080), M11, M16/M19 (clash@1366), M18, M20.
- visual:compose exits 1 when menu/picker/l10cb missing from metrics.json (not captured here); the six needed composites are still produced.
- visual-out/ is gitignored; not committed.
