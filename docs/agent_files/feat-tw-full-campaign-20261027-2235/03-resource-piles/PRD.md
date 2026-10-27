---
status: draft
summary: Resource piles (TW WOD) as neutral, non-capturable, depletable line targets; a soldier/tank that reaches one picks up gold, turns around on a companion return channel, and reinforces its home house by 1 + gold; AI targets piles as TW does (BOT_VERSION bump); no shipped level has piles, so existing locks/goldens do not move.
date: 2026-10-27
---
# PRD: 03 Resource piles

Repo/branch: node-arena, `feat/tw-full-campaign` (Phase A PR = SP01+02+03) · Depends on: 02 (element hp/state columns, crossing helper, `RULES_VERSION` 3.1.0, ELM area), 01 soft (census, themes for levels >= 41) · Feeds: 05 (rivers reuse the return-channel idea for plank-less troops), 08 (trolley), 09
Owns: `docs/GAME_RULES.md` (new area `PIL`, edits to R-ENT-01, R-LIN-01, R-CAP-01, R-WIN-01 cross-refs, phase table, changelog), `packages/content/src/versioning.ts` (RULES_VERSION 3.1.0 -> 3.2.0), `packages/defs/src/modules/{depletes,carries}.def.ts` + events (`PileHit`, `PileDepleted`, `TroopReturned`), `packages/content/data/buildings/resource-pile.json` + schema bits, `packages/sim/src/{ring.ts,state.ts,hash.ts,types.ts,read.ts}` + `modules/{depletes,carries}.ts`, `packages/bots/src/{tw-ai.ts,script.ts,version.ts}`, `tools/src/import-tw/{feature-map.json,map-level.ts,gate.ts}`, `apps/web/src/render/*` (pile + carried-gold), `apps/web/src/editor/*`, `tools/src/assets-tw/*` (Resources*/Gold rows), imported levels, `tools/levels-lock.json`, `tools/unsolved-by-proxy.json`.
Does not own: walls/mines (02), rivers/planks (05), cargo (stays dropped), meta/currency use of gold (OUT).

## TL;DR
- Pile = **neutral building** (appears in `buildings`, not `elements`) with `level = amount` (6..224). Houses may draw lines to it; it never owns, never spawns, cannot be captured, `ignoreForWin = true`. [verified: 03-core-mechanics §6 "`Resource : Building`", `canBeIgnoredToWin 1`]
- Arriving own troop takes `min(amount, attack)` gold (soldier 1, tank 2), `amount` drops, troop **turns around** and walks back; on arrival home it reinforces `+defense + gold` (TW: "1 + carried gold"). Gold has **no other in-match meaning**. [verified: §6 PickUp/AddObjectInHand/WarriorEffectOnCollision]
- Return trip = same troop (same `seq`) moved to a **companion return channel** (`pile -> home`) at progress 0: ring stays FIFO, so **no per-troop direction, re-anchor or sorted insert** is needed (06-gap-map §3 predicted those; this design avoids them) [design].
- AI adds piles to its weakest-first target list (key = amount). Zero shipped levels have `WOD` -> existing 20 levels, locks, goldens unchanged; `BOT_VERSION` 2.4.4 -> 2.5.0 regardless (identity change).
- Importer: `WOD` row becomes `building / resource-pile`; first pile at position 67; census-driven import.

## Problem
Piles gate 412 of 1,012 campaign levels (first at 67) [verified: 06-gap-map §1; 02-levels §5]. `WOD` is parsed but mapped as `kind: element, archetype: null` -> every pile level is blocked [verified: feature-map.json L22]. The sim has no resource, carry or return concept; the earlier AI port dropped pile targets because they "shift weakest-first order on 412 levels" [verified: FUTURES.md L6/L12]; 159 AI script steps (`AiCWS.THId`) target piles [verified: 02-levels §3.4]. No shipped level (positions 4-23) has `WOD` [verified: grep over `packages/content/data/levels`].

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| `R-PIL-*` rules + tests + code, pile as building | Gold as currency/score/meta; `addResourceBonus` talent (zero-default param only) |
| Pickup, return trip, reinforcement `1 + gold`, depletion, line cleanup | Wood/planks (SP05), Coins/cargo (dropped), `isAttackedIncreased` (no data uses it) |
| Troop payload hashed + replay-safe, no per-tick RNG | Generic per-troop kinematics |
| AI pile targeting exactly per TW; script `THId` pile steps | Rocket-tower pile-skip logic beyond what SP06 needs |
| Pile + carried-gold visuals; editor palette item; importer + unlocked levels | New HUD (none in TW) |

## Requirements

### Decoded vs spike
| Fact | Status |
|---|---|
| `amount = level`, values 6/12/14/18/24/32/60/100/154/224; `PickUp = min(amount, DefaultAttack + bonus)` | decoded [verified: §6; `Resource/PickUp.c`] |
| Gold: `defence += amount`; return: level `+= Defense` | decoded [verified: `AddObjectInHand`, `House.AddLevel`] |
| Pile-bound soldiers flagged `IsResourceMove`; reverse via `ChangeMoveToReverse` | decoded |
| `RESOURCE_DISABLE_TIME 4`: what the 4 s disable means (fade? lines held? pile re-enables?) | NOT decoded -> spike S1 |
| `DestroyWayToResource` condition | NOT decoded ("exact condition not decoded") -> S1 |
| Pile footprint / does it block other lines (R-OBS-01 "third building")? | inferred yes (it is a Building); box size NOT decoded -> S2 |
| Order of piles in AI target ties; `id` vs list order | NOT decoded -> S3 |
| Hostile troop sent to a pile (enemy line to same pile): any owner picks up? | inferred yes (`CanBeAttackedBy` N/A); confirm S1 |
| Tank carries 2 (DefaultAttack 2) | derived from §6 + unit data |

### R1 Rules (GAME_RULES first, then tests, then code)
- **R-PIL-01 Pile.** Neutral building, `amount = level`, no growth, no lines, `ignoreForWin` (R-WIN-01: flips to the winner with other ignored buildings). `DrawLine` to a pile is valid for any owned house with a free slot while `amount > 0`; pile is never a line source. R-ENT-01 kind list gains `pile`; R-OBS-01 treats a pile footprint like any third building.
- **R-PIL-02 Pickup.** Arrival (phase 8, overshoot-desc order, R-CMB-02) of a troop of owner X on a line ending at a pile: `g = min(amount, carry(kind))`, `amount -= g`, troop is **not consumed**: it leaves its channel and is appended to the companion return channel `pile -> source` with `p0 = overshoot`, `t0 = tick`, same `seq`, `carry = g`. If `g = 0` (already empty) the troop is consumed (S1). Alive cap unchanged (same troop).
- **R-PIL-03 Return.** A returning troop moves at its kind speed, fights and crosses like any troop (R-CMB-01/04, R-ELM-*). On arrival at its source house: own house -> level `+= defense + carry` capped at `maxLevel`, surplus per R-CAP-03 as an ordinary troop (gold dropped). House now owned by another player -> troop **dies** (same rule as old owner's in-flight troops, R-ENT/capture text); never attacks.
- **R-PIL-04 Depletion.** At `amount = 0` the pile is inactive: further `DrawLine` rejected; existing lines to it are cut (R-LIN-05 semantic, in-flight forward troops continue and are consumed on arrival); returners are unaffected. 4 s disable ignored unless S1 says otherwise. Same-tick order: arrivals ascending overshoot-desc, so earlier arrivals get gold first.
- **R-PIL-05 Cut/line lifecycle.** A cut line does not remove returners already on the return channel. Return channels have no spawn timer and are never drawn by commands.
- R-CAP-01 gains "plus carried gold"; phase 8 row cross-refs R-PIL. Changelog + `RULES_VERSION` 3.1.0 -> **3.2.0** (minor, additive; levels without piles replay bit-identically). Rebase number if order of landing differs.

### R2 Defs / content
- Building archetype `resource-pile.json` (`modules: depletes {initial from level}`; **no** `grows`, `drawsLines`, `spawns`, `shoots`), footprint circle (S2). Level `buildings[]` entry with `owner: null`, `level = c` (reuses existing building schema [verified: types.ts `owner null = unowned (WOD)` comment]).
- Unit content: `units/*.json` gains `carry` (soldier 1, tank 2, artillery 1) and `carriesGold` module flag; `balance.json` gains `pile.addResourceBonus: 0`.
- Level `requires` gains `depletes`, `carries`. Events: `PileHit{pile,troop,gold}`, `PileDepleted{pile}`, `TroopReturned{troop,house,gold}`.

### R3 Sim
- **Ring**: add `carry: Int32Array` column (hashed, shifted by `removeAt`, zeroed in `clear`). No change to `progressOf` (`p0 + (tick - t0)*speed`), `indexOfSeq`, FIFO. [verified: ring.ts, state.ts L54]
- **Return channels**: created at `compile` as the reverse of every line whose target is a pile (cold, deterministic: ascending `(pile, source)`), keyed `pile x n + source`; lane geometry reuses `makeLane`. They sit in `channels` in key order so iteration and hash order are stable. [RESOLVED O1: sim channels are keyed per ordered pair (`from*n+to`, lazily created via state.ts); return-channel companions are static at compile, as written above]
- Move = `removeAt(i)` on forward + `push` on return; same-tick arrivals push in overshoot-desc order, so descending-progress ring order holds without sorted insert (all troops same kind speed; if SP04/05 add per-troop speed, revisit).
- Head-on: a returner is never hostile to the forward traffic of its own line; hostile lines crossing its lane fight via the crossing pass (R-CMB-04). Cut/capture of the home house kills its returners via the existing "source building captured" sweep (add `pile -> house` channels to the sweep).
- Hash: ring `carry`, `amount` (building level), return channels. No new RNG draw.
- Phase: pickup lives in phase 8 arrivals (`arrivalPass` dispatches by target archetype); return arrival reuses the friendly-arrival path with `defense + carry`.
- SimView/`read.ts` exposes `carry` per troop and `pile` flag per building for bots/web. `bench:sim` gate on a pile-heavy level (only +1 column).

### R4 Bots
- `sortedTargets` already iterates all non-own buildings by `(targetKey, index)`; piles become targets by content alone with `targetKey = level` (not special) and **filter `amount > 0`** (TW `GetEnvironmentItems`: Resource with level > 0) [verified: 04-ai-bots.md L92, L120].
- `canDraw` unchanged (piles are third-building footprints). Script steps (`CreateWayBehavior`/`AiCWS` with `THId` = pile id, 159 steps) resolve through building ids; importer must keep pile ids in the id map. Rocket-tower pile skip is SP06.
- `BOT_VERSION` 2.4.4 -> **2.5.0** (target set changes on every pile level); bot goldens for the 20 shipped levels are expected byte-identical (assert; any diff = bug). New `bots:golden` entries for 1-2 pile levels.
- Update FUTURES: remove the two "dropped" entries.

### R5 Web
- Assets (`tools/src/assets-tw`): `Resources{6,12,14,18,24,32,60,100,154,224}` pile prefabs + `Gold` carried token; `assets:tw:check` byte-identical; manifest ids `building.resource.<amount>` (nearest-size model by amount band if prefab count < variants) and `fx.gold`; credits rows. [RESOLVED O4: see Risks]
- Render: pile mesh scaled/swapped by remaining `amount` bands, shrink on `PileHit`, fade on `PileDepleted`; returning troop shows gold bag when `carry > 0`; `TroopReturned` plays existing reinforce pop with `+N`. Reuse building renderer; no HUD.
- Editor: library item `resource pile` (amount select from the 10 values, snap to prefab list); owner fixed neutral; exports `owner: null`.

### R6 Importer
- `feature-map.json`: `WOD` -> `{action: map, kind: building, archetype: "resource-pile"}`; `gate.ts` `resource: 'WOD'` token cleared; `map-level.ts` emits piles after BD buildings in TW `id` order (S3), `level = c`, `rotation` presentation-only. `parse-raw` already reads `WOD` [verified: parse-raw.ts L103, L213].
- Import all positions <= 340 unblocked (census, SP01 R4); unsolved-by-proxy rows with `ownerSignOff: null`; content version bump + `content:lock`, `levels:lock`.
- LEVELS_GUIDE census row "resource piles" updated; report 0 shipped-level hash movement.

## Architecture (high level)
- **Pile = building, carry = ring column, return = companion channel.** Everything pile-specific is data (`depletes`, `carries`) plus one arrival-dispatch branch; SP02's element crossings still apply to returners since they are ordinary ring troops. SP05 can reuse "turn around on companion channel" for bridge-less soldiers.
- Why not element: lines/AI/view all key on `buildings`; making piles elements would force a parallel target path in `DrawLine`, win, bots and `read.ts`.
- Determinism: integer progress/ticks, ordered channel keys, overshoot-desc pushes, no RNG; `carry` and `amount` hashed. Replays on non-pile levels bit-identical (verify via `replay:verify golden`).
- Version impact: RULES minor, BOT minor, content version/hash bump only for new levels.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Pile type | building (`owner null`, `ignoreForWin`) | element | TW `Resource : Building`; reuses lines/AI/win |
| 2 | Gold meaning | `+carry` to home reinforcement only | score/currency | TW semantics; meta OUT |
| 3 | Return mechanics | same seq to companion channel, p0 = overshoot | per-troop direction + re-anchor | keeps FIFO; smaller hash/ring change |
| 4 | Home captured while returning | troop dies | attacks / banks | matches in-flight-death rule; no free hits |
| 5 | Depleted pile | inactive, lines cut now | 4 s delay | simple; S1 may refine |
| 6 | Pickup limit | `min(amount, carry(kind))` | whole amount | decoded |
| 7 | Pile blocks other lines | yes (third-building footprint) | no | inferred; S2 |
| 8 | Hostile owners | any owner may use a pile | owner-gated | inferred; S1 |
| 9 | BOT_VERSION | 2.5.0 | none | target set changes |
| 10 | RULES | 3.2.0 minor | major | no change on non-pile replays |

## Manual steps
- Run spikes S1-S3 on the rebuilt extract (`decomp.sh 'Resource'`, `'House.WarriorEffectOnCollision'`, `'Way.CheckIfCanDestroyWayToResource'`), time-boxed 1 day.
- Owner spot-check of new `unsolved-by-proxy.json` rows (`ownerSignOff` null).

## Risks / Open Questions
- [RESOLVED: decode spike first (task: decomp ResourceBuilding / resource pile classes via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use R-PIL-04 as written with `RESOURCE_DISABLE_TIME 4`, DestroyWayToResource off, empty-pile arrival returns without pickup, hostile-owner pickup allowed and record it as a deviation in GAME_RULES + the deviations ledger] S1.
- [RESOLVED: decode spike first (task: decomp pile prefab collider via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use circle r = 0.5 x house, non-blocking for lines and record it as a deviation in GAME_RULES + the deviations ledger] S2: pile footprint size and line blocking.
- [RESOLVED: decode spike first (task: decomp the AI pile target list via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use list order and record it as a deviation in GAME_RULES + the deviations ledger] S3: tie order for equal-amount piles (TW `id` vs list order); affects pile-level bot goldens only.
- [RESOLVED: sim channels are per ordered pair (`from*n+to`, verified in packages/sim/src/state.ts, commands.ts); companion return channels static at compile] O1.
- [RESOLVED: yes, a returner counts toward the per-house spawn limit; global alive cap unchanged; revisit only if the decode spike contradicts] O2.
- [RESOLVED: decode spike first (task: decomp returner/gold surplus handling via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use carried gold dropped on surplus (R-CAP-03) and record it as a deviation in GAME_RULES + the deviations ledger] O3.
- [RESOLVED: decode spike first (task: decomp Resources prefabs via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use scale one nearest-size prefab by amount band and record it as a deviation in GAME_RULES + the deviations ledger] O4: pile model per amount vs scaling one prefab.
- [RESOLVED: Phase A hash churn limited to new levels is verified by `replay:verify golden` in the final SP03 task; any other change is a bug] Phase A combined replay hash churn.

## Acceptance Criteria
- `R-PIL-01..05` in GAME_RULES with `covers R-...` tests; `check:rules` green; RULES_VERSION 3.2.0 + changelog.
- Unit tests: pickup clamp (soldier 1, tank 2, amount < carry), depletion + line cut, return reinforcement `1 + gold` incl. cap/surplus, home captured mid-return, returner clash on crossing lane, same-tick multi-arrival order, snapshot/hash round-trip with `carry`, determinism across runs.
- Bots: pile enters weakest-first list only while `amount > 0`; script pile `THId` resolves; `BOT_VERSION` 2.5.0; bot goldens for existing 20 levels byte-identical.
- First pile level (position 67) and all pile-only-unblocked levels <= 340 imported, solvable by proxy or in `unsolved-by-proxy.json`; census delta recorded.
- Web: pile and carried gold render, fx from events, editor places piles; `assets:tw:check`, `check:manifest` green.
- `bench:sim` within budget; `pnpm run ci` green.
