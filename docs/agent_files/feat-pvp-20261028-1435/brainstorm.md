---
status: approved
summary: Live online PvP (2–4 seats, teams, bots, spectators) via lockstep + server referee on Fly.io
date: 2026-10-28
---
# Brainstorm: Online PvP

## TL;DR
Live real-time PvP for friends: private rooms by link, 2–4 seats (1v1, FFA, teams, bot fill), spectators. Netcode = deterministic lockstep (clients run `packages/sim`, exchange only tick-stamped commands) with a server-side headless referee sim whose hash is truth. Plain `ws` server in new `apps/server`, hosted on Fly.io (~$2/mo); web stays on Firebase Hosting (Firebase Auth later). Built in 3 milestones; M1 = 2-tab local 1v1 for play-test.

## Problem
Node Arena is single-player only (1 human seat vs AI). Owner wants to learn netcode, build and play PvP, and share it with friends. Source game (Tower War) has no real PvP (fake AI opponents), so nothing to port.

## Verified facts
- Sim deterministic: Int32Array state, integer math, seeded Sfc32 RNG, lint bans Math.random/Date/floats; fixed 20 Hz (`TICK_RATE`); `Sim.step(commands)`; commands applied in (player, submission) order; `sim.hash()`; replay recorder with 1 s hash checkpoints + `playReplay` divergence detection.
- Only 2 commands: DrawLine, CutLine. No fog/hidden info.
- Gaps: `captureAll` objective seats `{human:1, aiMax:3}`; win.ts `humanSeat()` single human; no teams (R-ENT-04 each player own team); no draw (R-WIN-02); no snapshot restore; web `GameDriver` rAF accumulator on local clock with pause/2x speed; `MatchResult {winner, human}`.
- `HUMAN_PROXY` in bots = AI standing in for human seat (testing), not a network adapter. Bots use same command API.
- No backend: Firebase Hosting only (project node-arena-99), localStorage saves, no accounts.
- Sim cost ≤0.3 ms/tick budget → full replay from tick 0 for rejoin/spectate is cheap (~4 s for 10 min match).
- Firebase Functions can't hold WebSockets; Cloud Run min-instance ≈$10/mo idle, 60 min request cap; Fly shared-cpu-1x 256MB ≈$1.94/mo.

## Decision log
| Decision | Alternative rejected | Why |
|---|---|---|
| Live real-time online | Async ghost, local hotseat | Real PvP; ghost can't react |
| N-seat model: 1v1, 2–4 FFA, bot fill, teams — all tested | 1v1 only | Owner: fold in, cheap given seat abstraction |
| Private rooms via code/link | Public matchmaking | Friends use case; no ranking needed |
| Lockstep + server referee sim | Pure lockstep; server-authoritative state streaming | Reuses deterministic sim; tiny bandwidth; referee catches desync & fake wins |
| Input delay ~3 ticks (150 ms), server-paced clock | Client-paced / stall-on-lag | Lines take time anyway; nobody stalls |
| Plain `ws` + own ~8-message protocol in `apps/server` | Colyseus | Colyseus is state-sync oriented; learning goal |
| Fly.io single always-on instance, rooms in memory | Cloud Run min 1; scale-to-zero; Redis multi-instance | Cheapest always-on, no conn cap |
| Web stays Firebase Hosting; Firebase Auth later via ID token verified by firebase-admin on server | Move everything | Keeps existing deploy |
| Identity: nickname + random localStorage token | Firebase anon / Google auth | No accounts until ranking |
| No pause/speed in PvP; disconnect → 30 s grace then AI bot takes seat; reconnect by log replay | Forfeit on drop | Friendly; restore not needed |
| Elimination = no buildings + no troops in transit; last team standing wins; timeout ranks buildings then troops; exact tie = draw | Keep single-human win | Needed for N seats |
| Campaign outcomes unchanged → minor RULES_VERSION bump; golden replays must verify | Major bump | Additive rules |
| Teams: allies can't hurt each other AND reinforce (troops to ally building add, ownership stays); team wins when only its seats remain | No-harm only; shared ownership | Makes teams meaningful, small rule |
| Spectators: watch link `?room=X&watch`, join anytime via fast-forward, no delay, cap 8, read-only | None | Owner asked; trivial with lockstep |
| Maps: 3 new symmetric (Duel S 2p, Duel M 2p, Cross 4p/2v2), agent-authored JSON, owner tweaks in editor | Reuse campaign maps | Campaign maps asymmetric |
| Lobby: host picks map + per-seat human/bot(difficulty)/empty/team; start when humans ready; non-host toggles own ready; rematch = same room/setup new seed | Free-for-all lobby | Simple |
| PvP time limit per map, default 8 min | Level timeout | Tune after M1 |
| Milestones M1 rules+net+local server+2-tab 1v1 → owner play-test; M2 lobby/teams/bots/spectators/rematch/maps/Fly deploy; M3 reconnect hardening, desync resync, load test | Big bang | Validate fun early |

## Design
| Part | Responsibility |
|---|---|
| `packages/defs`+`packages/sim` | N seats, teams, ally reinforce, elimination, outcome ranking/draw; GAME_RULES + minor RULES_VERSION |
| `packages/content` | `pvp` objective schema (seats 2–4, team slots, time limit); 3 maps |
| `packages/net` (new) | Protocol types+validation; lockstep scheduler (stamp tick+delay, per-tick buffers, hash compare); pure, shared |
| `apps/server` (new) | ws rooms/lobby, 20 Hz clock, referee sim, bot seats via `packages/bots`, grace→bot, reconnect/spectate via log replay; Dockerfile + fly.toml |
| `apps/web` | NetDriver (server ticks, no pause/speed), create/join/lobby screens, `?room=`/`&watch`, multi-seat HUD/ownership, N-seat/draw results |
| CI/ops | Fly deploy workflow, `FLY_API_TOKEN` secret, server URL env for web build |

Failure modes: desync → server hash wins, client rebuilds by replay + toast; server crash → room lost, clients see "match ended" (v1 OK); slow client → falls behind and catches up.

Verification: `covers R-...` sim tests; golden replays unchanged; headless server integration (2 fake clients + bot, hashes equal); Playwright 2-context full match.

## Non-goals
Matchmaking, ranking, accounts (Firebase Auth later), chat, mobile layout, server-stored replays, cosmetics, fog of war.

## Owner-only
Create Fly.io account + billing; add `FLY_API_TOKEN` to GitHub secrets.

## Open risks
| Risk | Cheapest test |
|---|---|
| 1v1 not fun (snowball) | M1 2-tab play-test |
| Hidden nondeterminism in web path (e.g. command parse/order) | Server integration hash test |
| 150 ms delay feels laggy | M1 play-test; make delay configurable |
| Single Fly instance restart kills rooms | Accept v1; M3 decide |
