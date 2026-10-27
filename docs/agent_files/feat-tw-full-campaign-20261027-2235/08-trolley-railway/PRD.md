---
status: draft
summary: Trolley (a ready-gated one-shot cart that rides a drawn line, kills every troop it meets and deletes the building it hits) and railway (rail-mounted buildings that hop between discrete path points via a new RailMove command; moving cuts the building's lines), with AI rail moves (AiRM + TryMoveTowerOnRailway). Closes the CrossingSource seam as "not built".
date: 2026-10-27
---
# PRD: 08 Trolley + railway

Repo/branch: node-arena, `feat/tw-full-campaign` (Phase D PR = SP08+09) · Depends on: 04 (projectile hits may target trolley; `hits:'trolley'`), 02 (element facility; mine/wall helper), 03 (ring column pattern, return channel), 05 (river passes), 06 (command parse table, `RULES_VERSION` 3.5.0, BOT 2.6.0), 07 (3.6.0). Takes **RULES 3.7.0**, next BOT minor (**2.7.0**). Feeds: 09 (final import 267/330+, docs, gates).
Owns: `docs/GAME_RULES.md` (areas `TRL`, `RAIL`, command 4.1 `RailMove`, phase rows 1/8 amendments, changelog), `packages/content/src/versioning.ts`, `packages/bots/src/version.ts`, `packages/defs/src/{commands.ts,modules/{trolley,rides}.def.ts}` + registries/events (`TrolleyReady`, `TrolleyLaunched`, `TrolleyExploded`, `BuildingRemoved`, `RailMoveStarted`, `RailMoveEnded`), `packages/content/data/{buildings/trolley.json,elements/railway.json}` + schemas + level `railways` field, `packages/sim/src/{rails.ts (new),state.ts,hash.ts,commands.ts,tick.ts,ring.ts (kind column value),crossings.ts,geometry.ts (pair/lane rebuild entrypoint)}`, `modules/{trolley,rides}.ts`, `packages/bots/src/{tw-ai.ts,script.ts,seat.ts}`, `tools/src/import-tw/{feature-map.json,map-level.ts,script.ts}`, `apps/web/src/{render,input,hud,editor}/*`, `tools/src/assets-tw/*`, imported levels, locks, `tools/unsolved-by-proxy.json`, `docs/FUTURES.md` (CrossingSource entry).
Does not own: boosters/rage, cargo (dropped), projectile semantics (04), rocket/fortress (06/07), final census docs (09).

## TL;DR
- **Trolley = building archetype + a pseudo-troop.** Own troops fill it; overflow past `maxLevel` sets `ready`. A ready trolley has exactly one slot; `DrawLine` from it launches one *cart* troop (kind `cart`, 50 mt/tick = TW 1.0 u/s) on the normal channel ring. Carts kill every troop they touch (own or enemy), and on arrival (or touching any building) delete that building. [decomp: 03 §8.7] No new command.
- **Railway = discrete hops.** A rail has 2-5 path points. A rail-mounted building (`CTI`) sits at one point; `RailMove{player, building, pathPoint}` starts a move of `moveTicks`: all its lines are cut and their troops killed at start (decomp: AI does `KillWarriorsOnWays`+`DestroyAllWays`), the building cannot be drawn to/from while moving, position snaps at end. [decomp: §8.8] TW's continuous human drag is cosmetic (web drags, snaps to nearest point, sends `RailMove`).
- Building **position becomes hashed state** (`posX/posZ`); incident pair/lane/tower-range caches are rebuilt at move end (cold path, create-time functions reused). This is the only thing `rides` changes in the engine.
- **CrossingSource seam: not built.** Carts reuse the troop ring + existing contact/element passes; rails reuse nothing crossing-shaped. Close the FUTURES entry. [RESOLVED]
- Bots: sources already include trolley (`drawsLines`, slot only when ready); defense excludes it. New: script step `railMove` (AiRM) and `TryMoveTowerOnRailway` for BT 0. TW AI pacing (3.4 s pause) stays bot-side.
- Minor bump 3.7.0: no shipped level (positions 4-23) has trolley/rail, so replays are bit-identical; first trolley level 267, first rail 330. [verified: 02-levels §5]

## Problem
- `trolley` and `Railway` map to `archetype: null` and `AiRM` is a dropped bot token, so positions >= 267 block import. [verified: `feature-map.json`]
- Sim assumes building positions are constant: `blocked[pair]`, lane lengths, crossing pairs, tower annuli are all precomputed at `create`. [verified: SP04 PRD, `crossings.ts`]
- No building can be removed mid-match today (indices are dense and permanent), and the command set is `DrawLine`/`CutLine` (+ SP06 `Aim`/`ClearAim`).

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Trolley + railway playable by human, TW AI, proxy; levels 267-340 unblocked | Smooth cart motion in sim (continuous drag), booster speed-up (1.3x), cargo |
| Deterministic, snapshotted, hashed state; old replays unchanged | Generic `CrossingSource` registry |
| `RailMove` in the closed command set, same validation for all seats (R-ENT-04) | Rail effects on troops in flight other than kill-on-move |
| TW AI rail behaviour (AiRM steps + tower repositioning) | Boss / PvP rail variants |

## Requirements
**R1 Rules (written first; ids `R-TRL-01..06`, `R-RAIL-01..06`)**
- `TRL-01` Loading: own troop arrival adds `defense` to level; if `level + defense > maxLevel` the trolley becomes `ready` (level clamps to max). Starts ready if `startLevel == maxLevel`. Enemy arrival damages it house-like; capture = house rule [OPEN 1]. `ignoreForWin = true`. [decomp §8.7]
- `TRL-02` Slot: `slots = ready ? 1 : 0`. `DrawLine` from a ready trolley uses normal validation (R-LIN-*, blocking from 04). Draw clears `ready`, places one `cart` troop on the channel, hp = current level. Line is not cuttable (`CutLine` rejects `no-line`/`not-cuttable`), spawns no further troops. Draw to a pile, own or neutral building allowed [OPEN 3].
- `TRL-03` Cart contact: any troop it touches (head-on or crossing pass, either owner) dies via `killTroop(cause:'cart')`; carts never take troop damage. Mines subtract 1 hp (`MINE_DAMAGE_FOR_TROLLEY`), cart removed at hp <= 0 with no effect; walls ignored [OPEN 4]. Tower shots and 04 projectiles with `hits:'trolley'` target a cart *or* a loaded trolley building; a ready/launched one at hp <= 0 explodes (removed, no effect on others). Before ready they only decrement.
- `TRL-04` Arrival (phase 8): the target building is **removed**: its lines are cut, troops on them killed, `removed=1`. Any level/owner (towers, forts, houses); exception: pile with amount 0 is untouched; a pile with amount > 0 is zeroed and removed. The launching trolley is removed at launch+arrival. Binary, not level-scaled. [decomp]
- `TRL-05` Removed buildings: excluded from targets, `canDraw` (`removed` reject), win participation; indices stay dense; hashed. A player with no remaining buildings loses (R-WIN-01).
- `RAIL-01` State `Lock | Active | Moving` per rail, hashed. `Lock` while the building's owner is Neutral; Active otherwise; Moving during a hop. Capturing a railway tower changes who may command it (no controller flag in sim: ownership check only). [decomp]
- `RAIL-02` `RailMove` validation order: `gameover, malformed, unknown-id, not-rail, not-owner, locked, moving, bad-point, same-point`. Accepted: phase 1 cuts all incident lines (reason `rail`), kills their troops, sets Moving until `tick + moveTicks`.
- `RAIL-03` Moving building: no draw to/from (`moving` reject), tower does not fire, still a win participant, still capturable? **no**: no incoming lines exist, so unreachable. Troops cannot arrive.
- `RAIL-04` Move end (phase 1 of the end tick, before commands): set `posX/posZ` to the point, rebuild pair caches incident to the building, state Active. Order among rails: ascending building index.
- `RAIL-05` Two rail buildings on one rail cannot share a point (`bad-point`). Rail geometry is not an obstacle; the building's own footprint is unchanged.
- `RAIL-06` `moveTicks` content default 10 (0.5 s) for all seats [OPEN 2].

**R2 Content/defs**: archetype `trolley` (modules `trolley{maxLevel, startLevel, cartSpeedMt 50}`, `drawsLines` 1 slot, `ignoreForWin`); level key `railways: [{pos, connectedBuilding, points[], startPoint}]` (id-keyed); `rides` module on the connected building (a flag + rail ref). Footprint 1.31 (trolley) from 03 §8.7.

**R3 Commands/replay**: `RailMove{player, building, pathPoint}` added to `COMMANDS` (per-command parse table owned by 06). Replay snapshot gains `Int32Array posX,posZ,removed,ready,railState,railEndTick`; hash section appended after SP07's. Old replays hash unchanged when columns are absent from the level (guard: sections omitted).

**R4 Bots**: `drawsLines` trolley is already a valid source in `freeSources` (slots=0 until ready); `defense` excludes it (`x is not TrolleyBuilding`, port). New `railMove` script step (`AiRM {I,TPPI,BId}`): issues one `RailMove`, skipped if rail locked/not owned, node completes after TW pause 3.4 s (68 ticks). `TryMoveTowerOnRailway` (BT 0 only, after Attack, before Defense): first own tower on a rail with no enemy house in range, enemy list sorted by distance, first point from which an enemy is in range (`attackRadius` integer test) -> `RailMove`. `BOT_VERSION` minor bump; existing-20 bot goldens byte-identical (asserted).

**R5 Web**: trolley model + "ready" glow; cart mesh travelling the line interpolated from `(launch, arrival)`; explosion fx (reuse 04 blast); rail track polyline + station posts; moving building animated along the polyline over `moveTicks`; input: drag a rail building along the track, release snaps to nearest point and sends `RailMove`; trolley ready highlights and the existing draw gesture launches. Editor: place trolley, place rail with 2-5 points and attach a building, export `railways`. `explainDraw` unchanged. TW assets: `Trolley`, `Game/Railway/*`, `WayTrolley` via asset pipeline.

**R6 Importer**: `feature-map`: `trolley -> archetype trolley`, `Railway -> element railway`, `AiRM -> map (token removed)`; `script.ts` stops dropping AiRM and emits `railMove` nodes in queue index order; `map-level.ts` emits `railways`. Census delta table (96 rails, 188 trolleys) in 09.

## Architecture
- **Cart on the ring.** `ring.kind` gains `cart`. Hp/exchange: `exchange()` (03) short-circuits when either side is `cart` (troop dies, cart intact). Crossing/head-on windows already exist for any troop kind; no new geometry. Arrival path (phase 8) dispatches `cart` to `trolley.explode(target)` before capture/reinforce logic. Elements helper (02) gets a `damageCart` callback for mines.
- **Removal.** `removed[]` column; `killLinesOf(b)` helper (shared with RAIL-02) = existing cut + `killTroop` loop. All iterators already skip via `view.buildings.owner`; `removed` is exposed as a new `SimView` accessor and bots filter by it.
- **Position mutation.** `rails.ts#moveEnd` calls `rebuildPairsFor(b)` = the create-time BigInt SAT/pair/annulus functions restricted to pairs incident to `b`. Cold path (rare, <= few per match); per-tick math unchanged. `refreshCrossings` already invalidates on line change; moves cut all incident lines first so no stale window survives.
- **Tick order**: phase 1 gains "rail move ends, then commands"; phase 7b skip if moving; phase 8 cart arrival before capture. No new phase number.
- Determinism: integer ticks, ascending index iteration, no RNG.

## Decisions
| # | Decision | Choice | Alternative | Why |
|---|---|---|---|---|
| 1 | Trolley launch | Reuse `DrawLine` | New `Launch` command | TW draws a line; bots/UI/proxy free |
| 2 | Cart representation | Pseudo-troop on ring | Separate projectile (04) | Reuses contact/mine/crossing code; deterministic analytic motion |
| 3 | Rail motion | Discrete hop + duration | Continuous position | Keeps precomputed geometry valid; lines are dead during motion anyway |
| 4 | Human vs AI duration | Single `moveTicks` | Per-seat | R-ENT-04 no privileges; bot paces itself |
| 5 | CrossingSource seam | **Not built** | Registry | No consumer needs it [RESOLVED] |
| 6 | Building removal | `removed` flag, dense indices | Compact | Hash/replay stability |
| 7 | Versions | RULES 3.7.0, BOT 2.7.0 | Major | Additive; shipped 20 unchanged |

## Manual steps
- Owner sign-off on `unsolved-by-proxy.json` rows for trolley/rail levels (`ownerSignOff: null` until then).
- Play-feel check of drag-to-snap UX and `moveTicks`.

## Risks / Open Questions
- [OPEN 1] Can enemy troops capture a loaded trolley (house-like) or only damage? Spike: `TrolleyBuilding.OnWarriorCollided/SetNewOwner`.
- [OPEN 2] Human drag: does TW cut lines during human drag, and is movement continuous while firing? Spike `HumanRailwayMovementController` + `RailwayModelOnStateChanged`. Default here: cut at move start.
- [OPEN 3] Trolley line target set (piles? own buildings? other trolleys?). Spike `WayTrolley` target filter / `ValidBuildingTypesToCreateWay` target side.
- [OPEN 4] Wall vs cart interaction; mine kill rule exact (`DoDamageFromMine` ready gate). Default: mines -1, walls ignored.
- [OPEN 5] AI trolley targeting: does `Attack` pick weakest-first for trolley sources, or highest level? Spike `AiPlayerController.Attack` lambdas; default weakest-first.
- [OPEN 6] Cart hp = level vs fixed; tower/artillery damage interplay. Default level.
- [OPEN 7] Does a removed `ignoreForWin` trolley/loser rule (all buildings removed) hit AI seats with only trolleys? Default: trolley ignored for win/loss counts.
- [OPEN 8] Exact `TryFindAttackPositionForTower` / `IsPathClear` geometry (not transcribed in research). Default: integer attack-radius + `canDraw` as clearance; record deviation.
- [OPEN 9] Rail path-point coordinates per level are world-space; confirm `P` offset convention in importer.
- [DEFERRED] Booster 1.3x cart speed, continuous drag, cart vs wall hp.
- Risk: pair rebuild on move end is correct only if every cache is derived from building coordinates; test with golden that moves then draws.
- Risk: proxy may fail many rail levels; log, do not tune.

## Acceptance Criteria
- `R-TRL-01..05`, `R-RAIL-01..06` in GAME_RULES with `covers R-...` tests; `RULES_VERSION` 3.7.0 + changelog; `pnpm check:rules` green.
- Tests: fill -> ready -> draw -> cart kills mixed-owner troops -> removal; mine damage; rail move cuts lines, kills troops, blocks draw while Moving, snaps and rebuilds blocking; replay/snapshot round-trip; shipped-20 hashes and `bots:golden` unchanged.
- Bots: `railMove` step and tower repositioning covered; `BOT_VERSION` bumped; AiRM no longer dropped (`check:import` green).
- Feature-map rows flipped; levels through 340 imported; `validate:levels` or `unsolved-by-proxy.json` entries; `content:lock`, `levels:lock` refreshed.
- Web: trolley/rail render, drag-to-snap works, editor places both; `test:web:e2e` and `campaign:verify` green; `pnpm run ci` green.
- FUTURES `CrossingSource` entry marked closed.
