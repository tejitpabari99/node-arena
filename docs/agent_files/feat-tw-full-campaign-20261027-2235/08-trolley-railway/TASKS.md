---
status: draft
summary: 13 tasks — decode spike, rules text, defs/content, building removal + position state, trolley + cart, rails + RailMove, bots, importer, web, editor, curated selection and import of >=10 trolley + >=10 railway levels, perf/ci gate and CrossingSource closure
date: 2026-10-27
---
# Tasks: 08 Trolley + railway
Source of truth: [PRD](PRD.md). Adds the trolley (ready-gated one-shot cart on the troop ring that kills troops and deletes its target building), railways (discrete hops via new `RailMove`, lines cut at move start), AI rail behaviour (AiRM script step, `TryMoveTowerOnRailway`), and a provisional >=10 trolley + >=10 railway level selection. Mechanics order: rule text + changelog + version bump, then tests, then code. Tasks 1, 8, 9, 11, 12 need the rebuilt TW extract (`TW_EXTRACT`); Task 11 also needs SP01's `pnpm census`. Phase D PR = 08 + 09 (08 lands first; 09 rebases onto it and owns the phase `validate:levels --all`). Version numbers are indicative (RULES 3.7.0, BOT next minor at merge time). 08 closes the FUTURES `CrossingSource` entry as "not built". Sibling SPs are referenced only; 06 owns the command parse table, 07 the preceding phase-row amendments.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Decode spike: Q1–Q9 (capture, drag, targets, mine/wall, AI targeting, cart hp, win rule, attack geometry, rail offsets) | none | todo |
| 2 | Rules text: R-TRL / R-RAIL, RailMove, phase amendments, RULES_VERSION | 1 | todo |
| 3 | Defs, events, building/element JSON, schema, content version | 2 | todo |
| 4 | Building removal + hashed position state | 3 | todo |
| 5 | Trolley module + cart pseudo-troop on the ring | 4 | todo |
| 6 | Rails: RailMove command, move start/end, pair rebuild | 4 | todo |
| 7 | Bots: trolley source, railMove step, TryMoveTowerOnRailway, BOT_VERSION | 5, 6 | todo |
| 8 | Importer: trolley / railway rows, AiRM, railways field | 3 | todo |
| 9 | Web: trolley, cart, rails, drag-to-snap, fx, assets | 5, 6 | todo |
| 10 | Editor: trolley and rail placement | 9 | todo |
| 11 | Curated selection from pool tool | 8 | todo |
| 12 | Import selected levels, solvability, locks | 5, 6, 7, 8, 11 | todo |
| 13 | Perf, e2e, campaign:verify sample, calibration, FUTURES closure, CI | 9, 10, 12 | todo |

## Task 1 — Decode spike: Q1–Q9
What it is / what it means: PRD Risks Q1–Q9 (all RESOLVED as "spike first, else fallback"). Undecoded: loaded-trolley capture (Q1), human rail drag/cut (Q2), trolley line target set (Q3), mine/wall vs cart (Q4), AI trolley targeting (Q5), cart hp (Q6), `ignoreForWin` loss rule (Q7), `TryFindAttackPositionForTower` geometry (Q8), rail path-point `P` offset convention (Q9).
What changes at a high level: Time-boxed (~1 h each) decomp via `/root/projects/tower-war/_tools/decomp.sh` of the classes named in each Q. No product code.
Done when: findings recorded per Q. Each inconclusive item records its fallback as a deviation in GAME_RULES and the deviations ledger: house-like capture; cut lines at move start, non-continuous movement; piles plus own/neutral buildings, not other trolleys; mines -1 hp, walls ignored; weakest-first; hp = level at draw; trolley ignored for win/loss; integer attack radius + `canDraw`; world-space points with the `P` offset fixed on the first imported rail level. Needs `TW_EXTRACT`.

## Task 2 — Rules text: R-TRL / R-RAIL, RailMove, phase amendments, RULES_VERSION
What it is / what it means: PRD R1, R3, Decisions 1–7. Rules authority comes first.
What changes at a high level: `docs/GAME_RULES.md` gains areas TRL (loading, ready slot, cart contact, arrival removal, removed buildings) and RAIL (state, `RailMove` validation order, moving building, move end, point exclusivity, `moveTicks`). Command section 4.1 gains `RailMove`; phase rows 1 and 8 amended (move end before commands, cart arrival before capture, 7b skip while moving) on top of 06/07's rows. Spike results and deviations written in; changelog; `RULES_VERSION` bumped to the next minor (indicative 3.7.0; rebase onto 3.6.0).
Done when: `pnpm check:rules` accepts the new IDs as untested stubs per repo convention; changelog and version present.

## Task 3 — Defs, events, building/element JSON, schema, content version
What it is / what it means: PRD R2, R3 (events, command def).
What changes at a high level: `trolley` and `rides` module defs, `RailMove` in the command defs (using 06's per-command parse table), events (`TrolleyReady`, `TrolleyLaunched`, `TrolleyExploded`, `BuildingRemoved`, `RailMoveStarted`, `RailMoveEnded`), `buildings/trolley.json`, `elements/railway.json`, and the level-schema `railways` field (id-keyed, 2–5 points). Content version/hash bump and `content:lock`.
Done when: schemas regenerated; `check:schemas`, `validate:content`, typecheck green; shipped level hashes unchanged.

## Task 4 — Building removal + hashed position state
What it is / what it means: PRD Architecture (removal, position mutation), Decision 6. Today buildings are permanent and positions constant.
What changes at a high level: new columns (`removed`, `posX/posZ`, `ready`, `railState`, `railEndTick`) hashed and snapshotted with a schema version bump, sections omitted when a level has none; shared `killLinesOf(b)` helper; `removed` exposed on `SimView`; targets, `canDraw` (`removed` reject) and win participation skip removed buildings; a player with none left loses; `ignoreForWin` per Q7 result. Indices stay dense.
Done when: tests `covers R-TRL-05`: removal cuts lines and kills troops, reject reason, win/loss; snapshot/hash round-trip; shipped-20 replays bit-identical.

## Task 5 — Trolley module + cart pseudo-troop on the ring
What it is / what it means: PRD R-TRL-01..04, Decisions 1, 2. The cart reuses `DrawLine` and the troop ring.
What changes at a high level: `trolley` module: fill by own arrivals, `ready` on overflow past `maxLevel`, one slot only when ready, house-like or spiked enemy-arrival rule; `DrawLine` from ready clears it and places a `cart` (50 mt/tick, hp per Q6) on a non-cuttable line; `ring.kind` gains `cart`; `exchange()` short-circuits for carts; contact kills any troop of either owner; mine/wall helper per Q4; `hits:'trolley'` projectiles from SP04 handled; phase 8 dispatches arrival to explode and remove the target (piles per PRD).
Done when: tests `covers R-TRL-01..04`: fill -> ready -> draw -> mixed-owner kills -> removal; mine damage; no-cut; ready-at-start; level-0 and pile edge cases; replay hash determinism.

## Task 6 — Rails: RailMove command, move start/end, pair rebuild
What it is / what it means: PRD R-RAIL-01..06, Decisions 3, 4. The only engine change `rides` makes is mutable building position.
What changes at a high level: `rails.ts` plus `rides` module: `RailMove` parse and the nine-step validation order; accept cuts all incident lines (cause `rail`), kills their troops, sets Moving until `tick + moveTicks` (default 10); move end in phase 1 before commands sets position, state Active, and calls `rebuildPairsFor(b)` (create-time SAT/pair/annulus functions restricted to incident pairs, ascending index order); no draw to/from, no tower fire while Moving; `canMoveRail(...)` exported for the UI.
Done when: tests `covers R-RAIL-01..06`: every reject reason, lock while neutral, point exclusivity, move then draw uses new blocking (golden), replay/snapshot round-trip; existing replays bit-identical.

## Task 7 — Bots: trolley source, railMove step, TryMoveTowerOnRailway, BOT_VERSION
What it is / what it means: PRD R4. The proxy shares the TW AI.
What changes at a high level: trolley is a `freeSources` entry (slots 0 until ready) with the Q5 targeting result; `defense` excludes it; `removed` filtered in bot views; new `railMove` script step (`AiRM`: skipped if locked or not owned, completes after the 68-tick pause); `TryMoveTowerOnRailway` for BT 0 only, after Attack and before Defense, using the Q8 geometry. `BOT_VERSION` next minor; bot goldens refreshed.
Done when: bot tests for trolley launch, rail step skip/complete, repositioning choice; shipped-20 `bots:golden` unchanged (asserted); version bumped.

## Task 8 — Importer: trolley / railway rows, AiRM, railways field
What it is / what it means: PRD R6. Trolley and Railway are `archetype: null`; `AiRM` is dropped, blocking positions 267 and 330 onward. Needs `TW_EXTRACT`.
What changes at a high level: `feature-map.json` rows flipped (`trolley` -> archetype, `Railway` -> element, `AiRM` -> mapped); `script.ts` emits `railMove` nodes in queue order; `map-level.ts` emits `railways` using the Q9 offset convention. No levels imported yet.
Done when: `check:import` green; shipped 1–20 hashes unchanged (except 23 per SP02).

## Task 9 — Web: trolley, cart, rails, drag-to-snap, fx, assets
What it is / what it means: PRD R5. Needs `TW_EXTRACT` for models; placeholders and a recorded note if missing.
What changes at a high level: trolley model with ready glow; cart mesh interpolated from `(launch, arrival)`; explosion fx reusing SP04's blast renderer; rail polyline, station posts, and moving-building animation over `moveTicks`; drag a rail building along the track, release snaps to the nearest point and sends `RailMove` (Q2 result decides cut feedback); reject text in `reasons.ts`; `assets-tw` rows, manifest ids and credits for `Trolley`, `Game/Railway/*`, `WayTrolley`.
Done when: `assets:tw:check` and `check:manifest` green; drag-snap and trolley-launch e2e (desktop and touch) pass in `test:web:e2e`; screenshots vs refs.

## Task 10 — Editor: trolley and rail placement
What it is / what it means: PRD R5 (editor).
What changes at a high level: palette entry for the trolley (`maxLevel`, `startLevel`); rail tool placing 2–5 points and attaching a building with a start point; export `railways`; validation mirrors the importer (point count, unique points, attached building exists).
Done when: editor places both and exports valid level JSON that passes content validation; editor tests green.

## Task 11 — Curated selection from pool tool
What it is / what it means: README Curation + PRD R6; resolution 4 (SP01 owns census). Needs `TW_EXTRACT` and `pnpm census`.
What changes at a high level: from census output select >=10 trolley and, separately, >=10 railway levels from Common 24–340 (first trolley candidate 267, first rail 330). Each element's first level introduces it with no other new element; spread across later positions; prefer proxy-solvable, allowlist only when no equal-feature alternative; prefab-only ids swapped if `parse-prefab` fails. Selection list kept in the SP08 docs folder.
Done when: provisional selection recorded with source positions, features and metrics; both coverage lines (`trolley: n levels, first at display N`; `railway: n levels, first at display N`) drafted. If the pool yields fewer than 10 of either, record the shortfall for SP09 rather than padding.

## Task 12 — Import selected levels, solvability, locks
What it is / what it means: PRD Acceptance. Selection is provisional; only SP09 sets final order and numbers. Needs `TW_EXTRACT`.
What changes at a high level: import only the selected levels with provisional display ids after earlier SPs' levels; run `validate:levels` on them; proxy-unsolvable go to `tools/unsolved-by-proxy.json` (reason, `ownerSignOff: null`; proxy failure is logged, not tuned); refresh only own entries via `levels:lock --levels`, content lock, CREDITS rows.
Done when: >=10 trolley and >=10 railway levels imported, coverage lines printed; shipped 1–20 unchanged except 23; `validate:content --base HEAD`, `check:content`, `check:import` green.

## Task 13 — Perf, e2e, campaign:verify sample, calibration, FUTURES closure, CI
What it is / what it means: PRD Acceptance, resolution 6, 7. Phase D's `validate:levels --all` is run by SP09.
What changes at a high level: `bench:sim` on a trolley-heavy and a rail level within budget (move-end rebuild stays cold); add the trolley and railway introduction levels to the `campaign:verify` sample set; calibrate against TW playthrough refs and record deviations if fallbacks hold; refresh golden/replay refs only if calibration moves outcomes; mark the FUTURES `CrossingSource` entry closed ("not built"); full `pnpm run ci`.
Done when: bench within budget; sample verify passes; `sim:golden`, `replay:verify golden`, `bots:golden` green; FUTURES entry removed or closed; `pnpm run ci` green.

## Owner manual steps
- Provide rebuilt `TW_EXTRACT` for Tasks 1, 8, 9, 11, 12.
- Play-feel check of drag-to-snap UX and `moveTicks`.
- Spot-check rows added to `tools/unsolved-by-proxy.json` here (`ownerSignOff` stays null until then).
- Compare trolley and rail behaviour against TW playthrough refs (calibration approval).
- Approve the Phase D PR (with 09).
