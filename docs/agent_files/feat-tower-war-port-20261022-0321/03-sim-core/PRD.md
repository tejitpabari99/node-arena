---
status: draft
summary: Rewrite packages/sim as the Tower War 2.0.0 engine (per-line milli-tick timers, growth, alive cap, hp/attack exchange, capture-kills-source, named streams, hash/replay v2) on SP02's CompiledLevel, with explicit seams for SP04 (crossings, shooters, blockers); v1 sim code and goldens deleted.
date: 2026-10-22
---
# PRD: Sim core (SP03)

Repo/branch: node-arena · feat/tower-war-port · Depends on: 01 (R-ids, formulas), 02 (`CompiledLevel`, `Record<ModuleId,SimModule>` binding, CUT commit) · Feeds: 04 (seams below), 06 (read view, streams), 08 (read API, events), 09 (goldens/bench gates)
Owns: `packages/sim/**` (src, tests, goldens, scripts, bench) except SP04 behaviours; test tags for TCK, ENT, SPN, GRW, LIN, CAP, CMB-01/02/03/05, CPT, WIN (01 R9).
Does not own: rule text (01), defs/content (02), CMB-04/TWR/OBS mechanics and `canDraw` blocked reasons (04), bots (06), web (08), CI wiring (09).

## TL;DR
- Same skeleton (20 Hz, int32 SoA, lazy analytic movement, sfc32, WordHash, recorder/`playReplay`), new rules: v1 `economy.ts`, `registry.ts`, garrison/slots/generation, team/draw/elimination logic **deleted**.
- Per **line** (ordered-pair channel) spawn timer in milli-ticks; per **building** growth timer; `alive` counter (cap 30); ring columns add `hp` (speed is the constant per-unit value from the unit table).
- Modules (`level`, `drawsLines`, `spawns`, `grows`, `shoots`, `blocksLines`) bound by `IMPLS satisfies Record<ModuleId, SimModule>`. SP03 ships real `level/drawsLines/spawns/grows`, **stubs** `shoots/blocksLines` that SP04 fills. Movement, contacts, arrivals/capture, win are core code, not modules.
- Streams: `createStreams(seed).fork(name, idx).below(n)`; sim uses `fwd`(building); bots fork their own.
- Ring gets canonical middle removal (`killTroop`), cheap because the cap bounds every ring to <= 30. This is the SP04 shooter seam.
- Hash `sim-state-v2`; all v1 goldens regenerated; budgets (0.3 ms mean / 1 ms p99 / 0.5 ms hash) kept at 720 saturated troops.

## Problem
Verified in this worktree (1,093 src LOC, 1,943 test LOC):
- Components own `garrison.count/cap`, one `generates` accumulator, round-robin departures, `enforceSlots` auto-cut, leftover-value capture, `transit`-based elimination, draw outcome, team ids, 300 s timeout [`economy.ts`, `combat.ts`, `tick.ts`, `registry.ts`].
- Closed unions `Command/RejectReason/SimEvent/Outcome` [`commands.ts:4-19`]; speed per kind duplicated in `combat.ts:9` and `read.ts:75`; ring is front-only [`state.ts:11-81`]; `Sfc32` exists but is unused by v1 and has no `below`.
- Runtime `assertParity` [`state.ts:137`] is replaced by 02's compile-time binding.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Implement every 01 rule outside CMB-04/TWR/OBS, formulas integer-exact | Crossing contact, tower fire, corridor/third-building block (04) |
| Reproduce 03 tables (spawn 03#4.1, growth 03#4.6, capture 03#5.3) in goldens | Double-unit, shield, skins, rage, lateral offsets (no RNG consumed) |
| Read API + events SP06/SP08 can code against now | Module versions in replay header (02 deferred) |
| Typed seams so SP04 edits zero SP03-owned core files except listed stubs | v1 compat, shims, a second ruleset |

## Requirements

### R1 Inventory (grep-backed: `wc -l`, `covers R-` counts)
| Path | Verdict |
|---|---|
| `src/math.ts` (148) | keep; add `Sfc32.below(n)` (rejection sampling, unbiased), `fnv1a32` |
| `src/index.ts` | rewrite exports (`createStreams`, new unions, replay) |
| `src/state.ts` (226) | rewrite: `TroopRing` keep (+`hp`, `removeAt`), `Channel` +`timer`, building/player columns |
| `src/commands.ts` (93), `read.ts` (99), `hash.ts` (28) | rewrite (R4, R6, R7) |
| `src/combat.ts` (110) | rewrite: head-on exchange, arrival+capture; `friendly` becomes owner equality |
| `src/tick.ts` (74) | rewrite: `win.ts` + `assertInvariants` (conservation counters replace value accounting) |
| `src/economy.ts` (75), `registry.ts` (87), `stats.ts` (8) | **delete** (stats `generated/overflowLost/kills/captures` unused by tools; web `strength.ts` is 08's) |
| `src/replay.ts` (127) | keep; header unchanged (02 R8), drop `timeLimitTicks` hard bound when 0, `winnerTeam`->`winner` |
| new `streams.ts`, `timers.ts`, `arrive.ts`, `contacts.ts`, `win.ts`, `modules/{index,level,drawsLines,spawns,grows,shoots,blocksLines}.ts` | add |
| `eslint.determinism.cjs`, `tsconfig*.json` | keep |
| `test/`: `math`, `numeric-boundaries`, `determinism`, `replay` | keep, adapt (fixtures) |
| `test/`: `combat`(9 covers), `economy`(9), `rules`(15), `step`(8), `state`, `read`, `property`, `extensibility`, `golden`, `bench` | rewrite per R8; v1 `covers` tags (GEN, SND, CAP-02, v1 CMB/WIN/LIN semantics) die with them |
| `test/golden/{scenarios.ts,run.ts,baseline.json,browser/}`, `scripts/{golden,bench}.cjs` | scenarios/baseline/bench fixture rewritten; runner, version-bump guard, browser parity kept |

### R2 State model (int32 columns; `n` buildings, `p` players)
| Group | Fields |
|---|---|
| Building core (always) | `owner` (-1 neutral), `level`, `maxLevel`, `lines` (drawn outgoing count), `alive` (live troops sourced here), `ignoreForWin`; static: pos, footprint, `special`, `initialOwner`, `kind`, archetype/visual (view only) |
| Derived | `stage(level)` via `stageThresholds`; `slots = stage` if building has `drawsLines`; `free = slots - lines` (may be < 0, no auto-cut: LIN-02) |
| Module columns (`<module>.<field>`, sorted, hashed) | `grows.timer` (mt); `shoots.cooldown` (mt, **allocated by SP03 as zeros**, used by SP04, so `hash.ts` never changes again) |
| Channel (ordered pair `from*n+to`, lazy) | `drawn`, `drawSeq`, `timer` (mt; resets on draw, dies with line), `length` (symmetric precompute), `troops` ring. Owner is derived (`owner[from]`); invariant: drawn => `owner[from] != -1` |
| Road (unordered pair) | geometry only: `length`, and the two channels. No stored object in SP03; SP04 attaches per-road crossing lists via `onLineDrawn` hook |
| Ring columns | `p0,t0,owner,kind,seq,hp` (no per-troop `speed` column: speed is constant per unit kind, read from the unit table). `attack/defense` read from the unit table by `kind` (flat; add columns when the first per-troop modifier exists). Source building = channel `from` (so capture-kill iterates channels from X) |
| Player/seat | `kind`, `colorKey` (no booster state: boosters deferred, 01 R11) |
| Global | `tick`, `over`, `drawSeq`, `troopSeq`, `rejected`, stream states `fwd[b]` |

Invariant making front-only scans valid: all troops on one channel share an owner and speed at every tick (every unit kind has the same `speed`; a content test asserts all `units.*.speed` are equal, otherwise a per-troop speed column is required), so progress is FIFO-monotone. Debug `assertInvariants`: int32, recount `lines/alive`, `0<=level<=maxLevel`, FIFO monotone, ring length <= `aliveCap`, troop conservation `spawned = alive + arrived + died + killed`.

### R3 Phase order and total tie orders (01 TCK-05; `tick` increments first)
| # | Phase | Order within | Notes |
|---|---|---|---|
| 1 | commands | player idx, then submission index | `DrawLine/CutLine` |
| 2 | reserved (unused; was bomb strikes, deferred with boosters; numbering kept stable) | - | no-op |
| 3 | growth (`grows`) | building idx | R5 |
| 4 | spawn (`spawns`) | building idx, then target idx | R5 |
| 5 | movement | - | analytic, nothing to run |
| 6 | contacts | head-on: unordered pair `(from<to)` asc, repeat while qualifying; then `crossingPass(state)` (**stub, SP04**) | |
| 7 | towers (`shoots`) | building idx | **stub, SP04** |
| 8 | arrivals + capture | overshoot desc, channel key, FIFO; ownership re-evaluated per arrival; arrivals of a captured source are cancelled even if already queued | |
| 9 | win/loss/time | - | R9 |
Randomness only in phase 8 (`fwd`), the stream keyed by an entity so cross-entity order cannot shift draws.

### R4 Commands, validation, reject codes
Closed union (types come from `defs` COMMANDS; 03 supplies reasons/semantics):
- `DrawLine{player,from,to}` check order: `gameover` -> `malformed` -> `unknown-id` -> `not-owner` -> `self` -> `not-drawer` (source lacks `drawsLines`) -> `duplicate` (drawn same channel) -> `no-slot` (`free<=0`) -> **blocker hook** (`blocksLines`, SP04: `blocked-obstacle|blocked-building`). Same-owner reverse drawn: reverse cut `replaced`, troops stay; hostile reverse coexists (head-on). Atomic.
- `CutLine{player,from,to}`: `gameover`, `malformed`, `unknown-id`, `no-line`, `not-owner`. In-flight troops continue (LIN-05).
- Public `canDraw(player,from,to)` shares the validators and returns code or `null`; malformed input never throws.

### R5 Timers (TCK-06 verbatim; SPN, GRW)
Per eligible tick `timer += 1000`; if `timer >= period(now)` then `timer -= period`, act once. Pure fns in `timers.ts`: `spawnPeriodMt(L, n, ws_m, cwc_m)`, `growPeriodMt(L, gl_m, base)`, clamped `>= 1000`, all intermediates `< 2^53` (mulDiv).
- Spawn eligible: line drawn, owner non-neutral. Fire -> troop of the house's type at progress 0 on that line, `alive++`, skipped (timer still consumed) if `alive >= aliveCap`. New line starts at timer 0 when drawn; the draw tick already accrues 1000 (phase 4 runs after phase 1 in the same tick).
- Growth eligible: owner non-neutral, `lines == 0`, building has `grows`. Fire: `level = min(level+1, maxLevel)`. Not advanced while lines exist (kept), reset on fire/capture. At max level it still ticks (no effect; matches 01).
- Mid-interval change (line add/remove) uses the new period against the carried timer (documented TW behaviour).

### R6 Arrival, capture, forward, win
- Friendly (same owner): `L = min(L+defense, maxLevel)`; surplus -> CAP-03: if `lines>=1 && alive<cap` one `fwd[b].below(lines)` draw picks the k-th drawn outgoing line by target idx, new troop (arriving type, full hp), else lost.
- Hostile/neutral: `n = L - attack`; `n<0` => capture: owner flips, `level=0`, outgoing channels cut (`captured`), **all troops on channels from X removed** (`TroopDied cause capture`), `alive[X]=0`, growth timer 0, `ignoreForWin=false`, tower cooldown untouched; overshoot discarded. Else `L=n`. Neutral never captures.
- Head-on exchange (CMB-05): read both `attack`, apply simultaneously, remove `hp<=0`, max 2 rounds while both alive; same-owner fronts never fight (replaced-reverse leftovers). Trigger `progA+progB >= len - contact*tickRate`.
- Win (WIN-01/02/03), evaluated after phase 8, in this order: **win** (every non-ignored building human-owned; remaining ignored flip to human) -> **loss** (human owns no non-ignored) -> **timeout** (`timeLimitTicks>0 && tick>=limit`, loss). Outcome `won|lost|timeout`, `winner: playerIdx|null`; no draw, no elimination events. `timeLimitSec` null => `timeLimitTicks=0` (none). Harness step caps are not outcomes.

### R7 Read API, events, hash/replay header (consumed by 06, 08)
```
view: tick, over{outcome,winner}|null, timeLimitTicks, bounds{minX,maxX,minZ,maxZ}, ids{buildings,players,elements},
  players[{kind,colorKey}], buildings{owner,level,maxLevel,stage,slots,lines,alive,ignoreForWin,col}  // ReadColumn, borrowed
  buildingStatic[i]{x,z,kind,archetype,visual,footprint,special,drawsLines,initialOwner,modules}, elements[] (static, 04/07)
  lines[{channel,from,to,owner,length,drawSeq}]  (refreshed per tick), freeSlots(b), units[{id,speed,hp,attack,defense,visual}]
sim: step(cmds,{events}), canDraw, readTroops(buf{channel,seq,owner,kind,progress,hp,speed}), hash(), snapshot()   // speed = the constant unit speed in progress units/tick (from the unit table) so 07 interpolates `progress + speed*alpha` (clamped to lane length)
  (04 adds on `sim`: explainDraw, towerRadiusMilli(view,i))
streams: createStreams(seed).fork(name:string, idx:number) -> {next, below(n), snapshot}   // exported for bots; 06 relies on exactly `streams.fork(name, index).below(n)`
```
- Events (union in `defs` EVENTS; **03 T1 (CUT) writes the complete payload types**, 04 only emits; coordinates are milli ints): `LineDrawn{from,to,owner,drawSeq}`, `LineCut{from,to,reason: player|replaced|captured}`, `TroopSpawned{channel,seq,owner,kind,cause: timer|forward}`, `TroopArrived{channel,seq,owner,kind,effect: reinforce|overflow|hit}`, `BuildingCaptured{building,from,to,cause?}`, `MatchOver{outcome,winner}`, `CommandRejected{player,command,reason}`, and the three renderer-facing shapes below. Never alter state; `events:false` hash parity tested.
```
Clash{kind:'headon'|'crossing', a:{channel,seq,owner}, b:{channel,seq,owner}, x, z}
TroopDied{channel, seq, owner, kind, cause:'clash'|'capture'|'tower', x, z}
TowerShot{tower, target:{kind:'troop'|'house', channel?, seq?, building?}, x, z}
```
- Hash domain `sim-state-v2`: tick, seqs, over, building cols (+ sorted module cols), channels (`drawn,drawSeq,timer,troops` 6 words each), all stream states. Replay header unchanged (`rulesVersion,schemaVersion,contentVersion,levelId,simHash,seed`), all `2.0.0`; v1 replays rejected by the existing major.minor check; checkpoints every 20 ticks.
- Stream purpose id = `fnv1a32(name)`; seed = `mixSeed(seed, purposeId, idx)`; test asserts distinct ids for `fwd,bot.tw`.

### R8 Tests, goldens, bench
- `covers` tests per 01 R9 areas. Pure-function oracles in BigInt for `spawnPeriodMt/growPeriodMt`, a brute-force departure-tick oracle, and a property suite (fast-check) for invariants and 50-seed determinism.
- Goldens (`test/golden/scenarios.ts`, levels built with 02's `compileLevel` from inline JSON, not SP05 files): spawn table 1/2/3 lines x L=1/10/30/64 (first departures within one tick of 03#4.1; E-examples 18461/24000/20869 mt exact); growth 64600/45560 mt; capture exact-L no flip, L+1 flip, overshoot discarded; capture kills in-flight and cut-line troops; soldier vs tank (tank hp 2->1), tank vs tank (both die, 1 round); reverse replace; no auto-cut on level drop; overflow forward (seeded, capped, no-line loss); alive cap 30 skip; win with ignored flip; loss; timeout; rejections. `test/golden/run.ts` accepts a **scenario-list array** (`[...scenarios, ...geometryScenarios]`); SP04 appends `scenarios-geometry.ts` and its bench scenario without editing 03 files beyond the array. Version guard: `golden.cjs --update`/verify honour `VERSION_GUARD_BASE` (09 Phase A, task 0 before SP01), set to the branch merge-base, so the single 2.0.0 bump covers every regeneration on the branch (no per-commit bump; release runs without the env). Goldens are PARKED from the SP01 commit until SP03 un-parks them.
- Bench (`bench:sim`): (a) stress: 24 houses, 3 lines each, long lanes, 30 alive saturated = 720 troops, head-on pairs; (b) realistic 12 buildings. Budgets unchanged: mean 0.3, p99 1, hash 0.5 ms (x5 in CI).

## Architecture
```
defs (PHASES, MODULES, COMMANDS, EVENTS) -> content CompiledLevel -> sim.create(level, seed)
sim/src: state/ring/streams  commands  tick(phases)  timers  contacts(headOn + crossingPass stub)  arrive  win  hash  read  replay
sim/src/modules/index.ts: IMPLS = { level, drawsLines, spawns, grows, shoots*, blocksLines* } satisfies Record<ModuleId, SimModule>   (*stub)
SimModule = { id, state?: Record<string,number>, init?, phases?: Partial<Record<Phase,(s, buildings:Int32Array)=>void>, hooks?: { validateDraw?, onLineDrawn?, onLineCut?, onCapture? } }
```
**Staging and CUT order (02 step 4 = SP03 T1, one commit).** Through 02 step 3 the new engine is built **additively in `packages/sim/src/next/`** (skeleton on `CompiledLevel`: create/step/hash/read, empty phases, `IMPLS` stubs; v1 untouched, all green). T1 = "skeleton compiles on CompiledLevel" (checked in `next/`); the CUT commit itself is `git mv next/* up` + delete `registry/economy/combat` + v1 tests and goldens: mechanical, no authoring. Runs only after 02 steps 1-3 and 01 merged. Live after CUT: `build/lint/typecheck` (live set), math/numeric/determinism/replay tests. PARKED (09 Phase A runner) from the SP01 commit on: `sim:golden`, `replay:verify`, `bots:golden`, `validate:levels` (v1 goldens/replays carry 1.0.0 and the rulesVersion match fails once SP01 bumps to 2.0.0); `bench:sim` and `check:rules` (red until 03+04) from CUT. SP03 un-parks `sim:golden`/`bench:sim` in its later task; `replay:verify`, `bots:golden`, `validate:levels`, web are un-parked by 06/08/09.

**SP04 seams (SP04 edits only these):** `modules/shoots.ts`, `modules/blocksLines.ts` (replace stubs); `contacts.ts#crossingPass(state)` (stub no-op); `hooks.onLineDrawn(state, from, to, drawSeq)` / `hooks.onLineCut(state, from, to, reason: 'player'|'replaced'|'captured')` (crossing lists per road); `state.killTroop(channel, seq, cause)` (canonical removal, decrements `alive`, emits `TroopDied`); **`exchange(state, chA, seqA, chB, seqB)`** exported from `contacts.ts` (CMB-05 exchange, used by head-on and by 04's crossings; emits `Clash`/`TroopDied`); reason codes appended to `DrawLine` list; `buildings.col['shoots.cooldown']`; elements already in view. SP04 also appends its scenarios file to the golden runner's scenario-list array and wires its bench scenario (see R8). Contact order for CMB-04 (01: ascending `(channelKeyA, channelKeyB)` then FIFO `(seqA, seqB)`, sub-tick contact time ignored) is SP04's to implement against the brute-force oracle.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Core vs module | Spawn/grow/draw/shoot/block are modules; movement, contacts, arrival, win core | Everything a module (v1 style) | Compile-time binding has 6 ids; core rules are not per-archetype |
| 2 | Ring removal | Physical `removeAt` shift (ring <= 30) | Tombstones | No history-dependent hash; trivial cost |
| 3 | Unit stat columns | Only mutable `hp` | attack/defense columns | Flat per kind; widen on first modifier |
| 4 | Channel owner | Derived from `owner[from]` | Stored owner | One source of truth; capture cancels lines anyway |
| 5 | Streams | Entity-keyed (`fwd` per building), eager | One shared PRNG | Insensitive to cross-entity order changes; bots independent |
| 6 | Win order | win, loss, timeout | v1 timeout first | Last-tick win must count; 01 silent |
| 7 | (withdrawn) | Boosters deferred (owner Q3; 01 R11), so no `UseBooster` payload | - | - |
| 8 | (withdrawn) | No speed-booster state; speed is a constant per unit kind | - | - |
| 9 | Replay header | Unchanged shape, 2.0.0, hash domain v2 | Add module-version map | 02 defers; v1 replays already fail major check |
| 10 | Surplus-forward draw | Only when `lines>=1 && alive<cap` | Always draw | Fewer draws, same determinism |
| 11 | Perf | Recompute period per line per tick | Cached periods | <= ~72 lines; cheap and TCK-06-exact |

## Manual steps
None.

## Risks
| Risk | Mitigation |
|---|---|
| CUT lands before SP02 `next/` compile is stable | T1 gated on 02 steps 1-3 green; sim `next/` is additive so CUT is a mechanical move |
| Version/lock guards fight many golden regenerations on the branch | `VERSION_GUARD_BASE` = merge-base (09 Phase A task 0); single 2.0.0 bump |
| Interface drift with 08 (names below) | Listed as OPEN; 08 aligns to this PRD |
| Hash changes when SP04 adds state | Pre-allocated `shoots.cooldown`; module columns hashed generically |
| Large event logs in goldens (capture kills up to 30 `TroopDied`) | `eventLogHash` only; baseline stores hashes |

## Open Questions
- [RESOLVED: 02 R5 `CompiledLevel.rules` has `timeLimitSec, stageThresholds, aliveCap, growth.base, contactDistance, laneHalfWidth` (no boosters)]
- [RESOLVED: 08 R3/R6/R7 are rewritten from this PRD's R7 verbatim (`view.buildings/buildingStatic{x,z}`; no booster API; `sim.explainDraw` from 04 replaces `blockPoint`)]
- [RESOLVED: 02 R4 validator requires >= 1 non-ignored building]
- [RESOLVED: owner Q3 - boosters deferred; see docs/FUTURES.md via SP09] No `UseBooster`, `canUseBooster`, `view.boosters`, `pendingStrikes`, `BoosterUsed`/`BombImpact`, seat booster state, `bomb` stream, booster goldens or per-troop speed column in SP03.
- [RESOLVED: accepted as designed; known-unverifiable, behaviour-neutral] `fwd` draw semantics vs TW (`TrySpawnAdditionalWarrior` order of cap vs lane pick) unverifiable; behaviour-neutral in expectation.
- [RESOLVED: accepted (parked window)] `check:rules` stays red until SP04 tags CMB-04/TWR/OBS (accepted by 01); tower cooldown semantics (set at fire, 01 R3 exemption) are SP04's `shoots` module, `shoots.cooldown` column only allocated here.
- [RESOLVED: no time limit by default; `timeLimitTicks=0`, tools/bots harness own step caps]
- [DEFERRED] Double unit/shield/skin speed, attack/def columns, module versions in header, tombstone ring, event pooling.
- [RESOLVED: review 2026-10-22 — tank = attack 2 / defense 1 / hp 2 per research 01/03 tables; earlier '2/1/2' was misread as hp/attack/defense]

## Acceptance Criteria
- After T1: no `registry.ts`, `economy.ts`, `assertParity`, `garrison`, `generates`, `extraSlotAbove`, `PlayerEliminated`, `draw` outcome in `packages/sim` (grep); `build/lint/typecheck` live set green.
- Every SP03-owned R-id has a non-skipped `covers R-X-NN` test; no stale v1 tag.
- Oracle tests reproduce 03 spawn/growth tables and E-examples exactly; mid-interval and clamp properties hold.
- 50-seed determinism and event on/off hash parity pass; snapshot/hash round-trip under `playReplay`.
- Goldens regenerated at 2.0.0 and verified (`pnpm sim:golden`, with `VERSION_GUARD_BASE` = merge-base; no "passes because 1.x -> 2.0.0" reliance); `bench:sim` within budgets at 720 troops.
- SP04 can implement shooters/crossings/blockers touching only the seam files listed (incl. `exchange` and the golden scenario-list array).
- `defs` EVENTS carry the full payload types of R7; a type test fails if 04/07 emit/consume a field not in them.
