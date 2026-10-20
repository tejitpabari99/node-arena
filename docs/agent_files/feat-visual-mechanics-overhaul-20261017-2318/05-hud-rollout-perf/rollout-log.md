---
summary: SP05 Task 8 20-level rollout sweep (R1-R6 per level, fixes, outcome).
date: 2026-10-20
---
# Rollout log - 05-hud-rollout-perf Task 8

Capture: `visual:capture --all-levels --lod high` (lvl-01..lvl-20, tick 400, 1920x1080 + 1366x768, 80 PNGs, 4m44s). Contact sheets 4x5 (scratch, not committed): contact-1920x1080.png, contact-1366x768.png. R1/R2/R4 numbers from the repo metric functions (`visual/lib/metrics.mjs` evaluateJob) run over lvl-* with a scratch thresholds copy (existing thresholds.json untouched; scene lists extended in the copy only): M15 (min margin), M08, M07, M16, M02, M19. R3 = new unit test `apps/web/test/rollout-props.test.ts` (pure scatterProps vs every tower footprint disc and the full segment corridor of every tower pair, prop radii x scale, lane half-width 1.2 u; 20/20 levels 0 overlaps). R6 = probe troops.count + LOD constants.

## Matrix (1 iteration, no fix applied)
Pass rule: R1 min margin >= 0.02 and 9/9 rays; R2 void <= 0.5%; R3 0 overlaps; R4 roof glyph (PRD: >= 11 px at 1366; harness M16 gate 5 px); R5 blind score; R6 LOD high while troops <= 600.

| level | R1 min margin 1080/1366, rays | R2 void 1080/1366 | R3 props | R4 min digit px @1366 (M16/M02/M19) | R5 | R6 troops@t400, LOD |
|---|---|---|---|---|---|---|
| L1 | 0.093/0.093, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 10 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | n/a (no lanes) | 0, high |
| L2 | 0.097/0.097, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 10 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | n/a | 4, high |
| L3 | 0.05/0.05, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 9 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | n/a | 5, high |
| L4 | 0.054/0.054, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 9 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | n/a | 5, high |
| L5 | 0.108/0.108, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 9 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | n/a | 5, high |
| L6 | 0.099/0.098, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 7 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 7 | 6, high |
| L7 | 0.099/0.099, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 7 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 6 | 6, high |
| L8 | 0.111/0.111, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 8 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 6 | 6, high |
| L9 | 0.134/0.134, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 9 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 6 | 3, high |
| L10 | 0.045/0.045, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 7 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 6 | 8, high |
| L11 | 0.043/0.043, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 7 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 6 | 13, high |
| L12 | 0.108/0.108, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 7 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 6 | 6, high |
| L13 | 0.044/0.044, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 7 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 7 | 10, high |
| L14 | 0.077/0.076, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 9 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | n/a | 3, high |
| L15 | 0.043/0.043, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 8 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 6 | 8, high |
| L16 | 0.089/0.089, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 8 px; M16 pass/pass, M02 pass/pass, M19 pass/FAIL | 6 | 3, high |
| L17 | 0.042/0.042, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 8 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 6 | 8, high |
| L18 | 0.043/0.043, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 7 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 7 | 15, high |
| L19 | 0.044/0.044, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 7 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 7 | 12, high |
| L20 | 0.048/0.048, 9/9 rays | 0%/0% | 0 overlaps (rollout-props.test) | 6 px; M16 pass/pass, M02 pass/pass, M19 pass/pass | 7 | 15, high |

R1 binary PASS 20/20 (min margin 0.042-0.134 at both viewports, 9/9 rays). R2 PASS 20/20 (0% void). R3 PASS 20/20. R6 PASS 20/20: max 15 troops at tick 400 (LOD_LOW_COUNT 600, LOD_HIGH_COUNT 400, EMA 20/14 ms; auto stays high; L18 peak ~60-120 per SP04).
Other pixel metrics over lvl-*: M02/M03/M04 pass; M16 pass 40/40; M19 pass except lvl-16@1366 (neutral small tower, 30 px wide, second slot dot is the dim translucent dot on a grey roof, undetected: 2 slots / 1 detected; 1920 passes). M05 (lane/tower 0.18-0.20 on L6/L13/L19 below 0.20 floor, 0.44 on L12 above 0.40; L1 no lanes at tick 400), M06 (troop height L9/L12 0.62-0.70 of tower w vs 0.60 cap) and M15 unionMargin cap 0.1 (L5/L8/L9/L12 0.108-0.134: loose camera fit) are not R-items and not gated on lvl scenes: informational, recorded only.

## R4 / R5 judgement (one blind scorer, contact sheet + full-size L6, L13, L18, L19, L20 @1366)
Blind R4: 4-5 on every level (numbers ~7-10 px high at 1366, thin vs ref ~2.5x larger; contact sheet too small to read digits). Blind R5: 6-7 (lane crossings in L18/L19/L20/L13/L6 clean, no z-fight; shared-tower junctions stack lanes on the roof; no glitch). Ceiling matches SP03/SP04 (tower ~3% frame height; lanes thin dashed vs ref soft bands).
Self view of contact sheets: no void, no lane/prop overlaps, props clipped only at frame rim, L10/L11/L17/L18/L19 leave wide empty sand bands left/right (camera fit by height on narrow boards; not an R item).

## Fixes / why none applied
Every level references the single theme `grass` via level JSON `visual` (levels untouched by rule), camera/margin is global in the manifest, so a per-level render override has no lever without editing level JSON. R1-R3, R6 pass everywhere so no fix needed. R4/R5 shortfall is one shared cause (tower screen size / roof glyph scale / ribbon art, SP03/SP04 ownership); T7 already tried tower scale .72->.86/.79 and camera margin 3->1.5/2.2/2.6 (reverted: M01/M18/M20 regressions). Not repeated.

## Full checklist L10 and L18 (state from T7, not redone)
L10: V01 6, V03 6, V04 7, V05 -, V06 6, V07 5, V08 5, V10 6, V13 5, V19 8, V22 8, V23 6; metrics fail M11 (yellow tower b .754 > .72; neutral troop overlap), colourblind l10cb M11 (orange 31 deg vs 25).
L18: V01 6, V06 6, V08 6, V16 7, V22 8, V23 6, V24 7; metrics fail M11 and M20 (green team hue 130 inside the tree-green ground mask H105-150: green tower foreground 0).
No cheap render-param fix exists (green/colourblind failures are metric mis-specification; thresholds untouched).

## Outcome
R1/R2/R3/R6 pass 20/20. R4 and R5 Blocked-visual on all levels (blind 4-5 / 6-7 < 8; literal 11 px glyph unmet: min digit 6-10 px @1366, max 10). L10, L18 Blocked-visual (as T7). `pnpm check:content --base main`: "Content hashes current (21 levels, 24 bots); rules/content/BOT_VERSION gates agree" (simHash unchanged; no content/level edits).
Hand-off for final-review: R4/R5 need SP03 tower/glyph scale rework or art (outside render-param budget).
