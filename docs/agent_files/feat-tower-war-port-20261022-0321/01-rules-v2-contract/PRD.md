---
status: draft
summary: Rewrite docs/GAME_RULES.md as the Tower War rules contract v2.0.0 - 38 active rule ids over 11 areas, every formula pinned to integer 20 Hz milli-tick math, doc contradictions settled with decomp evidence.
date: 2026-10-22
---
# PRD: Rules v2 contract (SP01)

Repo/branch: node-arena · feat/tower-war-port · Depends on: none (Phase 1; every later SP codes against these ids)
Owns: `docs/GAME_RULES.md` (full rewrite); the two version strings that must equal its header (`RULES_VERSION` in `packages/content/src/versioning.ts`, `rulesVersion` in content metadata) so `checkRulesVersion` stays green.
Does not own: content schemas/values (SP02), sim code + sim tests (SP03/SP04), bot code (SP06), tests tagged `covers R-` (owners below), research docs.

## TL;DR
- `GAME_RULES.md` becomes the Tower War (APK 1.29.3) mechanics contract, `RULES_VERSION: 2.0.0`. No profiles, no v1 compat. 38 active ids, 5 tombstones.
- Rules own **structure and formulas**; every TW number (5 u/s, 0.5, 0.3, 1.7, 10/30, 30 cap, 0.9, 2.4...) lives in content under a named param. Rules only name resolved params.
- All float formulas become **integer rationals over milli-ticks** (1 tick = 1000 mt), recomputed every tick, remainder carried. 20 Hz + lazy analytic movement stays [verified: 06 §1 F1/F7; `math.ts` Sfc32/isqrt].
- Decomp-backed settlements: surplus lines **kept** (no auto-cut), capture **kills the old owner's troops**, overshoot **discarded**, overflow **forwarded**, towers: radius by stage, delay by level.
- New rule areas: SPN spawn, GRW growth, TWR tower, OBS obstacles. Boosters (bomb, speed) are deferred, not in v2.0.0 (R11). Retired: GEN, SND, v1 CAP-02, draw outcome, line auto-cut, time-limit-as-default.
- Extension convention: reserved-module table (no `R-` headings until shipped); new element = new area + minor bump + phase anchor.

## Problem
v1 rules are a different game: round-robin shared generation, strict slots with auto-cut, leftover value captures, in-flight troops survive capture, elimination by troops-in-transit, draw outcome, 300 s timer. None can express TW production (per-line timers, growth only at zero lines), tank HP/attack, shooters or blocking. SP02-SP09 need stable ids and unambiguous numbers before coding; research docs contradict each other in six places (README).

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Contract for exactly the 20 levels: houses WT1/WT2, shooting tower, obstacles, scripted-AI-facing commands (DrawLine, CutLine) | Walls, mines, rivers, rockets, fortress, trolley, railway, cargo, flags (reserved table only); bomb + speed boosters (deferred, R11) |
| Every formula integer-exact with rounding + tie order stated | Any code, content values, test edits (beyond the 2 version strings) |
| Each rule: statement, source cite, content-param home | Meta: currencies, upgrades, skins, power scaling |
| Extension conventions so a new element needs rule section + registry entry + phase anchor, not a rewrite | Double-unit/shield RNG (default skins = 0%) |

## Requirements
**R1 Document shape** (v1 house style kept so `tools/src/rules.ts` works unchanged): §1 conventions, §2 entities, §3 rules by area, §4 phase table, §5 worked examples (`E-...`), §6 reserved modules, §7 param glossary (rule param -> content key, no values), §8 changelog. Heading `### R-AREA-NN`; each rule: statement, `Params:`, `Examples:`, `Since: 2.0.0`, optional `Supersedes:`. `RULES_VERSION: 2.0.0` line exactly (regex in `versioning.ts`).

**R2 Terms.** *Building* (kinds `house`, `tower`), *building level* (vs *campaign level*), *line* (v1 channel), *troop* (types `soldier`, `tank`; artillery reserved), *stage* = 1/2/3 at level <10 / 10-29 / >=30 (content `stageThresholds [10,30]`).

**R3 Translation rules (TCK-06, normative).** Timer value in mt; each eligible tick `timer += 1000`; fire when `timer >= period(tick)`; `timer -= period`; <=1 fire/tick/timer; period clamped >= 1000. `period` is recomputed from current integer inputs every tick with floor division, multiply before divide, intermediates range-checked < 2^53 (TCK-02). Because the timer is compared to the *current* period, a mid-interval change (line added) behaves as in TW (`timer >= SpawnWarriorTime`) [verified: 03#4.1 UpdateSpawnTimer]. Feel impact: events land on tick edges (mean +25 ms, max +50 ms, never accumulates because remainder is carried to 1/1000 tick); intervals 13-40 ticks so quantisation <=8%; independent timers tie-break by index instead of float race (unavoidable divergence from TW, invisible). **Exemption (tower cooldown, TWR-01/02):** the tower cooldown is NOT recomputed per tick; it is set once at fire time from the tower's *current level* (`cooldown = delay mt(L at fire)`; decomp `WaitForSeconds(curAttackDelay)`), then counts down `-1000`/tick and the tower is ready at `<= 0`. Level changes while cooling (growth, hit, capture) do not alter the running cooldown. Spawn and growth timers keep the per-tick recompute.

**R4 Rule inventory.** (`K`=line penalty, `m`=milli-scaled content value, `mt`=milli-ticks)

| Id | Status vs v1 | Statement | Cite | Param home |
|---|---|---|---|---|
| TCK-01 | kept | `tickRate=20`, fixed step, pause/finished | 06 §1 F1 | rules const |
| TCK-02 | kept+ | milli fixed point, integer only, `isqrt`, mul-then-div range-checked | `math.ts` | `numericScale` |
| TCK-03 | rewritten | Iteration orders (players, buildings, lines by source then target, commands by player then submission, troops FIFO + global seq). Named streams `stream(seed,purposeId,entityIdx)` from Sfc32: `fwd`(building); `bot.*` reserved for SP06 (bots are outside sim state). Bounded draw = rejection sampling, unbiased. Draws only in fixed phases ascending index | 06 §1 F1 | replay `seed` |
| TCK-04 | kept+ | progress units `numericScale*tickRate`/world unit; per-tick advance = `speedMilli`; analytic; speed constant per unit type (no mid-flight speed change in 2.0.0) | v1 | `units.*.speed` |
| TCK-05 | rewritten | Phase order (R5) | - | - |
| TCK-06 | new | Timer/period translation (R3) | 06 F7 | - |
| ENT-01 | rewritten | Building: id, pos, owner, level, kind, stage; house = lines+spawn+growth, tower = shooter; both capturable | 03#2,5.5 | `buildings.*` |
| ENT-02 | rewritten | Troop: owner + source building + type fixed at departure; flat `hp/attack/defense` per type (soldier hp/attack/defense 1/1/1, tank 2/2/1); progress on a line | 03#2.3 | `units.*` |
| ENT-03 | kept+ | Line: owner, src->dst, own spawn timer, draw seq; troops FIFO survive cut | v1 | - |
| ENT-04 | kept | Player id=team; human/ai/neutral; same commands, no privileges; every non-self owner hostile (AI vs AI too) | 03#5.2 | - |
| SPN-01 | new | Each owned house line has a timer; period `mt = K_m*1_200_000 / (ws_m*L + 60000)` (floor) with `K_m = 1000 + cwc_m*(n-1)`, `L`=building level, `n`=lines | 03#4.1 | `spawnSpeed`, `lineSpawnPenalty` |
| SPN-02 | new | Fire -> one troop of the house's type departs on that line at progress 0; **free** (level unchanged); skipped (timer still consumed) when live troops from this building >= `aliveCap` | 03#4.2,4.4 | `balance.spawn.aliveCap`=30, `spawns.troop` |
| SPN-03 | new | New line: timer 0 (first troop after a full period). Timer dies with the line. Neutral buildings never spawn | 03#4.1 | - |
| GRW-01 | new | Owned (non-neutral) building with **zero lines**: growth timer; period `mt = idiv((idiv(900_000, isqrt(k*1_000_000)) + 1000) * gl_m, 50)`, `k=idiv(L,10)+1`; fire -> `L=min(L+1,maxLevel)`. Timer persists while lines exist (not reset on start/stop), resets on fire and on capture | 03#4.6, decomp HouseGrowth Start/StopGrowth | `growTime`, `balance.growth.base`=0.9, `maxLevel` |
| GRW-02 | new | Stage function from level and `stageThresholds`; used by slots, tower radius, art | 03#3.2 | `stageThresholds` |
| LIN-01 | rewritten | Draw valid iff: caller owns source; source is a house; target exists, != source; no duplicate; free slot (after reverse replace); not blocked (OBS-01). Atomic reject | 03#3.2 | - |
| LIN-02 | rewritten | `slots = stage`. **No auto-cut** when level drops; `free = slots - lines` may be negative, draw needs `free > 0`. Spawn `K` uses actual line count | decomp SetAvailableWays | `stageThresholds` |
| LIN-03 | kept | Same-owner reverse draw replaces reverse line (troops stay); hostile reverse coexists (head-on) | 03#3.2 | - |
| LIN-04 | rewritten | Straight centre-to-centre lines; free; no length cap; line crossings alone do nothing (combat is CMB-04) | 03#3.3 | - |
| LIN-05 | kept | Human cut stops departures only; in-flight troops continue | 03#3.4 | - |
| CAP-01 | rewritten | Level in [0, maxLevel]. Friendly arrival `L=min(L+defense,maxLevel)` | 03#5.3 | `maxLevel`, `units.*.defense` |
| CAP-02 | **tombstone** | v1 no-bank rule | - | - |
| CAP-03 | new | Surplus from CAP-01 re-enters as one new troop of the arriving type on a uniformly random outgoing line of that building (`fwd` stream, one draw), subject to `aliveCap`; no line or capped -> lost | decomp TrySpawnAdditionalWarrior | - |
| CMB-01 | rewritten | Head-on, same pair: fronts only; fire when `progA+progB >= len - contact*tickRate`; resolve via CMB-05; repeat while new fronts qualify | v1+03#5.2 | `balance.contactDistance`=0.7 |
| CMB-02 | kept | Arrival order: overshoot desc, line order, FIFO; ownership re-evaluated per arrival | v1 | - |
| CMB-03 | rewritten | Hostile arrival deals `attack` (not hp), troop consumed whole. `n = L - attack`; `n<0` -> capture (CPT-01), **overshoot discarded**; else `L=n`. Capture needs damage **>** level | 03#5.3 | `units.*.attack` |
| CMB-04 | new | Crossing via **interaction window**: hostile troops on different lines (different roads) fight when, at any instant within the tick, the distance between their centre-line positions is `<= contact` (window = region of lane coordinates `(s,u)` where that distance `<= contact`; covers X-crossings and near-parallel lines within `contact`). Swept (no tunnelling). Resolution order within the phase: ascending `(channelKeyA, channelKeyB)` (ordered-pair channel keys), then FIFO seq `(seqA, seqB)`; **sub-tick contact time is ignored** (all contacts in a tick resolve in that order, not by time of contact); survivors continue and may fight again in the same pass; same-owner lines never fight. Exchange = CMB-05. SP04 must match a brute-force per-tick oracle | 06 F9; 04 D6/R3 | `balance.contactDistance` |
| CMB-05 | new | Exchange: both read `attack` first, apply simultaneously; `hp<=0` dies; up to 2 rounds while both alive. Soldier vs tank (attack 1 vs 2): soldier dies, tank hp 2->1; tank vs tank: both die in round 1 | 03#5.2 | - |
| CPT-01 | rewritten | Capture: owner flips; level=0; old owner's outgoing lines cancelled; **all troops whose source is this building die (incl. cut-line, in flight)**; growth timer reset; `ignoreForWin` cleared; neutral can't capture | 03#5.3 | - |
| CPT-02 | rewritten | Incoming lines persist; other buildings' troops unaffected; arrivals re-evaluate vs current owner | v1 | - |
| TWR-01 | new | Tower: `radius_m = (ar_m + rupl_m*(stage-1)) * radiusUnit` (3840/6000/8160), `delay mt = supl_m*1_200_000/(ad_m*L+60000)`; radius by stage, delay by level | 03#5.5 | `ad, supl, ar, rupl, radiusUnit` |
| TWR-02 | new | Ready tower (cooldown elapsed, `level>=1`, owner non-neutral, or neutral when `neutralFires`, default true) fires at nearest hostile troop with `minRadius < dist <= radius + troopPad`; tie: dist, owner idx, troop seq. If none, nearest hostile *house* (towers are **never** targets of tower shots; houses only, `hitsNeutralHouses` gates neutral houses, default **true**, [RESOLVED: owner — towers hit neutral houses]). One shot per cooldown; cooldown set at fire from current level (R3 exemption) | 03#5.5; decomp (trigger reach = radius + troop body 0.35) | `minRadius`=1.0, `troopPad`=350 (milli; decomp-trusted default, N10), `hitsNeutralHouses`=true |
| TWR-03 | new | Shot on troop = instant kill (any hp). On house = level -1 (floor 0), never captures. Bullet flight is visual only | 03#5.5 | - |
| TWR-04 | new | Cooldown (mt timer) persists through capture. Neutral towers **fire** (every non-neutral owner's troops are hostile to them): content flag `neutralFires` **default true** [RESOLVED: owner Q1 - neutral towers fire, `neutralFires=true`; decomp has no owner gate]; flag kept so a flip = content flag + content-version bump | 03#5.5 | `neutralFires`=true |
| OBS-01 | new | Draw blocked if the line segment thickened by `laneHalfWidth` intersects an obstacle footprint or any non-endpoint building footprint. Touching is not overlap (strict boundary: tangent contact does not block). An obstacle overlapping the segment blocks **even at an endpoint** (endpoint buildings' own footprints never block) | 03#3.2 CheckBlock | `laneHalfWidth`=0.19, footprints (`circle|box`) in archetype data |
| OBS-02 | new | Obstacles static, not owned, not win participants, no troop interaction | 03#8.1 | - |
| WIN-01 | rewritten | Win: every building with `ignoreForWin=false` owned by human (neutrals included); remaining ignored buildings flip to human | 03#7.2 | `cbi` per building |
| WIN-02 | rewritten | Loss: human owns no non-ignored building. Troops in transit don't count. No draw outcome | 03#7.2 | - |
| WIN-03 | rewritten | Optional `timeLimitSec` (absent = none; no campaign level sets it) -> timeout loss; harness step caps are not outcomes. Outcome final | v1 | `timeLimitSec?` |

Tombstones: GEN-01, GEN-02, SND-01, SND-02, CAP-02.

**R5 Phase order (TCK-05).** 1 commands (player idx) -> 2 reserved/unused (was bomb strikes; booster strikes deferred, numbering kept stable) -> 3 growth -> 4 spawn/departures -> 5 movement (analytic) -> 6 head-on + crossing contacts -> 7 tower shots -> 8 arrivals + inline capture -> 9 win/loss/time. No slot-enforcement phase. Captured building produces nothing for its new owner until next tick. Troops killed by a capture are removed immediately; their later arrivals this tick do not apply.

**R6 Commands (closed set, extend by union):** `DrawLine{from,to}`, `CutLine{from,to}`. Bots use the same; TW AI never cuts (policy, not rule). No `UseBooster` (boosters deferred, R11).

**R7 Hash surface for SP03:** building owner/level/growth timer/`ignoreForWin`/tower cooldown; per-line spawn timer; troop kinematics+hp+source; stream states.

**R8 Reserved-module convention (§6):** table row per future element (walls, mines, rivers, rockets, fortress, trolley, railway, cargo, flags, WT3 artillery, double-unit, shield): intended behaviour, TW source cite, hook points (validation, phase anchor `preContact|postContact|postArrival`, win participation, hash). **No `R-` heading until shipped** (heading = active rule per `rules.ts`). Shipping = new 3-letter area, ids, minor bump (2.x.0), registry entry, tests, together.

**R9 check:rules + tag ownership.** [verified: `tools/src/rules.ts`] active = heading ids not tombstoned; every active id needs a non-skipped test title containing `covers R-X-NN` under `packages/**/*.{test,spec}.*` (apps/web and tools/test are not scanned); unknown ids in titles error; tombstoned ids stay "known".
| Area | Tests written by |
|---|---|
| TCK, ENT, SPN, GRW, LIN, CAP, CMB-01/02/03/05, CPT, WIN | SP03 (`packages/sim/test`) |
| CMB-04, TWR, OBS | SP04 |
| content-validation of rule params | SP02 (`packages/content/test`) |
| stale v1 `covers` tags (sim step/rules/economy tests, content components, tools/test, apps/web) | deleted by the SP that deletes that file; SP09 verifies none remain |
`check:rules` is red from SP01 merge until SP03/SP04 land; expected on the feature branch.

**R10 §7 glossary: exact content keys** (02's parity test diffs its schemas against this table; one row per key, no values in the doc). TW source names are the tw-level-ext/APK abbreviations.
| Content key | TW source | Rule ids |
|---|---|---|
| `maxLevel` | `ml` | CAP-01, GRW-01 |
| `spawnSpeed` | `ws` | SPN-01 |
| `lineSpawnPenalty` | `cwc` | SPN-01 |
| `growTime` | `gl` | GRW-01 |
| `attackDelay` | `ad` | TWR-01 |
| `attackRadius` | `ar` | TWR-01 |
| `speedUpByLevel` | `supl` | TWR-01 |
| `radiusUpByLevel` | `rupl` | TWR-01 |
| `radiusUnit` | tower radius unit (decomp 2.4) | TWR-01 |
| `minRadius` | tower min radius (decomp 1.0) | TWR-02 |
| `neutralFires` | tower owner gate (decomp absent; default true) | TWR-04 |
| `troopPad` | troop body radius added to trigger reach (milli, default 350) | TWR-02 |
| `hitsNeutralHouses` | tower house-target filter (default true; owner: towers hit neutral houses) | TWR-02 |
Other glossary entries (balance/unit keys) remain as in R4 `Param home` column.

**R11 Deferred (not in v2.0.0): boosters.** [RESOLVED: owner Q3 - boosters out of scope; see docs/FUTURES.md via SP09.] No BST ids, no `UseBooster` command, no `bomb` stream, no booster content keys/glossary rows, no per-troop speed state. Research facts kept so it can be revived:
- Bomb: **3 aims** (APK RC defaults `saykit_mlltrna_1.29.3_98@resourcesassets.json` = 3; code-embedded fallback literal is 1); human only; start delay **15 s**, cooldown **20 s** (RC `show_bomb_button_*`); candidates = AI + neutral buildings by level desc then index (level-0 and already-struck allowed); each strike lands after a jitter + fall, sets level 0, no capture, no troop effect. Prior draft numbers (ours, not TW): 3 charges, fall 20 ticks, jitter `below(7)`. TW "only when behind" gate (`PlayerAdvantageToActivateArmagedon`) unread.
- Speed: **x1.3 troop speed** (cap 7.5 u/s) and **x1.7 spawn rate** (`sc`); activate-only, rest of match, live on in-flight troops (`OnChangeSpeedUp` re-resolves; `IsSpeedUpActive` is a bool, no timer); human only; "x2" label vs these numbers: trust decomp. Prior draft: 1 charge.
- Revival = new area `BST`, minor bump (R8): `UseBooster` command, `bomb` stream, strike phase (slot 2), per-troop speed column + re-anchor, `speedUpSpawnFactor` in SPN-01.

## Architecture
```
GAME_RULES.md ids + param names  ->  SP02 schemas (param homes)  ->  SP03/04 sim (phases R5)  ->  tests `covers R-..`
                                  ->  SP05 importer (TW keys -> param names: l,ml,ws,cwc,sc,gl,ad,ar,supl,rupl,cbi)
                                  ->  SP06 bots (commands R6)
```
Worked examples SP03 must reproduce exactly: soldier house L=10, 1 line = 18461 mt; 2 lines = 24000 mt; L=64, 3 lines = 20869 mt; growth L=0 = 64600 mt, L=60 = 45560 mt; tower delay L=1 = 33870 mt, L=64 = 11170 mt [computed from the formulas; match 03 tables 0.92/1.20/1.04/3.23/2.28/1.69/0.56 s].

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Id policy | Same topic rewritten keeps id (`Since 2.0.0`); dead topic tombstoned, never reused | Fresh id space | Keeps `rules.ts` semantics, cheap |
| 2 | Surplus lines on level drop | Keep, no cut | v1 auto-cut | [verified: `SetAvailableWays` -> `SetAvailableWaysCount` only sets a ReactiveProperty; `CalculateFreeWays` = avail - count; no cutter found] |
| 3 | Capture | `damage > level`, overshoot discarded, kills source troops | v1 leftover captures | 03#5.3 decomp |
| 4 | Stage thresholds | Inclusive via stage function (not v1 strict `extraSlotAbove`) | `[9,29]` hack | Single stage fn feeds slots, tower, art |
| 5 | Boosters (bomb, speed) | Out of scope for v2.0.0 (owner Q3); research facts in R11; former Decisions 6-7 folded in here | Ship bomb + speed with charges/delay/cooldown | [RESOLVED: owner Q3] deferred; keeps rules, sim state and hash free of per-troop speed, strike phase and `bomb` stream |
| 8 | Tower bullet | Instant kill at fire tick, visual flight | Simulated homing bullet (12 u/s) | Homing never misses; <=0.3 s earlier; no bullet entities in hash |
| 9 | Contact | `contactDistance` 0.7 (2 x body sphere r 0.35) on centre lines, lateral offsets ignored | Arrival at 0 | [verified: 03#14 radii]; offsets are cosmetic |
| 10 | Win/loss | TW rule; troops in transit irrelevant (capture kills them, so consistent) | v1 elimination | 03#7.2 |
| 11 | Time limit | Optional field | Keep 300 s default | TW campaign has none |
| 12 | Double unit / shield / skin speed | Out of rules; default skin 1 = 0% dbl, 0% shield, +1% speed (ignored: speed exactly 5.0) | Reserve hooks now | [verified: 01 skin table row Default 1]; no RNG consumed in scope |
| 13 | Arrival inset | None (arrive at centre distance) | Per-building collider inset | ~0.1 s; see Risks |
| 14 | Version strings | SP01 bumps `RULES_VERSION` constant + content metadata to 2.0.0, **once for the whole branch**: guards compare against the merge-base via `VERSION_GUARD_BASE` (owned by 09 Phase A, task 0 before SP01), so no per-commit re-bump | Leave to SP02; bump per SP | Keeps `checkRulesVersion` green; avoids RULES_VERSION churn |

## Manual steps
None.

## Risks / Open Questions
- [RESOLVED: proposal accepted: buildings block with `Building` 1.5 box; obstacle child sizes from 05 Task 0 collider dump (`colliders.json`), 04 writes values into content (single commit + content bump); fallback if dump fails within a day = circle 450 + calibration vs refs, logged as known deviation in LEVELS_GUIDE] Blocking footprints (OBS-01): which collider `CheckBlock` tests for buildings (`Hit` 0.6 / `Building` 1.5 / `Selecable` 2.5) and obstacle child sizes (level data has positions only). Proposal: `Building` 1.5 box for buildings; obstacle sizes come from 05 Task 0 (UnityPy collider dump into `tools/src/import-tw/prefab/colliders.json`), 04 reads them into content; fallback if the dump fails within a day = 04's circle 450 + calibration against refs, recorded as a known deviation in LEVELS_GUIDE. (03#14, 06 §6 item 5)
- [RESOLVED: target priority troops-then-houses, nearest by distance; towers are never targets; `level>=1` to fire; `troopPad` 350 (decomp-trusted, N10); amendments from 04 folded into OBS-01/TWR-02/TWR-04/CMB-04 and R3 exemption]
- [RESOLVED: owner Q1 - neutral towers fire, `neutralFires=true`] Evidence: decomp has no owner gate (~70%); level 4 has a neutral level-5 tower. Kept as a content flag: flip = content flag + version bump.
- [RESOLVED: CAP-03 with zero lines loses the surplus; decomp `TrySpawnAdditionalWarrior` needs a way and respects the 30 cap]
- [RESOLVED: reverse-draw and cut keep in-flight troops (03#3.4 `DestroyWayFrom` stops the spawn timer only)]
- [RESOLVED: AI-vs-AI hostile; TW ignores only same-owner]
- [DEFERRED] Boosters (bomb "appears when behind" gate, candidate pool split, etc.): see R11.
- [RESOLVED: owner Q3 - boosters deferred; see docs/FUTURES.md via SP09] Bomb + speed boosters removed from v2.0.0 scope (R11).
- [DEFERRED] Arrival inset / departure spawn point, lateral lane offsets, double-unit, shield, live-server RC overrides (APK defaults used everywhere).
- [DEFERRED] Gate to flag stale `covers` tags on tombstoned ids (SP09 candidate).
- Risk: TW tank at 20 Hz with closing speed 2 x 5 = 0.5 u/tick < contact 0.7: head-on is threshold-based so safe; crossing must use swept test (CMB-04) - stated in rule.
- [RESOLVED: review 2026-10-22 — tank = attack 2 / defense 1 / hp 2 per research 01/03 tables; earlier '2/1/2' was misread as hp/attack/defense]

## Acceptance Criteria
- `docs/GAME_RULES.md` header is exactly `RULES_VERSION: 2.0.0`; `checkRulesVersion` passes with the two version strings bumped.
- SP01 commit CI expectation: with 09 Phase A (task 0) in place, `sim:golden`, `replay:verify`, `bots:golden`, `validate:levels` are PARKED from the SP01 commit on (v1 goldens/replays still carry 1.0.0 and would fail the rulesVersion match); `check:rules` red as stated. Version guards run with `VERSION_GUARD_BASE=$(git merge-base HEAD main)`, so 2.0.0 is the single bump for the branch.
- R10 glossary keys exist in §7 exactly as listed (02 parity test).
- `pnpm check:rules` parses: 38 active ids, 5 tombstones, no duplicate headings, no `R-` heading in §6.
- Every rule has statement, `Params:` naming content keys, `Since: 2.0.0`; §7 glossary lists each param once with home key and TW default, rules text contains no tunable literal other than structural constants (20, 1000, 1_200_000, 50, 900_000).
- Worked examples E-* reproduce the Architecture numbers by hand from the stated formulas.
- Changelog 2.0.0 entry states: replay outcomes change, v1 replays/goldens invalid, list of retired ids.
- Contradiction table in the doc (or changelog) records the six settlements with citations.
- A reader can derive, per phase in §4, which rule ids run and in what tie order (TCK-03).
