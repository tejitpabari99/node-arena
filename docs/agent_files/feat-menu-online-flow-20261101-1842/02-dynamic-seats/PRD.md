---
status: draft
summary: PvP maps become playable by any seat count from 2 to the map's slot count; unused slots' starting buildings turn neutral; lobby/protocol/server accept variable seat arrays; RULES 3.3.0, PROTOCOL 4.
date: 2026-11-01
---
# PRD: SP02 Dynamic seats (2..max players per map)
Repo/branch: node-arena / `feat/menu-online-flow` · Depends on: none · Consumed by: SP03 (lobby UI, map max)
Owns: `docs/GAME_RULES.md`, `packages/sim/src/{state,sim,replay,types,index}.ts` (+ new `seats.ts`), `packages/content/src/{pvp,versioning}.ts`, `packages/content/content.json`, `packages/content/data/levels/na-pvp-cross.json`, `hashes.lock.json`, `packages/net/src/{messages,validate,version}.ts`, `apps/server/src/{room,match}.ts`, `packages/defs/src/objectives.ts` (docs only), tests + goldens.

## TL;DR
- A map authors N slots (`players[]`, = max). A match uses the first n of them (2 <= n <= N), taken in `players[]` order; map author orders slots so every prefix is fair (cross: opposite corners first).
- Unused slots' buildings become neutral at their authored level; the unused players are dropped from the match.
- Sim derives this itself from `SeatSetup.teams.length` (= n). No new level field, no schema bump.
- Wire: `lobby.update.seats` and `lobby.state.seats` / `start.seats` may have any length 2..max; `room.create` gains optional `{levelId, seats}`; `PROTOCOL_VERSION` 3 -> 4; `RULES_VERSION` 3.2.0 -> 3.3.0 (minor).

## Problem
- Seat count is fixed to `level.players.length`: server rejects `msg.seats.length !== n` ("seat count must match level") [verified: room.ts:410-411]; sim rejects `teams.length !== players` [verified: state.ts:71]; `defaultSeats` maps every player to a human seat [room.ts:156-159].
- R-SEA-01 says a pvp match has 2-4 seats, all occupied, no empty/neutral placeholders [verified: GAME_RULES.md:501].
- `empty` seat kind exists in the lobby but blocks Start ("seats not filled") [verified: room.ts:451].
- `PvpMapInfo.seats` = `players.length` is the only capacity data [verified: content/src/pvp.ts].

## Goals / Non-Goals
Goals: any n in 2..N per map incl. bots; deterministic; existing full-seat matches/replays/goldens byte-identical; server enforces the range.
Non-goals: new maps (existing three suffice: duel-s/duel-m N=2, cross N=4); >4 seats (objective `pvp.seats.max` stays 4; UI cap 8 is satisfied by min(map max, 8) and future 8-slot maps need only data + objective bump [DEFERRED]); mid-match seat changes; removing the `empty` seat kind from the wire (stays, unused by new UI).

## Requirements
| # | Requirement |
|---|---|
| R1 | `maxPlayers` of a map = `players.length` (2..4 today). `PvpMapInfo` renames/adds `maxPlayers` (`seats` is renamed; callers updated). |
| R2 | `create(level, seed, setup)` with `setup.teams.length = n`, `2 <= n <= level.players.length`: match players = `level.players[0..n)`; each building owned by a slot >= n becomes neutral (`owner = -1`) keeping authored level; player indices in the match are 0..n-1. n = N is identical to today. Setup absent => n = N (identity teams). |
| R3 | Teams ints in `[0, n-1]`, >= 2 distinct (existing R-TEM-01 text with n). |
| R4 | Replay header already stores `teams`; its length defines n. Replay verifier accepts any n in range; `simHash` (level) unchanged. |
| R5 | Server: `lobby.update` (and `room.create` config) valid iff `levelId` known, `2 <= seats.length <= maxPlayers(level)`, seat 0 human (host), kinds/difficulty/teams as today, >= 2 distinct teams at Start. Level change in the same message applies the new seat array (no longer reset to defaults + ignored). Occupants on seats that no longer exist or are no longer human -> spectators; shrinking is allowed (occupied removed seats become spectators; UI avoids it, see SP03). |
| R6 | `start.seats`, `youPlayer`, match `teams`, pause/forfeit/bot driver all index 0..n-1 (already driven by `room.seats.length` [verified: match.ts:101-127]). |
| R7 | Neutral buildings left by unused slots behave as every neutral building (no growth/spawn; towers per `neutralFires`; capturable; count as neutral in ranking). |
| R8 | New goldens/tests: cross with n=2,3,4; duel maps n=2; replay verify; server lobby tests for count range; net validate tests. |

## Architecture
**Sim (`packages/sim/src/seats.ts`).** `forSeats(level: CompiledLevel, n: number): CompiledLevel` pure: returns a shallow-cloned level with `players.slice(0,n)`, building `owner` remapped (`>= n` -> `-1`; verify the compiled owner encoding, `-1` = neutral per `state.ts:83`), same `id`/`simHash`. `create()` calls it when `setup.teams.length < level.players.length` before building state. Exported so server (validation), web (seat colors, thumbnails) and bots harness use the same view. Per-slot data (player ids/colorKey) is kept, so seat colors follow slot not seat index; cross n=2 uses slots 0,1 (blue, red). `SeatSetup` type unchanged (`teams: readonly number[]`).
**State hash.** `players.n` and `owner` columns already hashed => n and neutralization change the hash automatically; full-N hashes identical. No new words.
**Content.** `na-pvp-cross.json`: reorder `players[]` so prefixes are fair: current coordinates p1(-7,0), p2(0,-7), p3(7,0), p4(0,7) -> new order p1, p3, p2, p4 (opposite pairs first). Authored default teams (used only when `SeatSetup` is absent: golden, editor play) become `[0,1,0,1]` over the new order (p1,p2 vs p3,p4); golden regenerated. `simHash` changes => `contentVersion` bump + `pnpm content:lock`; pvp has no bot blocks => `BOT_VERSION` unaffected. Duel maps untouched.
**Net.** `RoomCreateMsg = { t:'room.create'; levelId?: string; seats?: SeatConfig[] }` (both or neither). `validate.ts`: `room.create` allow-list adds the two keys; `lobby.update.seats` `arr(..., MAX_SEATS=8, ...)` stays (min length 2 checked in validator: `arr` min). `lobby.state` unchanged shape; seats length varies. `PROTOCOL_VERSION` 3 -> 4 (old client + new server would mismatch `seats.length === maxPlayers` assumptions; handshake already hard-fails on mismatch, giving the existing reload prompt).
**Server (`room.ts`).** Replace `defaultSeats` use on update: `applyConfig(room, levelId, seats)` validates & installs; `room.create` calls it for initial config (defaults: duel-s? first pvp map, 2 seats: human host + human). `defaultSeats(levelId)` now returns 2 seats (host + 1 open human) with identity teams. `start()` unchanged apart from the guard that seats count in range. Rematch keeps seat array.
**Docs.** `GAME_RULES.md`: R-SEA-01 amended ("2 to `level.players.length` seats; match uses a prefix of the slots; unused slots' buildings neutral" + `Amended: 3.3.0`), changelog 3.3.0 "additive: existing replays unchanged", `RULES_VERSION` in header + `versioning.ts` + `content.json`. Tests title-tagged `covers R-SEA-01`. Order: rule text -> tests -> code.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Unused slot buildings | Neutral, authored level kept | Delete buildings; zero-level neutral; give to nearest player | Keeps building indices/ids stable; owner decision recommended; neutral concept already exists (`owner<0`, R-ENT-04). Deleting reshuffles arrays and ids. Caveat: neutral lvl-12 homes become contestable prizes (acceptable, symmetric by slot order). |
| D2 | Which slots used | First n of `players[]`; map author orders slots for fairness | Explicit `seatOrder`/`activation` field; derive geometric spread | No schema change (SCHEMA_VERSION literal in every data file [verified: schemas.ts:7]); data-only fairness lever. |
| D3 | Max players property | Derived `players.length`, surfaced as `PvpMapInfo.maxPlayers` | Explicit `maxPlayers` level field | Single source of truth; no drift; no schema churn. |
| D4 | Where compaction happens | Inside `sim.create` via exported `forSeats` | Content compile variants; server-side level cloning | One code path for replay/server/web/bots; level `simHash` stays the identity of the map. |
| D5 | Version bumps | RULES minor 3.3.0; PROTOCOL 3->4; contentVersion bump (cross reorder); SCHEMA unchanged; BOT_VERSION 2.5.0 -> 2.5.2 (bumped during implementation) | RULES major | No existing replay outcome changes (full-N path identical; proven by unchanged goldens except cross default teams/order). Owner approved a bump. |
| D6 | Level change semantics | Single `lobby.update` carries levelId + full seats; occupants keep order, overflow -> spectators | Keep "reset to defaults" | Online form (SP03) edits map and counts atomically. |
| D7 | Create-with-config | Optional `levelId`+`seats` on `room.create` | create then update | Avoids a transient default room visible to joiners. |
| D8 | `empty` seat kind | Kept on wire, rejected by Start, no longer produced by UI | Remove (protocol break) | Zero-risk; dead for UI. [DEFERRED] removal. |

## Risks / Open Questions
- Cross golden/bot-cross e2e depend on slot order/teams. [RESOLVED: regenerate golden + `bots:golden`, keep teams as test input explicit; bot-cross spec passes teams explicitly]
- Neutral big homes at n=2 on cross change balance; bots may over-target them. [RESOLVED: acceptable; `pnpm balance` report-only; bot targeting treats neutral as any neutral]
- Any `level.players.length`-indexed code outside sim (renderer legends, bots harness `count`, `validate:levels` symmetry gate) must use the seat-reduced view. [RESOLVED: audit task: grep `players.length`; harness `count = level.players.length` [bots/harness.ts:82] gets `forSeats` level]
- Symmetry gate checks full-N symmetry only; prefix fairness (n<N) is unchecked. [DEFERRED: automated prefix-fairness gate; manual review for cross only]
- Old in-flight rooms during deploy. [RESOLVED: PROTOCOL bump + existing drain flow (SP09 of prior project)]

## Acceptance Criteria
- cross with n=2,3,4 runs headless to an outcome; unused homes owner = neutral in `sim.view`; n=4 hash equals pre-change hash modulo the reorder (golden refreshed once).
- duel-s/duel-m/campaign goldens and `simHash` unchanged (`pnpm sim:golden`, `replay:verify golden`, `check:content` green with documented bumps).
- Server tests: update with 2/3/4 seats on cross OK; 1 or 5 seats -> `bad-lobby`; level switch applies new seats; start with 3 seats (2 humans + bot) plays; replay record verifies.
- net validate rejects `room.create` with only one of `levelId`/`seats`; `PROTOCOL_VERSION` 4 handshake test updated.
- `pnpm run ci` green; `check:rules` sees `covers R-SEA-01` tests.
