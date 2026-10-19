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
