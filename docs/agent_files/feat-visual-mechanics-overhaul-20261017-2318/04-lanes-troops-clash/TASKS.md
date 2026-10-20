---
status: draft
summary: 10 tasks - SP04 baseline, pair ribbon lanes, build-out/cut, shared lane split, input, troops, LOD, brawl FX, v1 cleanup + specs, L10/L18 density pass
date: 2026-10-17
---
# Tasks: Lanes, Troops, Clash (SP04)
Source of truth: docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318/04-lanes-troops-clash/PRD.md. Renderer-only: no sim, rules or hash change; screenshot baselines untouched (SP05). Depends on SP03 being complete (needs `towers.visualWidth(id)` and the diorama ground) and on the SP01 harness (commands below). No open items. BF = docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318. Commit per task/improving iteration: `04-lanes-troops-clash: Task N - iter k: <change>`. Log file for all tasks: BF/04-lanes-troops-clash/iteration-log.md (row: iter #, date, commit, per-item scores, metrics, top 3 gaps, planned change).

Shared visual loop (every visual task repeats it): (1) `pnpm --filter @node-arena/web visual:capture --scene <ids>`; (2) `pnpm --filter @node-arena/web visual:compose`; (3) view `apps/web/visual-out/compare-<scene>.png`, score each gated item 0-10 on the CHECKLIST 4/6/8/10 anchors; read `metrics.json` (also `visual:check`); (4) append log row; (5) fix only the top 1-3 gaps, smallest change, re-run touched unit/e2e; (6) commit if improved, revert if any score dropped; (7) exit when all gated items >= 8, metrics pass, tests green. Stuck: 3 consecutive non-improving iterations -> log hypotheses, switch approach. Cap 12 -> mark `Blocked-visual` in the Status column and continue. Never edit refs, lower thresholds, delete tests or touch screenshot baselines.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | SP04 baseline capture (iteration 0) | SP03 T7, SP01 T8 | done |
| 2 | Pair ribbon lanes: model, shader, troop front data path | T1, SP01 T1 | Blocked-visual |
| 3 | Build-out, cut flash/retract, draining lanes | T2 | Blocked-visual |
| 4 | Shared head-on lane + smoothed split | T2, T3, SP01 T2 | Blocked-visual |
| 5 | Input: centre-line hit-test, hover, draw preview | T2, T4 | done |
| 6 | Troops: team-tinted chibi, size, gait, credits | T1 | Blocked-visual |
| 7 | Troop LOD (auto/high/low) | T6 | Blocked-visual |
| 8 | Brawl FX at the split | T4, T7 | Blocked-visual |
| 9 | Remove v1 lane paths + update specs | T5, T8 | done |
| 10 | L10/L18 density, crossings, perf pass | T8, T9 | Blocked-visual |

## Task 1 - SP04 baseline capture (iteration 0)
What it is / what it means: Starting point on the post-SP03 look (Iteration protocol; SP01 Decision 9 style). Includes the clash fixture caveat check.
What changes at a high level: No code. Capture `clash`, `buildout`, `cut`, `l01`, `l10`, `l18`; score V10-V17, V22, V24 and metrics M05, M06, M12, M13. Verify the clash fixture recurs at one point (symmetric clashes); if not, edit only that scene's tick offset in `scenes.json` and log the reason.
Done when: row 0 logged with all items and metrics, fixture caveat resolved.
Iteration: Visual-style. Run `visual:capture --scene clash`, `--scene buildout`, `--scene cut`, `--scene l01`, `--scene l10`, `--scene l18`, then `visual:compose` and `visual:check`; refs per SP01 `ref-map.json` (`towerwar_06.jpg`, `towerwar_yt1.jpg`, `towerwar_01.jpg`; `citytakeover_01.jpg` only as the V11 chevrons role). Gated: none (baseline only). Run capture twice; outputs must match. Cap 12, stuck rule per shared loop.

## Task 2 - Pair ribbon lanes: model, shader, troop front data path
What it is / what it means: Req 1, 2, 6, 11 (offset removal); Decisions 1, 2, 9. One flat chevron ribbon per tower pair.
What changes at a high level: `lines.ts` builds one lane object per unordered pair from `view.lines` plus channels still carrying troops; new `lane-material.ts` shader (width 0.33 x mean endpoint `visualWidth`, base ribbon anchored on Tower War: soft ~0.55 alpha translucent team fill with subtle dotted texture as in yt1, darker edges, City Takeover-style white scrolling chevrons on top (user kept chevrons), faded near tower ends, reduced-motion freeze); troops.ts fills read-only `frontProgress`/`channelCount` typed arrays; runtime order troops -> lines -> fx. Tag `visualRole='lane'` and `pair`; probe keeps `lanes[].{widthWorld,screenWidthPx,mid}` non-null. Remove offset-left geometry and the dashed arrow shader.
Done when: lanes render as ribbons on l01; V10 and V11 >= 8; M05 passes.
Iteration: Visual. Scenes `l01`, `clash`. Capture `visual:capture --scene l01` and `--scene clash`, then compose. Refs `towerwar_06.jpg`, `towerwar_yt1.jpg`, `towerwar_01.jpg` for V10 ribbon (Tower War wins), `citytakeover_01.jpg` for V11 chevrons (City Takeover wins). Gated: V10, V11, V16 (crossing overlap only), M05 (0.25-0.40 lane/tower width). Contributes to V22. Tests: `lines-fx` unit test touched parts. Shared loop, cap 12. Scoring rigor applies (PRD protocol step 3): >= 3 logged observable differences vs ref before any item >= 8; pixel checks via `visual:score-sheet` (SP01); blind second scorer sees only composite + checklist, item score = min of both.

## Task 3 - Build-out, cut flash/retract, draining lanes
What it is / what it means: Req 3; Decision 8. Lanes grow on draw, flash and retract on cut, and a cut channel with troops keeps a faded half.
What changes at a high level: On `LineDrawn`, `buildT` 0->1 from the source over 0.35 s ease-out (instant under reduced motion). On `LineCut`, 80 ms white flash, 0.3 s retract toward the source, 4 pooled puffs at the midpoint. Draining half (alpha 0.4, no chevrons) until the channel is empty.
Done when: `buildout` strip shows growth over 3 frames; scene `cut` (frames +1/+3/+6) shows flash + retract; troops never on bare grass; V12, V17 >= 8.
Iteration: Visual. Scenes `buildout` (draw frames +2/+6/+12 ticks, `settle:false`, `reducedMotion:false`) and `cut` (SP01: L1 DrawLine tick 0, `CutLine` tick 120, frames +1/+3/+6, `settle:false`); cut feedback is gated on scene `cut`, not on `l10`/`l10cb` (bot cuts there are non-deterministic). Run `visual:capture --scene buildout` and `--scene cut`, compose. Refs: `buildout` `towerwar_01.jpg`, `towerwar_yt1.jpg`; `cut` `towerwar_01.jpg`, `towerwar_06.jpg`. Gated: V12 (`buildout`), V17 (`cut`; pixel check = frame diff between +1/+3/+6 non-zero on the lane crop). Add a unit test for build/retract timing with a fixed dt. Shared loop, cap 12. Scoring rigor applies (PRD protocol step 3): >= 3 logged observable differences vs ref before any item >= 8; pixel checks via `visual:score-sheet` (SP01); blind second scorer sees only composite + checklist, item score = min of both.

## Task 4 - Shared head-on lane + smoothed split
What it is / what it means: Req 4, 5; Decisions 2, 3. Hostile A->B plus B->A is one lane, two colours, split at the live fight point.
What changes at a high level: Merge the pair's channels into one lane (A half chevrons A->B, B half B->A). Target `s = (fa+fb)/2` from front progress, measured from the lower-index tower (`progA` = front of channel from<to, per combat.ts `clash()`; "A" is never the owner); exactly `progA/L` at the clash condition and compared against the most recent Clash event of the pair; undrawn-and-empty side forces target to the other end then collapses to a single-direction lane. Per-pair critically damped spring (omega ~14/s), new pair starts at target, `settle()` snaps and is never called implicitly by `update()`. Probe keeps `splitScreen` (shared lanes only) non-null. Allied head-on renders as shared lane with no brawl.
Done when: clash scene shows exactly 1 lane for the pair, `splitScreen` within 12 px of the Clash event point, split moves <= 1.5 u/frame across `splitTrace` T..T+9; cutting one side collapses the lane within 1.5 s; V14 >= 8; M12 passes.
Iteration: Visual. Scenes `clash` (settle and +6 PNG, `splitTrace` in `metrics.json`). Run `visual:capture --scene clash`, compose, `visual:check`. Refs `towerwar_06.jpg`, `towerwar_yt1.jpg`. Gated: V14, V16, M12 (SP01 `thresholds.json` uses the PRD SP04 specifics definition: 1 lane for the pair, crossing lane separate, split-vs-most-recent-Clash error <= 12 px on a `settle()`d frame at/after that Clash tick, widened tolerance for unsettled frames). Add unit tests for the split formula, spring and collapse. Confirm sim state hash identical with/without renderer. Shared loop, cap 12. Scoring rigor applies (PRD protocol step 3): >= 3 logged observable differences vs ref before any item >= 8; pixel checks via `visual:score-sheet` (SP01); blind second scorer sees only composite + checklist, item score = min of both.

## Task 5 - Input: centre-line hit-test, hover, draw preview
What it is / what it means: Req 10. Input matches the new lane geometry.
What changes at a high level: `projectSegments` returns centre lines per channel (shared lane: both channels on one segment, only the human's selectable); remove the `.24` fallback and per-direction segments; hit radius `max(12, halfLanePx+4)` for right-click/hover, `max(8, halfLanePx)` for swipe; `hover*` uniforms (white edge glow, chevron speed x1.6) on the human's half only; draw preview at lane width with a ghost chevron ribbon in team colour, red when `canDraw` rejects. Swipe trail unchanged.
Done when: input unit test and `e2e/input.spec.ts` updated; run it and require green (except `SP05 baseline refresh` fixme specs, which SP05 T11 restores); preview and hover visible on l01.
Iteration: Visual plus tests. Scene `l01` (hover/preview states via the harness handles). Capture `visual:capture --scene l01`, compose. Refs `towerwar_01.jpg` (V10), `citytakeover_01.jpg` (V11 chevrons only). Gated: V10, V11 must not regress (>= 8); no new metric. Run `pnpm --filter @node-arena/web test`. Update the e2e spec and run `pnpm --filter @node-arena/web exec playwright test input`, requiring green. Shared loop, cap 12. Scoring rigor applies (PRD protocol step 3): >= 3 logged observable differences vs ref before any item >= 8; pixel checks via `visual:score-sheet` (SP01); blind second scorer sees only composite + checklist, item score = min of both.

## Task 6 - Troops: team-tinted chibi, size, gait, credits
What it is / what it means: Req 8; Decisions 4, 5. Bigger, fully team-tinted Kenney Mini Characters with a procedural walk.
What changes at a high level: mask-all tint variant in `troop-material.ts` (head 20% lighter); manifest `scale` for height 0.29 x tower width (~1.8 u standard); lower-half vertex shear gait `+/- sin(phase)` in the vertex patch; single file on lane centre. Stuck-rule fallbacks in order: Kenney Blocky Characters, Quaternius Ultimate Animated Characters (rig stripped, via `tools/assets/import-art.mjs`). Any other freely downloadable model that matches the refs better is fine (no licence check). Add a CREDITS.md source row per shipped model (traceability only).
Done when: V13 >= 8; M06 passes; `pnpm check:manifest` green.
Iteration: Visual. Scenes `l01`, `clash`. Capture `visual:capture --scene l01` and `--scene clash`, compose. Refs `towerwar_yt1.jpg`, `towerwar_01.jpg`. Gated: V13, M06 (height >= 1.5% viewport and 0.22-0.60 x tower width). Run `pnpm check:manifest` and troops unit test. Shared loop, cap 12. Scoring rigor applies (PRD protocol step 3): >= 3 logged observable differences vs ref before any item >= 8; pixel checks via `visual:score-sheet` (SP01); blind second scorer sees only composite + checklist, item score = min of both.

## Task 7 - Troop LOD (auto/high/low)
What it is / what it means: Req 9; Decision 6. Seamless instanced capsule+head fallback for density or slow frames.
What changes at a high level: `createTroopRenderer({lod:'auto'|'high'|'low'})`; low set (~80 tris) uses the same `troopPose`, patched material and height/footprint (+/-5%). Exported constants `LOD_LOW_COUNT=600`, `LOD_HIGH_COUNT=400`, `LOD_LOW_EMA_MS=20`, `LOD_HIGH_EMA_MS=14`; hysteresis; swap by setting `count` of the other set in one frame, no allocation; `?lod=` URL param for the harness.
Done when: `?lod=low` and `?lod=high` on `l01` differ only in figure detail; auto flips at the stated thresholds without flicker (unit test with a fake clock); V13 stays >= 8 in both.
Iteration: Visual plus tests. Run `visual:capture --scene l01` once with `?lod=high` and once with `?lod=low`, compose, compare height/placement. Gated: V13, M06 in both modes. Log LOD state and troop count. Shared loop, cap 12. Scoring rigor applies (PRD protocol step 3): >= 3 logged observable differences vs ref before any item >= 8; pixel checks via `visual:score-sheet` (SP01); blind second scorer sees only composite + checklist, item score = min of both.

## Task 8 - Brawl FX at the split
What it is / what it means: Req 7; Decision 7. Cosmetic fight cluster where armies meet.
What changes at a high level: new `brawl.ts`, pooled and zero-allocation, jitter and puff offsets seeded from `(pair, tick)` with no `Math.random`: 2-6 tinted fighters from the LOD mesh facing each other at the split, instanced billboard puffs (pool 6 brawls x 12, 6-puff burst per `Clash`), canvas-generated crossed-swords marker 1 u above the lane; intensity from EMA(clash events/s, tau 2 s) drives fighter count, puff rate 2-10/s, marker scale 0.8-1.2. Existing Clash spark in `fx.ts` recoloured white/cream. Probe keeps `clash.fxScreen` non-null.
Done when: fighters, puffs and marker visible in the clash composite; V15 >= 8.
Iteration: Visual. Scene `clash`. Capture `visual:capture --scene clash`, compose. Refs `towerwar_06.jpg`, `towerwar_yt1.jpg`. Gated: V15; V14 must not regress. Log fighters/puffs active. Shared loop, cap 12. Scoring rigor applies (PRD protocol step 3): >= 3 logged observable differences vs ref before any item >= 8; pixel checks via `visual:score-sheet` (SP01); blind second scorer sees only composite + checklist, item score = min of both.

## Task 9 - Remove v1 lane paths + update specs
What it is / what it means: Req 11, 12. Dead code gone and tests reflect pair lanes.
What changes at a high level: remove per-owner `materials` map, `highlightMaterial` cloning, `ribbonUV`, sparks as the only clash visual. Update `lines-fx`, `troops`, `input` unit tests and `lines-fx`, `troops`, `input` e2e specs per Req 12 (`lanes.length===1`, `lod:'high'` plus a `lod:'low'` pass). Any snapshot test broken (clash, capture, glb-fixture) gets `test.fixme(true, 'SP05 baseline refresh: <reason>')`, snapshot files untouched.
Done when: `rg "highlightMaterial|\.24|ribbonUV"` clean; `pnpm check:manifest`, `test`, `typecheck`, `lint` green; relevant e2e specs (`lines-fx`, `troops`, `input`) run and green except `SP05 baseline refresh` fixme specs (restored by SP05 T11).
Iteration: Non-visual. Measure: `pnpm --filter @node-arena/web test`, `test:e2e` (green except `SP05 baseline refresh` fixme specs), `typecheck`, `lint`, the `rg` command; run twice for the same result. Log in iteration-log.md. Stuck rule: 3 iterations no progress -> log hypotheses, switch approach. Cap 12 -> `blocked`. Never delete tests.

## Task 10 - L10/L18 density, crossings, perf pass
What it is / what it means: Final SP04 gate on dense levels (scene order: l10 then l18; Goals perf).
What changes at a high level: tune lane/troop/brawl params only for crossings, cut feedback and L18 readability; no scope additions. Add informational numbers (fighters/puffs, LOD state, troop count).
Done when: V10-V17 all >= 8, V22 lane/troop part and V24 >= 8; M05, M06, M12 pass; L18 `drawCalls<=100` and `jsMs p95<=8` (fps >= 55 only with `--gpu`).
Iteration: Visual plus perf. Run `visual:capture --scene l10`, `--scene cut`, then `--scene l18`, compose, `visual:check`. Refs `towerwar_yt1.jpg`, `towerwar_01.jpg`, `towerwar_03.jpg` (l18). Gated: V16, V17 (`cut`), V22, V24, M13. Finish L10 before L18. If perf misses, lower LOD constants via the exported overrides. Shared loop, cap 12. Scoring rigor applies (PRD protocol step 3): >= 3 logged observable differences vs ref before any item >= 8; pixel checks via `visual:score-sheet` (SP01); blind second scorer sees only composite + checklist, item score = min of both.
