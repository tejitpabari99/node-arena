---
status: approved
summary: Lanes matching the Tower War refs as closely as possible (flat chevron ribbons, build-out, one shared head-on lane with a smoothed live split), brawl FX at the split, bigger team-tinted chibi troops with a seamless LOD fallback
date: 2026-10-17
---
# PRD: Lanes, Troops, Clash (SP04)

Repo/branch: node-arena · feat/visual-mechanics-overhaul · Depends on: SP03 (phase 3; also uses SP01 harness)
Owns: `apps/web/src/render/{lines,troops,troop-material,fx}.ts` (lane/brawl/troop parts), new `render/{lane-material,brawl}.ts`, `apps/web/src/input/index.ts` (lane hit-testing/preview/hover only), manifest `troop.*` visuals + `apps/web/assets/models/troop-*.glb`, `docs/CREDITS.md` rows, `tools/assets/import-art.mjs` (character step), unit/e2e specs listed in Req 12, `apps/web/src/test-harness/**` lane/troop/clash handles feeding the SP01 probe (probe fields only), `<BF>/04-lanes-troops-clash/iteration-log.md`.
Does not own: sim/GAME_RULES (read-only), towers/labels/`overlays.ts`/ground/camera (SP03; SP04 never edits `overlays.ts`), HUD (SP05), harness scripts/thresholds (SP01).

## TL;DR
- Replace per-direction offset dashed ribbons with one ribbon **per tower pair**: flat, translucent team tint, darker edges, white chevrons scrolling in travel direction, ~1/3 tower width, one draw call per lane.
- Hostile A->B + B->A = ONE lane, two colours split at the live meeting point, computed renderer-side from the channels' front-troop progress (no sim change, hash untouched), spring-smoothed; brawl cluster + puffs + marker pooled at the split.
- Troops: keep the Kenney Mini Characters chibi (already in repo, 288 tris), bigger, fully team-tinted, procedural gait; instanced capsule+head LOD swaps in seamlessly above a count or frame-time threshold.
- L18 realistic peak is ~60-120 troops in flight [verified: computed below]; LOD is insurance, not the common path.

## Problem
Lines are thin offset dashes, a head-on fight is two parallel lines (nothing shows where armies meet), and troops are ~invisible [verified: v1_playtest_1/2.png, lines.ts offsets `width*.6` left per direction, troop scale 2.8 vs 40-degree camera]. Tower War's core readability is "wide lane, arrows, little men marching, brawl in the middle" [towerwar_01/06, citytakeover_01].

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| V10-V17 >= 8, plus V13/V22 lane+troop parts | Any sim/rule/balance change; new SFX |
| Lane width 0.25-0.40 x tower width; troops >= 1.5% viewport height | Per-troop skinned meshes / skeletal animation |
| Split tracks the real fight; resolves cleanly on cut/empty | Unit-vs-unit collision or pathing |
| Stay inside SP01 perf gates at L18 (drawCalls <= 100, jsMs p95 <= 8) | New troop types (only `troop.regular` exists) |

## Requirements
1. **Lane model.** `lines.ts` keeps one lane object per unordered tower pair `{a,b,chanAB,chanBA,state}` built from `view.lines` + channels that still carry troops. Mesh = one quad, `ShaderMaterial` (transparent, `depthWrite:false`, `polygonOffset(-2,-2)`, y = ground + 0.04, `renderOrder = 1 + drawSeq%100` so newer lanes sit over older; plain alpha blending so crossings just overlap). Runs centre-to-centre; towers occlude via depth. Tagged `userData.visualRole='lane'`, `userData.pair='a-b'` (SP01 probe contract).
2. **Look (shader).** Width `W = 0.33 x mean(endpoint tower visual width)` (SP03 contract: `towers.visualWidth(id)` / `userData.visualWidth`, world u; fallback `2 x footprintRadius` only if null; standard tower = 6 u, lane = 2 u). Fill = team colour @ ~0.55 alpha; edge band (outer 12%) 25% darker/opaque; white chevron SDF, pitch ~= 1.1 W, scroll ~2.5 u/s (frozen under reduced motion; static chevrons still visible); chevrons faded within tower footprint radius of each end. Uniforms: `laneLen, colA, colB, split, buildT, fade, hoverA/hoverB, drainA/drainB, time`.
3. **Build-out / cut.** On `LineDrawn`: `buildT` 0->1 from source over 0.35 s (ease-out; instant under reduced motion). On `LineCut`: 80 ms white flash, then retract toward the source over 0.3 s + 4 pooled puffs at midpoint. A cut channel that still carries troops (R-LIN-05, R-CMB-01) keeps a faded "draining" half (alpha 0.4, no chevrons) until empty, so troops never walk on bare grass.
4. **Shared lane.** If both channels of a pair are drawn/draining, render one lane, A half chevrons A->B, B half B->A. Split target `s` (fraction from A):
   `s = (fa + fb) / 2`, `fa = progA_front / L` (0 if A empty), `fb = 1 - progB_front / L` (1 if B empty), `L` = line length. At the sim's clash condition (`progA+progB >= L`, GAME_RULES R-CMB-01/E-CLASH) `s = progA/L`, exactly the Clash event point [verified: combat.ts clash(), fx.ts Clash locator `progA/length`]. Front = max progress in a channel (FIFO). If one channel is undrawn and empty: force target to the other end, slide, then collapse to a single-direction lane. Same-owner reverse lines never coexist (replaced) [verified: economy.ts validateLine + commands.ts `replaced`]; no level defines teams, so allied head-on is out of scope (render as shared lane, no brawl).
5. **Smoothing.** Per-pair critically damped spring (omega ~ 14/s) on `s`; new pair starts at target (no slide-in); snaps allowed on `settle()` (SP01 harness `render({settle:true})`, the default, calls it so fixed-tick captures are deterministic; `buildout` and the clash +6/strip frames call `render({settle:false})` with `reducedMotion:false` and a fixed per-tick dt, so `settle()` must never be called implicitly by `update()`). Reason: front changes after each clash jump `s` by several units.
6. **Data path (no sim change).** `troops.ts` already iterates `readTroops` each frame; it additionally fills `frontProgress[n*n]` / `channelCount[n*n]` (typed arrays, reused) exposed read-only; `lines.update(dt, troopsView)` consumes them. Render order in runtime: troops.update -> lines.update -> fx. Nothing writes to sim state or hash.
7. **Brawl FX** (`brawl.ts`, pooled, zero allocation at runtime): per shared pair while both fronts exist or a Clash occurred <= 1.2 s ago: (a) 2-6 fighter figures from the troop LOD mesh, team-tinted, jostling (sin offsets, face each other) at `s`; (b) puff sprites (instanced billboards, procedural soft-cloud texture, pool 6 brawls x 12); a 6-puff burst per `Clash` event; (c) small crossed-swords marker sprite (canvas-generated, no asset) hovering 1 u above the lane. Intensity = EMA(clash events/s, tau 2 s)/1.0 -> fighter count, ambient puff rate (2-10/s), marker scale 0.8-1.2. Existing `Clash` locator/`spark` effect in fx.ts is kept for the event burst but recoloured white/cream.
8. **Troops.** Primary: Kenney Mini Characters 1.0 `character-male-a` (already imported, 288 tris after simplify, rig stripped) [verified: CREDITS.md row, tools/assets/import-art.mjs]. Changes: whole figure team-tinted (head 20% lighter, per towerwar refs fully blue/red figures) via mask-all variant in `troop-material.ts`; height target 0.29 x tower width (world ~1.8 u at standard) tuned by manifest `scale`; walk = existing bob/sway plus procedural gait (lower-half vertices shear +/- by `sin(phase)`, sign by x) in the vertex patch; single file on lane centre (already pure centre-line in troops.ts). Fallback candidates if V13 < 8 after the stuck rule: Kenney Blocky Characters (rigged, strip like above), Quaternius Ultimate Animated Characters, or any other freely downloadable/code-built model that gets closer to the refs (licensing not a constraint). A CREDITS.md source row is added for every shipped model (traceability only); `pnpm check:manifest` must pass.
9. **LOD.** `createTroopRenderer({lod:'auto'|'high'|'low'})`. Low = instanced capsule + sphere head, ~80 tris, same `troopPose` attribute, same patched material and same height/footprint (+/-5%) so only silhouette detail changes. Auto: ->low when live > 600 OR frame-time EMA > 20 ms for 1 s; ->high when live < 400 AND EMA < 14 ms for 3 s. The thresholds are exported named constants (`LOD_LOW_COUNT=600`, `LOD_HIGH_COUNT=400`, `LOD_LOW_EMA_MS=20`, `LOD_HIGH_EMA_MS=14`) plus an optional manifest/quality-tier override, so SP05's perf ladder can lower them without editing logic. Swap = set `count` of the other mesh set (pose data for both sets written, cheap at <= 600; above that only low) in one frame; no allocation; hysteresis prevents flapping. `?lod=` URL param feeds the harness.
10. **Input.** Remove the `.24` left-offset fallback and per-direction segments; `projectSegments` returns centre lines per channel (shared lane returns both channels on one segment; only the human's channel is selectable). Hit radius = `max(12, halfLanePx + 4)` for right-click/hover and `max(8, halfLanePx)` for swipe. Hover = `hover*` uniform (edge glow white, chevron speed x1.6) on the human's half only. Draw preview mesh uses lane width and a ghost chevron ribbon in team colour (red when `canDraw` rejects). Swipe trail unchanged.
11. **Remove v1 paths.** Offset-left geometry, dashed `arrow` fragment shader, per-owner `materials` map + `highlightMaterial` cloning, `fx` sparks as the only clash visual, `.24` fallback in input. `overlays.ts` / label cards / slot glyphs are SP03's (R8); SP04 does not edit them and lanes read no label/slot-glyph overlay.
12. **Tests to update (deliberately, not deleted).** `test/lines-fx.test.ts` (offset/segments/highlight-uniform assertions -> pair lanes, `hover*`, split), `test/troops.test.ts` (`meshes` length now includes LOD set; uniform names `troopTeam` kept), `test/input.test.ts` (segment geometry), `e2e/lines-fx.spec.ts` (expects blue>100 and red>100 pixels from "opposite ribbons": now one lane with two colours -> keep assertions, add `lanes.length===1`; clash position `[5,.15,0]` unchanged), `e2e/troops.spec.ts` (`calls===14`, `jsMs.p95<4`, `fronts` pose layout, 2000-troop count: run with `lod:'high'` for the shader/pose asserts, add a `lod:'low'` pass), `e2e/input.spec.ts` (`center()` via centre-line segments). `acceptance.spec.ts` snapshots are SP05's: an SP04-broken snapshot test (clash, capture, glb-fixture) is marked `test.fixme(true, 'SP05 baseline refresh: <reason>')` (exact prefix; never removed, snapshot files untouched); SP05 restores it.

## Architecture
```
sim.readTroops -> troops.update: poses + frontProgress/channelCount
LineDrawn/LineCut/Clash events -> lines.consumeEvents  (pair state, build/retract timers)
lines.update(dt): per pair spring(s) -> uniforms; exposes lanes[]{from,to,pair,widthWorld,splitWorld,screen*}
brawl.update(dt, lanes, clashEvents): pooled fighters/puffs/marker
lod: troops owns {high set, low set}; auto policy in update()
```
Probe fields SP04 keeps non-null: `lanes[].{widthWorld,screenWidthPx,splitScreen,mid}` (`splitScreen` only for shared lanes), `troops.{count,screenHeightPx,sampleRects}`, `clash.fxScreen`.
L18 sizing: peak in flight ~= sum(rate 13.4/s) x path length / speed 10 u/s = ~58 (mean tower distance) to ~118 (every line at max distance 88 u) [verified: archetype rates 0.6/1/1.5, troop speed 10, L18 14 towers, bounds 120x80]. Budget 300 troops: high 86k tris, low 24k tris.

## Iteration protocol
Visual loop, per task with a visual outcome:
1. Capture: `pnpm --filter @node-arena/web visual:capture [--scene <id>]` (SP01) - deterministic (fixed seed, paused at fixed tick, 1920x1080 and 1366x768), PNGs + metrics.json to `apps/web/visual-out/`.
2. Compose: `pnpm --filter @node-arena/web visual:compose` -> `visual-out/compare-<scene>.png` (current | matched refs from `<BF>/ref/`).
3. Score: view each composite; score every task-relevant item 0-10 vs the reference; read metrics.json against thresholds.
4. Log: append a row to `<BF>/04-lanes-troops-clash/iteration-log.md`: iter #, date, commit, scores, metrics, top 3 gaps, planned change.
5. Change only the top 1-3 gaps, smallest change; run unit/e2e for touched area.
6. Commit each improving iteration: `04-lanes-troops-clash: Task N - iter k: <change>`; revert any iteration that lowers a score.
7. Exit: all task-relevant items >= 8 AND metrics pass AND tests green. Stuck rule: 3 consecutive non-improving iterations -> log hypotheses, switch approach (different asset/param/technique, e.g. next character pack). Cap 12 per task -> mark `Blocked-visual`, continue.
8. Never edit refs, lower thresholds, or delete tests. Screenshot baselines untouched (SP05); snapshot tests broken by this SP get the `SP05 baseline refresh` `test.fixme` marker (Req 12).

SP04 specifics:
- **Scene order:** `clash` fixture + `buildout` strip + `l01` first (lane look, build-out, troop size on the slice); then `l10` (crossing lanes, cut feedback); then `l18` (density, perf). Non-blocking: finish L1 before L18 tuning.
- **Checklist items (owner 04):** V10 ribbon, V11 chevrons, V12 build-out, V13 troops, V14 shared lane + split, V15 brawl FX, V16 crossings, V17 cut feedback; contributes to V22 (no offset dashes) and V24 (L18 readability).
- **Metrics:** M05 lane/tower width 0.25-0.40; M06 troop height >= 1.5% viewport and 0.22-0.60 x tower width; M12 exactly 1 lane for the pair, crossing lane separate, split-vs-Clash error <= 12 px; M13 L18 `drawCalls<=100`, `jsMs p95<=8`, fps >= 55 only with `--gpu`. SP04 adds informational numbers to its log: fighters/puffs active, LOD state, troop count.
- **Refs:** lanes/chevrons/brawl: `citytakeover_01.jpg`, `towerwar_06.jpg`; lanes/troops: `towerwar_yt1.jpg`, `towerwar_01.jpg`.
- **Per-iteration extra checks:** capture the clash scene at `settle()` and 6 ticks later (split moved, no popping: <= 1.5 u/frame in a 10-frame strip); force `?lod=low` and `?lod=high` on `l01` and confirm composites differ only in figure detail (same height/placement).
- **Fixture caveat:** SP01 captures `clash` at first Clash + 20 ticks (plus a +6 PNG and a `splitTrace` T..T+9 in `metrics.json`, which the continuity check above reads instead of ad hoc captures). The fixture is symmetric so successive clashes recur at one point; verify in iter 1, otherwise SP04 may edit that scene's tick offset in `scenes.json` (not thresholds; SP01 permits this with a logged reason) and log why.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Lane granularity | One mesh per tower pair, shader chevrons | Instanced chevron quads; per-channel ribbons | One draw call, no z-fight between halves, split is a uniform |
| 2 | Split source | Renderer-side from `readTroops` fronts | New sim read helper; Clash events only | No sim/hash touch; continuous between clashes; equals event point at clash |
| 3 | Smoothing | Critically damped spring + `settle()` | Lerp; none | Fronts jump per clash; deterministic captures |
| 4 | Troop model | Kenney Mini Characters, re-tinted whole-figure | New pack; skinned animation | Already imported, 288 tris, instancing-friendly |
| 5 | Walk | Procedural shear gait in shader | Baked vertex anim textures | Zero data, one instanced mesh |
| 6 | LOD | Capsule+head, same pose buffer, hysteresis | Distance LOD; drop troops | Seamless swap, trivially cheap |
| 7 | Brawl | Cosmetic fighters + puffs, not tied to specific sim troops | Mirror real front troops | Sim removes fronts instantly; cosmetic persists readable |
| 8 | Draining lane for cut channels with troops | Faded half until empty | Hide lane | Troops must not float off-lane |
| 9 | Lane width | 0.33 x mean endpoint tower width | Fixed world width | Holds M05 on small/large towers |

## Risks / Open Questions
- [RESOLVED: stuck-rule fallback list in Req 8] Mini Characters may read too plain at 1.8 u; fall back to Blocky/Quaternius.
- [RESOLVED: SP03 PRD landed and matches] SP03 R2 fixes ground at y=0 with no interior decals, R7 exposes `towers.visualWidth(id)`/`userData.visualWidth`, R8/Owns give SP03 `overlays.ts`; footprint fallback kept only for null.
- [RESOLVED: centre-line, no lateral offset] Opposing troops share the centre line; they annihilate pairwise at the split so no passing occurs.
- [RESOLVED: Req 9] 2,000-troop e2e is a stress test, not a game case (L18 <= ~120).
- [RESOLVED: cosmetic] Per-troop value > 1 does not exist in v1 content; brawl intensity uses clash rate only.
- [DEFERRED] Allied (same-team) head-on visuals; no level uses teams.
- [RESOLVED: no user decision required]

## Acceptance Criteria
- Clash scene: probe shows exactly 1 lane for the A-B pair, `splitScreen` within 12 px of the Clash event point, crossing C-D lane separate; fighters, puffs and marker visible in the composite.
- Cutting one side of a head-on slides the split to that end and collapses to a single-direction lane within 1.5 s; sim state hash identical with and without the renderer (golden replays untouched).
- `buildout` strip shows the ribbon growing from the source over 3 frames; cut shows flash + retract.
- M05, M06, M12 pass; V10-V17 >= 8 in `iteration-log.md`; L18 `drawCalls<=100`, `jsMs p95<=8`.
- `?lod=low` and `?lod=high` render matching heights/positions; auto LOD flips at the stated thresholds without flicker (unit-tested with a fake clock).
- No dashed/offset-lane code remains (`rg "highlightMaterial|\.24|ribbonUV"` clean); `pnpm check:manifest`, `test`, `typecheck`, `lint`, and the updated specs in Req 12 are green; CREDITS.md lists the source of every shipped troop model.
