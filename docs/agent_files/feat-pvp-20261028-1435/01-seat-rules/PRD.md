---
status: draft
summary: Rules/sim/defs/content support for 2-4 seats with teams, ally reinforcement, elimination, last-team-standing, timeout ranking and draw via a new `pvp` objective; campaign hashes and outcomes byte-identical.
date: 2026-10-28
---
# PRD: SP01 Seat rules (teams, elimination, PvP outcome)
Repo/branch: node-arena / `feat/pvp` · Depends on: none · Consumed by: SP02 (types), SP03 (level schema), SP04 (referee, bots), SP05 (view/result)
Owns: `docs/GAME_RULES.md`, `packages/defs/src/{objectives,events}.ts`, `packages/sim/src/{types,state,sim,win,hash,replay,read,contacts,crossings,modules/shoots}.ts`, `packages/content/src/{schemas,level,compile,versioning}.ts` (+ generated `schemas/*.json`, `content.json` rulesVersion), `packages/bots/src/{harness,tw-ai,version}.ts` (ally filter + harness `teams`), tests under `packages/*/test`, golden envelopes.

## M2 amendment (2026-10-29)
The original surrender non-goal below is historical M1 scope. SP07 adds a future M2 1v1 forfeit outcome and requires deterministic terminal logging/replay, rules and version design before coding; non-1v1 semantics remain open. Authoritative scope: [SP07 Pause, Quit and window-close forfeit](../07-pause-forfeit/PRD.md). Existing task lists await reconciliation after its open questions are settled.

## TL;DR
- New objective `pvp`; `captureAll` code path and semantics untouched. Win/elimination logic is branched on `level.objective`.
- Teams are a per-match `SeatSetup {teams[]}` given to `create()`; allies never fight, troops arriving at an ally building reinforce it (owner unchanged).
- PvP outcome = last team standing; at the time limit, rank teams by buildings then total troops owned (garrisons in owned buildings + troops in transit); exact tie = draw.
- Campaign proof: team column defaults to identity; pvp-only hash tail; campaign `simHash`/state hash/outcomes unchanged. Goldens change only in the `rulesVersion` metadata field (3.0.0 to 3.1.0).

## Problem
- Sim assumes one human: `humanSeat()` = first `kind` 0 [verified: sim/src/win.ts:6-11]; validator demands exactly 1 human [verified: content/src/level.ts:79]; `OBJECTIVES.captureAll.seats={human:1,aiMax:3}`.
- R-ENT-04 makes every player its own team; no ally concept; R-WIN-02 says no draw [verified: GAME_RULES.md].
- Outcome type `{won|lost|timeout, winner:number|null}` cannot express team wins, placements or draws.

## Goals / Non-Goals
Goals: 2-4 seats, any seat human or bot (decided outside the sim); teams (1v1, FFA, 2v2, 3v1); ally non-aggression + reinforcement; elimination; deterministic outcome with placements; testable headless with `runMatch`.
Non-goals: lobby/net/UI (SP02/04/05); the three maps (SP03); bot difficulty presets (SP04, bots package); alliance changes mid-match; shared ownership or control of ally buildings; surrender command in original M1 (future M2 forfeit: SP07).

## Requirements
| # | Requirement | M |
|---|---|---|
| R1 | `pvp` objective: 2-4 seats, every seat occupied for the whole match, no `bot` blocks in level data, `timeLimitSec` default 480 (9600 ticks), all buildings `ignoreForWin=false`. | M1 |
| R2 | `create(level, seed, setup?)`; `setup.teams[i]` = team id of seat i (ints `0..n-1`, at least 2 distinct). Absent = identity (each seat its own team). Level may carry default `teams`. | M1 |
| R3 | Same-team owners never fight: head-on (R-CMB-01), crossing (R-CMB-04), exchanges, and tower shots/targeting (R-TWR-02) skip allies. | M1 |
| R4 | A troop arriving at a building whose owner is on the troop owner's team reinforces it (`+defense`, cap and overflow as R-CAP-01/03); building owner unchanged. Ownership is re-evaluated per arrival (R-CMB-02), so a line to a building that an enemy captured now attacks it. | M1 |
| R5 | `DrawLine` to an ally building is valid (R-LIN-01 has no owner restriction); an ally's reverse line coexists (R-LIN-03 replacement stays same-owner only). | M1 |
| R6 | Seat elimination: owns no building AND owns no troops in transit; final; recorded `eliminatedAt` tick; event `SeatEliminated`. Evaluated phase 9, ascending seat. | M1 |
| R7 | Last team standing: when exactly one team has a non-eliminated seat, outcome `victory`, winners = all seats of that team (eliminated teammates included). | M1 |
| R8 | Time limit: `tick >= limit` after R7 check. Rank teams by non-neutral buildings (desc), then total troops owned (desc) = garrisons in owned buildings + troops in transit. Unique best = `timeLimit`; tied best = `draw` with winners = the tied top teams' seats (also when 3+ teams exist and only the top teams tie). Zero teams alive = `draw`, winners `[]`. | M1 |
| R9 | Placement: `ranking[]` per team: eliminated teams ranked below live ones, later `eliminatedAt` better, equal values share rank. | M2 |
| R10 | Bot targeting ignores allies (candidate targets exclude same-team buildings; reinforcing allies is not a bot behaviour in v1). | M2 |
| R11 | Campaign (`captureAll`) behaviour, `simHash`, state hashes, replays: unchanged. | M1 |

## Architecture
**Rules doc (`GAME_RULES.md`).** `RULES_VERSION` 3.0.0 to 3.1.0 (minor, additive).
- New ids: `R-SEA-01` (seat setup, kinds are lobby-level, no privilege), `R-TEM-01` (teams, identity default), `R-TEM-02` (ally non-aggression: CMB-01/04, towers), `R-TEM-03` (ally reinforcement), `R-ELM-01` (elimination), `R-WIN-04` (pvp last team), `R-WIN-05` (timeout ranking), `R-WIN-06` (draw), `R-WIN-07` (placement).
- Amended in place, not tombstoned (tombstoning would orphan existing `covers R-ENT-04` / `R-WIN-0x` tests): R-ENT-04 ("team = player id unless a `SeatSetup` assigns teams"; hostile = different team), R-WIN-01..03 gain "objective `captureAll`" scope; R-WIN-02's "no draw" scoped to captureAll. Each gets `Amended: 3.1.0`. Retired ids section unchanged.
- §4 table: phase 6/7 add R-TEM-02, phase 8 adds R-TEM-03, phase 9 adds ELM/WIN-04..07; §4.2 hash surface adds the pvp tail; changelog row 3.1.0 ("additive; campaign replays unchanged"); §8.2 test-ownership rows.

**Hostility helper.** `state.team: Int32Array` (static, length n). `hostile(a,b) = a !== b && (a < 0 || b < 0 || team[a] !== team[b])`; with identity teams equals today's `!==` [verified: owner compares at contacts.ts:30,36,42,62,94,163; crossings.ts:191-202; shoots.ts:87,102]. Arrival friendly branch (contacts.ts:163) becomes same-team. Troops keep the sender's owner; capture still kills troops sourced at the captured building [verified: contacts.ts:112-125], so "troops in transit" is observable as ring rows by `troops.owner` or `buildings.alive[src]`; consequently a seat with 0 buildings has 0 troops, and the dual condition is defensive. Implementation scans troops only when a seat has 0 buildings (bench-neutral).

**Win dispatch.** `winPass` switches on `level.objective`: `captureAll` runs the existing `evaluateOutcome` untouched; `pvp` runs `pvpOutcome`.

**Hash.** Domain stays `sim-state-v2`. Teams are static per match and live in replay header (`teams` optional), not mutable state. For `pvp` only, append after existing words: `team` words, `eliminatedAt` words, and in the `over` block `winners` count and ids. Campaign emits zero extra words [verified: hash.ts fully conditional on `state.over`/columns]. `ranking` is derived at match end and not hashed.

**Cross-project contract (SP02/04/05 consume):**
```ts
// @node-arena/sim
interface SeatSetup { teams: readonly number[] }              // len == level.players.length
create(level: CompiledLevel, seed: number, setup?: SeatSetup): Sim
interface Placement { team: number; seats: number[]; rank: number; buildings: number; troops: number; eliminatedAt: number | null }
type Over =
  | { outcome: 'won'|'lost'|'timeout'; winner: number|null }                       // captureAll, unchanged
  | { outcome: 'victory'|'timeLimit'|'draw'; winner: number|null;                  // pvp
      winners: number[]; ranking: Placement[] }                                    // winner = lowest winning seat, null on draw
// SimView additions: players[i].team: number; eliminatedAt: ReadColumn (-1 = alive)
// ReplayHeader.teams?: number[]  (absent for campaign); playReplay passes it to create()
// Events: SeatEliminated{player:int}; MatchOver gains outcome literals + optional winners
// bots: runMatch({..., teams?}); BotContext.view.players[i].team lets bots filter allies
```
`draw` with non-empty `winners` means shared first place. `winners` is always seat indices; map to nicknames in server/web.

**Content.** `OBJECTIVES.pvp = { seats: { min: 2, max: 4 }, ruleIds: [R-SEA-01, R-TEM-*, R-ELM-01, R-WIN-04..07] }`; validator branches on objective: pvp requires 2-4 players, kind `human` as slot placeholder, no `bot`, optional per-player `team` (default identity; dense ids, at least 2 distinct) and `timeLimitSec` (compile fills 480 when null). Compiled player gets `team` only when authored, so campaign `simHash` is unchanged [verified: computeSimHash hashes players minus colorKey, compile.ts:70-74]. `SCHEMA_VERSION` stays 2.0.0 (additive optional fields; bumping breaks exact-match replay headers and every level file).

**Bots.** `tw-ai.ts` target list ("all non-own buildings") filters same-team via `view.players[].team`; campaign behaviour identical so `BOT_VERSION` bump is a patch for hygiene (2.4.4 to 2.4.5) only if bot goldens' identity map changes; SP04 owns the real bump when adding PvP difficulty presets.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Campaign preservation | Branch on objective; identity teams; conditional hash tail | New hash domain; always hash teams | Keeps goldens/levels-lock bytes identical |
| D2 | Where teams live | `SeatSetup {teams}` at `create` + replay header; no `timeLimitTicks` in setup (time limit per map only; lobby override rejected) | In level JSON only; setup with time limit | Lobby picks teams at runtime [RESOLVED: agent recommendation] |
| D3 | Human/bot seat kind | Outside sim (server/lobby); pvp level kind = placeholder | `kind` in setup | No mechanical privilege (R-ENT-04); sim stays pure |
| D4 | Old rule text | Amend in place + `Amended` line | Tombstone + renumber | Preserves existing `covers` tests |
| D5 | Outcome names | `victory`/`timeLimit`/`draw` + `winners` | Reuse won/lost/timeout | Campaign save/UI treat `won` as level completion |
| D6 | Timeout tie-break "troops" | Total troops owned (garrisons + in transit) | Transit only | Transit-only is near-always 0 at timeout and would make draws common; total is the meaningful strength measure [RESOLVED: orchestrator] |
| D7 | Schema version | Unchanged | 2.1.0 | Exact-match replay header |
| D8 | Empty seats | Not in sim; lobby fills every level seat (human or bot) | Neutral seat | Keeps map symmetry; Cross is always 4 seats [RESOLVED: agent recommendation] |
| D9 | Ally lines into a captured ally building | Keep; now hostile | Auto-cut | Emergent, no new rule |

## Risks / Open Questions
- Golden envelopes change (`rulesVersion` only) because replay compat is exact major.minor [verified: replay.ts:114]; reviewer must confirm diffs contain no hash/outcome change. [RESOLVED: expected]
- Perf: `hostile()` in contact loops; gate on `pnpm bench:sim` (<0.3 ms mean, <1 ms p99, hash <0.5 ms). [RESOLVED: fast path when teams identity]
- `ranking.troops` = total troops owned (garrisons + in transit); exact ties on symmetric maps still possible (draws). [DEFERRED: tune after M1 play-test]
- Bot allies in v1 never reinforce; mixed human+bot teams are valid. [DEFERRED]
- [RESOLVED: orchestrator - timeout with 3+ teams where only the top teams tie = `draw`, winners = tied top teams' seats]
- [RESOLVED: orchestrator - no `SeatSetup.timeLimitTicks`: time limit is per map only (`level.timeLimitSec`); lobby override rejected as alternative (would diverge from `simHash`/level data)]

## Acceptance Criteria
- `pnpm check:rules` green: every new id has a test titled `covers R-...` (unit: hostility, ally arrival, tower skip, crossing skip, elimination, victory, timeout ranking, tie/draw, placement). M1
- Scripted matches via `runMatch`: 1v1; 4-seat FFA; 2v2 (`teams [0,0,1,1]`); 3v1; each ends with expected `outcome`/`winners`/`ranking` (timeout tests cover garrison-based tie-break and 3-team top-tie draw); replay round-trips with `teams` in header. M1/M2
- `pnpm sim:golden`, `pnpm bots:golden`, `pnpm replay:verify golden`, `pnpm levels:lock` check: only `rulesVersion` metadata differs; all hashes/outcomes identical. M1
- `pnpm validate:content --base HEAD`, `check:schemas`, `validate:levels` green; invalid pvp level (1 seat, 5 seats, bot block, single team, absent limit filled with 480) rejected or defaulted per R1/R2. M1
- `pnpm bench:sim` within budget; `pnpm typecheck`, `lint` (determinism rules) green. M1
