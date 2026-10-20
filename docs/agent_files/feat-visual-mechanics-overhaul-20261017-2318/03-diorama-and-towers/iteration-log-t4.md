---
status: in-progress
summary: SP03 Task 4 (instanced stacked towers) iteration log, rows start at iter 101 to avoid merge clashes with iteration-log.md. V05/V06 merged 6, held by DOM label cards (T5) and green-hue metric mask.
date: 2026-10-20
---
# Iteration log — Task 4 (towers)

| iter | date | task | commit | self/blind/merged | difference log | pixel checks | metrics (l01/l10/l18) | top 3 gaps | planned change |
|---|---|---|---|---|---|---|---|---|---|
| 101 | 2026-10-20 | T4 | 2e9506c + iter commit | V05 7/6/6, V06 7/6/6 | roof cap smaller/thinner than ref (0.9 plinth, 0.15w vs ref ~full width, ~35% h); plinth+door small; flat shading vs ref soft tonal; label card covers roof (T5); floors pitch 0.49w vs yt1 tighter. Built: 6 shared InstancedMeshes, floors by count, white bodies, team roof/bands/plinth, neutral all grey, lean-cancelling shear, LIGHT_GAIN compensation for warm scene light, emissive fill | l01 PASS: M01 .044, M04, M11 (b .57-.70, c .27-.35), M15 .094, M20; M18(ii) tower .027 PASS. l10: M01 .029, M04, M20 PASS, M11 1/10 fail (yellow tower under label card). l18: M01 .032, M04 PASS, M13 drawCalls 37 PASS (jsMs p95 8-15 noisy, SwiftShader), M11 5/14 fail (4 green towers: hue 130 inside the tree-green ground mask so unmeasurable; 1 yellow under card), M20 1 fail (green). M18(i) frame .196-.27 FAIL (ground/props + whites) | label cards (T5), green vs tree-green mask in M11/M20 (metric), roof/plinth proportions | stop: remaining gaps are T5/metric scope |
