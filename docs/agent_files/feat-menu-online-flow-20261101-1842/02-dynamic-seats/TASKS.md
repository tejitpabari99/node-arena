---
status: draft
summary: 6 tasks in AGENTS.md order - rules text + RULES 3.3.0, tests, sim forSeats, content/cross reorder + locks, net PROTOCOL 4, server range validation + audit.
date: 2026-11-01
---
# Tasks: SP02 Dynamic seats (2..max players per map)
Source of truth: docs/agent_files/feat-menu-online-flow-20261101-1842/02-dynamic-seats/PRD.md. No OPEN items. Mechanics order: rule text + changelog + RULES_VERSION first, then tests, then code. Run gates here before SP03 builds on it.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Rule text, changelog, RULES_VERSION 3.3.0 | none | done |
| 2 | Failing tests (sim, net, server) tagged R-SEA-01 | 1 | done |
| 3 | Sim `forSeats` + create() integration | 2 | done |
| 4 | Content: cross reorder, maxPlayers, locks, goldens | 3 | done |
| 5 | Net: room.create config, validators, PROTOCOL 4 | 2 | done |
| 6 | Server: applyConfig, range validation, players.length audit | 3, 4, 5 | done |

## Task 1 — Rule text, changelog, RULES_VERSION 3.3.0
What it is: the mechanics contract change, before any test or code.
What changes: `docs/GAME_RULES.md` R-SEA-01 amended (2..`level.players.length` seats; prefix of slots; unused slots' buildings neutral; `Amended: 3.3.0`), R-TEM-01 wording with n, neutral behavior note (R-ENT-04), changelog 3.3.0 "additive: existing replays unchanged"; bump `RULES_VERSION` in doc header, `packages/content/src/versioning.ts`, `content.json`. Keep tombstones.
Done when: `pnpm check:rules` and `pnpm check:docs` pass (test-tag coverage may flag R-SEA-01 until task 2; fine if tagged tests land in same series).

## Task 2 — Failing tests (sim, net, server)
What it is: tests encoding PRD R2-R8, titles containing `covers R-SEA-01` (and R-TEM-01).
What changes: sim tests for `forSeats`/create with n=2,3,4 on cross and n=2 on duel maps (unused homes `owner=-1` in `sim.view`, hash for full N unchanged); replay verify with n<N; net validate tests (room.create needs both or neither of levelId/seats; seats min 2); server lobby tests (2/3/4 seats ok; 1 or 5 -> `bad-lobby`; level switch applies seats; overflow -> spectators; 3-seat match with bot starts and replay verifies); handshake test expects PROTOCOL 4.
Done when: tests committed and fail only for the intended reasons; `pnpm check:rules` sees the tags.

## Task 3 — Sim `forSeats` + create() integration
What it is: pure `forSeats(level, n)` in new `packages/sim/src/seats.ts`, exported.
What changes: returns shallow clone with `players.slice(0,n)`, building owners `>= n` -> `-1`, same `id`/`simHash`; `create()` calls it when `setup.teams.length < level.players.length`, and validates `2 <= n <= N`, teams in `[0,n-1]` with >=2 distinct; absent setup = n=N identity. Replay header `teams` length defines n; verifier accepts range.
Done when: sim + replay tests from task 2 green; `pnpm test lint typecheck sim:golden replay:verify golden` green (full-N hashes unchanged).

## Task 4 — Content: cross reorder, maxPlayers, locks, goldens
What it is: data and content-package changes.
What changes: `na-pvp-cross.json` players order p1,p3,p2,p4 (opposite corners first), authored default teams `[0,1,0,1]`; `PvpMapInfo.seats` renamed `maxPlayers` (= `players.length`), callers updated; bump `contentVersion`; `pnpm content:lock`, `levels:lock` as needed; regenerate cross golden and `bots:golden`; bot-cross spec passes teams explicitly; document bumps (SCHEMA/BOT unchanged).
Done when: `pnpm validate:content --base HEAD`, `check:content --base HEAD`, `check:schemas`, `validate:levels`, `sim:golden`, `replay:verify golden`, `bots:golden`, `check:manifest` green; duel/campaign goldens and simHash unchanged.

## Task 5 — Net: room.create config, validators, PROTOCOL 4
What it is: wire changes.
What changes: `RoomCreateMsg` gains optional `levelId` + `seats` (both or neither); validator allow-list and `lobby.update.seats` min-length 2 / max `MAX_SEATS`; `lobby.state`/`start` seat arrays may vary in length; `PROTOCOL_VERSION` 3 -> 4; `empty` seat kind stays on wire.
Done when: net validate/handshake tests green; `pnpm test:net build:net lint typecheck` green.

## Task 6 — Server: applyConfig, range validation, players.length audit
What it is: server enforcement and audit of `players.length` assumptions.
What changes: `room.ts` `applyConfig(room, levelId, seats)` validating levelId known, `2 <= seats.length <= maxPlayers`, seat 0 human, kinds/difficulty/teams; level change + seats applied atomically, occupants on removed/non-human seats -> spectators; `room.create` uses it for initial config; `defaultSeats` = host + 1 open human, identity teams; Start guards range; rematch keeps seats. Audit grep `players.length` (renderer legends, bots harness `count` at harness.ts:82 -> use `forSeats` view, `validate:levels`); docs-only note in `defs/objectives.ts`.
Done when: server tests from task 2 green; `pnpm test:server build:server test lint typecheck`, `pnpm test:pvp:e2e` (existing flows, updated for cross order/teams) and `pnpm run ci` green.
