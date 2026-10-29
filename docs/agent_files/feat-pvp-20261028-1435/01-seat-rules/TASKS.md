---
status: draft
summary: 12 tasks (10 M1, 2 M2) adding pvp objective, teams, ally rules, elimination, last-team/timeout/draw outcomes, placement and bot ally filter without changing campaign hashes.
date: 2026-10-28
---
# Tasks: Seat rules (teams, elimination, PvP outcome)
Source of truth: docs/agent_files/feat-pvp-20261028-1435/01-seat-rules/PRD.md. Rules text and version bump come first, then tests, then code (AGENTS.md). Campaign (`captureAll`) behaviour, `simHash`, state hashes and replay outcomes must stay identical; only `rulesVersion` metadata changes. No [OPEN] items in the PRD.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M1] Rules doc + RULES_VERSION 3.1.0 | none | done |
| 2 | [M1] defs: pvp objective + events | 1 | done |
| 3 | [M1] content: pvp level validation, team field, 480 s default | 2 | done |
| 4 | [M1] sim: SeatSetup, teams state, hostility helper, view/replay header | 2 | done |
| 5 | [M1] sim: ally non-aggression | 4 | done |
| 6 | [M1] sim: ally reinforcement + ally lines | 4 | done |
| 7 | [M1] sim: elimination + pvp hash tail | 4 | done |
| 8 | [M1] sim: pvp outcome (victory, timeout rank, draw) | 7 | done |
| 9 | [M1] bots harness teams + scripted match suite | 3, 5, 6, 8 | done |
| 10 | [M1] Refresh goldens/locks + gate sweep | 9 | done |
| 11 | [M2] sim: placement ranking | 8, 9 | done |
| 12 | [M2] bots: ally filter in tw-ai | 4, 9 | todo |

## Task 1 — [M1] Rules doc + RULES_VERSION 3.1.0
What it is / what it means: Rule text is the contract that precedes tests and code (D4, R11).
What changes at a high level: In `docs/GAME_RULES.md` add R-SEA-01, R-TEM-01..03, R-ELM-01, R-WIN-04..07 (R-WIN-07 text lands now, tested in task 11). Amend in place with an `Amended: 3.1.0` line: R-ENT-04 (team = player id unless SeatSetup), R-WIN-01..03 scoped to `captureAll`, R-WIN-02 "no draw" scoped. Update the §4 phase table, §4.2 hash surface (pvp tail), changelog row 3.1.0 ("additive; campaign replays unchanged"), §8.2 test-ownership rows. Bump `RULES_VERSION` to 3.1.0 in sim. Retired ids section untouched. SCHEMA_VERSION stays 2.0.0 (D7).
Done when: doc reads consistently, version constant is 3.1.0, `pnpm check:docs` passes. `check:rules` may flag untested new ids until tasks 5-11 land; acceptable on-branch.

## Task 2 — [M1] defs: pvp objective + events
What it is / what it means: Registries must know the new objective and events before sim/content use them (R1, R6).
What changes at a high level: In `packages/defs` add `OBJECTIVES.pvp` (seats min 2, max 4; ruleIds R-SEA-01, R-TEM-*, R-ELM-01, R-WIN-04..07) leaving `captureAll` untouched. Add event `SeatEliminated{player}`; extend `MatchOver` with new outcome literals (`victory`/`timeLimit`/`draw`) and optional `winners`. Update registry tests.
Done when: defs tests/typecheck green; `captureAll` entry byte-identical.

## Task 3 — [M1] content: pvp level validation, team field, 480 s default
What it is / what it means: Level data may express pvp matches without disturbing campaign identity (R1, R2, D1, D7).
What changes at a high level: Validator in `packages/content/src/level.ts` branches on objective: pvp needs 2-4 players, kind `human` placeholder, no `bot` blocks, all buildings `ignoreForWin=false`, optional per-player `team` (dense ids, at least 2 distinct, default identity) and `timeLimitSec` (compile fills 480). Compiled player carries `team` only when authored so campaign `simHash` is unchanged. Regenerate schemas (`content:schemas`), update `content.json` rulesVersion. Tests: reject 1 seat, 5 seats, bot block, single team; default 480.
Done when: `check:schemas`, `validate:content --base HEAD`, `validate:levels` green; campaign level hashes unchanged.

## Task 4 — [M1] sim: SeatSetup, teams state, hostility helper, view/replay header
What it is / what it means: Foundation for all team behaviour (R2, hostility helper, cross-project contract).
What changes at a high level: `create(level, seed, setup?)` with `SeatSetup {teams}` validated (length = players, ints 0..n-1, at least 2 distinct); fall back to level default then identity. Add static `state.team` Int32Array and `hostile(a,b)` with identity fast path. `SimView` gains `players[i].team` and `eliminatedAt` column (-1 alive). `ReplayHeader.teams?` optional (absent for campaign); `playReplay` passes it to `create()`. Tests covers R-SEA-01, R-TEM-01 (identity default equals today's `!==`).
Done when: sim tests green; campaign replays/hashes unchanged.

## Task 5 — [M1] sim: ally non-aggression
What it is / what it means: Allies never fight (R3, R-TEM-02).
What changes at a high level: Replace owner `!==` hostility compares with `hostile()` in head-on combat and exchanges (contacts), crossings, and tower targeting/shots (shoots). Neutral (<0) stays hostile to everyone. Tests covers R-TEM-02 for: head-on, crossing, exchange, tower skip; plus a negative test that enemies still fight.
Done when: tests green; `pnpm bench:sim` still within budget (<0.3 ms mean, <1 ms p99).

## Task 6 — [M1] sim: ally reinforcement + ally lines
What it is / what it means: Troops reaching an ally building add defense instead of attacking (R4, R5, D9).
What changes at a high level: Arrival friendly branch in contacts becomes same-team: `+defense` with R-CAP-01/03 cap/overflow, owner unchanged. Ownership re-evaluated per arrival so a line to a building later captured by an enemy attacks it. `DrawLine` to an ally building validates; ally reverse line coexists (replacement stays same-owner). Tests covers R-TEM-03 including capture-after-line case and reverse-line coexistence.
Done when: tests green; campaign hashes unchanged.

## Task 7 — [M1] sim: elimination + pvp hash tail
What it is / what it means: Seats can die and the state hash reflects it for pvp only (R6, D1).
What changes at a high level: In phase 9, ascending seat, mark a seat eliminated when it owns no building and no troops in transit (scan troops only when a seat has 0 buildings); final, record `eliminatedAt`, emit `SeatEliminated`. For pvp only, append `team` words, `eliminatedAt` words and, in the `over` block, `winners` count and ids; domain stays `sim-state-v2`; campaign emits zero extra words. Tests covers R-ELM-01 and a hash test proving captureAll words unchanged.
Done when: tests green; `bench:sim` hash <0.5 ms.

## Task 8 — [M1] sim: pvp outcome (victory, timeout rank, draw)
What it is / what it means: Defines how a pvp match ends (R7, R8, D5, D6).
What changes at a high level: `winPass` switches on `level.objective`: `captureAll` runs existing `evaluateOutcome` untouched; `pvp` runs `pvpOutcome`. Last team standing = `victory` with all team seats as `winners` (eliminated teammates included). At `tick >= limit` (after last-team check) rank teams by buildings then total troops owned (garrisons + in transit): unique best = `timeLimit`; tied top teams = `draw` with winners = their seats (also in 3+ team cases); zero alive = `draw`, `[]`. `winner` = lowest winning seat or null. Extend `Over` type; `MatchOver` carries winners. Tests covers R-WIN-04, R-WIN-05, R-WIN-06 incl. garrison-based tie-break and 3-team top-tie draw.
Done when: tests green; captureAll outcomes unchanged.

## Task 9 — [M1] bots harness teams + scripted match suite
What it is / what it means: Headless proof of the full rule set (acceptance criteria).
What changes at a high level: `runMatch({..., teams?})` in `packages/bots` harness passes `SeatSetup` to `create`, records `teams` in the replay header. Add scripted-match tests: 1v1, 4-seat FFA, 2v2 (`[0,0,1,1]`), 3v1, each asserting outcome/winners; replay round-trip with `teams` in header. Use a small test-only pvp fixture level (SP03 owns real maps).
Done when: suite green; replay of each match reproduces identical final hash.

## Task 10 — [M1] Refresh goldens/locks + gate sweep
What it is / what it means: Replay compat is exact major.minor, so envelopes must carry `rulesVersion` 3.1.0 (R11, Risks).
What changes at a high level: Regenerate `sim:golden`, `bots:golden`, replay goldens, `levels:lock`, content lock as needed. Review that diffs contain only the `rulesVersion` field; any hash/outcome change is a bug. Run the full gate list: `check:rules`, `replay:verify golden`, `validate:content --base HEAD`, `check:schemas`, `validate:levels`, `bench:sim`, `typecheck`, `lint`, `pnpm test`.
Done when: all gates green and golden diffs are metadata-only.

## Task 11 — [M2] sim: placement ranking
Implemented early as an M1 gate dependency: R-WIN-07 was already active in the 3.1.0 contract, so its missing coverage blocked full CI. Original milestone: M2.
What it is / what it means: Per-team placements for results screens (R9, R-WIN-07).
What changes at a high level: Derive `ranking: Placement[]` at match end (team, seats, rank, buildings, troops, eliminatedAt): eliminated teams below live ones, later `eliminatedAt` better, equal values share rank. Not hashed. Extend scripted matches with ranking assertions (FFA staggered eliminations, shared ranks, timeout ordering). Tests covers R-WIN-07.
Done when: tests green; hashes unchanged versus task 8.

## Task 12 — [M2] bots: ally filter in tw-ai
What it is / what it means: Bots must not target teammates (R10); reinforcing allies stays out of scope.
What changes at a high level: `tw-ai.ts` candidate target list excludes same-team buildings using `view.players[].team`. Campaign behaviour identical (identity teams). Test: bot in a 2v2 never draws lines to ally buildings. `BOT_VERSION` already 2.4.5 (SP01 Task 10); regenerate bot goldens only if the identity map changes; SP04 owns the final bump.
Done when: `bots:golden` outcomes unchanged; tests green.
