---
status: draft
summary: 20 tasks (9 M1, 8 M2, 3 M3) for apps/server - hub, rooms, 20 Hz global clock, referee sim, bot seats, spectators, limits, Docker/fly.toml, grace/reconnect, resync, load smoke.
date: 2026-10-28
---
# Tasks: Game Server (apps/server)
Source of truth: docs/agent_files/feat-pvp-20261028-1435/04-game-server/PRD.md. Transport-agnostic `Hub` over a `Socket` interface with injected clock; one thin `ws` adapter. SP01/SP02 deps use real task numbers; SP03 deps use real task numbers (SP03#2 Duel S, SP03#6 Duel M, SP03#7 Cross). No [OPEN] items in the PRD.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M1] Scaffold apps/server + root scripts | SP02#1 | todo |
| 2 | [M1] Config, logger, content loader | 1, SP01#3 | todo |
| 3 | [M1] Global clock | 1 | todo |
| 4 | [M1] Hub, connection, identity, hello | 2, SP02#3, SP02#4 | todo |
| 5 | [M1] Room lobby (2 seats), create/join, start | 4, SP01#4 | todo |
| 6 | [M1] Match: referee, lockstep, tick, hash check, end | 3, 5, SP02#6, SP02#8, SP01#8 | todo |
| 7 | [M1] ws adapter, /healthz, real-socket smoke | 6 | todo |
| 8 | [M1] Two-client acceptance on fixture + Duel S | 7, SP02#9, SP03#2 | todo |
| 9 | [M1] Command and input rejection hardening | 6 | todo |
| 10 | [M2] Bots: presets, seat driver, BOT_VERSION 2.5.0 | SP01#9, SP01#12 | todo |
| 11 | [M2] Full lobby editing and start validation | 5, SP01#3 | todo |
| 12 | [M2] Bot seats in match | 6, 10, 11 | todo |
| 13 | [M2] Spectators and mid-match catch-up | 6, 11, SP02#10 | todo |
| 14 | [M2] Host transfer, room GC, rematch | 11, 13 | todo |
| 15 | [M2] Limits and abuse controls | 7, SP02#11, SP02#12 | todo |
| 16 | [M2] Ops: env validation, health detail, SIGTERM drain | 7, 15 | todo |
| 17 | [M2] Dockerfile, .dockerignore, fly.toml | 16 | todo |
| 18 | [M2] Lobby-shape scenario suite | 12, 13, 14, SP03#6, SP03#7 | todo |
| 19 | [M3] Disconnect grace, bot takeover, resume, reclaim | 12, 13, 14 | todo |
| 20 | [M3] Auto-resync and load smoke | 19, SP02#13 | todo |

## Task 1 — [M1] Scaffold apps/server + root scripts
What it is / what it means: Gated workspace package so later tasks land under lint/test (R1, Decision 13).
What changes at a high level: `apps/server` package (`@node-arena/server`) with build, tsx-watch dev, `node:test` + tsx runner, tsconfig/typecheck, eslint config allowing `node:*`/`ws` but forbidding `apps/web`. Deps: pinned `ws`, workspace net/sim/bots/content/defs. Root `package.json` gets `dev:server` and server in test/lint/typecheck/build chains (minimal edit, rebase risk with SP02).
Done when: `pnpm --filter @node-arena/server` build/test/lint/typecheck pass on a placeholder; root `pnpm test`/`lint`/`typecheck` include it; forbidden `apps/web` import fails lint.

## Task 2 — [M1] Config, logger, content loader
What it is / what it means: Boot-time inputs (R2, Ops env, Content).
What changes at a high level: `config.ts` parses/validates env (PORT, HOST, ALLOWED_ORIGINS, INPUT_DELAY 1..10, MAX_ROOMS, MAX_CONNS, CONTENT_DIR, ALLOW_NO_ORIGIN, LOG_LEVEL; bad value = exit 1). `log.ts` JSON-line logger with no tokens/IPs. `content.ts` reads `CONTENT_DIR` raw strings into `ContentFiles`, calls `loadContent`, lists every `objective==='pvp'` level, assembles handshake versions; refuses to start on error. Test-only extra-level option for fixtures.
Done when: tests cover bad env, content error refusal, pvp level listing, fixture injection; compiled levels shared read-only.

## Task 3 — [M1] Global clock
What it is / what it means: Single drift-corrected 20 Hz loop for all rooms (Decision 1, R6).
What changes at a high level: `clock.ts` with injected `{now,setTimeout}`; `nextDue += 50`, per-wake run due rooms up to `MAX_CATCHUP=4`, rebase if >500 ms behind (log `clock.rebase`, no skipped/duplicate logical ticks), room `startAt` rounded to loop boundary, lateness p50/p99 exposed.
Done when: fake-timer tests: steady 50 ms cadence, 200 ms stall catches up within cap, >500 ms rebases with contiguous `n`, countdown start alignment.

## Task 4 — [M1] Hub, connection, identity, hello
What it is / what it means: Transport-agnostic entry (Decision 2, Identity, R7 gate).
What changes at a high level: `Socket` interface, `hub.ts` (`accept`), `conn.ts` (parse via net `parseClientMessage`, pre-`hello` only hello, 5 s deadline), `auth.ts` no-op slot. Handshake via net `checkHello`; `playerId = HMAC(secret, token)`; token index; new hello with same token supersedes old (close 4000). Errors for bad JSON/oversize, no crash.
Done when: fake-socket tests: version mismatch refused, hello deadline closes, supersede works, token never appears in logs or messages.

## Task 5 — [M1] Room lobby (2 seats), create/join, start
What it is / what it means: Room state machine up to countdown (R3, R4 M1, R5, Decision on state machine).
What changes at a high level: `room.create` -> 4-char code (31-char alphabet, `crypto.randomInt`), creator host seat 0; `room.join` play -> first open human seat or `room-full`; unknown code -> `room-not-found`. Lobby model with host-only level pick, non-host `lobby.ready`, `lobby.state` broadcast. `lobby.start` validates (2 humans ready), draws u32 seed, sends `start` with 3 s countdown, moves lobby -> countdown.
Done when: tests for create/join/full/not-found, host-only edits, start blocked until ready, seed from CSPRNG injection point.

## Task 6 — [M1] Match: referee, lockstep, tick, hash check, end
What it is / what it means: Core authoritative loop (Match, R6, R7, R8, R9, Desync M1).
What changes at a high level: `match.ts` builds `Sim` via `create(level, seed, {teams})`, `LockstepServer`, per-tick order exactly as PRD (bot cmds hook empty for now, closeTick, step, checkpoint every 20 ticks, single encoded broadcast, end via `toWireOutcome` with `finalHash`). Client `hash` -> `onHash`; mismatch -> `desync` to that socket only + structured log, rate-limited. Per-room try/catch -> `error internal` + `room.closed`. Server never waits on clients.
Done when: tests on manual clock: contiguous `n`, empty ticks sent, `end` once and clock stops, forced bad hash yields `desync` and log with room/seat/tick/hashes.

## Task 7 — [M1] ws adapter, /healthz, real-socket smoke
What it is / what it means: Real process entry (Decision 10, R18 basics).
What changes at a high level: `main.ts` creates `http` server with `GET /healthz` (`ok, rooms, conns, running, lateP99Ms, uptimeS, versions`; other paths 404) and wraps `ws` (maxPayload 4096) into `Socket`; wires clock to `performance.now`; uncaught -> log + exit(1) (Decision 11). Origin check is basic here (full in task 15).
Done when: loopback ws smoke test connects, hellos, creates a room and gets `room.joined`; `/healthz` returns 200 JSON.

## Task 8 — [M1] Two-client acceptance on fixture + Duel S
What it is / what it means: The M1 gate (Acceptance M1).
What changes at a high level: Fixture level under `apps/server/test/fixtures`; test harness with two simulated clients using net `LockstepClient` + `Sim`, scripted commands. Assert client hash == referee `sim.hash()` every 20th tick and at `end`; `end.outcome` == referee `view.over`; server command log passes `playReplay`. Repeat on Duel S once SP03 lands.
Done when: both fixture and Duel S runs green with hash equality and replay verification.

## Task 9 — [M1] Command and input rejection hardening
What it is / what it means: R7 and abuse acceptance for M1.
What changes at a high level: `cmd` accepted only from connected human seats during running; rejected from spectators, non-members, bot seats, pre-start; messages with injected `player` rejected via net parser; oversize/bad JSON produce `error` without crash. Tests for each.
Done when: all listed rejections return the expected error code and the match hash is unaffected.

## Task 10 — [M2] Bots: presets, seat driver, BOT_VERSION 2.5.0
What it is / what it means: Server-side bot support (Bots section, Decisions 3-5, R10).
What changes at a high level: In `packages/bots`: `pvp.ts` `createSeatDriver(level, matchSeed)` -> `{setBot, has, commands}` reusing `createSeatBot` (fork `bot.tw`, seat); `difficulty.ts` easy 3000 / normal 1500 / hard 700 ms, `behavior:'full'`; export from `index.ts`; `BOT_VERSION` 2.5.0. Unit tests: determinism, set/clear seat, player check. Regenerate bot goldens only if identity map changes.
Done when: bots tests pass; `pnpm bots:golden` and `check:content` unchanged except documented version fields.

## Task 11 — [M2] Full lobby editing and start validation
What it is / what it means: Complete lobby (R4 M2, lobby model).
What changes at a high level: host edits per-seat kind (human/bot/empty), difficulty, team; level change resets seats to defaults; flipping an occupied human seat to bot kicks occupant to spectator; `timeLimitSec` read-only from map; non-host only `lobby.ready`; start refuses `empty` seats, unready humans, invalid teams (SP01 rules).
Done when: tests per rule; `lobby.state` carries occupant `{nick,ready,status}` and spectator count.

## Task 12 — [M2] Bot seats in match
What it is / what it means: Wire bots into the tick (Match step 1, R10).
What changes at a high level: match builds `createSeatDriver`, `setBot` per bot seat with preset; step 1 collects `botCmds` from state after n-1 and passes them into `closeTick`. Bot commands are server-logged only.
Done when: 1 human + 1 bot match finishes with client/referee hash equality and a `playReplay`-valid log.

## Task 13 — [M2] Spectators and mid-match catch-up
What it is / what it means: Watch mode and late join (R11, Identity).
What changes at a high level: `room.join` watch -> spectator, cap 8 (`spectators-full`); mid-match join gets `start` (`youPlayer:null`) + `catchup` chunks (<=2000 ticks from `CommandLog.range`) then live subscribe in the same synchronous turn. Spectators read-only, receive identical tick bytes, survive rematch.
Done when: spectator joining mid-match reaches hash equality; 9th spectator refused; spectator cmd rejected.

## Task 14 — [M2] Host transfer, room GC, rematch
What it is / what it means: Room lifecycle (R12, R13, Decision 8).
What changes at a high level: host leave/lost -> earliest-joined connected human; none -> GC. GC timers: empty lobby 2 min, ended 10 min, running with no sockets/humans 60 s, hard match cap = limit + 2 min. `rematch` from a seated human returns room to lobby with same setup, ready cleared (sender ready), new seed next start, spectators kept.
Done when: tests on fake timers for each timer and transfer; rematch yields a different seed.

## Task 15 — [M2] Limits and abuse controls
What it is / what it means: R17, Abuse/security.
What changes at a high level: `verifyClient` Origin allowlist (exact + single-label wildcard; missing refused unless `ALLOW_NO_ORIGIN`); per-connection token bucket 40/s burst 80 with 3 strikes then close; per-IP (`Fly-Client-IP`) 8 conns, 5 creates/min, 10 failed joins/min; `MAX_ROOMS` 40, `MAX_CONNS` 200; backpressure skip-writes >256 KB with `ticks` batch on drain, close >2 MB; use net rate limiter and batching.
Done when: each limit refused in tests (41st room, 9th conn per IP, burst, bad Origin, lagging socket); IPs never logged.

## Task 16 — [M2] Ops: env validation, health detail, SIGTERM drain
What it is / what it means: R18 operational behaviour.
What changes at a high level: finish `/healthz` fields (lateness p99, versions), `LOG_LEVEL`, SIGTERM/SIGINT: stop accepting, send `room.closed{reason:'shutdown'}`, close 1001, exit within 8 s.
Done when: drain test exits under 8 s and clients receive `room.closed`; healthz shape asserted.

## Task 17 — [M2] Dockerfile, .dockerignore, fly.toml
What it is / what it means: Deployable artifact (R18, Ops).
What changes at a high level: `apps/server/Dockerfile` (two stage, repo-root context, corepack pnpm 10.34.6, frozen lockfile, workspace builds, `pnpm deploy --prod --legacy` verified at impl, content copied to `/out/content-data`, `USER node`, heap cap 192). Root `.dockerignore`. `apps/server/fly.toml` per PRD values incl. ALLOWED_ORIGINS and `/healthz` check.
Done when: image builds, boots, `/healthz` 200 with content loaded; `fly config validate` passes.

## Task 18 — [M2] Lobby-shape scenario suite
What it is / what it means: M2 acceptance across shapes.
What changes at a high level: fake-socket scenarios with client hash equality: 2 humans + 1 bot (3-seat/Cross), FFA 4, 2v2 `teams [0,0,1,1]` with bots, mid-match spectator, host transfer, rematch new seed, lobby rule rejections.
Done when: all scenarios green in `pnpm test`.

## Task 19 — [M3] Disconnect grace, bot takeover, resume, reclaim
What it is / what it means: R14, R15, Decision 9, Disconnect FSM.
What changes at a high level: per-seat FSM `connected -> grace(30 s) -> bot`, `grace -> connected` on resume (token + catch-up), `bot -> connected` on reclaim (bot dropped next tick); `seat.status` broadcast every transition, also in lobby (30 s seat free); commands from non-connected seats dropped. Takeover uses a fresh normal seat bot at tick T. M2 behaviour (returns as spectator) replaced.
Done when: fake-clock tests: bot commands appear after 30 s and clients stay hash-equal; resume in grace converges; reclaim after takeover works.

## Task 20 — [M3] Auto-resync and load smoke
What it is / what it means: R16, R19.
What changes at a high level: after `desync`, resend full log as `catchup` from 0, limit 1 per 10 s per seat. Load script runs N concurrent bot-filled rooms and reports tick lateness p50/p99, RSS and CPU per room.
Done when: forced mismatch resyncs and converges; 20-room smoke shows loop lateness p99 < 25 ms and RSS < 200 MB, with CPU/room reported.

## Manual steps (owner)
`fly apps create`, confirm app name/region, set `FLY_API_TOKEN` GitHub secret (SP06 consumes), set `ALLOWED_ORIGINS`.
