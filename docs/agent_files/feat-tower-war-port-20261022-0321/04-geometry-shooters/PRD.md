---
status: draft
summary: Geometry + shooters for the Tower War port - exact corridor blocking (obstacles, third buildings), swept lane-vs-lane crossing combat, the shooting tower (lane-space targeting, instakill, house hit), and one lane-interval primitive reused as the seam for walls/mines/rivers. Decomp-verified where cheap; unknowns left [OPEN].
date: 2026-10-22
---
# PRD: Geometry + shooters (SP04)

Repo/branch: node-arena · feat/tower-war-port · Depends on: 03 (seams: `modules/{shoots,blocksLines}.ts`, `contacts.ts#crossingPass`, `onLineDrawn/onLineCut`, `killTroop`, `shoots.cooldown`), 02 (footprint schema, `shoots` params), 01 (CMB-04, TWR-*, OBS-* text) · Feeds: 05 (footprint/obstacle-size contract), 06 (`canDraw` incl. third tower), 07 (`TowerShot`/`Clash` render fields), 08 (`explainDraw`), 09 (goldens, bench)
Owns: `packages/sim/src/{geometry,crossings}.ts` (new), `modules/{shoots,blocksLines}.ts`, the **body** of `contacts.ts#crossingPass`, `packages/sim/test/{crossing,tower,obstacles}.test.*`, `test/golden/scenarios-geometry.ts` (appended to 03's `run.ts` scenario-list array; 04 also wires its bench scenario), footprint **values** in `packages/content/data/{buildings,elements}` (02 ships schema + placeholder; 04's single commit edits values + bumps content version), `towerRadiusMilli(view,i)` export on `sim`, tests tagged `covers R-CMB-04 / R-TWR-* / R-OBS-*`.
Does not own: rule text (01; amendment requests below), schemas/loader (02), sim core/ring/`killTroop` internals (03), importer placement (05), bots (06), render (07), web (08), CI wiring (09).

## TL;DR
- One primitive, `geometry.ts`: **lane ∩ shape → integer arc-length intervals** (milli-units, same unit as troop progress). Corridor blocking, tower range, and lane-vs-lane contact windows are all instances. (A `CrossingSource` seam for walls/mines/rivers is NOT built here; it is a note in `docs/FUTURES.md`, S1.)
- Blocking is static: precompute `blocked[pair]` at `create` (exact SAT in BigInt, cold path; BigInt only at `create`, per-tick math is in Numbers, N5). `canDraw` stays `code|null`; new `explainDraw` returns `{reason, point}` for 08's red preview.
- CMB-04 generalises "crossing" to **interaction windows** (quadratic distance form in lane coordinates, Q20 cosine), so near-parallel lanes within 0.7 also fight. Per tick: FIFO-range prefilter, exact swept (continuous-in-tick) test in Numbers, then shared CMB-05 exchange.
- Tower: precomputed annulus intervals per (tower, lane, stage); nearest hostile by exact lane-space d² (`(p-proj)²+perp²`); delay set at fire time; kills via `killTroop(cause:'tower')`.
- Decomp verification done (table below). Two findings contradict SP01 provisionals: neutral towers (code has **no owner gate**) and detection range (trigger overlap = radius + body). Both are content flags: `troopPad` default 350 (decomp-trusted, owner locked "trust decompiled code on contradictions"); `neutralFires` default **true** (decomp-trusted; [RESOLVED: owner — neutral towers fire]; still a content flag).

## Problem
03 ships stubs only. Today lines cross freely and do nothing, nothing blocks a line, nothing shoots. 20-level campaign: 12 tower levels, most levels have obstacles [verified: 05 scan, `campaign_order.tsv`]. Ring is front-only (fixed by 03 `killTroop`); contact/range geometry is unspecified in float-free form; `check:rules` stays red until CMB-04/TWR/OBS are tagged (01 R9).

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Rules CMB-04, TWR-01..04, OBS-01..02 implemented, tagged, golden-tested | Walls, mines, rivers, gates, rocket/fortress/capture-rocket towers (seam only) |
| Integer, deterministic, snapshot-rebuildable derived state; no `Math.sqrt/round` | Bullet flight as sim state (visual only; see D9) |
| Emit only events whose payloads 03's CUT defines (B6); use 03's exported `exchange()` | Defining/owning event payload types (03 `defs` EVENTS) |
| `canDraw` blocked reasons + `explainDraw` point | Draw-mode polylines (straight lanes only) |
| Decomp-verify the 4 open geometry facts; record evidence | Changing rule text (requests only) |

## Decomp verification (SP04 task 0, done in this PRD; `_extract/decomp`, `catalog/prefab_parts_assets.json`)
| Question | Finding | Evidence | Confidence |
|---|---|---|---|
| Which collider blocks lines | Only **`Building`** box (layer 19). `Hit`=18, `Selecable`=6. Human path: `PathPhysics` trigger fills `_obstaclesInWay` (obstacle layer, +0x30) / `_buildingsInWay` (building layer, +0x28); `CheckBlock` blocks on **any** obstacle contact, or any building collider that is not `IsBelong` start/end | `WayBaseController/{OnTriggerEnter,CheckBlock}.c`, `Building/IsBelong.c`, `LayerMaskContainer_920` bits 524288/1024, dump 165290 offsets; hierarchy layers of `House_Default`, `Tower` | high |
| Building footprint size | `Building` box 1.5 x 1.5 (scale 1, no yaw in level data: buildings have no rotation key) -> AABB half 750 milli | prefab scales 1.0; 1.5 from 03#5.5 prefab data (BoxCollider sizes not re-exported here) | medium (size), high (identity) |
| AI path agrees | `CheckCreateWayCondition`: `BoxCastAll(start WayPosition, halfExtents boxHalfSize 0.19/0.3/0.19, dir, mask building+obstacle)`; hit not on building layer -> false; building hit whose parent is neither start nor target -> false | `AiPlayerController/CheckCreateWayCondition.c` | high |
| Corridor half-width | 0.19 (box 0.38 wide) | `boxHalfSize`; `PathPhysics._defaultSize (0.38,1,0.30)` | high |
| Obstacle collider size | Per child `BoxCollider` on layer 10 with child local scale 0.6-1.19 (sample prefab); **box sizes not exported**; level data gives child positions + yaw only | `Obstacle` hierarchy, `prefab_parts_assets.json`, 02-levels 3.6 | **unknown** -> [OPEN] |
| Tower order troops vs houses | `_canAttackTypes` pre-populated dictionary [98 Warrior, 10 Trolley, 0 House]; `AddTarget` uses `get_Item` (key must pre-exist) so iteration order is fixed config order; `Update` sorts each non-empty group by distance and stops at the first group that fires | `Tower/Update.c`, `DetectAndGroupedDamageableTrigger/AddTarget.c` | medium-high |
| Troop filter | `minRadius` skip is centre distance `<= minRadius` (field +0x124 = 1.0); target must pass `CheckIfAvailableToDoDamage(owner)` = hp>0 and owner != tower owner | `Tower/TryAttackWarrior.c`, `WarriorBase/CheckIfAvailableToDoDamage.c` | high |
| House filter | `Building.CheckIfAvailableToDoDamage`: not destroyed, **level >= 1**, owner != attacker. Only `House`/`TrolleyBuilding` class instances are shot (type-hierarchy test): **towers are not targets**. Neutral-owner skip lives in a lambda (`TryAttackSelectableHouses_b__32_x`) that is not decompiled; [RESOLVED: owner — towers hit neutral houses] | `Building/CheckIfAvailableToDoDamage.c`, `Tower/TryAttackSelectableHouses.c` | medium; neutral part settled by owner |
| Neutral towers fire? | **No owner gate** found in `Update`/`TryAttackWarrior`/`OnLevelStateChanged` (owner type only toggles the radius indicator GameObject). Code reading says a neutral tower shoots every non-neutral troop. Contradicted SP01 "inert" (basis: tutorial text only); owner confirmed the code reading. L4 (`LevelView 1`) has a neutral level-5 tower | same files + `campaign_rows.json` | code 70%; owner confirmed fire -> [RESOLVED: owner — neutral towers fire] |
| Cooldown | `_canAttack=false`, `WaitForSeconds(curAttackDelay)` then true; first ready = one delay after level start; `curAttackDelay` read at shot time; not reset by `SetNewOwner`/level change; ready tower with no target waits ready | `Tower/{Update,StartObserveEnemy,OnLevelStateChanged,CalculateAttackDelay,SetNewOwner}.c` | high |
| Delay formula | `1.75*60/(2.0*L+60)` s, L=1 -> 1.69 s = 33,870 mt; SP01 TWR-01 integer form matches | `CalculateAttackDelay.c` | high |
| Detection range | Trigger sphere (`TowerRadius`, r=2.4 x scale) overlaps target colliders: effective reach = radius + body (troop sphere 0.35). No further upper-bound test | `TryAttackWarrior.c` (only lower bound), prefab | medium -> [OPEN] |
| Unit-vs-unit contact | Body spheres r 0.35 each -> centre distance 0.7 = `balance.contactDistance` | 03#14 prefab | high |
| Tower hits house | `TryDoDamageFromProjectile`: `level = max(0, level-1)`, never captures (03#5.3) | research | high |

## Requirements
**R1 Geometry primitive** (`geometry.ts`, pure, integer; BigInt **only at `create`** for SAT/window precompute (cold path); the per-tick narrow phase runs in Numbers: coordinates are milli ints < ~5e4, `s*u` < 2^31 and Q20 products < 2^53, so Number math with the existing `mulDiv` range-check is exact; a debug assertion checks every per-tick intermediate < 2^53; a BigInt oracle lives in tests only):
- Units: milli (fx3). Lane = segment `A->B`, `len` from 03 (symmetric `isqrt`), progress `s in [0,len]`.
- `laneIntervals(lane, shape, pad)` -> sorted disjoint `[s0,s1]` where lane centre line is within `pad` of `shape` (circle, AABB, yawed box). Used by R2 (pad=corridor) and R4 (disc/annulus). This is the only shared primitive kept for later walls/mines/rivers.
- `perpSq(lane, point)` / `proj(lane, point)` for exact `d^2 = (s-proj)^2 + perp^2`.

**R2 Line validity (OBS-01/02)**
- At `create`, for every unordered pair compute reason `none | blocked-obstacle | blocked-building`: corridor OBB (half-width 190, along-axis extended by 190 each end, swept box) vs every `blocksLines` element footprint, and every building footprint except the two endpoints. **Any obstacle overlap blocks even at an endpoint** (decomp). Touching is not overlap (strict). Result is level-constant; lanes are never re-checked.
- `blocksLines.validateDraw` returns the code; nearest-to-source blocker wins the reason. Plugs into 03 R4 order after `no-slot`. Third **tower** blocks like a third house (06 relies on it).
- `sim.explainDraw(player,from,to) -> {reason, point:{x,z} milli, ref}|null` = lane point at first blocking interval start. 08 preview uses it; bots use `canDraw` only.
- Obstacles: static, unowned, not win participants, no troop interaction (OBS-02).

**R3 Lane crossings, CMB-04** (`crossings.ts`, `contacts.ts#crossingPass`)
- Per ordered lane pair (different roads), geometry is static; memoised on first need. Distance between troop at `s` on A and `u` on B is `f(s,u) = s^2 + u^2 - 2c*s*u + 2kA*s - 2kB*u + k0`, with `c` (Q20 cosine), `kA,kB,k0` from lane origins/directions, all precomputed in BigInt at `create` (cold). Pairs whose minimum segment distance `> contact` are dropped. Surviving pairs store the bounding window `[sLo,sHi] x [uLo,uHi]` of `f <= contact^2`, clipped to the lanes.
- Active list rebuilt incrementally in `onLineDrawn/onLineCut` and fully from `drawn` columns on snapshot restore (derived, **not hashed**).
- Per tick (after head-on, same phase 6): for each active hostile pair (owners differ at tick time) in ascending `(channelKeyA, channelKeyB)`: troops of each lane inside window +/- max per-tick move (contiguous FIFO range, early exit); candidate pairs in `(seqA, seqB)` order; exact swept test (min over the tick of the quadratic `<= contact^2`, positions at tick-1 and tick from `p0,t0,speed`); contact -> shared `exchange(state, chA,seqA, chB,seqB)` (CMB-05, exported by 03; 04 does not reimplement it). Dead troops are skipped; survivors continue in the same pass. Same-owner lanes never fight. Head-on stays 03's special case (equivalent to `c=-1`).
- Shared endpoints are ordinary crossings (a defender's fresh spawn vs an arriving attacker fights if within 0.7).
- Event (payload defined by 03's CUT in `defs` EVENTS, 04 only emits): `Clash{kind:'headon'|'crossing', a:{channel,seq,owner}, b:{channel,seq,owner}, x, z}` (milli). Deaths emit `TroopDied{channel,seq,owner,kind,cause:'clash'|'capture'|'tower',x,z}` via `killTroop`.

**R4 Tower (TWR-01..04)** (`modules/shoots.ts`)
- Params from `shoots` + `balance.stageThresholds`: radius by stage, delay by level (SP01 integer forms), `minRadius`, plus content flags `neutralFires` (default **true**, [RESOLVED: owner — neutral towers fire]), `troopPad` (default **350**, decomp-trusted: trigger reach = radius + troop body 0.35), `hitsNeutralHouses` (default **true**, [RESOLVED: owner — towers hit neutral houses]). All three are content flags (02 R3), flip = content version bump.
- Cache per (tower, lane, stage): annulus intervals (`laneIntervals` with outer `radius+troopPad`, minus `minRadius` disc), `proj`, `perp^2`. Invalidated by stage change only (level crossing 10/30) and rebuilt from state on restore.
- Phase 7 order = building idx. Cooldown column `shoots.cooldown` (mt, hashed): starts at `delayMt(L0)`; `-1000/tick` floor 0. Ready + (`neutralFires` (default true) or owner non-neutral): pick **nearest hostile troop** (min `d^2`, ties owner idx, then seq) among troops whose progress lies in an interval; else nearest hostile house with `level >= 1` (neutral houses included when `hitsNeutralHouses`, default true; towers never targeted). Fire: set cooldown to `delayMt(L_now)`.
- Troop: `killTroop(channel,seq,'tower')` (any hp). House: `level = max(0, level-1)`, never captures; stage drop never auto-cuts (LIN-02). One shot per cooldown; ready tower with no target stays ready.
- Cooldown, radius cache survive capture (03 leaves `shoots.cooldown` untouched on capture).
- Event (shape fixed by 03's CUT): `TowerShot{tower, target:{kind:'troop'|'house', channel?, seq?, building?}, x, z}`; `x,z` = target position at fire tick (troop already removed). Bullet flight is render-only (07 uses `bulletSpeed`). `sim.towerRadiusMilli(view,i)` exported for 07's range ring (radius by stage; formula lives here).

**R5 Lane-crossing seam**: dropped from scope (S1). `CrossingSource` (walls/mines/rivers) is unspecified in TW behaviour and will not survive real wall/mine semantics; recorded as a note in the `docs/FUTURES.md` plan (09 appends). Only the shared `laneIntervals` primitive stays in code and acceptance.

**R6 Content values (SP04 authors)**: building footprint = `box` 1500 x 1500 (02 allows `circle|box` on both archetype kinds); obstacle footprints are **read from 05's `tools/src/import-tw/prefab/colliders.json`** (05 Task 0 UnityPy dump: `BoxCollider.m_Size/m_Center` + child local scale/yaw for `Obstacle.prefab` children and the `Building` collider; 05 emits per-child obstacle footprints = box + yaw, plus `variant`). Fallback only if the dump proves impossible within a day: circle radius 450 + calibration against ref screenshots, recorded as a known deviation in LEVELS_GUIDE; `laneHalfWidth` 190; `contactDistance` 700 (all existing 01/02 params).

**R7 Tests/goldens** (non-skipped, tagged): see Acceptance.

## Architecture
```
geometry.ts: laneIntervals / perpSq / proj / SAT (pure)
   |-> modules/blocksLines.ts   create: blocked[pair]; validateDraw; explainDraw
   |-> crossings.ts             pair windows (memo), active list <- onLineDrawn/onLineCut/restore;  sweepCrossed (seam)
   |        `-> contacts.ts#crossingPass (phase 6)  -> exchange() [03]  -> killTroop [03]
   `-> modules/shoots.ts        annulus cache per stage; phase 7; cooldown column
```
Derived caches never enter the hash; state hashed = `shoots.cooldown` + troop columns already in 03.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Blocking timing | Precompute pair matrix at `create` | Test per `canDraw` | Geometry is static; bots call `canDraw` often; exact BigInt cost is paid once |
| 2 | Corridor shape | Exact oriented-rect vs AABB/circle SAT | Inflate-and-segment approximation | Must match BoxCast oracle; approximation over-blocks corners |
| 3 | `canDraw` signature | Unchanged `code\|null`; add `explainDraw` | Return object, or `blockPoint` in `canDraw` | Bots/06 stay trivial; resolves 08 [OPEN] |
| 4 | Crossing model | Quadratic interaction windows | Intersection point only | Intersection-only misses near-parallel lanes inside 0.7; same cost class |
| 5 | Contact test | Exact swept-in-tick, BigInt narrow phase | Per-tick position check | Tank closing 0.75/tick > 0.7 tunnels (01 risk); matches oracle |
| 6 | Crossing order | Pair `(keyA,keyB)`, then `(seqA,seqB)`; survivors continue | Contact-time sort inside tick | Total order, cheap; matches 01 CMB-04 |
| 7 | Tower target scan | Lane-space `(s-proj)^2+perp^2` over interval range | World-space distance per troop | Exact in int, no sqrt, skips lanes out of range |
| 8 | Priority | Troops, then houses (dictionary order) | Houses first | Decomp group order is fixed config order |
| 9 | Bullet | Instant kill at fire tick | Pending-shot state with travel delay (`d/bs` <= 0.68 s) | SP01 TWR-03; avoids new hashed state; deviation logged to FUTURES |
| 10 | Neutral/pad flags | Content flags: `troopPad`=350 (decomp-trusted), `neutralFires`=true ([RESOLVED: owner — neutral towers fire]) | Hard-code decomp reading | Trigger reach evidence is decomp (medium); neutral evidence is absence-of-gate in a partly decompiled lambda, owner confirmed fire; flag kept so a flip is data-only (content version bump) |
| 11 | Seam | Only shared `laneIntervals` primitive; `CrossingSource` dropped to FUTURES (S1) | Build `CrossingSource` now | Unbuilt and unspecified in TW behaviour; will not survive real wall/mine semantics |

## Manual steps
- None (neutral-tower firing and neutral-house targeting settled by owner).

## Risks
| Risk | Mitigation |
|---|---|
| Obstacle sizes wrong (blocks too much/little) | values from 05's `colliders.json` dump; if dump fails, circle 450 + calibration vs ref screenshots (07/08), logged as deviation in LEVELS_GUIDE; overlap warning stays warning (02) |
| Per-tick narrow phase misses 0.3 ms budget at stress | prefilter by window + FIFO range; Numbers-only per tick (BigInt only at `create`); bench scenario with 40 hostile crossing pairs |
| Pad wrong changes level difficulty (neutral towers fire: owner-confirmed, L4 neutral level-5 tower shoots passers) | flags + goldens per setting; owner check on `troopPad` |
| Restore drift in derived caches | rebuild-from-`drawn` test (snapshot mid-fight == straight run hash) |
| 03 seam drift (`exchange`, `killTroop` names) | listed as dependencies; acceptance tests import only those |

## Open Questions
- [RESOLVED: 05 Task 0 produces `colliders.json` (UnityPy dump of obstacle child `BoxCollider` size/center/scale/yaw + `Building` collider); 04 reads values from it. Fallback circle 450 + calibration if the dump fails within a day, recorded as deviation in LEVELS_GUIDE]
- [RESOLVED: owner — neutral towers fire] Q1: decomp has no owner gate; owner confirmed. `neutralFires` default `true` (content flag; flip = content version bump). 01 TWR-04 carries the flag wording.
- [RESOLVED: detection range = radius + troop body; `troopPad` default 350 (decomp-trusted), content flag; 01 TWR-02 carries it]
- [RESOLVED: owner — towers hit neutral houses] Tower vs neutral houses: `hitsNeutralHouses` default true.
- [RESOLVED: Building box size comes from 05 Task 0 `colliders.json` (Building collider); 1.5 is the placeholder until then]
- [OPEN] Fidelity of endpoint contacts (attacker vs spawn at defender) and arrival at centre vs `Hit` box; shared with 03 arrival semantics.
- [RESOLVED: troops before houses; basis fixed `_canAttackTypes` dictionary order]
- [RESOLVED: towers are not tower targets; basis House/Trolley class test (medium)]
- [RESOLVED: Building box is the sole line-blocking collider; endpoints exempt, obstacles never exempt]
- [DEFERRED] Bullet travel delay; walls/mines/rivers/gates; non-straight lanes; fortress/rocket towers.
- [RESOLVED: amendments are applied in 01 (OBS-01, TWR-02 incl. `troopPad`, TWR-04 `neutralFires`, CMB-04 channel-pair-key order + interaction window, tower cooldown exempt from per-tick recompute) and 02 (`box` footprint on both archetype kinds, `shoots.{neutralFires,troopPad,hitsNeutralHouses}`); 03 CUT exports `exchange()` and defines `Clash`/`TroopDied`/`TowerShot` payloads, 04 only emits]

## Acceptance Criteria
- `check:rules` green for CMB-04, TWR-01..04, OBS-01..02 (each has a non-skipped `covers` test).
- OBS: 500-case fuzz vs an independent float OBB reference (tests only) agrees; tangent not blocked; endpoint building exempt, third tower/house blocks, obstacle at endpoint blocks; `explainDraw` point inside first blocker; `canDraw`==`null` iff DrawLine accepts.
- CMB-04: scenarios - X-cross soldier/soldier (both die), tank vs soldier (hp 2->1), fast tank vs tank (closing > 0.7/tick, no tunnelling), near-parallel lanes at 0.5, same-owner no fight, three-lane ordering, cut/capture mid-fight, snapshot restore mid-fight. Brute-force per-tick oracle (all troop pairs, exact swept) matches on 50 seeds.
- TWR: delay L=1/10/30/64 exact mt (33,870 at L=1); radius change at levels 10/30; minRadius; nearest + tie order; tank dies; middle-of-lane kill keeps FIFO/`alive`/conservation; house -1 floor 0 no capture, `level>=1` only; cooldown persists capture; ready-without-target; neutral tower shoots non-neutral troops by default (golden); flags both settings (`troopPad` 0/350, `neutralFires` true/false, `hitsNeutralHouses` true/false); default tower shoots a neutral house (golden).
- Per-tick narrow phase uses Numbers only with debug assert < 2^53; BigInt oracle in tests agrees. Event on/off hash parity; events match 03's payload types (`Clash`, `TroopDied`, `TowerShot`) exactly; `sim:golden` regenerated incl. `scenarios-geometry.ts`; `bench:sim` within budgets with added crossing/tower scenario (720 troops, 40 hostile crossings, 3 towers).
- No `Math.sqrt/round`/floats in `packages/sim/src` (lint determinism preset).
