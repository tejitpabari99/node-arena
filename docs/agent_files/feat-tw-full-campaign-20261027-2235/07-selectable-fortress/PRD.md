---
status: draft
summary: Selectable fortress (TW `s_f`, 335 uses) as a house-like line source with 8 tower-style guns and a periodic parachute-reinforcement cycle; decomp shows the parachute lands AT the fortress (no player-chosen fly target), so no new command is needed. Includes proxy/TW-AI use, web model + parachute fx, importer row flip.
date: 2026-10-27
---
# PRD: 07 Selectable fortress

Repo/branch: node-arena, `feat/tw-full-campaign` (Phase C PR = SP06+07; merge 06 first, 07 rebases) · Depends on: 03 (spawn/ring/`spawnTroop`, RULES 3.2.0, BOT 2.5.0), 04 (projectile core only for cosmetic bullet / optional; RULES 3.3.0), 06 soft (phase table row 7d, `parse()` key table, input gesture machine, BOT 2.6.0, RULES 3.5.0) · Feeds: 09 (gates, docs), 06 (fortress is a capture-rocket and rocket-weight target; weight 3.0)
Owns: `docs/GAME_RULES.md` (areas `FRT`, phase rows 4b and 7b amendment, changelog), `packages/content/src/versioning.ts` (`RULES_VERSION` 3.5.0 -> **3.6.0**), `packages/bots/src/version.ts` (BOT minor only if Q7 changes output), `packages/defs/src/modules/{guns,cargo}.def.ts` (or `shoots` extension, see Architecture) + events, `packages/content/data/buildings/selectable-fortress.json` + schema, `packages/sim/src/modules/{shoots.ts,cargo.ts}`, `packages/sim/src/{state.ts,hash.ts,snapshot,tick.ts}` (columns), `tools/src/import-tw/{feature-map.json,map-level.ts}` (`selectable` row), `apps/web/src/{render,ui,editor}/*` (model, guns, parachute fx, editor palette), `tools/src/assets-tw/*`, imported levels, `tools/levels-lock.json`, `tools/unsolved-by-proxy.json`.
Does not own: projectile core (04), rocket/aim commands (06), plain `fortess` (OUT), cargo trucks/`cargoSpawnPoints` (dropped), trolley (08).

## TL;DR
- **No fly-target selection exists in TW.** "Selectable" means the fortress can start lines like a house (`Selecable` collider, `ValidBuildingTypesToCreateWay = [House, SelectableFortess, Trolley]`). Parachutes (`FortessCargoWithWarriors`) drop at the fortress's own spawn points; chargers then walk a lane of the fortress, or reinforce its level if it has none. [verified: research 03 §5.6.1; 04-ai-bots §ctor]
- So: **no new command**, no reuse of SP06 `Aim`. Replays/commands closed set unchanged. Human UX = draw lines from it exactly like a house.
- Fortress = house-like (`grows`, `spawns`, `drawsLines`, wt1 troops, `cwc 0.2 ws 0.5 sc 1.7`, ml 64..350) + **8 guns** (cooldown `ac` 2.0 s) + **cargo cycle** (`dtsc` s between drops of `wcpr` soldiers, budget `swc`, 3.0 s fall).
- Guns reuse tower semantics (instant kill of enemy troops in reach, bullet visual cosmetic at `bs` 15), generalised in `shoots` as a gun count + fixed offsets. Tower behaviour and replays unchanged.
- Parachute landings are scheduled by integer tick (like projectiles); landing spawns normal troops on a deterministic lane (round-robin, not RNG). Minor bump 3.6.0: no shipped level has `s_f`, existing 20 replays bit-identical.

## Problem
- `selectable` row is `archetype: null` (blocked) [verified: `feature-map.json`]; 335 uses, first at position 182, ~11% -> 20% of later levels [research 02 §5]. Gates a large share of positions 182-340.
- Sim `shoots` is tower-only (one gun, stage radius from `attackRadius/radiusUpByLevel`); `spawns` has timer-only departures; no scheduled spawn exists [verified: `modules/shoots.ts`, `modules/spawns.ts`].
- TW AI/proxy draws from `drawsLines` sources only [verified: `tw-ai.ts#freeSources`], so a fortress is usable as soon as the archetype carries `drawsLines`; but untested for fortress-specific behaviour.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Fortress playable by human, TW AI, scripted AI and proxy | Plain `fortess` (BuildingsType 4; 0 uses; stays `block`) |
| Decoded values exact (`cwc/ws/sc`, `ac 2.0`, `bs 15`, cargo timings) | Booster/rage/skin interactions, Boss/Draw/festival variants |
| Guns deterministic, tower-compatible, hashed | Player-chosen parachute target (does not exist in TW) |
| Parachute cycle deterministic (no RNG), snapshot-safe | Bullet flight as sim state (cosmetic, as tower) |
| Existing replays/locks unchanged | Cargo trucks (dropped) |

## Requirements
**R1 Rules (GAME_RULES first; each needs `covers R-FRT-..`)**
- `FRT-01` identity: house-like line source (slots, growth, capture, level cap `ml`, spawn period formula of R-SPN-01 with fortress `cwc/ws/sc`); troop type from `wt` (always 1).
- `FRT-02` guns: 8 guns, each independent cooldown `ac` (2.0 s default, 4.0/6.0 rare), first shot one `ac` after level start (tower rule). A ready gun fires at the nearest enemy troop in reach (tower tie order), instakill via `killTroop(cause:'tower')` (cause reused or `'fortress'`, [Q3 see Risks]). Reach = capsule r 3.0 (local, parent scale not applied) + troop body 0.35; min radius as tower [Q2 see Risks]. Guns fire at any level >= 1 and when neutral-owned (tower precedent `neutralFires`). Fortress does NOT shoot houses (only warriors + trolleys per `_canAttackTypes`; trolleys when 08 lands) [verified: 03 §5.6].
- `FRT-03` cargo cycle: active only while owner is non-neutral. Per owner epoch: `drops = trunc(swc / wcpr)`; drop k lands `fall = 1.0 + 2.0 s` = 60 ticks after its launch; between drops wait `dtsc`; each drop = `min(remaining, wcpr)` soldiers. Owner change cancels all airborne troops (no spawn) and restarts the cycle for the new owner (neutral: stops). [decomp 03 §5.6.1]
- `FRT-04` landing: if the fortress has >= 1 outgoing drawn line, troops depart as normal troops at progress 0 on lines chosen round-robin by ascending target index (persistent per-fortress pointer; TW picks `Random.Range`, deviation, [RESOLVED: owner — copy TW]); else each landed soldier adds the same level bonus as an arriving friendly soldier (R-ENT-02 style, +1 level each). Alive cap applies (skip + counter, like R-SPN-03).
- `FRT-05` capture: ordinary capture rules (levels like tower/house); capturing cancels airborne cargo (FRT-03).
- Phase placement: landings in new phase row `4b` (after spawn departures, before movement); guns in 7b with towers (ascending building index; fortress guns after the building's cooldown tick).
**R2 Content**: archetype `selectable-fortress` modules `drawsLines, grows, spawns{troop soldier, ws 0.5, cwc 0.2, sc 1.7}, guns{count 8, cooldownMs 2000, radius 3000, troopPad 350, offsets[8]}, cargo{swc 14, wcpr 5, dtsc 5000, fallMs 3000}`; per-level overrides `l, ml, cbi, ws, cwc, sc, ac, bs, swc, wcpr, dtsc, wt`. Footprints from prefab (`Building` 4.7, `Hit` 3.3) via 04's collider dump: sets the line-blocking box. Prefab defaults vs level overrides: importer always writes overrides present; absent -> prefab (swc 14, wcpr 5, dtsc 5).
**R3 Commands**: none added. `DrawLine` reasons unchanged (fortress = valid `from`; `not-drawer` never for it).
**R4 Bots**: TW AI source set already `[House, SelectableFortess, Trolley]` -> mirrors `drawsLines`; `targetKey`/counter branch treat fortress like house; `special` level-scaling hook (`idiv(2*level+1,3)` for special buildings) must be checked to include fortress [Q7 see Risks]. Rocket weight 3.0 for SP06 argmax. Proxy = same AI, so it uses fortress lines; if fortress-first-draw ordering differs, BOT minor bump.
**R5 Web**: model `SelectableFortess` (+8 gun meshes, rotating toward target, muzzle/bullet fx at `bs`, pooled), parachute: plane or spawn-in from y 10, canopy mesh descending 1.0 s + 2.0 s, pooled in `fx-pool`; HUD: cargo countdown ring, drops-left pips; input unchanged (house gesture). Editor: palette entry with `l, ml, ac, swc, wcpr, dtsc`; validation: `swc >= 0`, `wcpr >= 1`, neutral fortress shows guns but no cargo.
**R6 Importer**: `selectable` -> `map` with archetype; select >=10 TW-pool levels (Common 24-340) featuring selectable fortress per README Curation rules (candidates and metrics from SP01 pool tool; the first selected level introduces selectable fortress with no other new element; spread across later positions; prefer proxy-solvable, allowlist only if no equal-feature alternative); import only those; show the coverage line in the PR (`selectable fortress: n levels, first at display N`). Selection is provisional; SP09 finalizes order and numbering. Unsolvable-by-proxy -> `tools/unsolved-by-proxy.json`; refresh locks; `plain fortess` stays `block`.

## Architecture
- **Guns** extend `shoots`: params gain `guns?: {count, offsets}`; per-gun cooldown stored in a `shoots.gunCd` column (count x buildings, flattened), hashed. Reach is a fixed disc around the fortress centre (+ gun offsets if Q2 resolves), reusing tower `laneIntervals` precompute (one stage, no radius growth). Tower code path untouched when `guns` absent (golden-asserted).
- **Cargo module** `modules/cargo.ts`: per-building columns `cargoRemaining, cargoNextMt, cargoPending[]` (fixed-capacity ring of `{landTick, count, epoch}`), hashed. Scheduling at 4b is pure integer; landing calls `spawnTroop(state, from, to, kind)` per soldier, ascending. Owner-change hook (existing capture/ownership seam) clears pending + resets cycle; no RNG stream used.
- **Hash/snapshot**: new columns appended after elements/projectiles; snapshot roundtrip test.
- **Projectile core**: not required (instant guns). Optional hook later if TW is proven to have bullet travel time; bullet speed 15 kept as cosmetic param (tower precedent).
- **Next-wave rule** (Q1) is isolated in one function.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Fly target | None; drop at fortress | New `Parachute` command / reuse `Aim` | Decomp: no target selection exists |
| 2 | Landing lane | Round-robin by target index | RNG | No RNG in sim; deterministic; deviation noted |
| 3 | Guns | Instant, tower semantics, 8 cooldowns | Projectile core shots | Tower precedent; zero replay risk |
| 4 | Gun geometry | Disc r 3.0 + pad around centre | Per-gun capsule | Offsets unknown; upgrade if decoded |
| 5 | Fall time | 3.0 s fixed (60 ticks) | Per-drop heights | Decoded 1.0 + 2.0 |
| 6 | Phase slots | 4b landings, 7b guns | New phases | Stable numbering |
| 7 | Version | RULES 3.6.0 minor | Major | No shipped level has `s_f` |

## Manual steps
- Owner-only: none. Needs `TW_EXTRACT` for `SelectableFortess` model + parachute assets; placeholders if absent.
- Decomp spikes (time-boxed, extract may not exist): `decomp.sh 'SelectableFortess'`, `'FortessTower'`, `'FortessCargoWithWarriors'`.
- Calibrate vs TW playthrough of position 182 (owner approval at end).

## Risks / Open Questions
- Q1 wave repeat [RESOLVED: decode spike first (task: decomp _SpawnFlyWarriors_d__28 via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use next wave starts after previous wave's troops are all gone plus `dtsc` (else one wave per ownership epoch) and record it as a deviation in GAME_RULES + the deviations ledger]
- Q2 gun positions/offsets [RESOLVED: decode spike first (task: decomp SelectableFortess (prefab gun transforms via UnityPy) via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use one disc at fortress centre, r 3.0 (not per gun) and record it as a deviation in GAME_RULES + the deviations ledger]
- Q3 gun level-gating/damage [RESOLVED: decode spike first (task: decomp SelectableFortess gun logic via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use all 8 guns active, instakill and record it as a deviation in GAME_RULES + the deviations ledger]
- Q4 fortress guns vs trolleys/houses: [RESOLVED: trolleys yes once SP08 lands (owned by SP08 hookup), houses no (`_canAttackTypes` verified)]
- [RESOLVED: owner — copy TW] Parachute landing: drop at fortress spawn points, walk a fortress lane chosen round-robin, else add level; no command.
- Q6 alive cap vs airborne troops [RESOLVED: decode spike first (task: decomp _SpawnFlyWarriors_d__28 (alive-cap timing) via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use check alive cap at landing (not reserve at launch) and record it as a deviation in GAME_RULES + the deviations ledger]
- Q7 TW AI fortress details [RESOLVED: decode spike first (task: decomp AiPlayerController (fortress `special` hook) via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use mirror `drawsLines`, include fortress in `special` level-scaling; bump BOT only if a calibration run changes output and record it as a deviation in GAME_RULES + the deviations ledger]
- Q8 soldiers added to level when no lines [RESOLVED: decode spike first (task: decomp SelectableFortess landing AddLevel via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use +1 level per soldier and record it as a deviation in GAME_RULES + the deviations ledger]
- [RESOLVED: locked decision] Plain `fortess` and Boss/Draw variants OUT.
- [DEFERRED] Visible bullet travel in sim, per-gun targeting offsets, cargo trucks.
- Risk: 06 and 07 both edit phase table, `parse()`, input; 07 adds no command so the conflict surface is the phase table + `tick.ts`. Risk: fortress-heavy levels unwinnable by proxy -> `unsolved-by-proxy.json`.

## Acceptance Criteria
- GAME_RULES `FRT-01..05` with `covers R-FRT-..` tests; changelog 3.6.0; `RULES_VERSION` bumped; BOT bumped only if bot output changes; `check:rules` green.
- Unit tests: gun cadence/first shot/boundary r and r+1 milli; 8 independent cooldowns; neutral fires; drop timing (60 ticks), `drops = trunc(swc/wcpr)`, remainder drop; owner change cancels airborne; round-robin lane; no-line level bonus; alive cap; snapshot/hash roundtrip; replay (no new command) bit-identical.
- Existing 20 locks, `sim:golden`, `replay:verify`, `bots:golden` unchanged (asserted).
- `selectable` row `map`; >=10 selected fortress levels imported, locks refreshed, coverage line in PR; `validate:levels` green; proxy draws from fortress in a bot test.
- Web: fortress, guns, parachute visible; position 182 passes `campaign:verify`; editor places and validates; screenshots vs refs.
- `pnpm run ci` green.
