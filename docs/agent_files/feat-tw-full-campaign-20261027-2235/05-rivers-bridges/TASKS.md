---
status: draft
summary: 13 tasks — decode spike (S1–S5), rules text, defs/content, importer + collider dump, bridge state + planks columns, bridgeable module + turn-around, conditional bot check, web render, editor, curated selection and import of >=10 river + >=10 ROBS levels, perf/ci gate, Phase B full validate
date: 2026-10-27
---
# Tasks: 05 Rivers + bridges + river obstacles
Source of truth: [PRD](PRD.md). Adds non-blocking rivers whose crossing lines build plank bridges (one plank per troop, ordered ceils, plankless troops turn around via SP03's return channel) plus river obstacles (ROBS), with one hashed per-channel `bridgeMask` beside SP02's element facility. Mechanics order: rule text + changelog + version bump, then tests, then code. Tasks 1, 4, 8, 10 need the rebuilt TW extract (`TW_EXTRACT`); Task 10 also needs SP01's `pnpm census`. Depends on SP02 (element facility), SP03 (return channel, `carry` column) and SP01 merged or stacked below; Phase B PR = SP04 + SP05 (04 merges first, so `RULES_VERSION` is the next minor at merge time, indicative 3.4.0). Bots unchanged unless the spike flips ROBS to blocking. Siblings referenced only.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Decode spike: planks, collider shapes, bridge lifetime, ROBS layer, AI river reads | none | todo |
| 2 | Rules text: R-RIV-01..05, phase 6 row, RULES_VERSION | 1, SP02 T2, SP03 T2 | todo |
| 3 | Defs, events, river/ROBS JSON, schema, content version | 2 | todo |
| 4 | Importer rows, emitters, river/ROBS collider dump | 1, 3 | todo |
| 5 | Bridge state: crossing geometry, bridgeMask + planks columns, hash/snapshot | 3, SP02 T4, SP03 T4 | todo |
| 6 | Bridgeable module, bridge pass, turn-around | 5, SP03 T5 | todo |
| 7 | Bots: confirm no river reads, conditional BOT_VERSION | 1, 6 | todo |
| 8 | Web render + asset rows (water, ROBS, ceils, planks) | 3, 6 | todo |
| 9 | Editor library items | 8 | todo |
| 10 | Curated selection from pool tool | 4, SP01 census | todo |
| 11 | Import selected levels, solvability, locks | 4, 6, 7, 10 | todo |
| 12 | Perf, campaign:verify sample, playability check, CI | 8, 9, 11 | todo |
| 13 | Phase B full validate:levels --all (conditional on SP04 merged) | 12, SP04 merged | todo |

## Task 1 — Decode spike: planks, collider shapes, bridge lifetime, ROBS layer, AI river reads
What it is / what it means: PRD Risks S1–S5 (all RESOLVED as "spike first, else fallback"). Planks per troop/kind, `CheckRightWay` strictness, role of `W`/`D`, the 18 river collider shapes, bridge lifetime on cut and sharing, ROBS layer and AI reads of river state are undecoded.
What changes at a high level: Time-boxed (~1 h each) decomp via `/root/projects/tower-war/_tools/decomp.sh` of `BridgeCeil`, `RiverBridgeController`, `WayBaseController`, river/ROBS prefab collider classes and AI target scoring, plus a UnityPy collider dump. No product code.
Done when: findings recorded per item. Each inconclusive item records its fallback as a deviation in GAME_RULES, LEVELS_GUIDE and the deviations ledger: 1 plank per troop, strict order, instant activation, `W`/`D` presentation-only; shapes flattened to box polylines from mesh bounds (calibrated on levelview refs); per-channel bridge, same-channel enemy troops only, reset on redraw, cleared on cut; ROBS non-blocking; AI ignores river state, `BOT_VERSION` unchanged. Needs `TW_EXTRACT`.

## Task 2 — Rules text: R-RIV-01..05, phase 6 row, RULES_VERSION
What it is / what it means: PRD R1, Decisions 1, 3–6, 8, 10. Rules authority comes first.
What changes at a high level: `docs/GAME_RULES.md` gains area RIV (river state and ceil row, planks, ceil pass with turn-around, bridge lifetime, river obstacles). Phase 6 row ("bridge pass after element pass"), R-OBS-02 and R-LIN-04 cross-references, spike results and deviations, changelog; `RULES_VERSION` bumped to the next minor at merge time (indicative 3.4.0; rebase if SP04 slips or merges first).
Done when: `pnpm check:rules` accepts the new IDs as untested stubs per repo convention; changelog and version present.

## Task 3 — Defs, events, river/ROBS JSON, schema, content version
What it is / what it means: PRD R2. Rivers are content-driven, not hard-coded sim.
What changes at a high level: `bridgeable` module def (`ceilSpacingMilli`, `planksPerTroop`, `appliesTo: 'element'`, phase `contacts`) and registry entry; events `BridgeCeilBuilt`, `TroopTurnedBack`; `KillCause` gains `river`; `elements/river.json` (footprints per shape `T`, values from Task 1) and `river-obstacle.json` (4-child cluster; `blocksLines` only if Task 1 flipped it); `planks` on unit JSON; level `requires` accepts `bridgeable`; `shape`/`bridgeWidth`/`distance` params in the schema. Content version/hash bump and `content:lock`.
Done when: schemas regenerated, `check:schemas`, `validate:content`, typecheck green; shipped level hashes unchanged apart from expected locks.

## Task 4 — Importer rows, emitters, river/ROBS collider dump
What it is / what it means: PRD R6. River and ROBS are blocked at import; `colliders.json` has no river/ROBS rows. Needs `TW_EXTRACT`.
What changes at a high level: `feature-map.json` River and ROBS become `map` rows; `emitRivers` (pos, yaw, `T/W/D`) and `emitRiverObstacles` (parent/child offsets, scale; inactive omitted), rotation via `rotate.ts`; collider rows for the 18 shapes via the dump script, or the Task 1 fallback flattening.
Done when: `check:import` green; a sample river and ROBS level import and validate; every shipped level hash unchanged.

## Task 5 — Bridge state: crossing geometry, bridgeMask + planks columns, hash/snapshot
What it is / what it means: PRD R3, Architecture. The one new sim facility; keyed to the channel, not the element.
What changes at a high level: `bridges.ts` precomputes per ordered pair and river the crossing interval and ceil row (`ceil(len/550)`, min 1; AABB reject; precomputed river-crossing bitset; assert at most 32 ceils, wider levels fail validation). `bridgeMask` column and a troop `planks` ring column added to state, hash and snapshot with a schema version bump; `channelElementState` accessor in `elements.ts`. Clear-bit API stub for SP06.
Done when: tests titled `covers R-RIV-01` (k ceils for a lane through a river) and mask hash/snapshot round-trip; river-free replays bit-identical.

## Task 6 — Bridgeable module, bridge pass, turn-around
What it is / what it means: PRD R3, Decisions 3, 4, 6. Rules R-RIV-02..04.
What changes at a high level: `bridgeable` module sets `planks` at spawn on river-state lines, runs the bridge pass after the element pass (front-first, ceil order): active ceil passes, inactive with plank and earlier ceils active spends the plank and sets the bit, else the troop turns back via SP03's companion return channel (dies with `cause: river` if impossible). Mask cleared on `DrawLine`/`CutLine`/removal; returning troops do not rebuild. Zero-default `plankCarry` modifier.
Done when: tests `covers R-RIV-02..04`: k troops build in order and troop k+1 passes, plankless turn-back reinforces source, cut clears mask, two lines over one river independent, wall-killed troop never builds while mine-delayed one may, replay determinism. `check:rules` fully green.

## Task 7 — Bots: confirm no river reads, conditional BOT_VERSION
What it is / what it means: PRD R4, Risks S4/S5. Exact port means no bot change.
What changes at a high level: Verify `canDraw` ignores water and nothing in bots reads river state beyond the mask. If Task 1 showed ROBS on the Obstacle layer (`blocksLines`), bump `BOT_VERSION` (next minor at merge time) and refresh `bots:golden`; otherwise no code change.
Done when: confirmation recorded; `bots:golden` green; `BOT_VERSION` unchanged or bumped with refreshed locks.

## Task 8 — Web render + asset rows (water, ROBS, ceils, planks)
What it is / what it means: PRD R5. Needs `TW_EXTRACT` for models.
What changes at a high level: `assets-tw` rows for `RiverBridge`, `BridgeCeil`, plank and river shape meshes; manifest ids `element.river`, `element.bridgeCeil`, `element.plank`; credits. Sibling renderer by visual id: one water mesh per river from `T` using SP01's `river` slot, ROBS from `riverObstacle`, instanced ceils (ghost until `BridgeCeilBuilt`), plank on troop while `planks > 0`. Rivers/ROBS are not hit-test targets.
Done when: `assets:tw:check` and `check:manifest` green; water, ROBS, ceil activation and planks render per theme in-game from events.

## Task 9 — Editor library items
What it is / what it means: PRD R5 editor bullet.
What changes at a high level: `river` (shape picker 0–17, yaw, W/D read-only presets) and `river-obstacle` library items with model and thumbnail; gizmo and overlap warnings off; `LevelDoc` params for shape/W/D.
Done when: editor places both and exports valid level JSON that passes content validation; editor tests green.

## Task 10 — Curated selection from pool tool
What it is / what it means: README Curation + PRD R6; resolution 4. Needs `TW_EXTRACT` and `pnpm census`.
What changes at a high level: From census select >=10 river and, separately, >=10 ROBS levels from Common 24–340 (first river at TW 103, first ROBS at 140; levels may carry both). First selected level introduces each with no other new element; spread across later positions; prefer proxy-solvable (short rivers), avoid allowlisting when an equal-feature alternative exists; swap prefab-only ids if `parse-prefab` fails. Selection list kept in the SP05 docs folder.
Done when: provisional selection recorded with source positions, features and metrics; coverage lines (`rivers (+bridges) ...` and `river obstacles (ROBS) ...: n levels, first at display N`) drafted.

## Task 11 — Import selected levels, solvability, locks
What it is / what it means: PRD R6, Acceptance. Selection is provisional; only SP09 sets final order and numbers.
What changes at a high level: Import only the selected levels with provisional display ids after earlier SPs' levels; run `validate:levels` on them; unsolvable by proxy go to `tools/unsolved-by-proxy.json` (reason, `ownerSignOff: null`); refresh only own entries via `levels:lock --levels`, content lock, CREDITS rows.
Done when: >=10 river and >=10 ROBS levels imported, coverage lines printed; shipped 1–20 unchanged except 23 per SP02; `validate:content --base HEAD`, `check:content`, `check:import` green.

## Task 12 — Perf, campaign:verify sample, playability check, CI
What it is / what it means: PRD Acceptance, playability resolution, resolution 7.
What changes at a high level: `bench:sim` on a river-heavy level within budget; add the river and ROBS introduction levels to the `campaign:verify` sample set; review proxy win metrics of long-river levels (no rule change; adjust selection or allowlist); full `pnpm run ci`.
Done when: bench within budget; sample verify passes; golden/replay gates green; `pnpm run ci` green.

## Task 13 — Phase B full validate:levels --all (conditional on SP04 merged)
What it is / what it means: README resolution 8; Phase B pre-merge run belongs to the later of 04/05. Runs only once SP04 is merged and this branch rebased on it.
What changes at a high level: Rebase on SP04, reconcile version numbers, run `validate:levels --all` (about 5–8 min at curated size); re-validate existing unsolved-by-proxy entries; fix or allowlist new failures from this SP's levels only.
Done when: `validate:levels --all` green; Phase B PR ready for owner approval.

## Owner manual steps
- Provide rebuilt `TW_EXTRACT` for Tasks 1, 4, 8, 10.
- Spot-check rows added to `tools/unsolved-by-proxy.json` here (`ownerSignOff` stays null).
- Approve the Phase B PR (SP04 + SP05) after Task 13.
