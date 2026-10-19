---
status: approved
summary: SP01 visual checklist - 24 scored items (V01-V24, 4/6/8/10 anchors, pixel check, owner), metrics M01-M20 with thresholds/status/colour spec, scoring protocol, probe contract; rubric for SP03-SP05
date: 2026-10-19
---
# Visual Checklist (SP01, feat/visual-mechanics-overhaul)

Source: [PRD.md](PRD.md) Appendix A (verbatim), Metrics table (Appendix B), Colour spec and Scoring protocol. Read by `visual:check` (Appendix B / B.1 must agree with `apps/web/visual/thresholds.json`, else it exits 1) and `visual:score-sheet` (items, Scene column and anchors). Keep the table layouts: the tools parse them.

## Rules (every later SP)

- **Never edit refs** (`docs/agent_files/*visual-mechanics-overhaul*/ref/`).
- **Never lower thresholds.** `thresholds.json` is the source of truth; this file mirrors it and `visual:check` fails if the two disagree. A `prov` metric may only be tightened after T8 calibration.
- **Update screenshot baselines only in SP05.** A snapshot-based e2e test broken by a look change is marked `test.fixme(true, 'SP05 baseline refresh: <reason>')` (never removed, snapshot files untouched) by the SP that breaks it; SP05 greps that string and restores each one.
- Where Tower War and City Takeover differ, **Tower War wins**; the only exceptions are lane chevrons (V11, user chose to keep them) and the level picker (V21, Tower War has none).
- Later SPs may append scenes or adjust a scene's capture tick in `scenes.json` with a logged reason; an appended scene lists its V-ids in its `ref-map.json` entry (`items`).

PRD wording of the rules: Rules for later SPs (copy into CHECKLIST.md header): never edit refs, never lower thresholds, update screenshot baselines only in SP05. Where Tower War and City Takeover differ, **Tower War wins**; the only exceptions are lane chevrons (V11, user chose to keep them) and the level picker (V21, Tower War has none). A snapshot-based e2e test broken by a look change is marked `test.fixme(true, 'SP05 baseline refresh: <reason>')` (never removed, snapshot files untouched) by the SP that breaks it; SP05 greps that string and restores each one.

## Appendix A: Visual Checklist

Scale: 0-2 absent/wrong; **4** = element exists but reads clearly as the old/placeholder look; **6** = right idea, visibly off in proportion/colour/detail; **8** = would pass as a sibling of the ref at a glance, minor polish gaps; **10** = indistinguishable in style/proportion from the anchor. Exit needs >=8 on task-relevant items, as the merged min(self, blind) score with the pixel check passing (Scoring protocol). Owner = SP that must reach 8. Tower War refs win over City Takeover refs, except V11 chevrons and V21 picker. Refs are portrait phone shots: anchors compare **proportions** (ratios, shares, counts, hues), never portrait layout.

**Tower look (V05/V06, measured from towerwar_01 red5/grey25, towerwar_03, towerwar_06 and the yt1 zooms of "38"/"44").** Bottom to top: (1) wide octagonal plinth in the team colour (neutral: dark grey) topped by a light-grey/white chamfer ring, with a light-grey door frame and dark door and small side buttresses; (2) one to five floors, each a **white/light-grey chamfered octagon body with one dark horizontal slit window**, each floor sitting on a **thin team-colour band** (chamfered ring) so the vertical rhythm is white body / team band / white body / team band; upper floors are slightly narrower than lower ones (stepped taper); (3) a **thick chamfered octagon roof cap in the saturated team colour**, overhanging the top floor, flat top, darker bevelled edge, carrying the number and dots. Neutral: roof mid-grey (V~.55), bands light grey, bodies light grey, no saturated pixels. The body is never team-painted; only roof cap, trim bands and plinth carry the team hue (blue ~205-212, red ~357, yellow ~44). Floors follow ceil(5*count/63) in the ref (5 -> 1, 25 -> 2, 38/44 -> 4, Max -> 5).

| ID | Item | Scene | Anchor refs | 4 | 6 | 8 | 10 | Pixel check | Owner |
|---|---|---|---|---|---|---|---|---|---|
| V01 | Camera: ~65 deg steep, landscape, level centred, fits. Anchored on **proportions**: tower width / frame height (tw01 ~5.8%, yt1 ~7%), border share of frame (tw01 34%, yt1 44%), lane width / tower width, margin | l01,l10,l18 | yt1, towerwar_01 | v1 shallow ~40 deg, board skew | steep but tower-width ratio >25% off the ref or margin >12% or no border band | steep, tower-width ratio within 25% of ref, border band 10-45% of frame, tightest-axis margin <=8%, all towers inside frame | ratios within 10% of yt1 | M15, M08, M10 border area | 03 |
| V02 | Ground: bright grass, soft shadow blobs, no void/edge | l01 | towerwar_01, yt1 | grey plane in blue void | green plane, flat, edge visible | full-bleed grass, shadows, no edge | + subtle tonal variation as 01 | M07, M09, M14, M18(i) | 03 |
| V03 | Border dressing: sand/rock + trees/crates/tyres on all outside-the-patch regions | l01,l10 | towerwar_01, yt1 | few props floating | sand ring, sparse props | dense, varied, cropped by frame | matches 01 density and colour | M10 | 03 |
| V04 | Palette/lighting: saturated toy palette, soft light | all | towerwar_01, yt1 | muted greys | right hues, harsh/dull | cohesive, bright | matches 01 | M18(i) | 03 |
| V05 | Tower look: white/light-grey floors with slit windows, team-colour thick roof cap + thin team band under every floor + team plinth; neutral all grey (see Tower look) | l01,l10 | towerwar_01 (red5, blue5, yellow4, grey25), towerwar_03, towerwar_06, yt1 | grey tower, coloured base disc, or whole body painted team colour (City Takeover look) | white/grey floors + team roof but missing per-floor team bands, slits, plinth/door ring, or boxy | all of: white body floors with slit, team band per floor, chunky team roof cap, plinth + door, neutral all grey; M11 passes | = tw01 red5 / yt1 "38" at same scale | M11, M18(ii), M20 | 03 |
| V06 | Floors by count band (max 5), stepped taper, proportions | l01,l10,l18 | towerwar_03, yt1 | single stack, no banding | floors but wrong count or no taper | floors correct (M04), white/team alternation, readable steps | = 03 "Max" stack | M04, M20 | 03 |
| V07 | Roof count: white-fill dark-outlined number ON the roof plate, digit height ~0.16-0.22 of tower width | all | towerwar_01, towerwar_03, yt1 ("38", "44") | dark card above, 3x tower | on roof, thin/small (<0.14) | bold fill + outline, centred in upper roof, M02 and M16 pass | = yt1 "38" | M02, M16, M19 | 03 |
| V08 | Slot dots (1 < 10, 2 >= 10, 3 >= 30 count) below the number: **bright white = free slot, dim translucent = slot in use**; neutral shows bright dots; "Max" at cap | l10,l18 | towerwar_01 (blue5 bright, red5 dim), yt1 ("44" two bright + one dim; "38" three dim), towerwar_03 | glyph rows in card | dots present, wrong state or count | count correct, bright/dim semantics correct, legible, M19 passes | = 01/yt1 sets | M19 | 03 |
| V09 | Colourblind glyph on roof, default clean | l10cb | brief | glyph in card | glyph on every tower | only in cb mode, readable | clean, distinct per team | M19 (default scenes: no extra glyph blobs) | 03 |
| V10 | Lane ribbon: flat soft translucent tint, darker edge line, tiny dots, ~1/4-1/3 tower width (**Tower War ribbon**) | l01,l10 | towerwar_01, towerwar_06 | thin dashes | wide, opaque or hard | translucent, right width (M05) | = 06 ribbons | M05 | 04 |
| V11 | Chevrons show direction, evenly repeated (**City Takeover chevrons, user-kept**) | l01 | citytakeover_01 | none | present, wrong size/spacing | clear, consistent | = CT 01 | - | 04 |
| V12 | Lane build-out animates from source | buildout | brief | pops in whole | grows but jitters | smooth from source | smooth + ends under tower | - | 04 |
| V13 | Troops: chunky chibi, team tint, single file, >=1.5% screen height | l01,l10 | towerwar_01, towerwar_06 | specks | visible, boxy/untinted | readable character, tinted, queue | = 06 | M06 | 04 |
| V14 | Head-on: ONE shared lane, colour split at meeting point | clash | towerwar_06, brief | two overlapping dashed lines | one lane, no split | split at live point | split tracks fight smoothly | M12 | 04 |
| V15 | Brawl FX at clash: puffs + small marker | clash | towerwar_06 (red/blue splats), yt1 | none | static blob | animated puffs on point | = 06 confetti | - | 04 |
| V16 | Crossing lanes overlap, no merge/artifact | clash,l18 | towerwar_06 | z-fight/glitch | overlap ok, colour mix odd | clean layering | = 06 | - | 04 |
| V17 | Cut feedback on ribbon (flash, retract) | cut | brief | none | flash only | ribbon snaps/fades over the +1/+3/+6 frames | polished | frame diff between +1/+3/+6 non-zero on the lane crop | 04 |
| V18 | HUD: top-centre level pill + strength bar, round pause/1x/2x buttons | l01 | yt1, towerwar_09 | dark panel | pill, wrong bar/placement | pill + live share bar, round buttons | = yt1 | - | 05 |
| V19 | Help text only as first-level tip; no persistent help bar | l01,l10 | towerwar_09 | persistent bar | shown always in L1 | tip L1 only | dismisses cleanly | - | 05 |
| V20 | Menu restyled to palette | menu | towerwar_05 | old dark | partial | consistent | cohesive | - | 05 |
| V21 | Level picker restyled (Tower War has none; closest ref) | picker | citytakeover_06 | old dark | partial | consistent, 20 readable | cohesive | - | 05 |
| V22 | No v1 leftovers (label cards, road slab, grey plane, offset dashes) | all | v1_playtest_1/2 | 3+ present | 1-2 | none | none + no regressions in L18 | M17, M07 | 03/04 |
| V23 | Gestalt: "looks like Tower War" at thumbnail size | l01,l10,l18 | towerwar_01/06 | no | same genre | would be mistaken at 25% size | indistinguishable style | M18 | 05 |
| V24 | Density/readability at L18 (many towers/troops) | l18 | towerwar_03, yt1 | clutter, unreadable | readable, dense | clear hierarchy | = 03 | M16 (L18 threshold) | 05 |

## Appendix B: Metrics

Metrics (all in `thresholds.json`; px thresholds given at 1920x1080 and scaled by viewport height for 1366x768)

Status column: `cal` = threshold measured on the refs (this PRD), `prov` = provisional; `visual:calibrate` / T8 confirm or fix `prov` before SP03 starts, and a `prov` metric may only be tightened afterwards.
| ID | Metric | Source | Threshold | Ref calibration | St |
|---|---|---|---|---|---|
| M01 | tower screen width, % viewport width (median owned tower) | projected model bbox | l01/l10 >=6.0% at 1920x1080, >=5.5% at 1366x768, <=12%; l18 3.0-8% | towerwar_01: 70/554=12.6% portrait, ~5.8% of height; landscape ref yt1: ~7% of height. T8: OPEN conflict, kept `prov` (needs a decision; loosening is not allowed in T8): at 1920x1080 the 6.0% vw floor = 115 px = 10.7% of frame height, while the refs are 5.8-7% of height (V01 8-anchor: within 25% -> <=~94 px = 4.9% vw), so no camera passes both M01 and V01>=8 | prov |
| M02 | count digit height / tower bbox width (roof number) | pixels in `countRect` locator (white-fill component height); card area / tower area <=1.0 | 0.14-0.30 | measured: tw01 red5 11.7px/75=0.16, grey25 11px/~70=0.16; yt1 38/44 zoom 0.19-0.22 (roof width). The earlier 0.30-0.55 was wrong | cal |
| M03 | count on roof: every tower has the roof-decal mesh inside its model rect AND `hasCard` none AND M17=0 | probe + M19 | 100% / 0 | towerwar_06 | cal |
| M04 | floors == clamp(ceil(5*count/cap), 1, 5) for all towers | probe vs sim | 100% | TW cap 63: 5 -> 1 floor, 25 -> 2, 38/44 -> 4, Max -> 5 [verified visually] | cal |
| M05 | lane screen width / tower width (mid-lane) | probe | 0.25-0.40 | towerwar_01, citytakeover_01 (~1/4-1/3). T8 measured (pixel profile across the ribbon / ref-calib tower box width): tw01 yellow ribbon 17 px / 71 = 0.24, blue ribbon 21 px / 80-90 = 0.23-0.26; yt1 vertical ribbons ~12 px / 43-55 = 0.22-0.28. OPEN: refs sit at or below the 0.25 floor; kept `prov` (lowering = loosening, needs a decision) | prov |
| M06 | troop on-screen height, % viewport height; /tower width | probe | >=2.0% and 0.30-0.60 | T8 measured (troop helmet-to-feet, tower = ref-calib box width): tw01 soldier 32-33 px / 1030 = 3.1%, / tower 71 px = 0.45; yt1 soldier ~18 px / 720 = 2.5%, / tower 43-55 px = 0.33-0.42 (earlier ~1.7% / 0.29 was an under-measure); tightened from >=1.5% / 0.22 | cal |
| M07 | void pixel share | pixels, from an extra pass of the same frame with the harness clear colour forced to magenta `#FF00FF` (so sand-coloured clear colour is not miscounted); share of magenta +-6/channel | <=0.5% (all views incl. 1920x1200) | no void in any ref | cal |
| M08 | 9 viewport sample rays hit ground/border | probe | 9/9 | refs fill frame | cal |
| M09 | grass share **inside the play quad** (`ground.playQuadScreen`, any aspect) | pixels, class `grass` | 0.55-0.85 (l01/l10) | tw01 play band y190-870: 0.68; yt1 play band: 0.70 | cal |
| M10 | border: of pixels **outside** the play quad, share that is sand or rock; plus border area | pixels, classes `sand`+`rock` | sand+rock >=0.60 of border pixels, grass <=0.05 of border, border area >=10% of frame | tw01 border (above/below the play band, 34% of frame): sand .49 + rock .17 = 0.66, grass .01; yt1 (44% of frame): sand .39 + rock .38 = 0.77, grass 0.00. Region = whatever lies outside the quad (top/bottom in portrait refs, any side in landscape), not fixed L/R 20% | cal |
| M11 | tower paint (owned towers; tower rect = probe model bbox, ground-masked): (a) team-sat share of saturated fg pixels (S>=.45,V>=.40) >=0.85; (b) team-sat pixels / fg pixels (roof cap + trim bands) 0.35-0.72 and **never >=0.80** (whole-tower paint = City Takeover look, fails); (c) white-body pixels / fg 0.15-0.45. Neutral towers: saturated pixels <=5% of fg and grey+white >=90% of fg | pixels, class table | as stated | tw01 red5/red4/blue5/yellow4: (a) .93/.88/.99/1.00, (b) .59/.54/.64/.67, (c) .26/.27/.25/.26; yt1 44/38/Max (4-5 floors): (a) .94/.94/.97, (b) .46/.43/.46, (c) .30/.25/.27; neutral tw01 grey25/grey5: sat .01/.00, grey+white 1.00 | cal |
| M12 | head-on (SP04 definition; "A" = lower-index tower, never the owner): (a) exactly 1 lane object for the A-B pair; (b) crossing C-D lane separate (exactly 1); (c) split error = `\|splitScreen - project(point at progA_recent/L from the lower-index tower)\|` against the **most recent** Clash event of that pair (latest tick), measured on a `settle()`d frame taken at or after that Clash tick with no newer Clash (the main `clash` frame); for unsettled frames k ticks later (+6 PNG, `splitTrace` ticks) tolerance = 12 px + projected front-closure distance over k ticks (<= 2 x troop speed x k / TICK_RATE) | probe (`clash` scene: `lanes[]`, `splitScreen`, `clash.eventScreen`/`eventTick`, `splitTrace`) | (a) 1 / (b) 1 / (c) <=12 px (settled) | combat.ts `clash()`: Clash event point = `progA/L`; brief decision. T8: definitional (structure + sim Clash point), not ref-measurable; confirmed unchanged | cal |
| M13 | perf (l18, 5 s real time, fresh page, no clock): fps, p95 frame ms, drawCalls, jsMs p95 | `__na.sample()` + `renderer.info` | `gpu:true`: fps>=55; always: drawCalls<=100, jsMs p95<=8; fps on SwiftShader = `informational` | AGENTS perf goal. T8: spec-derived, not ref-measurable; confirmed unchanged (v1 l18 on SwiftShader: drawCalls 109, jsMs p95 17.5) | cal |
| M14 | grass share of the whole frame | pixels, class `grass` | 0.30-0.60 | tw01 (y<1030, no promo banner) 0.45; yt1 0.39 | cal |
| M15 | towers in frame: min over all towers and edges of (model-rect edge distance / viewport dimension); and tightest-axis margin of the union bbox of all tower rects | probe rects | min margin >=0.02 and tightest-axis union margin <=0.10 | brief V01 (margin <=8% target). T8 measured on ref-calib tower boxes: tw01 min/union margin 35/554 = 0.063; yt1 (central 324 px) union ~0.09 (yellow10 right edge ~772 of 802), so <=0.08 would fail yt1; confirmed unchanged | cal |
| M16 | roof number glyph height in px (tallest outlined digit inside the roof-rect locator, height = white fill (S<=.25,V>=.70) plus its dark outline ring; digit <=0.3 x tower width wide, centred in the upper 60% of the roof locator on a lit plate V>=.45) | pixels | >=12 px at 1366x768 L1 (scaled by viewport height elsewhere); >=10 px at L18 | M02 0.16 x M01 75 px = 12 px; refs digit ~11.5 px at tw01 native size. T8 `visual:calibrate` (towers rescaled to 75 px): min glyph 12 px on tw01 and yt1, pass both; cannot tighten (refs sit on the limit) | cal |
| M17 | DOM label count: `document.querySelectorAll('[data-tower-index], .tower-label')` on game scenes; and `[data-tower-summary]` count | page DOM | 0 / exactly 1 (post SP03 T5) | PRD SP03 R8 | cal |
| M18 | palette distance (objective check for V02/V04/V05): total-variation distance between class-share vectors {grass, sand, rock, white, grey, team-sat, other} of the capture and of the best mapped ref, for (i) the whole frame and (ii) the crop of the first owned tower vs a ref tower crop (`ref-calib.json`) | pixels | (i) <=0.20, (ii) <=0.20 | tw01 vs yt1 frame TV = 0.125 (two refs of the same look pass) | cal |
| M19 | roof-decal pixel visibility, probe-independent (objective check for V07/V08): in the upper 45% of each tower crop, >=1 white-fill component (S<=.25,V>=.70) with a dark-outline ring (within 2 px: V<=.25, or >=0.20 darker than the surrounding roof plate), <=0.3 x tower width wide, centred in the upper 60% of the roof locator on a lit plate (V>=.45), height (fill + ring) >= 0.10 x tower width; plus the count of circular bright/dim dot blobs (min size in both axes) centred under the whole number within 1.3 glyph heights equals the sim's slot count (`__na` sim view, not the probe) | pixels + sim view | 100% of towers; dots match 100% | tw01/yt1: every tower has outlined number + 1-3 dots (verified visually). T8 `visual:calibrate`: outlined number 7/7 towers, dots match 7/7 (tw01 1/1/1/2, yt1 3/3/3), pass both; v1 captures 0 | cal |
| M20 | floor stripes (objective check for V05/V06): along the vertical centre line of the tower rect, count runs of white-body pixels (>=2 px) between roof cap and plinth | pixels | runs within [floors-1, floors+1] and >=1 team-sat band run per white run | yt1 38: 3-4 white runs between blue bands. T8 `visual:calibrate` (start row = bottom of digit + dots): match 1 on tw01 (2w/2b, 1w/1b, 2w/2b) and yt1 (4w/4b x2, 4w/5b), pass both | cal |

### B.1 Machine limits (mirror of `thresholds.json`; must match exactly)

| ID | St | Scenes | Viewports | Limits |
|---|---|---|---|---|
| M01 | prov | l01, l10, l10cb, l18 | 1920x1080, 1366x768 | `{"default":{"1920x1080":{"min":0.06,"max":0.12},"1366x768":{"min":0.055,"max":0.12}},"l18":{"min":0.03,"max":0.08}}` |
| M02 | cal | l01, l10, l10cb, l18, clash | 1920x1080, 1366x768 | `{"ratio":{"min":0.14,"max":0.3},"cardArea":{"max":1}}` |
| M03 | cal | l01, l10, l10cb, l18, clash | 1920x1080, 1366x768 | `{"onRoofShare":{"min":1},"cards":{"max":0}}` |
| M04 | cal | l01, l10, l10cb, l18, clash | 1920x1080, 1366x768 | `{"matchShare":{"min":1}}` |
| M05 | prov | l01, l10, l10cb, l18, clash | 1920x1080, 1366x768 | `{"ratio":{"min":0.25,"max":0.4}}` |
| M06 | cal | l01, l10, l10cb, l18, clash | 1920x1080, 1366x768 | `{"heightShare":{"min":0.02},"perTowerWidth":{"min":0.3,"max":0.6}}` |
| M07 | cal | l01, l10, l10cb, l18, clash, buildout, cut | 1920x1080, 1366x768, 1920x1200 | `{"share":{"max":0.005}}` |
| M08 | cal | l01, l10, l10cb, l18, clash | 1920x1080, 1366x768, 1920x1200 | `{"hits":{"min":9}}` |
| M09 | cal | l01, l10, l10cb | 1920x1080, 1366x768 | `{"share":{"min":0.55,"max":0.85}}` |
| M10 | cal | l01, l10, l10cb | 1920x1080, 1366x768 | `{"sandRock":{"min":0.6},"grass":{"max":0.05},"area":{"min":0.1}}` |
| M11 | cal | l01, l10, l10cb, l18 | 1920x1080, 1366x768 | `{"a":{"min":0.85},"b":{"min":0.35,"max":0.72},"c":{"min":0.15,"max":0.45},"neutralSat":{"max":0.05},"neutralGreyWhite":{"min":0.9}}` |
| M12 | cal | clash | 1920x1080, 1366x768 | `{"pairLanes":{"eq":1},"crossingLanes":{"eq":1},"splitErrorPx":{"max":12,"px":true},"closureFactor":2}` |
| M13 | cal | l18 | 1920x1080 | `{"fps":{"min":55,"gpuOnly":true},"drawCalls":{"max":100},"jsMsP95":{"max":8},"durationMs":5000}` |
| M14 | cal | l01, l10, l10cb | 1920x1080, 1366x768 | `{"share":{"min":0.3,"max":0.6}}` |
| M15 | cal | l01, l10, l18 | 1920x1080, 1366x768 | `{"minMargin":{"min":0.02},"unionMargin":{"max":0.1}}` |
| M16 | cal | l01, l10, l10cb, l18, clash | 1920x1080, 1366x768 | `{"default":{"min":12,"px":true,"atHeight":768},"l18":{"min":10,"px":true,"atHeight":768}}` |
| M17 | cal | l01, l10, l10cb, l18, clash, buildout, cut | 1920x1080, 1366x768 | `{"labels":{"max":0},"summary":{"eq":1}}` |
| M18 | cal | l01, l10, l10cb, l18, clash | 1920x1080, 1366x768 | `{"frame":{"max":0.2},"tower":{"max":0.2}}` |
| M19 | cal | l01, l10, l10cb, l18, clash | 1920x1080, 1366x768 | `{"minDigitRatio":0.1,"numberShare":{"min":1},"dotsShare":{"min":1}}` |
| M20 | cal | l01, l10, l10cb, l18 | 1920x1080, 1366x768 | `{"slack":1,"matchShare":{"min":1}}` |

### Colour spec

**Colour spec (B2).** All pixel metrics use **HSV** from 8-bit sRGB: H degrees 0-360, S and V 0-1 (standard `rgb->hsv`, same as Python `colorsys`), in `visual/lib/color.mjs`. Ranges below were measured from the actual refs (PIL, medians over hand-picked crops of towerwar_01.jpg and the central 324 px of towerwar_yt1.jpg) and are the only definitions; HSL is not used.
| Class | HSV rule | Ref evidence (median) |
|---|---|---|
| grass | H 55-105, S>=.40, V>=.40 (includes yellow-green and shaded grass) | tw01 H75 S.90-.97 V.78-.85; yt1 H73-74 S.75 V.80-.86 |
| sand | H 25-48, S .20-.60, V>=.85 | tw01 H33-35 S.45 V1.0 (PRD `#FFE1B3` = H36 S.30 V1.0) |
| rock | (H<=22 or H>=350), S .30-.80, V .40-.90 | tw01 H14 S.68 V.75 (PRD `#BC5439` = H12 S.69 V.74) |
| white body | S<=.20, V>=.60 | tower floors |
| grey | S<=.20, .35<=V<.90 | neutral roof V.55, floors V.74 |
| team-sat | S>=.45, V>=.40, within +-25 deg of team hue (blue 212, red 357, yellow 44, green 130) | tw01 blue roof H205, red H357, yellow H44 |
| ground mask | grass or sand or rock or tree-green (H 105-150, S>=.35) | excluded when measuring towers |
The v1 sand-HSL rule (`s .3-.8, l>.55, hue 20-50`) and `hue 70-150` grass rule are retired (they failed the PRD's own sand `#FFE1B3` and the sampled grass hue 73-76). Magenta void (M07) is unchanged: `#FF00FF` +-6/channel.

## Scoring protocol

Self-scoring against "= ref" anchors cannot catch drift, so every scored iteration does all of:
1. **Difference log before any score >=8.** For each item the iterating agent wants to score >=8, write >=3 concrete observable differences vs the mapped ref in the iteration log (each = what, ref value, ours value; e.g. "roof cap height: ref 31% of tower height, ours 22%", "stripe count: ref 4 bands, ours 3", "grass hue: ref H75, ours H82", "tree density at rim: ref ~12/100 px, ours 5"). If it cannot find 3, it must say which crops it compared; fewer than 3 caps the item at 7.
2. **Objective pixel check per item where feasible.** Mapped metrics (CHECKLIST column "Pixel check"): V01 M15/M08, V02 M09/M14/M18, V03 M10, V04 M18, V05 M11/M18(ii)/M20, V06 M04/M20, V07 M16/M19/M02, V08 M19, V22 M17. An item cannot score >=8 while its mapped pixel metric fails; the pixel check outranks the eyeball.
3. **Blind second scorer.** After the iterating agent's own scoring, the orchestrator spawns a separate sub-agent (fresh context, model `sonnet`) and gives it ONLY: the composite PNG path(s) and the blank sheet from `pnpm --filter @node-arena/web visual:score-sheet --scene <id>` (items relevant to that scene with their 4/6/8/10 anchors, the ref list, and empty `score` / `differences` fields; no metrics, no previous scores, no iteration log, no code, no diff). The blind scorer writes `visual-out/score-blind-<iter>.json` (`{item:{score,differences[]}}`; items >=8 need >=3 differences) and may not read the repo. The iterating agent saves its own scores as `visual-out/score-self-<iter>.json`; `visual:score-merge self.json blind.json` writes the merged file: **item score = min(self, blind)**, flags any item where |self-blind| >= 3 for the log. Exit gates use merged scores. Spawn a fresh blind scorer every iteration (never reuse one that has seen earlier scores or code).
4. Log row additions: self scores, blind scores, merged, pixel-check results, difference log, top 3 gaps.

Tools: `pnpm --filter @node-arena/web visual:score-sheet --scene <id>` writes `apps/web/visual-out/score-sheet-<id>.md` (the blind scorer's only input besides the composite); `pnpm --filter @node-arena/web visual:score-merge <self.json> <blind.json> [--out file]` writes the merged file (default `score-merged-<iter>.json` next to the self file): per item min(self, blind) after capping any score >=8 with fewer than 3 differences at 7, flag `|self-blind| >= 3`, item missing from either file = merged null (fails).

## Probe contract

`window.__na.visualProbe()` (test hooks only, `apps/web/src/test-harness/probe.ts`) is built from `userData` tags. SP03/SP04/SP05 keep or re-emit every tag on replacement meshes; **null never passes a metric**, so a dropped tag shows up as a failing metric, not a silent pass.

| Tag (`userData.visualRole`) | Carried by | Fields |
|---|---|---|
| `tower` | each tower root `Group` (PRD also allows an `InstancedMesh` with `userData.towerIds[]`; the SP that introduces one extends `probe.ts` to derive `model` from root transform + `visualWidthWorld` + stack height) | `towerIndex` (required), `paintColor` (hex, updated on team change), `floors`, `slotDots`, `visualWidthWorld`; descendants tagged `visualPart: 'model'` bound the model rect (else the whole root minus `count`) |
| `count` | the roof number decal mesh, inside its tower root | position inside the model rect gives `countOnRoof` |
| `lane` | each lane mesh | `from`, `to` (tower indices), `pair` (`'lowId-highId'`), `widthWorld`, `splitWorld` (world distance from the lower-index tower) |
| `troop` | troop `InstancedMesh`es | `heightWorld`, `widthWorld`, `baseY`; positions from the `troopPose` attribute `[x, z, rot, seq]` per instance |
| `ground` | ground plane, border, props, rocks | `playQuad`: `[x, z][4]` world corners of the grass patch (absent => `playQuadScreen` null) |

Probe fields that must be **non-null** once the owner SP lands (v1 nulls are expected baseline failures):

| Probe field | Source tag/field | Metrics | Must be non-null from |
|---|---|---|---|
| `towers[].model`, `countRect`, `countOnRoof`, `hasCard`, `paintHue` | `tower` root + `visualPart`, `count`, `paintColor`, page DOM | M01-M03, M11, M15, M16, M19 locators | SP01 (present in v1) |
| `towers[].floors` | `tower.floors` | M04, M20 | SP03 |
| `towers[].cap` | sim view | M04 | SP01 (present) |
| `towers[].slotDots` (defaults to 0, never null) | `tower.slotDots` | V08 / M19 cross-check | SP03 (must equal the sim slot count) |
| `towers[].visualWidthWorld` | `tower.visualWidthWorld` | M01 (instanced towers) | SP03 |
| `ground.playQuadScreen` | `ground.playQuad` | M09, M10 | SP03 |
| `ground.cornerRayHits` (9 booleans) | `ground` meshes | M08 | SP01 (present; all true from SP03) |
| `lanes[].widthWorld`, `screenWidthPx` | `lane.widthWorld` | M05 | SP04 |
| `lanes[].splitWorld`, `splitScreen` | `lane.splitWorld` | M12 (+ `splitTrace`) | SP04 |
| `lanes[].pair`, `mid` | `lane.from/to/pair` | M12, compose crops | SP01 (present) |
| `troops.screenHeightPx`, `sampleRects` | `troop.heightWorld` + `troopPose` | M06, compose crops | SP01 (present) |
| `clash.eventScreen`, `eventTick`, `eventPair` | sim `Clash` events | M12 | SP01 (present) |
| `clash.fxScreen` | visible FX mesh on the Clash point | V15 | SP04 |
