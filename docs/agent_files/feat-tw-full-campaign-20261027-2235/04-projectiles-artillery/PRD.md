---
status: draft
summary: Generic deterministic projectile/scheduled-effect core (integer travel time, area blast, direct-hit and point targets) that SP06/07 consume, plus TW artillery (WT3 house + ranged unit that volleys at in-range enemy troops); tower shots stay instant.
date: 2026-10-27
---
# PRD: 04 Projectile core + artillery

Repo/branch: node-arena, `feat/tw-full-campaign` (Phase B PR = SP04+05) · Depends on: 01 (pool tool, themes for levels >= 41), 02 (per-element state + phase-6 element pass; blast can hit elements later), 03 (ring column pattern, `RULES_VERSION` 3.2.0, `BOT_VERSION` 2.5.0) · Feeds: 06 (rocket + capture-rocket projectiles), 07 (fortress turrets + parachute drops), 05 (nothing; bridges only if artillery may hit them, see OPEN 6), 09 (docs, gates)
Owns: `docs/GAME_RULES.md` (new areas `PRJ`, `ART`, phase-7 sub-steps, changelog), `packages/content/src/versioning.ts` (`RULES_VERSION` 3.2.0 -> 3.3.0, `BOT_VERSION` only if OPEN 4 says so), `packages/defs/src/modules/{ranged}.def.ts` + new `projectiles` registry + events (`ProjectileLaunched`, `ProjectileImpact`), `packages/content/data/projectiles/artillery-shell.json`, `data/units/artillery.json`, `data/buildings/house-wt3.json` + schemas, `packages/sim/src/{projectiles.ts,state.ts,hash.ts,snapshot,tick.ts}` + `modules/ranged.ts`, `packages/sim/src/ring.ts` (one column), `tools/src/import-tw/{feature-map.json,map-level.ts}` (WT3 archetype), `apps/web/src/render/*` (shell + blast fx, artillery/house models), `tools/src/assets-tw/*`, imported levels, `tools/levels-lock.json`, `tools/unsolved-by-proxy.json`.
Does not own: rocket/capture-rocket/fortress behaviour (06/07 define defs on this core), rage skills (OUT), tower rewrite (Decision 3), walls/mines (02).

## TL;DR
- A **projectile** is a row in a hashed, snapshotted store with an **integer impact tick** fixed at launch (`ceil(dist / speed)`, >= 1). No per-tick motion; the web interpolates `(launch, impact)` for the visual. [design; mirrors the analytic ring, R-TCK-04]
- Impact resolves in a new phase-7 sub-step (7a) **before** towers fire (7b) and artillery launches (7c). Area blast = integer disc test vs. enemy troops (and, per OPEN, buildings/elements). Identity-targeted ("direct") projectiles fizzle if the target is gone. [verified: 03-core-mechanics §5.9 `OnTargetDisposed`]
- Artillery (WT3 house -> unit `artillery`, hp/atk/def 1/1/1) keeps walking its line and, on a 1.2 s cadence (first shot 0.4 s), launches a shell at **every** qualifying enemy troop within 4.0. Troops are killed via existing `killTroop` (mid-ring removal already works). [decomp: §5.9; "every target" medium confidence]
- Tower shots stay instant (no migration, no replay change). Visible cannonball is cosmetic only, tied to the existing `bulletSpeed` presentation param (FUTURES item).
- Minor bump 3.3.0: no shipped level has WT3, so the 20 existing levels replay bit-identically.

## Problem
- Sim has no delayed or area effect: tower shot is instant `killTroop` in `shoots.towers` [verified: `packages/sim/src/modules/shoots.ts`]. Artillery, rocket tower, capture rocket and fortress turrets all need travel time + blast.
- `house` archetype `warriorType 3` -> `house-wt3` points at a nonexistent file, blocking every WT3 level (first at position 45; 11.8% of campaign houses) [verified: `feature-map.json`; research 02-levels §5].
- Units are flat data (`speed/hp/attack/defense`); no module hook exists for unit behaviour (FUTURES: "Shield/ranged unit modules").

## Goals / Non-Goals
Goals: reusable projectile core with a stable consumer interface; artillery faithful to decoded numbers; zero change to existing replays; bounded perf with hundreds of live shells.
Non-Goals: rage skills (Hail, BurningEarth), shield absorb (5.4, not in scope list), Air/Ground location types, trolley as target (out of scope, deferred by owner), persistent beams/fire zones, redesigning tower.

## Requirements
**Rules (GAME_RULES, written first)**
- `PRJ-01` lifecycle: launch (phase 7c / 7b-for-06/07 shooters), in flight (inert, hashed), impact (7a at `tick >= impactTick`, ascending `(impactTick, id)`), removal. Impact tick `>= launch+1`, so a shell never lands on its launch tick.
- `PRJ-02` aim modes: `point` (fixed x,z milli; used by rocket tower), `troop` (aims at target's analytic position **at impact tick**; blast is area so a miss by drift is allowed), `entity` (direct-hit on building/troop id; fizzles if dead or captured-away at impact).
- `PRJ-03` blast: closed disc, integer `dx^2+dz^2 <= r^2` in milli-units (reuse `compareRadiusSq`; footprint-aware for buildings as in `shoots`). Hits **enemy-of-owner** targets only (owner check; neutrals are enemies of everyone, matching tower neutral-house rule R-TWR-02). Order inside one impact: troops by `(channelKey, seq)`, then buildings, then elements by index. Damage to troop = `damage` (default shooter hp at launch, frozen in the row); `hp -= damage`, remove at `<= 0` via `killTroop(cause:'blast')`.
- `ART-01..03` cadence, targeting, effect (below). `damage`, `radius`, `speed`, `firstDelay`, `cooldown`, `detect` are content params.
**Content/defs**
- New registry `projectile` (def: `aim`, `speed`, `blastRadius`, `damageMode: 'shooter-hp'|'fixed'`, `hits: ('troop'|'building'|'element')[]`, `visual`). `artillery-shell`: speed 9.5, blast 1.0 [decomp §5.9].
- Unit schema gains optional `modules: { ranged: {...} }`; `ranged` params: `detectRadius 4.0, firstDelay 0.4, cooldown 1.2, projectile: 'artillery-shell'`. Unit `artillery`: speed 5 (TW default; (Risk 2)), hp/atk/def 1/1/1.
- `house-wt3.json`: clone of wt1 (grows, spawns) with `spawns.unit = artillery`; params per decoded WT3 `ws/cwc/sc` (Risk 3).
**Sim**: ring gains `rangedCd` column (artillery-only meaningful), hashed in channel digest; new columns (`id, def, owner, srcKind, src, aim, tx, tz, targetId, launchTick, impactTick, damage`) in a fixed-capacity store; capacity overflow = deterministic drop of the **launch** (counter `projDropped`, invariant test) not UB.
**Importer**: flip WT3 row; select >=10 TW-pool levels (Common 24-340) featuring artillery house WT3 per README Curation rules (candidates and metrics from SP01 pool tool; the first selected level introduces artillery house WT3 with no other new element; spread across later positions; prefer proxy-solvable, allowlist only if no equal-feature alternative); import only those; show the coverage line in the PR (`artillery house WT3: n levels, first at display N`). Selection is provisional; SP09 finalizes order and numbering. Unsolvable-by-proxy -> `tools/unsolved-by-proxy.json`.
**Web**: artillery + house-wt3 models from TW; shell sprite/mesh pooled in `fx-pool` (instanced, interpolated from `(launch, impact)`), blast ring fx on `ProjectileImpact`.

## Architecture
- **Base derivation (D7).** SP04 owns `projectile-base` (aim path, speed, blast, damage mode, hits); `artillery-shell` `extends` it, and SP06 rocket / capture shot derive from the same base. `house-wt3` `extends` the house base (`house-wt2`/`building-base` + modules), the artillery unit `extends` `unit-base` plus the `ranged` module. Data-driven archetypes + modules, no TS class hierarchy; `extends` from SP02 Task 2a.
- **Projectile store** `packages/sim/src/projectiles.ts`: struct-of-arrays, kept sorted by append order (ids monotone), impact scan = linear over live rows (cap 512; typical < 50) so no heap/ordering hazards. `launch(state, spec)` and `resolveImpacts(state)` are the **only** consumer API; module files (06/07) call `launch` from their own phase and never touch the store. Pure integers; travel `ceil(distMilli*1000 / speedMilliPerSec) * tickRate` via `idiv`, `checked` math as in `shoots.ts`.
- **Tick placement**: phase 7 becomes `7a impacts -> 7b tower shots -> 7c ranged launches`. Phase numbers unchanged (SP02 rule 3: stable numbers). SP02's element pass is phase 6, so elements are settled before blasts hit them; a mine triggered this tick (2-tick delayed kill) still resolves via its own timer. Arrivals (8) after blasts: a troop killed by a shell on its arrival tick does not arrive. [design; ordering unverified vs TW, OPEN 5]
- **Artillery fire (7c)**: the ring is scanned only on channels where `ranged` units exist (per-channel `rangedCount` kept by spawn/removal) -> O(rangedTroops x enemyTroopsInCandidateChannels). Detect = Euclidean distance from artillery position to enemy troop position <= 4.0 (milli, integer sq compare), plus buildings/towers/fortresses of enemies per `_canAttackTypes` (Risk 6). Per volley: one shell per qualifying target, closest first, ties `(owner, seq)`. `rangedCd` decrements 50 ms/tick; fires at `<= 0`; reset to 1200 ms only if >= 1 shell launched (else stays 0 = ready next tick). [decomp: Attack/CooldownTick]
- **Troop-target vs blast overlap**: two shells aimed at neighbouring troops both damage both; overkill is allowed (matches area semantics); friendly fire never.
- **kill(seq)**: `killTroop(state, channel, seq, cause)` already removes mid-ring by seq via `indexOfSeq` and decrements `alive` [verified: `state.ts`]. No tombstones needed; `KillCause` gains `'blast'`. Research's tombstone worry (gap-map §3) is moot with this ring.
- **Determinism/perf**: no floats, no RNG, no iteration over `Map` insertion order outside sorted keys; store snapshot/hash added to `hash.ts` after elements. Bench `bench:sim` with a synthetic 40-artillery level; budget: < 5% tick-time regression on the existing 20 levels (no WT3 -> early-out when store empty and `rangedCount==0`).
- **Tower**: unchanged. `shoots` keeps instant kill; optional later migration is a **major** bump (timing changes) and is deferred.
- **Bots**: `bots` read only building level/owner and lines; WT3 houses behave like WT1 for target scoring. Artillery makes proxy/AI more lossy but no logic changes. `BOT_VERSION` stays 2.5.0 unless calibration (task) shows the exact-TW AI weights `warriorType` (OPEN 4).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Impact time | Integer tick fixed at launch | Per-tick sim motion | Matches analytic ring; no float drift; cheap hash |
| 2 | Troop aim | Position at impact tick (analytic) | Live homing | Deterministic, area blast hides drift |
| 3 | Tower | Leave instant | Migrate to core now | Zero replay risk; major bump not justified |
| 4 | Phase slot | Sub-steps of phase 7 | New phase / phase 6 | Stable numbering (SP02 precedent) |
| 5 | Damage | Shooter hp frozen at launch, `hp -= dmg` | Always kill | Matches `unique[Warrior]=current HP` [decomp §5.9]; tank (hp 2) survives a 1-hp shell |
| 6 | Ring | New `rangedCd` column | Side table keyed by seq | One lookup, hashed with ring |
| 7 | Overflow | Drop launch + counter | Grow arrays | Fixed memory, deterministic |
| 8 | Version | RULES 3.3.0 (minor) | Major | No shipped level has WT3 |

## Manual steps
- Owner-only: none. Needs TW extract for house-wt3/artillery model copy (`TW_EXTRACT`); record if missing.
- Calibration vs. a TW playthrough ref of position 45 (owner approval at end).

## Risks / Open Questions
- [RESOLVED 1: decode spike first (task: decomp WarriorArtilleryController via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: keeps walking (no movement lock) and record it as a deviation in GAME_RULES + the deviations ledger] Artillery stop-vs-walk. Spike: `WarriorArtilleryController`.
- [RESOLVED 2: decode spike first (task: decomp WarriorArtilleryController via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: speed 5 = soldier and record it as a deviation in GAME_RULES + the deviations ledger] Artillery speed/maxSpeed vs soldier.
- [RESOLVED 3: decode spike first (task: decomp house/level WT3 params via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: read ws/cwc/sc/gl from imported WT3 level params; if uniform, clone wt1 values and record it as a deviation in GAME_RULES + the deviations ledger] WT3 house `ws/cwc/sc/gl` deltas vs WT1.
- [RESOLVED 4: decode spike first (task: decomp AI target-scoring class via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: no TW difference, WT3 scored like WT1, `BOT_VERSION` stays 2.5.0; bump to 2.6.0 only if the spike shows a difference and record it as a deviation in GAME_RULES + the deviations ledger] Does TW AI treat WT3 differently? Spike: AI target scoring.
- [RESOLVED 5: decode spike first (task: decomp WarriorArtilleryController via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: ordering 7a impacts -> 7b tower shots -> 7c launches -> 8 arrivals as designed, calibrate on ref screenshots and record it as a deviation in GAME_RULES + the deviations ledger] Impact-vs-arrival and clash ordering.
- [RESOLVED 6: decode spike first (task: decomp WarriorArtilleryController / shell damage via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: troops only in SP04; building/tower targeting behind param `hits`, default off; if enabled, damage = level -1 like tower and record it as a deviation in GAME_RULES + the deviations ledger] Buildings as shell targets (damage amount, which targets).
- [RESOLVED 7: decode spike first (task: decomp WarriorArtilleryController via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: every target per volley, param `volleyAll=true` (switch to nearest-only if spike says so) and record it as a deviation in GAME_RULES + the deviations ledger] "Every target per volley".
- [RESOLVED: locked decision] Rage variants (Hail, BurningEarth) out of scope.
- [DEFERRED] Visible tower cannonball using the same render path; tower migration; shield absorb.
- Risk: levels with large artillery counts make levels unwinnable by proxy -> list in `unsolved-by-proxy.json`.

## Acceptance Criteria
- GAME_RULES `PRJ-*`, `ART-*` with `covers R-...` tests; changelog 3.3.0; `RULES_VERSION` bumped; `check:rules` green.
- Unit tests: impact tick math; blast boundary (r and r+1 milli); owner filter; entity fizzle; mid-ring kill with `alive` consistency; overflow drop; snapshot/hash roundtrip; cadence 0.4/1.2 s.
- Existing 20 level locks, `sim:golden`, `replay:verify`, `bots:golden` unchanged (asserted).
- `house-wt3` row is `map`; >=10 selected WT3 levels imported, locks refreshed, coverage line in PR; `validate:levels` green.
- Web: artillery + shell + blast visible in `campaign:verify` for position 45; 60 fps with 100 live shells (bench note).
- `pnpm run ci` green.
