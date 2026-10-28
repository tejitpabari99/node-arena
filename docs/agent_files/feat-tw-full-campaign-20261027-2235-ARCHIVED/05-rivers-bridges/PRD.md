---
status: archived
summary: Rivers as non-blocking water bands whose crossing lines build plank bridges (ceils activated one plank per troop; plankless troops turn around via SP03's return channel), plus river obstacles (ROBS); adds per-channel bridge state next to SP02's element facility, no generic CrossingSource, no bot change.
date: 2026-10-27
---
# PRD: 05 Rivers + bridges + river obstacles

Repo/branch: node-arena, `feat/tw-full-campaign` (Phase B PR = SP04+05) · Depends on: 02 (element facility: `elements.ts` crossing helper, phase-6 element pass, hashed state; `RULES_VERSION` 3.1.0), 03 (companion return channel for turned-around troops; unit `carry`), 01 (pool tool; `themes.<t>.river`/`riverObstacle` material slots) · Feeds: 09 (docs, final gates). Parallel with 04 in Phase B.
Owns: `docs/GAME_RULES.md` (new area `RIV`, edits R-OBS-02 / R-LIN-04 cross-refs, phase-6 row, changelog), `packages/content/src/versioning.ts` (`RULES_VERSION` 3.3.0 -> **3.4.0**), `packages/defs/src/modules/bridgeable.def.ts` + registry + events (`BridgeCeilBuilt`, `TroopTurnedBack`), `packages/content/data/elements/{river,river-obstacle}.json` + schema bits, `packages/sim/src/{bridges.ts,state.ts,hash.ts,snapshot}` + `modules/bridgeable.ts` (+ geometry extension if needed), `tools/src/import-tw/{feature-map.json,map-level.ts}` (River/ROBS rows, emitters), `tools/src/import-tw/prefab/{dump_colliders.py,colliders.json}` (river/ROBS rows), `apps/web/src/render/*` (water, ceils, planks), `apps/web/src/editor/*`, `tools/src/assets-tw/*` (bridge/plank model rows), imported levels, `tools/levels-lock.json`, `tools/unsolved-by-proxy.json`.
Does not own: theme river materials (01), resource piles (03), artillery vs ceils (04, rocket destroying ceils is 06), bots (unchanged), sheep/gates (OUT).

## TL;DR
- River = **non-blocking** water band. Lines cross it freely; every troop spawned on a crossing line carries one plank; the crossing has an ordered row of **ceils**; a troop reaching the next inactive ceil spends its plank to activate it and walks on; with no plank it **turns around** (return trip). So a k-ceil river costs the first ~k troops a round trip. [verified: 03-core-mechanics §8.4, `BridgeCeil.OnTriggerEnter`, `TryToReverseWarriorMove`; port reading of "one plank per troop" is inferred, S1]
- New sim state is **per (channel, river)**, not per element: bridges belong to the line. SP02's element state does not fit; this SP adds one hashed `bridgeMask` column beside it and reuses SP02's phase-6 pass and SP03's return channel.
- **ROBS** = river-side decor (4 children, same shape as OBS). Default non-blocking and visual-only; spike S4 decides if its layer is Obstacle.
- Bots unchanged: TW AI does not mask water and happily draws across rivers [verified: 04-ai-bots §AI line validity L137]; `canDraw` and `BOT_VERSION` stay. Levels with rivers change bot outcomes only through sim effects.
- Importer: `River` / `ROBS` become `map` rows; first river at TW position 103, ROBS at 140 [verified: 02-levels §5]; curated import.

## Problem
River levels gate 440 of 1,012 TW levels, ROBS 242 [verified: 03 §corpus counts; 06-gap-map: rivers lift coverage 38.1% -> 44.1%]. Both are `archetype: null` in `feature-map.json`, so every such level is blocked [verified: feature-map.json L15, L19]. The sim has no troop-vs-geometry state other than SP02's per-element columns; `R-OBS-02` says elements do not interact with troops.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Rules `R-RIV-*` (text, tests, code), RULES 3.4.0 | Plank talents (`createBridgeBonus`, BridgeSpeed): meta OUT; keep zero-default `plankCarry` param |
| River geometry (18 TW shapes) as content footprints; ceil row derived at `create` | Rocket / artillery destroying ceils (SP06; hook only, OPEN 6) |
| Per-channel bridge state: hashed, snapshotted, replay-stable | Generic `CrossingSource` abstraction (Decision 2) |
| Troop turn-around reusing SP03's return channel | Draw-family polyline paths, sheep, gates (OUT) |
| Water + ceil/plank render per theme, editor placement, importer rows + unlocked levels | Bot bridge-awareness (TW AI has none; exact port) |

## Requirements

### Decoded vs spike
| Fact | Status |
|---|---|
| River does not block drawing; line enters "river state"; spawned soldiers carry a `BridgeWood` plank | decoded [verified: 03 §8.4, `WayBaseController.SetWayStateToRiver`, `_riversCount`] |
| Ceils placed by raycasting the way vs river colliders; `PLANK_OFFSET 0.55`; bridge complete when all ceils active | decoded [verified: 03 §8.4, `RiverBridgeController.{FindPositionsToCreateBridges,CreateBridgeCeils}`, `CheckCreatedState`] |
| Troop with plank touching inactive ceil: `CheckRightWay`, activate, consume one plank | decoded [verified: `BridgeCeil.OnTriggerEnter`] |
| Plankless troop that cannot proceed: reverse, else `ForceKill` | decoded [verified: `TryToReverseWarriorMove`] |
| `T` shape 0-17, `W` always 1.014, `D` always 0.2 | data [verified: 02-levels L147] |
| Planks per troop (1?), do tanks carry 2?, pause while building, `CheckRightWay` semantics (strict order?), meaning of `D` and `W` in code | NOT decoded -> spike S1 |
| River/ROBS collider shapes per `T` | NOT in `colliders.json` (obstacle/building/tower/house only) [verified] -> spike S2 |
| Bridge lifetime on `CutLine`; two lines across one river; enemy troops using my built ceils | NOT decoded; inferred bridge belongs to its way and is destroyed with it -> S3 |
| ROBS layer (blocks lines?) and trigger behaviour | NOT decoded -> S4 |
| Where plank token originates (all spawns vs only first N) | inferred: all spawns; talents "+N planks" imply a base count -> S1 |

### R1 Rules (GAME_RULES first, then tests, then code)
- **R-RIV-01 River state.** A river never blocks `DrawLine` (R-OBS-01 unaffected). A line whose lane intersects a river footprint is in *river state*; `create` precomputes, per ordered pair and river, the crossing interval (`laneIntervals`, SP02/SP04 primitive) and the **ceil row**: positions `s_1 < ... < s_k` (milli progress) spaced `ceilSpacing` (550, from `PLANK_OFFSET`) along the interval; `k = ceil(intervalLen / ceilSpacing)`, min 1.
- **R-RIV-02 Planks.** Each troop spawned on a river-state line has `planks = carry` (default 1; `plankCarry` modifier 0). Planks are not gold; they live in a troop column.
- **R-RIV-03 Ceil pass.** In phase 6 element pass, per channel, each troop whose swept progress passes `s_i` (ring order front-first): ceil active -> continues; inactive and `planks > 0` and all earlier ceils active -> `planks -= 1`, ceil active (bit set), troop continues; otherwise the troop **turns around** (moves to the channel's return companion, SP03 R-PIL-02 mechanism) and walks back to its source. Source arrival reinforces as an ordinary own arrival (planks discarded). If no return is possible (blocked/line cut) it dies (`cause: river`).
- **R-RIV-04 Bridge lifetime.** Bridge state belongs to the channel: cleared on `DrawLine` (new line), kept while the line exists, cleared on `CutLine` / line removal. A returning troop does not rebuild. (Risk S3)
- **R-RIV-05 River obstacles.** `riverObstacle` elements are static, unowned, no troop interaction; `blocksLines` only if S4 says so.
- Phase table row 6: "bridge pass (R-RIV) after element pass". Changelog + `RULES_VERSION` **3.4.0** (minor; river-free replays bit-identical). Merge order: Phase B PR carries SP04 (3.3.0) then SP05 (3.4.0); if 04 slips, renumber.

### R2 Defs / content
- One module `bridgeable {ceilSpacingMilli, planksPerTroop}` (`appliesTo: 'element'`); phase `contacts`; `ruleIds R-RIV-*`. `elements/river.json`: footprint set by shape `T` (union of boxes/capsules/arcs flattened to boxes; S2 fills values). `elements/river-obstacle.json`: 4-child cluster like `obstacle.json`.
- Level element `params`: `shape` (T 0-17), `bridgeWidth` (W), `distance` (D). W and D are stored; sim effect only if S1 shows one (default presentation + spacing floor).
- Level `requires` gains `bridgeable`. Unit content: `units/*.json` gets `planks` (soldier 1, tank 1, artillery 1) pending S1.
- `KillCause` += `river`; events `BridgeCeilBuilt{channel,river,ceil}`, `TroopTurnedBack{channel,seq}`.

### R3 Sim
- `bridges.ts`: `create`-time `riverCrossings[pair] -> [{river, ceils:number[]}]` (BigInt cold, per-tick Numbers, same budget as SP04 R1); `bridgeMask: Uint32Array(channels x riverSlots)` (<= 32 ceils per crossing, asserted at create; wider levels fail validation) in state, `hash`, snapshot.
- Troop `planks` column on the ring (one more column; pattern from SP03 `carry`). Turned-back troops reuse SP03's companion return channel; no new motion code.
- Hot path: skip channels with no river crossing (precomputed bitset); `bench:sim` gate.
- Ordering inside phase 6: head-on -> crossing -> element pass (walls/mines) -> **bridge pass**. A troop killed by a wall never reaches a ceil in the same tick; a mine-delayed troop may still build.

### R4 Bots
`canDraw` unchanged (rivers do not block). TW AI ignores water [verified], so exact port means **no code change, `BOT_VERSION` unchanged** (2.5.0 from SP03). Proxy/bot strength on river levels may drop (bridges eat troops); covered by `validate:levels` and `unsolved-by-proxy.json`. (Risk S5: confirm no AI code reads `_isBlocked` for river state beyond the mask.)

### R5 Web
- Water: new renderer registered by visual id `element.river` (follows SP02 sibling-renderer pattern); one mesh per river from `T`, material from `themes.<t>.river` (SP01 slot); ROBS from `themes.<t>.riverObstacle`, placed like `placeObstacles`.
- Ceils: instanced plank meshes from TW `BridgeCeil` / `RiverBridge` prefabs along `ceils[]`, inactive = ghost/hidden, active on `BridgeCeilBuilt`; carried plank on troop = small instance on troop mesh while `planks > 0`. Turn-back plays existing reverse movement from SP03.
- Input: rivers/ROBS are not hit-test targets; lines draw through; no preview error. Editor: library items `river` (T picker 0-17, yaw, W/D read-only presets) and `river-obstacle`; gizmo + overlap warnings off (non-blocking).
- Assets: add `RiverBridge`, `BridgeCeil`, plank rows + river shape meshes to `tools/src/assets-tw`; `assets:tw:check` byte-identical; manifest `element.river`, `element.bridgeCeil`, `element.plank`; credits rows.

### R6 Importer
- `feature-map.json`: `River` -> `{action: map, kind: element, archetype: "river"}`, `ROBS` -> `"river-obstacle"`. Parser already reads both [verified: parse-raw.ts L38, L42]. Emitters `emitRivers` (pos `P`, yaw `R`, params `T/W/D`) and `emitRiverObstacles` (parent `OPP/OPR`, children `OCP/OCR`, `S`); inactive omitted. Rotation handled by `rotate.ts` as for OBS.
- Curated import: select >=10 TW-pool levels (Common 24-340) featuring rivers (+bridges) and, separately, river obstacles (ROBS) (>=10 each) per README Curation rules (candidates and metrics from SP01 pool tool; the first selected level introduces rivers (+bridges) and, separately, river obstacles (ROBS) (>=10 each) with no other new element; spread across later positions; prefer proxy-solvable, allowlist only if no equal-feature alternative); import only those; show the coverage line in the PR (`rivers (+bridges) and, separately, river obstacles (ROBS) (>=10 each): n levels, first at display N`). Selection is provisional; SP09 finalizes order and numbering. Unsolvable by proxy -> `tools/unsolved-by-proxy.json` (`ownerSignOff: null`).
- Content version bump + `content:lock`; `levels:lock`; `validate:levels`.

## Architecture
- **Base derivation (D7).** River, river obstacle (ROBS) and bridge ceil archetypes `extend` `element-base` (footprint, layer, per-element state; SP02) and add `bridgeable`/blocking modules only. Data-driven, no TS class hierarchy.
- **Seam, no new abstraction.** River needs three things: lane-interval geometry (`laneIntervals`, exists), a per-tick "troop passed progress s on channel c" visit (SP02 `forEachCrossing` already iterates channels and troops front-first), and per-(channel, element) state. The first two exist; the third is one extra column. `bridges.ts` owns it; `elements.ts` gains only `channelElementState(state, moduleId)`.
- Bridge state keyed to channel because ring and lines are dynamic while SP02 element state is keyed to static elements. This is the one conceptual deviation from SP02; documented in R-RIV-04.
- Determinism: integer milli progress, ticks, no RNG, fixed iteration (channel key, troop ring order, ceil order), all new state hashed.
- Version impact: no river => bit-identical replays. River levels get new content hashes (expected).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | River blocks drawing? | No | Block, bridge-only crossing | Decoded: rivers do not block (03 §8.4); AI unmasked |
| 2 | `CrossingSource` seam (FUTURES) | **Not built**; reuse SP02 helper + one column | Generic crossing-source registry | Only rivers need per-channel state; trolley/railway are deferred by owner so no second consumer is planned. FUTURES entry stays deferred; SP09 records it |
| 3 | State owner | Per (channel, river) mask | Per-element state (SP02) | Bridges die with lines; two lines over one river build independently |
| 4 | Plankless troop | Turn around via SP03 return channel | Instant death; stall | Decoded reverse-else-kill; reuses motion |
| 5 | Ceil count | `ceil(len/550)` | Count from W/D | `PLANK_OFFSET` decoded; W/D constant in data |
| 6 | Ceil order | Strict front-to-back | Any order | `CheckRightWay` inferred; S1 |
| 7 | Bot change | None, no `BOT_VERSION` bump | Make AI avoid rivers | Exact port; AI unaware |
| 8 | ROBS | Decor, non-blocking | Blocking | Name/pool tool; S4 flips it |
| 9 | Talents | zero-default params | implement | Meta OUT |
| 10 | RULES bump | minor 3.4.0 | major | Additive for river-free levels |

## Manual steps
- Spikes S1-S5 against rebuilt extract (`/root/projects/tower-war/_tools/decomp.sh 'BridgeCeil'`, `'RiverBridgeController'`, `'WayBaseController'`, `'AiPlayerController'`; UnityPy collider dump of River and ROBS prefabs, 18 shapes), time-boxed 1.5 days; extract may not exist yet, so this is task 1.
- Owner spot-check of `unsolved-by-proxy.json` rows added here.
- Pre-merge `validate:levels --all` for Phase B.

## Risks / Open Questions
- [RESOLVED S1: decode spike first (task: decomp BridgeController / plank classes via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback as stated; log deviation in GAME_RULES + LEVELS_GUIDE and record it as a deviation in GAME_RULES + the deviations ledger] Planks per troop/kind, pause on activation, `CheckRightWay` strictness, role of `W`/`D`. Fallback: 1 plank per troop, strict order, instant, `W`/`D` presentation-only.
- [RESOLVED S2: decode spike first (task: decomp river prefab collider classes via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: flatten each shape to a polyline of boxes from mesh bounds; calibrate on levelview refs and record it as a deviation in GAME_RULES + the deviations ledger] River collider shapes for `T` 0-17.
- [RESOLVED S3: decode spike first (task: decomp bridge classes via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: per-channel bridge state, same-channel enemy troops only, reset on redraw, cleared on cut and record it as a deviation in GAME_RULES + the deviations ledger] Bridge lifetime on cut, shared use by enemy troops, re-draw rebuilding.
- [RESOLVED S4: decode spike first (task: decomp ROBS prefab/layer via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: ROBS non-blocking (decorative, layer not Obstacle), no `BOT_VERSION` bump and record it as a deviation in GAME_RULES + the deviations ledger] ROBS layer; if Obstacle (10) -> `blocksLines` and `canDraw` already handles it (bot-affecting -> `BOT_VERSION` bump + lock refresh).
- [RESOLVED S5: decode spike first (task: decomp AI target-scoring class / `_isBlocked` readers via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: AI ignores river state, `BOT_VERSION` unchanged and record it as a deviation in GAME_RULES + the deviations ledger] AI never reads river state (only mask).
- [RESOLVED 6: owned by SP06] Rocket/area damage to ceils (`BridgeCeil.GetDamage`). SP05 ships only the mask clear-bit API stub; default no damage until SP06 lands.
- [RESOLVED 7: owned by SP03] Return-channel arrival of turned-back troops when source house captured meanwhile: follow SP03's rule.
- [RESOLVED playability: tooling/measure] Strict k-troop bridge cost may make long rivers near-unwinnable for proxy. Starting value: no rule change; run `validate:levels` + pool-tool metrics in task; prefer proxy-solvable river candidates, adjust; unsolvable levels go on the `unsolved-by-proxy.json` allowlist with `ownerSignOff: null`.
- [RESOLVED: derived] Rivers do not block (03 §8.4); first river at 103, ROBS at 140.
- [RESOLVED: locked decision] Plank talents/boosters OUT; rocket vs ceils is SP06.
- [DEFERRED] Generic `CrossingSource` stays in FUTURES (no second consumer after trolley/railway were deferred by owner).
- Risk: precompute cost = pairs x rivers; mitigate with AABB reject and bench gate. Risk: 32-ceil mask cap; assert at create.

## Acceptance Criteria
- `R-RIV-01..05` in GAME_RULES with `covers R-...` tests; `pnpm check:rules` green; RULES_VERSION 3.4.0 + changelog.
- Unit tests: lane through river yields k ceils; k troops build bridge in order and troop k+1 passes without turning; plankless troop turns back and reinforces source; cut clears mask; mask in hash and snapshot round-trip; two lines over one river independent; replay determinism; river-free golden replays unchanged.
- Rivers do not block `canDraw`; `BOT_VERSION` unchanged unless S4 flips ROBS (then bumped with `bots:golden` refreshed).
- `River`/`ROBS` rows flipped; >=10 river and >=10 ROBS levels selected and imported (each introduced alone first), each solvable by proxy or in `unsolved-by-proxy.json`; coverage lines recorded; locks refreshed.
- Web: water, ceils, planks render per theme (SP01 slots), ceil activation visible, editor places river and ROBS and exports valid JSON; `assets:tw:check`, `check:manifest` green.
- `pnpm bench:sim` within budget on a river-heavy level; `pnpm run ci` green.
