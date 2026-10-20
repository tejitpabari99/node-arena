---
summary: SP05 Task 8 20-level rollout sweep (R1-R6 per level, fixes, outcome).
date: 2026-10-20
---
# Rollout log - 05-hud-rollout-perf Task 8

Capture: `visual:capture --all-levels --lod high` (lvl-01..lvl-20, tick 400, 1920x1080 + 1366x768, 80 PNGs, 4m44s). Contact sheets 4x5 (scratch, not committed): contact-1920x1080.png, contact-1366x768.png. R1/R2/R4 numbers from the repo metric functions (`visual/lib/metrics.mjs` evaluateJob) run over lvl-* with a scratch thresholds copy (existing thresholds.json untouched; scene lists extended in the copy only): M15 (min margin), M08, M07, M16, M02, M19. R3 = new unit test `apps/web/test/rollout-props.test.ts` (pure scatterProps vs every tower footprint disc and the full segment corridor of every tower pair, prop radii x scale, lane half-width 1.2 u; 20/20 levels 0 overlaps). R6 = probe troops.count + LOD constants.

## Iterations (6 of 25 global; per-level well under 6)
| iter | commit | change (owner) | result |
|---|---|---|---|
| 0 | a9113ba | baseline sweep + R3 test | R1/R2/R3/R6 pass; M05 fail L6/L12/L13/L19; M06 fail L9/L12; M15 union > .1 L5/L8/L9/L12; M19 lvl-16@1366 |
| 1 | e336cca | fix(SP03) roof number 40->44 px (global) | standard-tower digit +1 px, M19 lvl-16 pass; BUT l01@1920 M11 white-body c .451-.454 > .45 (regression) |
| 2 | 68cd979 | fix(SP04) lane width = factor x level median tower width (lines.ts) | M05 pass all lvl-*, l01/l10/l18/clash M05 hold (.26-.39) |
| 3 | 4c206ad | fix(SP04) troop size factor (owned towers < 4 u wide, L9 x0.9) | M06 L9/L12 pass; l01/l10/l18/clash M06 unchanged |
| 4 | 9ea3e26 | per-level camera margin (CAMERA_MARGIN_OVERRIDE keyed by level id: L5/L8/L12 1.2, L9 -1) | M15 union .087-.094 (<= .1), min margin >= .02, 9/9 rays, void 0% |
| 5 | c0e242b | revert roof number to 40 (44 and 42 both push l01@1920 M11 c > .45) | l01 M11 back to pass |
| 6 | 5392ff5 | fix(SP03) per-level roof number: 44 px except 01-first-steps (roofNumberPx); test/rollout-params.test.ts | standard digit 10-12 px @1366 on L2-L20 (L1 11), M02/M16/M19 pass, gated metrics = T7 baseline set (no new fails) |
Not fixed: M19 lvl-02@1366 (dot count 4/3) and lvl-12@1366 (3/2) now flag an extra detected dot (non-gated scenes, detection noise from larger digit); lvl-16@1366 passes; wide empty sand bands on L10/L11/L17/L18/L19 (camera is height-fitted on narrow boards; all towers must stay framed, framing cannot widen; no R item); R5 no param lever found (ribbon art / junction stacking is SP04 art).

## Matrix (final capture, commit 5392ff5, 1920x1080 + 1366x768)
Pass rule: R1 min margin >= 0.02 and 9/9 rays; R2 void <= 0.5%; R3 0 overlaps; R4 PRD >= 11 px glyph (standard towers; smallest towers (30-40 px wide) are capped by M02 digit/tower-w <= .30 = ~10 px); R5 blind score; R6 LOD high while troops <= 600.

| level | R1 min margin (1080/1366), rays | R2 void | R3 | R4 std-tower digit px @1366 (min any tower) | M05 lane/tower | M06 troop/tower | R5 | R6 |
|---|---|---|---|---|---|---|---|---|
| L1 | 0.093/0.093, 9/9 rays | 0% | 0 overlaps | 11 (10) | n/a (none yet) | n/a | n/a | 0 troops, high |
| L2 | 0.097/0.097, 9/9 rays | 0% | 0 overlaps | 10 (10) | 0.284 | 0.404 | n/a | 4 troops, high |
| L3 | 0.05/0.05, 9/9 rays | 0% | 0 overlaps | 12 (9) | 0.315 | 0.421 | n/a | 5 troops, high |
| L4 | 0.054/0.054, 9/9 rays | 0% | 0 overlaps | 10 (10) | 0.266 | 0.447 | n/a | 5 troops, high |
| L5 | 0.087/0.087, 9/9 rays | 0% | 0 overlaps | 10 (10) | 0.255 | 0.471 | n/a | 5 troops, high |
| L6 | 0.099/0.098, 9/9 rays | 0% | 0 overlaps | 12 (7) | 0.228..0.242 | 0.492 | 6 | 6 troops, high |
| L7 | 0.099/0.099, 9/9 rays | 0% | 0 overlaps | 12 (7) | 0.237..0.259 | 0.48 | 6 | 6 troops, high |
| L8 | 0.09/0.09, 9/9 rays | 0% | 0 overlaps | 12 (9) | 0.23..0.248 | 0.535 | 6 | 6 troops, high |
| L9 | 0.094/0.094, 9/9 rays | 0% | 0 overlaps | 11 (10) | 0.231..0.293 | 0.57 | 6 | 3 troops, high |
| L10 | 0.045/0.045, 9/9 rays | 0% | 0 overlaps | 10 (8) | 0.229..0.328 | 0.423 | 6 | 8 troops, high |
| L11 | 0.043/0.043, 9/9 rays | 0% | 0 overlaps | 10 (8) | 0.224..0.326 | 0.387 | 6 | 13 troops, high |
| L12 | 0.086/0.086, 9/9 rays | 0% | 0 overlaps | 12 (8) | 0.338..0.374 | 0.498 | 6 | 6 troops, high |
| L13 | 0.044/0.044, 9/9 rays | 0% | 0 overlaps | 11 (8) | 0.221..0.31 | 0.418 | 6 | 10 troops, high |
| L14 | 0.077/0.076, 9/9 rays | 0% | 0 overlaps | 10 (10) | 0.251..0.275 | 0.468 | 6 | 3 troops, high |
| L15 | 0.043/0.043, 9/9 rays | 0% | 0 overlaps | 12 (8) | 0.22..0.33 | 0.356 | 6 | 8 troops, high |
| L16 | 0.089/0.089, 9/9 rays | 0% | 0 overlaps | 11 (8) | 0.255..0.285 | 0.453 | 6 | 3 troops, high |
| L17 | 0.042/0.042, 9/9 rays | 0% | 0 overlaps | 11 (8) | 0.217..0.325 | 0.366 | 6 | 8 troops, high |
| L18 | 0.043/0.043, 9/9 rays | 0% | 0 overlaps | 11 (8) | 0.269..0.311 | 0.349 | 6 | 15 troops, high |
| L19 | 0.044/0.044, 9/9 rays | 0% | 0 overlaps | 11 (8) | 0.218..0.309 | 0.43 | 7 | 12 troops, high |
| L20 | 0.048/0.048, 9/9 rays | 0% | 0 overlaps | 10 (7) | 0.232..0.316 | 0.458 | 7 | 15 troops, high |


R1 pass 20/20, R2 pass 20/20, R3 pass 20/20 (rollout-props.test), R6 pass 20/20 (max 15 troops at tick 400 vs LOD_LOW_COUNT 600; L18 peak 60-120 per SP04). M05/M06 (non-R items) now in band on every level that has lanes/troops at tick 400 (L1 has none yet). M15 union margin <= 0.1 on all levels with a lane/margin fix (L5 .087, L8 .09, L9 .094, L12 .086; L3/L10/L11/L13+ already .04-.08).

## R4 / R5 judgement (final, one fresh blind scorer: contact sheet + full-size L6, L9, L12, L13, L18, L19, L20)
Blind R4 5-6 on every level (numbers ~25% of tower width on big towers, ~10% on small; small towers with count <= 10 illegible at 1366), blind R5 6-7 (crossings L19/L20 clean; ribbons thin chevron stripes vs wide translucent ref bands; unit blobs clip tower edges at lane ends). PRD pass bar >= 8 not met: R4 and R5 Blocked-visual on all levels (R4 numeric: standard-tower digit 10-12 px vs 11 target, met on ~half the levels; smallest towers 6-10 px).

## Full checklist L10 and L18 (state from T7, not redone)
L10: V01 6, V03 6, V04 7, V05 -, V06 6, V07 5, V08 5, V10 6, V13 5, V19 8, V22 8, V23 6; metrics fail M11 (yellow tower b .754 > .72; neutral troop overlap), colourblind l10cb M11 (orange 31 deg vs 25).
L18: V01 6, V06 6, V08 6, V16 7, V22 8, V23 6, V24 7; metrics fail M11 and M20 (green team hue 130 inside the tree-green ground mask H105-150: green tower foreground 0).
No cheap render-param fix exists (green/colourblind failures are metric mis-specification; thresholds untouched).

## Outcome
R1/R2/R3/R6 pass 20/20 and the M05/M06/M15 param issues are fixed via render params (6 iterations, commits above). R4 and R5 remain Blocked-visual on all 20 levels (blind 5-6 / 6-7). L10, L18 Blocked-visual (T7 scores, M11/M20 mis-specification). Gated metrics at final state = T7 baseline set only (M11 l10/l18/l10cb, M20 l18, M13 jsMs noise). Web unit 373/373 pass, lint + typecheck pass, `pnpm check:content --base main`: "Content hashes current (21 levels, 24 bots); rules/content/BOT_VERSION gates agree" (no content edits).
