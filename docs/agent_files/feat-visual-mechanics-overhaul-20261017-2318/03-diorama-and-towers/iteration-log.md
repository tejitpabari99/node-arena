---
status: in-progress
summary: SP03 diorama + towers iteration log (one row per iteration). Task 1 stopped at merged V01/V04/V22 = 5 (blocked by T2/T3/T4/T5 scope).
date: 2026-10-19
---
# Iteration log — 03-diorama-and-towers

| iter | date | task | commit | self/blind/merged | difference log | pixel checks | metrics (l01) | top 3 gaps | planned change |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-10-19 | T1 core | 0c80604 | not scored | grass theme, camera 65/35/margin 8, sand clear colour, sand base plane + grass patch, hemisphere fill, road/light/cone deleted | - | M07 pass 0%, M08 9/9, M15 FAIL union .128 (>.10), M01 pass .049 | union margin too loose | margin 8 -> 5 |
| 1 | 2026-10-19 | T1 | (iter 1 commit) | V01 6/5/5, V04 6/5/5, V22 6/5/5 | V01: tower w/frame h ref 5.8-7% vs ours ~8.7%; border band ref 34-44% vs ours thin sand wedges (<10%); margin ref .063 vs ours .076. V04: grass ref #A3D419 flat lime w/ variation vs ours #A6C61D flat; ref sand/rock/tree/crate accents vs none; ref white towers + team caps vs placeholder grey GLBs + navy cards. V22: road slab gone, grey plane gone (M07 0%), label cards still present (5/5, T5). Blind (scored on the pre-light-tweak capture, intensity 2.4 / olive #9EBC1A): cards, no sand band, olive grass | M18 FAIL (frame .481 vs <=.20), M10/M09 FAIL playQuad null (T2), M14 FAIL grass .90 (0.30-0.60) | M07 PASS 0/0/0%, M08 PASS 9/9 x3, M15 PASS .076, M01 PASS .048 vw, M14 FAIL .90/.84, M18 FAIL .48 | (1) sand/rock border band + grass variation = T2; (2) props = T3; (3) label cards = T5, tower look = T4 | margin 8->5->3, tower scales x0.8 (M01 <= .0492 with M15 union <= .10), key light 2.4 -> 2.8 (grass A6C61D vs ref A3D419) |

Stop reason: V01/V04/V22 cannot reach 8 until T2 (sand/rock border band, grass variation, M09/M10/M14), T3 (props, M18), T4 (tower look/scale), T5 (label cards) land. Framing, palette, road removal, no-void (M07/M08/M15/M01) are done. Not iterating further in T1 to avoid doing T2-T5 work.

| 2 | 2026-10-19 | T2 | 13eee8c | V02 7/6/6, V04 6/6/6, V22 6/4/4 | V02: grass share ref .39-.45 vs ours .42; play-quad grass ref .68-.70 vs .83 (patch pad 8, props pending); sand ref .18 vs .34; tonal variation ref blobs vs ours faint 2-green bands; no void. V04: classes grass/sand/rock/team ref .39-.45/.18/.06-.17/.14-.18 vs .42/.34/.10/.02; towers grey GLBs vs white+team caps; no trees/crates. V22: road+grey plane gone; label cards + dark HUD remain; lane thin dashed. Blind: patch edge visible, no clearing/shadow blobs, towers dull, cards | M07 PASS 0%, M08 9/9 x3, M09 PASS .83/.80, M10 PASS .81/.70 (area .50), M14 PASS .42/.40, M15 PASS .076, M01 PASS .048, M18 FAIL frame .222 (tower .345) | ground ring + patch done; M18 needs T3 props (sand 0.34 -> fill), T4 team-colour caps, T5 cards | iter 3: EDGE_SOFT 3->6, stronger variation (3 sines, +-8% shade) |
| 3 | 2026-10-19 | T2 | (iter 3 commit) | not re-scored (no gated item can reach 8: bounded by T3-T5 scope) | softer rim, visibly mottled grass; rest as iter 2 | M07/M08 PASS, M09 PASS .75/.72, M10 PASS .79/.67, M14 PASS .41/.40, M18 frame .214 (limit .20) | same | M18 frame .214 (T3/T4), V04 towers (T4), V22 cards (T5) | none in T2 |

Stop reason (T2): ground metrics M07/M08/M09/M10/M14 pass; V02/V04/V22 held < 8 only by T3 (props, M18 frame), T4 (tower look), T5 (label cards). Not doing their work.
