---
status: draft
summary: SP04 tasks - geometry primitive, corridor blocking, swept crossing combat, shooting tower, content footprints, goldens/bench, un-park check:rules
date: 2026-10-22
---
# Tasks: Geometry + shooters (SP04)
Source of truth: [PRD](PRD.md). Implements CMB-04, TWR-01..04, OBS-01..02 on 03's seams; one pure lane-interval primitive shared by blocking and tower range. No [OPEN] items; all [RESOLVED] binding. Cross-SP deps: 03 (seams, `exchange`, `killTroop`, event payloads), 02 (footprint/`shoots` schema), 01 (rule text), 05#0 (`colliders.json`).

| # | Task | Depends on | Status |
|---|---|---|---|
| 0 | Seam check + content footprint values | 03, 02, 05#0 | in-progress |
| 1 | Geometry primitive | 0 | in-progress |
| 2 | Corridor blocking + `explainDraw` (OBS) | 1, 0 | todo |
| 3 | Crossing windows + swept combat (CMB-04) | 1 | todo |
| 4 | Shooting tower (TWR) | 1, 0 | todo |
| 5 | Goldens, bench, restore/parity tests | 2, 3, 4 | todo |
| 6 | Un-park `check:rules`, final acceptance | 5 | todo |

## Task 0 — Seam check + content footprint values
What it is / what it means: Confirm 03's exports and 02's schema match what 04 imports, then author footprint values (Decisions 10, R6).
What changes at a high level: Verify `exchange()`, `killTroop`, `Clash/TroopDied/TowerShot` payloads, `shoots.cooldown`, `onLineDrawn/onLineCut`, `blocksLines/shoots` module hooks exist. Read 05#0 `colliders.json`; write building box 1500x1500 and per-child obstacle box+yaw footprints into content in one commit with content version bump; `laneHalfWidth` 190, `contactDistance` 700, flags `troopPad` 350 / `neutralFires` true / `hitsNeutralHouses` true as defaults. Fallback if dump unusable within a day: obstacle circle 450 plus calibration, logged as deviation in LEVELS_GUIDE.
Done when: content validates, version/hash bumped once, any seam mismatch recorded as a 03 request (not reimplemented here), fallback decision recorded if used.

## Task 1 — Geometry primitive
What it is / what it means: `geometry.ts`, the single pure integer primitive (R1, Decisions 7, 11).
What changes at a high level: `laneIntervals(lane, shape, pad)` for circle/AABB/yawed box returning sorted disjoint arc-length milli intervals; `perpSq`/`proj`; SAT helpers. BigInt only for create-time/cold work; per-tick helpers in Numbers with a debug assert on intermediates < 2^53; no `Math.sqrt/round`. BigInt oracle lives in tests only. `CrossingSource` seam is not built (note for FUTURES via 09).
Done when: unit tests agree with BigInt oracle on fuzzed lanes/shapes; determinism lint preset passes.

## Task 2 — Corridor blocking + `explainDraw` (OBS-01/02)
What it is / what it means: Static line validity (R2, Decisions 1-3), the exact BoxCast match.
What changes at a high level: At `create`, precompute `blocked[pair]` (none / blocked-obstacle / blocked-building) via corridor OBB (half-width 190, extended 190 at ends) vs obstacle footprints (never exempt, even at endpoints) and all buildings except the two endpoints (third tower/house blocks); touching not overlap; nearest-to-source blocker wins. `validateDraw` slots in after `no-slot`; `canDraw` stays `code|null`; new `sim.explainDraw` returns `{reason, point, ref}` at first blocking interval start. Obstacles stay unowned, inert.
Done when: tests tagged `covers R-OBS-01/02`: 500-case fuzz vs independent float OBB reference (tests only), tangent unblocked, endpoint building exempt, endpoint obstacle blocks, `explainDraw` point inside blocker, `canDraw` null iff DrawLine accepts.

## Task 3 — Crossing windows + swept combat (CMB-04)
What it is / what it means: Generalise crossing to interaction windows so near-parallel lanes within 0.7 also fight (R3, Decisions 4-6).
What changes at a high level: `crossings.ts` precomputes per ordered lane pair the quadratic distance form (Q20 cosine) and bounding window, dropping pairs beyond contact; active list maintained in `onLineDrawn/onLineCut` and rebuilt from `drawn` on restore (derived, unhashed). Fill body of `contacts.ts#crossingPass` (after head-on): hostile pairs in `(channelKeyA, channelKeyB)` order, FIFO-range prefilter, candidates in `(seqA, seqB)`, exact swept-in-tick test in Numbers, contact calls 03's `exchange()`. Dead skipped, survivors continue; same-owner never fights; shared endpoints are ordinary crossings. Emit `Clash`/`TroopDied` per 03's payloads only.
Done when: scenarios pass (X-cross, tank vs soldier 2->1, fast tank no tunnelling, near-parallel 0.5, same-owner, three-lane ordering, cut/capture mid-fight) and a brute-force per-tick oracle matches on 50 seeds; tagged `covers R-CMB-04`.

## Task 4 — Shooting tower (TWR-01..04)
What it is / what it means: `modules/shoots.ts` phase 7 with lane-space targeting (R4, Decisions 7-10).
What changes at a high level: Radius by stage (10/30), delay by level (33,870 mt at L=1), `minRadius`; per (tower, lane, stage) annulus interval cache (outer radius + `troopPad`, minus minRadius disc), rebuilt on stage change/restore. Towers in building order; `shoots.cooldown` starts at `delayMt(L0)`, decrements 1000/tick floor 0, survives capture. Ready and (`neutralFires` or non-neutral owner): nearest hostile troop by exact lane-space d² (ties owner idx, then seq) -> `killTroop(...,'tower')` any hp; else nearest hostile house with level>=1 (neutral included per `hitsNeutralHouses`, towers never targeted) -> level-1 floor 0, no capture, no auto-cut. Emit `TowerShot`; export `sim.towerRadiusMilli(view,i)`. Instant kill, bullet flight render-only.
Done when: tests tagged `covers R-TWR-01..04` cover delay at L=1/10/30/64, radius changes, minRadius, nearest+tie, tank dies, mid-lane kill keeps FIFO/alive/conservation, house floor, cooldown across capture, ready-without-target, all three flags both settings.

## Task 5 — Goldens, bench, restore/parity tests
What it is / what it means: Lock behaviour deterministically and prove derived caches are rebuildable (Risks, Acceptance).
What changes at a high level: Add `test/golden/scenarios-geometry.ts` to 03's scenario list (default neutral tower shoots non-neutral troops; default tower shoots neutral house; crossing and obstacle scenarios) and regenerate `sim:golden`. Snapshot-mid-fight restore equals straight-run hash; events on/off hash parity; payloads match 03 types exactly. Wire bench scenario (720 troops, 40 hostile crossings, 3 towers) into `bench:sim`.
Done when: goldens replay-verify, parity/restore tests pass, bench within budgets, no floats or `Math.sqrt/round` in `packages/sim/src`.

## Task 6 — Un-park `check:rules`, final acceptance
What it is / what it means: SP04's last task per 09's red-window table.
What changes at a high level: Delete the `check:rules` PARKED entry from `scripts/ci.sh` (one-line edit, owner SP04); confirm every active rule R-CMB-04, R-TWR-01..04, R-OBS-01..02 has a non-skipped `covers` test; walk the PRD Acceptance list; hand 05/06/07/08 the footprint contract, `explainDraw`, `canDraw` incl. third tower, `towerRadiusMilli`, and render fields.
Done when: `check:rules` green in `pnpm run ci` with the entry removed; acceptance list ticked; amendments to 01/02/03 (if any surfaced) filed as requests.

## Owner steps
None. Optional owner check on `troopPad` (350) if level difficulty looks off in 06's proxy validation.
