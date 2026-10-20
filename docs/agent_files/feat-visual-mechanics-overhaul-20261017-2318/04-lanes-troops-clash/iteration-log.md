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
| 1 | 2026-10-20 | 3908977 | V10 7/5/5, V11 8/7/7, V16 8/7/7 | M05 PASS l01 0.262, clash 0.252..0.275 | blind: near-opaque saturated ribbon, bold chevrons, hard crossing seam | paler/translucent fill, smaller chevrons |
| 2 | 2026-10-20 | ddbb869 | V10 7/6/6, V11 8/7/7, V16 8/7/7 | M05 PASS all scenes (l10 0.245..0.37, l18 0.246..0.346); M13 jsMs p95 10.4 (SwiftShader noise; base 7.7-15), drawCalls 37 | ribbon still denser than ref; chevrons bolder than CT; crossing seam | tint more/alpha .5 (tried, reverted) |
| 3 | 2026-10-20 | reverted | V10 7/6/6, V11 7/6/6, V16 7/7/7 | same | no improvement (V11 down) -> reverted to iter 2 | stuck: hypotheses (a) blind compares to refs on saturation, lane over lime grass inherently teal/orange; try opaque pastel fill with alpha-independent colour (premultiplied tint) (b) chevron as soft pale triangle, not white stroke (c) crossing: draw lower-priority lane with lower alpha |
| 4 | 2026-10-20 | 1102813 | V10 7/6/6, V11 8/7/7, V16 8/7/7 | M05 PASS | pastel tint .5 alpha .72: blind "saturated steel-blue, dense dots, hard edge" | paler, fainter dots |
| 5 | 2026-10-20 | cf6d0df | V10 7/6/6, V11 8/7/7, V16 8/7/7 | M05 PASS | blind: chevrons dominate, hard seam at crossing | width factor .35 |
| 6 | 2026-10-20 | 5d2fec7 | 7/7/7 each (self V10 7, V11 8, V16 8) | M05 PASS all (l01 .278, l10 .26-.392, l18 .246-.367 at iter 9, clash .267-.292) | blind: opaque/saturated, chevrons large | smoother fill |
| 7 | 2026-10-20 | 218402f | 7/7/7 | M05 PASS | steel-blue slab; crossing hard square | Tower War recipe from towerwar_01 (low alpha, crisp edge, sparse dots) |
| 8 | 2026-10-20 | c396e4f | 7/7/7 | M05 PASS | desaturated grey-blue; dark navy chevron fringe (dots in chevron tip) | phase-lock dots between chevrons |
| 9 | 2026-10-20 | 47acc6b | V10 7/7/7, V11 7/7/7, V16 7/7/7 | M05 PASS; M13 jsMs p95 12.1 SwiftShader noise, drawCalls 37 | chevrons thin/small vs CT; crossing no darker overlap | bolder chevrons + end fade |
| 10 | 2026-10-20 | 80505fa | 6/7/7 | same | chevrons dominate | reverted |
| 11 | 2026-10-20 | f2eb43f | 6/7/7 | same | band denser/greyer; scorer asks both larger and smaller chevrons (inconsistent) | reverted |
| 12 | 2026-10-20 | final (= 47acc6b shader) | 7/7/7 (blind-9 on identical code) | M05 PASS; tests green | stuck at 7: blind wants paler high-key ribbon w/ visible ground (hue vs lime ground trade-off) and soft diagonal crossings (fixture crossing is 90 deg) | Blocked-visual; hypotheses: ref pastel pink/ice-blue ground vs our lime ground makes teal/orange cast unavoidable; SP05 may re-tune ground/lane together |
| T3-1 | 2026-10-20 | T3 build/cut | (this commit) | V12 8/8/8, V17 8/7/7 | V12: grows from source p2 ~25%, p6 ~60-75%, p12 full w/ bright front; ends under target tower; ours thinner/paler than ref bands. V17: p1 white flash, p3 bright half retracted ~55% over faded base + puff, p6 faded drain base; no flash in refs | laneCrop framesDistinct true (cut, both viewports); M05 PASS; unit lane-anim 3 tests, lines-fx e2e pass | no probe metrics for V12 | V17: flash not distinct (reads as fade), thin ribbon | brighter/wider flash halo |
