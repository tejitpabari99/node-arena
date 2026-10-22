---
status: draft
summary: Delete the utility bots and ship an exact, deterministic 20 Hz copy of Tower War's AI (timer + weakest-first attack + nearest-own reinforce, scripted step queues) driven by inline per-level params; rework level validation around TW-AI-as-human-proxy.
date: 2026-10-22
---
# PRD: 06 AI port (Tower War bots)

Repo/branch: node-arena, `feat/tower-war-port` · Depends on: 03 (sim view, seeded streams, commands), 05 (level `bot` blocks, tower order/ids), soft 02 (schema), 04 (`canDraw`)
Owns: `packages/bots/**` (src, tests, goldens, bench, README, `BOT_VERSION`); the spec (not the wiring) of tooling use in R6
Does not own: bot schema/registry/hash (02), sim view/streams/commands (03), `canDraw` rules (04), TW->level mapping (05), `tools/src/*` + CI wiring + thresholds (09), web (08)

## TL;DR
One bot kind, `tw`, a literal port of `DefaultBehavior` + the four scripted behaviours. Per seat: integer-ms timer, one decision per `AD`, targets sorted weakest-first, uniformly random free source from a seeded per-seat stream, nearest-own reinforcement fallback, never cuts. Reaction handler is not implemented (inert in TW). No difficulty system: strength = level layout + `AD` + script only. Everything else in `packages/bots` is deleted.

## Problem
- Current bots are a utility scorer (10 considerations, cut/reinforce/attack, line commitment, 16 skill tiers); TW's AI is ~60 lines and different in kind [verified: 04#0, 04#12.1; utility.ts 245 + considerations.ts 404 loc].
- Bot params are profile strings; TW needs per-AI inline params and event-sequenced scripts [verified: core.schema `botProfile`; 06a#3].
- `validate:levels`/`balance` assume a tunable `reference` profile playing the human seat [verified: tools/src/levels.ts:46-47, balance.ts:44-60].

## Goals
1. Behaviour of TW's AI on levels 4-23 reproduced within the stated deviations (determinism, total order, 20 Hz).
2. Bit-identical replays: same level + seed => same commands.
3. Package surface shrinks; no dead utility code, profiles or tiers.

## Non-Goals
Reaction/under-attack handler; difficulty scaling or `seatPower`; rocket-tower aiming, railway moves, resource piles, trolleys, boss AI, useless-attack behaviour (disabled in RC) [verified: 04#5]; PvP/fake lobby/names; any sim change.

## Requirements

### R1 Inventory (grep-backed)
| Path | Verdict |
|---|---|
| `packages/bots/src/{utility,considerations}.ts`, `version.ts` content | delete / bump `BOT_VERSION` 2.0.0 |
| `src/driver.ts` (76) | rewrite: keep `createBotDriver(level, matchSeed)` name+signature (re-exported by `apps/web/src/driver/bot.ts`, the only web use) |
| `src/index.ts` | keep `Bot`, `guardBotContext`; `BotContext` = `{view, canDraw}` (`readTroops` dropped, TW reads no troop flow, 04#3.6) |
| `src/harness.ts` (`runMatch`, `ScriptedController`) | keep |
| new `src/{tw-ai,script,seat}.ts` | add (Architecture) |
| `test/{utility,commitment,churn,corpus,context,progress-units,task8}.test.cjs`, `scripts/churn.mjs`, `churn-baseline-v1.json`, `benchmark-evidence.json` | delete |
| `test/{driver,harness,browser-parity,lint}.test.cjs`, `scripts/{golden,bench}.mjs`, `test/golden/bots.json` | rewrite for `tw` (lint test: no `CutLine`, no `Math.random`/`Date`) |
| root scripts `bots:churn` | delete; `bench:bots`, `bots:golden` stay |
| `packages/content/data/bots/*.json` (24: personalities, tiers, reference, human-proxy, idle), `bot-params.ts`, `bot.schema.ts`, `resolve-profiles.ts` | deleted/replaced by 02 |
| callers: `tools/src/{levels,balance,balance-match}.ts`, `tools/test/{levels,bot-version}.test.ts`, `tools/src/content.ts` (BOT_VERSION gate) | 09 rewires per R6 |

### R2 Interface
- `Bot{player, decide(ctx, tick): Command[]}` unchanged. Driver calls every seat **every tick**, before `sim.step`; no cadence/phase offset (TW phase is 0).
- `createSeatBot(level, matchSeed, seatIndex, params: TwBotParams): Bot`; driver builds one per `level.bots` entry (02 changes entry to `{player, bot}`). Also exported for tools (human proxy).
- Reads only `ctx.view` (owner, garrison count = "level", free slots, positions, line list, static `special` and `drawsLines` flags, initial owner) and `ctx.canDraw(player, from, to)`. Emits only `DrawLine`. Never `CutLine`.
- Randomness: one stream per seat, `streams.fork('bot.tw', seatIndex)` from the match seed (03); sim RNG never touched. Only draw: `below(n)`, one per candidate source tested.
- Time: `MS_PER_TICK = 50` (`1000/TICK_RATE`); all timers are integer ms accumulated per tick. TW `deltaTime` and `DOVirtual` (scaled vs unscaled) collapse to sim time.
- A seat with zero towers does nothing and its timers freeze (TW updates only while `Buildings.Count > 0`, 04#2). No decisions after game over.

### R3 Default AI (04#3, 04#12.3)
```
decideDefault():                      // literal branch order of DefaultBehavior.UpdateBehavior
  if timer < AD: timer += 50; return
  timer -= AD                         // carry remainder
  free    = own towers, drawsLines, slots-lines > 0
  targets = all towers with owner != me (houses, shooting towers, neutrals, other AIs, human)
  sort ascending by (key, towerIndex);  key = L, or idiv(2L+1, 3) if tower.special   // L/1.5 never hits .5 so round-half-even == this
  attack(): for t in targets: cand = copy(free); while cand: s = cand[rng.below(n)];
              if noLineBetween(s,t) && canDraw(me,s,t)==null: return DrawLine(s,t)   else remove s
  if attack drew: return
  if behavior=="full": defense(): cand = free minus trolleys; while cand: d = cand[rng.below(n)];
              others = own towers != d sorted by (dist²(d,o), index); first with noLineBetween && canDraw==null -> DrawLine(d,o); else remove d
```
- `noLineBetween(a,b)`: no existing line a<->b of **any owner, either direction** (TW `HasWayWith` is symmetric over `addedWays`) [verified: decomp `Building/HasWayWith` + `<>c__DisplayClass100_0/_HasWayWith_b__0`]. So the AI never opens head-on lines.
- `special` is read from `buildingStatic.special` **only** (static flag; `house-wt2.special=true`, `house-wt1` and `tower` false, set in 02 data); the bot never derives it from unit kind. Semantics: house unit kind != default soldier (TW `WT != 1`, tank/artillery) [verified: 04#3.1]. `behavior`: `full` (BT 0) or `attackOnly` (BT 1/2, identical) [verified: 04#0.2].
- Obstacles/rivers: AI has no geometry; blocked pairs fail `canDraw` and are skipped like any invalid pair.
- Deviation: ties in `key` (TW unstable introsort) -> building index, which is the TW `BD` flatten order (05 R2 order rule: buildings concatenated per `P` entry in ORIGINAL `P` order; ids `b<twId>` are keys only).

### R4 Script interpreter (04#6.2)
Queue of ops (order = TW `I`) runs to completion one at a time; when empty, `decideDefault` starts with `timer = 0` and never ends. A seat running a script op does not run default logic that tick.
| Op | Semantics at 20 Hz |
|---|---|
| `delay{ms}` | timer reset at start; += 50/tick; done when `>= ms` |
| `line{own,target,afterMs}` | skipped at start if `own`'s **initial** owner != me; after `afterMs` run `scriptLine`, then done |
| `steps{root}` | done when every node done. Node `{goal,own,target,delayMs,then[]}`: on start, if `own` set and not mine -> node done (children still start). Else fire at `start + max(1, ceil(delayMs/50))` ticks; re-check ownership; `none` -> done; `line` -> `scriptLine`, done; `capture` -> `scriptLine`, then poll every 20 ticks: done if `own` not mine or `target` null or `target.owner == me`. Done => all `then` children start the same tick, in list order |
| `scriptLine(own,target)` | `target` null => nothing. If `own` mine and `noLineBetween` and `canDraw` ok -> `DrawLine`. Else fallback: if I own < 2 towers stop; first own free tower in index order, not `own`/`target`, with `noLineBetween`+`canDraw` ok -> `DrawLine`; else nothing |
- Several nodes may emit in one tick; the bot keeps a per-tick ledger (used slots, drawn pairs) so it never sends a command the earlier one invalidated.
- No RNG in scripts.

### R5 Level `bot` block (contract required from 02/05)
```jsonc
"bot": { "kind": "tw",
  "actionDelayMs": 12000,          // AD*1000, int >= 50
  "behavior": "full",              // "full" (BT 0) | "attackOnly" (BT 1,2)
  "script": [                      // omit/[] if none; order = TW I
    { "op": "delay", "ms": 8000 },
    { "op": "line",  "own": "b3", "target": "b2", "afterMs": 6000 },
    { "op": "steps", "root": { "goal": "line"|"capture"|"none", "own": "b1", "target": "b2",
         "delayMs": 5000, "then": [ /* same shape */ ] } } ] }
```
- Ids are level building ids (`b<twId>`); `own`/`target` may be `null` (TW ids that resolved to nothing or a dropped resource pile, 02#3). Durations int ms (importer rounds TW floats). Building array order = TW `BD` flatten order (05 R2).
- `MinRD/MaxRD` are **not** imported (dead data); `AiRM` ops are dropped by 05 (TW skips them instantly without rails). 
- Per-level compile output feeds the content hash so `BOT_VERSION`/botHash gates still detect param drift.
- Needed from 03 view: `buildingStatic.special` and `drawsLines` static flags, free-slot count, initial owner, `lines` with owner+endpoints. From 04: `canDraw` rejects pairs whose corridor crosses an obstacle **or a third building** (tower or house; TW `CheckCreateWayCondition`).

### R6 Tooling semantics (09 wires)
- `@node-arena/bots` exports `HUMAN_PROXY = {kind:'tw', actionDelayMs:2000, behavior:'full', script:[]}`; tools play it on the human seat.
- `validate:levels`, per level and seed 1..N: (a) human-proxy vs authored AIs terminates or hits the `maxTicks` cap (20000; reported as Capped, not a failure — spike: 5 levels stall), 0 rejected, seed-1 rerun hash equal; (b) an idle human never wins; (c) **solvable** = any win in N seeds over proxy `AD in {500, 1000, 2000}` with behavior `full` (faster = stronger); win rate is printed. Unsolved levels are listed in `tools/unsolved-by-proxy.json` (id + reason + owner sign-off) and the gate prints them as warnings, not failures. The owner manual pass is the real solvability check (Q4 [RESOLVED: owner]: allowlist + owner playtest); `levels-lock.json` still guards determinism. No committed-solution-replay fallback (no producer). Band-based `requiredWins` is retired (02/09 decide field).
- `balance`: rows per level for proxy `AD in {1000, 2000, 4000}` plus idle; report-only until targets are authored. `arena` mode: all seats `tw`.
- `bots:golden`: command logs + final hashes for 3 campaign levels (pos 4 passive AI; pos 6 three AIs with delay+line; pos 11 nested `steps`), guarded by the existing BOT_VERSION-must-increase rule.

### R7 Tests (`covers`-style names)
Unit: timer carry (AD=1700 acts ticks 34, 69, 104 (per timer-order-pin.md)...), sort key incl. `special`, tie by index, source uniformity (fixed-seed histogram), `noLineBetween` incl. reverse hostile line, defense nearest + index tie, `behavior` parity (BT 1==2 == full minus defense), never-`CutLine` lint, each script op (delay, line skip/fallback/<2 towers, steps skip-if-lost with children, capture poll at +20/+40 ticks, null target, parallel children, ledger), script->default handoff with `timer=0`. Integration: same level+seed twice => identical command log; replay verify; goldens.

## Architecture
```
packages/bots/src/  index.ts (Bot, guard, exports) · driver.ts (createBotDriver) · seat.ts (createSeatBot: state, queue, rng)
                    tw-ai.ts (decideDefault, attack, defense) · script.ts (ops, node tree, ledger) · harness.ts (kept)
```
Pure functions over `(view, canDraw, rng, state)`; state is plain data. No imports from sim internals.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Difficulty | None. Flat unit stats; strength = layout + `AD` + script | seatPower % (needs meta), keep tiers | Locked: no meta; TW's difficulty is a power % outside AI rules (04#8). Cost: TW Common bots start at 80% of player power; we are 100% |
| 2 | Utility bots | Delete, no coexistence | Keep as `kind` | Replaces game; dead code and goldens |
| 3 | Reaction handler | Not implemented, no params | No-op field; inverted-guard port | Inert as compiled (04#4); dead data churns hashes |
| 4 | Timer branch order | Copy TW literally (check, then add) | add-then-check | Exactness at 20 Hz |
| 5 | Ties | Tower index | Seeded shuffle | Total order, no RNG draws |
| 6 | Pair pre-check | AI-side `noLineBetween` (any owner) | Rely on `canDraw` | Reproduces `HasWayWith`; sim may allow head-on |
| 7 | Human proxy | `tw` AD 2000 in tools | Authored solutions only | Cheap, deterministic; solutions remain fallback |
| 8 | Tower targets | All non-own towers incl. shooting towers | Houses only | `GetEnemiesHouses` = owner != me over all level buildings |

## Manual steps
None.

## Risks
- No ground truth (cannot run TW); several order-of-operation details come from decomp only.
- TW AI as human proxy may not win harder levels (no cuts or timing); mitigated by the any-of-3-`AD` rule, the `tools/unsolved-by-proxy.json` allowlist (warnings) and the owner pass.
- Without power scaling early levels may feel harder than TW; tuned only via level data.

## Open Questions
1. [RESOLVED: implementer reads decomp first, pins tests to it] Timer order in `DelayBehavior`/`CreateWayBehavior`/capture-poll first check: implementer reads `Game.Main.Player.{DelayBehavior,CreateWayBehavior}/UpdateBehavior.c` and `AiStepAction` first, pins tests to them.
2. [RESOLVED: tower is a normal capturable target (`GetEnemiesHouses` = all non-own buildings, D8); `special=false` via `buildingStatic.special` set in 02 data]
3. [RESOLVED: owner] Q4: proxy win rate on levels 4-23 is spiked first; rule = any win over `AD in {500,1000,2000}`; unsolved levels go to the `tools/unsolved-by-proxy.json` allowlist (warnings) and the owner playtest signs off.
4. [RESOLVED: 03 exposes exactly `streams.fork(name, index).below(n)`] 03 exposes `streams.fork(name, index).below(n)`? Needed API name (unchanged by the critique).
5. [RESOLVED: 05 keeps `BD` flatten order (per ORIGINAL `P` order), ids `b<twId>`; `special` comes from `buildingStatic.special` (02 archetype data, surfaced by 03 view)]
6. [RESOLVED: dropped, accepted; entry in docs/FUTURES.md] Resource-pile targets dropped: shifts weakest-first order on 412 levels; accepted unless piles are ported.
7. [RESOLVED: owner — boosters deferred] (no booster commands in scope; FUTURES).
8. [RESOLVED: inert] Reaction handler.
9. [DEFERRED] Rocket/railway/trolley/resource/boss AI; `seatPower`; useless-attack. Log in `docs/FUTURES.md`.

## Acceptance Criteria
1. `packages/bots` contains no utility/consideration/commitment/churn code; `pnpm lint typecheck test` green; `BOT_VERSION` 2.0.0.
2. Unit tests of R7 pass; identical seed => identical command log; `replay:verify` ok.
3. `bots:golden` committed for 3 levels; update rejected without version bump.
4. Levels 4-23 run TW-vs-TW to termination with 0 rejected commands; scripted levels (6, 11, 13, 15, 18, 20, 21, 22 and prefab 10) execute their openings (probe shows first scripted lines at the expected ticks).
5. No `CutLine`/`Math.random`/`Date` in package (lint test).
6. `bench:bots` reports per-decision cost on the largest level.
