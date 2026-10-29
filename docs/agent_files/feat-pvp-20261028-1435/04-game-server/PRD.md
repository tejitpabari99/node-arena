---
status: draft
summary: apps/server - Node ws game server hosting private PvP rooms, lobby, 20 Hz lockstep clock, referee sim, bot seats, disconnect/reconnect, outcome authority; Fly.io artifact
date: 2026-10-28
---
# PRD: Game Server (apps/server)
Repo/branch: node-arena / feat/pvp · Depends on: 01-seat-rules (sim/outcome), 02-net-protocol (messages, Lockstep*, CommandLog), 03-pvp-maps (levels; M1 gate needs Duel S) · Owns: `apps/server/**`, `packages/bots/src/{pvp.ts,difficulty.ts,index.ts,version.ts}` (presets + dynamic seat driver + BOT_VERSION), root `package.json` server entries, `.dockerignore`, `docs/agent_files/.../04-game-server/`

## M2 amendment (2026-10-29)
SP07 (settled) supersedes the old grace->bot/reclaim plan (R14/R15, disconnect FSM, Decision 9) for human players: one cumulative 30 s per-human budget, holds, seat-only forfeit (team/FFA included), unlimited pause when no other human. M2 adds: heartbeat (3 s ping / 7 s timeout, close 4004), pause module + clock remove/re-add with `boundary(now())`, `Forfeit` via `closeTick` system cmds, minimum reconnect (token reclaim, full `catchup` from `CommandLog.range`, `pause.state`, stored `end`), removal of the running-room 'all conns closed => drop' path, deadline-safe GC (`gc()` never drops a room with a pending deadline; ended rooms kept 10 min; sole-human unlimited abandonment closes `idle` after 10 min). Lobby (R12 refined): dropped seat reserved 30 s for token reconnect then freed; host passes to next human seat; a drop during the 3-2-1 countdown cancels to lobby. Remaining M3: auto-resync (R16), load smoke (R19), SIGTERM drain. Authoritative scope: [SP07 Pause, Quit and window-close forfeit](../07-pause-forfeit/PRD.md).

## TL;DR
One Node process (ws + `http` health) holding all rooms in memory. Per room: lobby state machine -> referee `Sim` + `LockstepServer` + bot seats -> one `tick` broadcast per 20 Hz tick from a single drift-corrected global loop. Server owns seed, bot commands, hashes, outcome. Reconnect/spectate = replay log from tick 0. Thin ws adapter over a transport-agnostic `Hub`, so integration tests use fake sockets and a manual clock.

## Problem
Nothing hosts matches. Clients (05) are dumb lockstep followers; someone must pace the clock, stamp commands, run bots, detect desync, decide winners, survive disconnects, and resist abuse, on a 256 MB shared CPU.

## Goals / Non-Goals
Goals: correct authoritative lockstep; every lobby shape (1v1, FFA, 2v2, bot fill, spectators) works; one bad client/room never degrades others; deployable image.
Non-goals: auth (slot only), matchmaking, chat, persistence, server replays, multi-machine, snapshot restore, Fly workflow (06), client code (05).

## Requirements
| ID | Requirement | MS |
|---|---|---|
| R1 | `pnpm --filter @node-arena/server` build/test/lint/typecheck; `pnpm dev:server` runs it with tsx watch | M1 |
| R2 | Boot loads content from disk (no Vite), exposes all `objective==='pvp'` levels; refuses to start on content error | M1 |
| R3 | `room.create` -> 4-char code (31-char unambiguous alphabet, `crypto.randomInt`), creator = host, seat 0. `room.join` play/watch by code. Unknown code -> `room-not-found` | M1 |
| R4 | Lobby: host edits level/seats(kind, difficulty, team) (time limit is per map, not editable); non-host only `lobby.ready`; start requires every seat human-occupied+ready or bot (no `empty`), valid teams (SP01 R2) | M1 (2 seats), M2 (full) |
| R5 | `lobby.start`: server draws seed (u32, `crypto.randomInt`), builds referee, sends `start` (countdown 3 s), clock begins after countdown | M1 |
| R6 | 20 Hz tick: exactly one `tick` per tick to players + spectators, identical bytes; empty ticks included | M1 |
| R7 | Server stamps `player` and tick (via LockstepServer); only connected human seats may send `cmd` | M1 |
| R8 | Hash checks every 20 ticks vs referee; mismatch -> `desync` + structured log (room, seat, tick, both hashes) | M1 |
| R9 | `end` sent once on `sim.view.over`; room -> `ended`; clock stops | M1 |
| R10 | Bot seats: preset difficulty easy/normal/hard (see Architecture); bot cmds appended server-side | M2 |
| R11 | Spectators (cap 8): join in lobby or mid-match via `start` + `catchup`; read-only; survive rematch | M2 |
| R12 | Host leaves/lost -> host moves to earliest-joined connected human; no humans left -> room GC | M2 |
| R13 | Rematch: back to lobby, same setup, ready cleared, new seed on next start | M2 |
| R14 | [SUPERSEDED by SP07 2026-10-29] Historical M3 proposal (M2 1v1 superseded by SP07): disconnect mid-match: `seat.status grace` 30 s, then bot takes seat; reconnect in grace resumes via token + catch-up | M3 |
| R15 | [SUPERSEDED by SP07] Historical non-1v1 proposal pending SP07 policy; no 1v1 takeover: after takeover, original token may reclaim seat; bot yields | M3 |
| R16 | Auto-resync on `desync`: resend full log; per-seat limit 1 per 10 s | M3 |
| R17 | Limits/abuse: origin allowlist, maxPayload 4 KB, per-connection token bucket, per-IP conn/create caps, max rooms, failed-join throttle | M2 |
| R18 | `/healthz`, JSON-line logs, SIGTERM drain, Dockerfile, fly.toml | M2 |
| R19 | Load smoke: N concurrent bot-filled rooms, tick lateness + CPU per room reported | M3 |

## Architecture
**Layout** `apps/server/src`: `main.ts` (env, http+ws, signals) · `config.ts` · `content.ts` · `hub.ts` (rooms map, connections, limits) · `room.ts` (state machine) · `match.ts` (referee, lockstep, bots, outcome) · `clock.ts` · `conn.ts` (per-socket: parse, buckets, backpressure) · `auth.ts` (slot) · `log.ts`. Deps: `ws` (pinned), workspace `net, sim, bots, content, defs`. Tests `test/*.test.ts` via `tsx --test` (same as net). eslint: may use `node:*`/`ws`, may not import `apps/web`. `Hub.accept(socket: Socket)` takes `{send,close,onMessage,onClose,bufferedAmount}`; `main.ts` wraps `ws`.

**Content.** `content.ts` reads `CONTENT_DIR` (default `packages/content/data`; Docker: `/app/content-data`) into `ContentFiles` as raw strings (same shape as web's `import.meta.glob ?raw` [verified: apps/web/src/app/boot.ts:2]) and calls `loadContent` [verified: content/src/content.ts]. Versions for handshake: `RULES_VERSION`, schema, `content.json` version, `BOT_VERSION`. `compiled[levelId]` is shared read-only across rooms.

**Room state machine.** `lobby -> countdown -> running -> ended -> lobby (rematch)`; any state -> `closed`.
- Lobby model: `{host, levelId, timeLimitSec (read-only, from map), seats[{kind, difficulty, team, occupant?:{playerId,nick,ready,status}}], spectators[]}`. Changing level resets seats to defaults (seat 0 host human; others human open; teams identity). Joiner takes first open human seat, else `room-full`; `watch` -> spectator (`spectators-full` at 8).
- Host may flip a human-occupied seat to bot: occupant is kicked to spectator.
- Lobby disconnect: seat freed after 30 s (same timer), host transfer per R12. Empty-of-sockets lobby GC 2 min; `ended` GC 10 min; running room with no connected sockets and no human seats GC 60 s; hard cap match = limit + 2 min.
- Per-room `try/catch` around tick work: failure logs, sends `error internal` + `room.closed`, other rooms unaffected.

**Match.** On start: `sim = create(level, seed, {teams})` (time limit comes from the map level only); `lockstep = new LockstepServer(...)`; `bots = createSeatDriver(level, seed)`; `setBot(seat, preset)` for bot seats. Tick `n`:
1. `botCmds = bots.commands(sim)` (state after n-1)  2. `{n, cmds} = lockstep.closeTick(botCmds)`  3. `sim.step(cmds, {events:false})`  4. if `sim.view.tick % 20 === 0` -> `lockstep.recordCheckpoint(tick, sim.hash())`  5. `encode({t:'tick',n,c})` once, write to every non-behind socket  6. if `sim.view.over` -> `end` via net `toWireOutcome`, `finalHash = sim.hash()`.
Server never waits for any client. Client `hash` -> `lockstep.onHash`.

**Clock** (`clock.ts`, injected `{now(): number /*ms, performance.now*/, setTimeout}`). One global loop for all running rooms (one timer, not N): `nextDue += 50`; `delay = max(0, nextDue - now())`; per wake, run every running room whose `startAt` has passed, at most `MAX_CATCHUP=4` ticks each; if behind > 500 ms, rebase `nextDue = now()` (logical ticks stay contiguous; clients just see a slower clock, never a skipped/duplicate `n`) and log `clock.rebase`. Room `startAt` = start + countdown rounded up to the next loop boundary. Exposes lateness (p50/p99) to `/healthz`.

**Bots.** `createBotDriver` is fixed to `level.bots` and pvp levels have none [verified: bots/src/driver.ts:21; SP01 R1], so add `packages/bots/src/pvp.ts`: `createSeatDriver(level, matchSeed) -> {setBot(seat, SeatBot|null), has(seat), commands(sim)}`, reusing `createSeatBot(level, seed, seat, params)` (RNG `fork('bot.tw', seat)`, player check as driver.ts:34 [verified]). Takeover creates a fresh seat bot at tick T (timer 0): safe because bot output is only ever consumed as logged commands; clients never run bots. Presets in `difficulty.ts` (`SeatBot` shape, `actionDelayMs` lower = harder; `HUMAN_PROXY` is 2000): easy 3000, normal 1500, hard 700, all `behavior:'full'`, empty script. Takeover default `normal`. `BOT_VERSION` 2.4.5 -> 2.5.0 (minor: presets + seat driver; SP01 ally filter lands first); regenerate bot goldens only if their identity map changes.

**Identity / reconnect.** `hello{token, nick, auth?}`. `playerId = HMAC(serverSecret, token)` hex (public id; token never echoed or logged). Hub index `token -> {room, seat|spectator}`. New hello with a token that already has a connection supersedes the old (close 4000). If the token owns a seat/spectator slot: `welcome{resume}` -> `room.joined` -> `lobby.state` -> (running) `start` + `catchup` chunks (<=2000 ticks, from `CommandLog.range`) then live subscribe in the same synchronous turn. Spectator mid-match join = same path with `youPlayer:null`. Auth slot: `auth.verify(hello.auth) -> {uid?} | null`, default no-op; room logic keys on `playerId` only.

**Historical disconnect FSM [SUPERSEDED by SP07 for all human players].** `connected -> grace(30s) -> bot` ; `grace -> connected` on resume; `bot -> connected` on reclaim (M3, token must match, bot dropped from driver next tick). Every transition broadcasts `seat.status`. Commands from a seat not `connected` are dropped.

**Desync.** Server hash is truth. M1/M2: send `desync{tick, serverHash}` to that socket only, log, rate-limited. M3: follow with full `catchup` from 0; client rebuilds sim (05).

**Abuse / security.**
- Upgrade `verifyClient`: `Origin` in `ALLOWED_ORIGINS` (exact, plus `*` single-label wildcard for Firebase preview channels, e.g. `https://node-arena-99--*.web.app`); missing Origin refused unless `ALLOW_NO_ORIGIN=1` (tests). Origin is a courtesy, not auth.
- `ws maxPayload` 4096; all frames via net `parseClientMessage`; pre-`hello` only `hello` accepted, 5 s deadline.
- Connection token bucket 40 msg/s burst 80 (cmd-level limits come from net `ratelimit`); abuse -> `error rate-limited`, then close at 3 strikes.
- Per-IP (from `Fly-Client-IP`, else socket): 8 conns, 5 room creates/min, 10 failed joins/min. IPs live in memory only, never logged.
- Caps: `MAX_ROOMS` 40, `MAX_CONNS` 200. Backpressure: `bufferedAmount > 256 KB` -> skip tick writes, `ticks` batch on drain (net R11); >2 MB -> close.
- Logs: JSON lines `{ts,level,ev,room,matchId,...}`; nickname only at `room.join`; no tokens/IPs/IDs-of-users.

**Ops.**
- `GET /healthz` (same port) -> `{ok, rooms, conns, running, lateP99Ms, uptimeS, versions}`; other HTTP paths 404.
- SIGTERM/SIGINT: stop accepting, send `room.closed{reason:'shutdown'}`, close sockets 1001, exit within 8 s. Single machine => a deploy drops live matches (accepted; owner schedules deploys).
- Env: `PORT`(8080) `HOST`(0.0.0.0) `ALLOWED_ORIGINS` `INPUT_DELAY`(3, 1..10) `MAX_ROOMS` `MAX_CONNS` `CONTENT_DIR` `ALLOW_NO_ORIGIN` `LOG_LEVEL`; validated at boot, bad value = exit 1.
- `apps/server/Dockerfile` (build context = repo root): stage 1 `node:22-slim`, corepack pnpm 10.34.6, `pnpm install --frozen-lockfile`, build defs/content/sim/bots/net/server, `pnpm --filter @node-arena/server deploy --prod --legacy /out` (pnpm 10 needs `--legacy` without `inject-workspace-packages` [to verify at impl]); copy `packages/content/data` + `content.json` to `/out/content-data`; stage 2 runtime `USER node`, `NODE_OPTIONS=--max-old-space-size=192`, `CMD node dist/main.js`. Root `.dockerignore` excludes `node_modules`, `.worktrees`, `docs`, `apps/web`, assets.
- `apps/server/fly.toml`: app `node-arena-server`, `primary_region = "ewr"`, `[build] dockerfile`, `[http_service] internal_port=8080 force_https=true auto_stop_machines='off' auto_start_machines=false min_machines_running=1`, `[[vm]] shared-cpu-1x 256mb`, `[[http_service.checks]] GET /healthz`, `[deploy] strategy='immediate'`, `[env] ALLOWED_ORIGINS = "https://node-arena-99.web.app,https://node-arena-99.firebaseapp.com,https://node-arena-99--*.web.app"` (versioned, not secret; SP06 assumes it). Single machine (`fly scale count 1`).

**Cross-project contract (asks)**
- SP01: `create(level, seed, {teams})`; no `timeLimitTicks` in `SeatSetup` (time limit per map only). `view.over` shape per SP01. Sim `player` index == lobby seat index (confirmed by SP02).
- SP02 (consumed, now in the SP02 catalogue): `LockstepServer`, `CommandLog.range`, `toWireOutcome`, `encode`; `room.closed{reason}`; `lobby.state` with per-seat occupant `{nick,ready,status}`, `timeLimitSec` (from map) and spectator count; `start` also sent to spectators with `youPlayer:null`; `seat.status` also during lobby.
- SP03: pvp levels loaded from `packages/content/data/levels`; Duel S must land for the M1 gate. Until then M1 tests use a fixture level in `apps/server/test/fixtures` via `CONTENT_EXTRA_LEVELS`-style test option (test-only).
- SP05: consumes `catchup` rebuild path for resync; receives no clock beyond `tick`.
- SP06: image/fly.toml are inputs; workflow, secret `FLY_API_TOKEN`, `ALLOWED_ORIGINS` secret/var, web server-URL build var are theirs.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Clock | single global loop, hrtime-style drift correction, rebase if >500 ms behind | timer per room; setInterval | one timer, fair, no drift; logical ticks never skip |
| 2 | Testability | `Hub` over `Socket` interface + injected clock | spin ws in every test | fast deterministic tests; 1 real-ws smoke |
| 3 | Bot driver | new `createSeatDriver` in bots | fake `level.bots` per match | pvp levels carry no bot blocks; dynamic takeover |
| 4 | Difficulty | 3 presets via actionDelayMs 3000/1500/700 | per-field tuning in lobby | simple UI; tunable later in one file |
| 5 | BOT_VERSION | 2.5.0 minor | patch; none | additive API + presets, identity of existing bots unchanged |
| 6 | Code alphabet | 31 chars, 4 long (923k) | 6 chars | SP02 fixes 4; throttle + max 40 rooms makes guessing impractical; private rooms for friends |
| 7 | Token | client-random 128-bit, server stores HMAC id | server-issued | locked: localStorage token; not an auth credential |
| 8 | Rematch | any seated human `rematch` returns room to lobby (sender ready) | auto-restart on all votes | host still picks setup; fewer states |
| 9 | Post-takeover | token may reclaim seat (M3); M2 returns as spectator | permanent loss | friends' game, bot is stateless server-side |
| 10 | Health port | same HTTP server | separate port | Fly check + one internal port |
| 11 | Process failure | per-room try/catch; uncaught -> log + exit(1), Fly restarts | swallow | avoid corrupt shared state |
| 12 | Fly app/region | `node-arena-server`, `ewr` | iad, ord | owner in NYC; names are global [RESOLVED: agent recommendation] |
| 13 | Test runner | node:test + tsx | vitest | matches packages/net |

## Manual steps
- Owner: `fly apps create`, confirm app name/region, set `FLY_API_TOKEN` GitHub secret (06 consumes), set `ALLOWED_ORIGINS`.

## Risks / Open Questions
- [RESOLVED: orchestrator - no lobby time-limit override; time limit per map only, no `SeatSetup.timeLimitTicks`]
- [RESOLVED: lobby `empty` kind accepted in edits but start refuses it, matching SP01 D8 — agent recommendation]
- [RESOLVED: bots only seat-driven server side; clients never need bot code — agent recommendation]
- Risk: CPU burst credits on shared-cpu-1x. Mitigation: M3 load smoke; per-room cost est ~1% CPU (0.3 ms sim + serialize); MAX_ROOMS 40.
- Risk: single point of failure / deploy drops matches. Accepted; [DEFERRED] multi-machine, drain-aware deploys.
- Risk: CommandLog cap exceeded -> room aborted with `error internal`.
- [DEFERRED] late-joining spectator sees last result after end; Firebase token verification; reconnect across server restart.

## Acceptance Criteria
- M1: fake-socket integration, 2 humans on a fixture/Duel S: referee `sim.hash()` == each client `LockstepClient`+`Sim` hash at every 20th tick and at `end`; `end.outcome` == referee `view.over`; server log passes `playReplay`.
- M1: tick messages contiguous `n`, one per 50 ms on manual clock (fake-timer unit tests: steady state, 200 ms stall -> rebase without skipped `n`, MAX_CATCHUP respected).
- M1: cmd from spectator/non-member/bot seat rejected; injected `player` rejected; bad JSON/oversize -> error, no crash. `healthz` OK. Real-ws loopback smoke passes.
- M2: scenarios pass with hash equality: 2 humans+1 bot (3-seat/FFA fixture or Cross), FFA 4, 2v2 (`teams [0,0,1,1]`) with bots; spectator joins mid-match and reaches equal hash; host transfer; rematch yields new seed; lobby rules (non-host cannot update, start blocked on unready/empty).
- M2: limits: 9th spectator, 41st room, rate bursts, disallowed Origin, missing hello deadline each refused; Docker image builds, boots, `/healthz` 200, content loaded; `fly.toml` valid (`fly config validate`).
- Historical M3 disconnect acceptance (SUPERSEDED by SP07 for humans): disconnect -> `grace` -> after 30 s (fake clock) bot commands appear, match completes, clients still hash-equal; reconnect inside grace resumes and converges; reclaim after takeover works; forced hash mismatch -> `desync` -> resync converges; 20-room bot load smoke: loop lateness p99 < 25 ms, RSS < 200 MB, report CPU/room.
- Lint, typecheck, `pnpm test` include server; `pnpm bots:golden` + `check:content` unchanged except documented version fields.
