---
status: approved
summary: M3 SP09 — SIGTERM drain with a notice window. Server stops creating/starting, broadcasts server.draining{deadlineMs}, lets running matches finish or aborts them at the deadline (no result, no rules change); room-close hook tears down match timers; fly.toml/hard-exit aligned; web shows the notice and a "server restarted" terminal state.
date: 2026-10-30
---
# PRD: SP09 Drain-aware restart

Repo/branch: node-arena / `feat/pvp-m3` · Milestone: **M3** · Depends on: SP04 (`main.ts` shutdown, `room.ts`, `match.ts`), SP05 (controller, `PvpLayer`), SP06 (`fly.toml`, `deploy-server.yml`, `docs/PVP_OPS.md`) · Coordinates with: SP08 (`room.ts` switch), SP11 (`messages.ts`/`validate.ts`/`version.ts`, acceptance sweep). Land order SP08 -> SP09 -> SP11.
Owns: `apps/server/src/{main,room,match,config}.ts` (drain, hook, healthz), `apps/server/fly.toml`, `.github/workflows/deploy-server.yml` (soft pre-deploy check), `packages/net/src/{messages,validate}.ts` (one message + one error code; version bump shared), `apps/web/src/pvp/controller.ts`, `apps/web/src/ui/pvp/{PvpLayer,Lobby,ConnBanner}.tsx`, `docs/PVP_OPS.md`, tests.

## TL;DR
Today SIGTERM instantly closes every room (`room.closed{shutdown}`, 1001) and hard-exits at 8 s (`main.ts` `shutdown`/`drain`, `fly.toml kill_timeout = 10`). Players get no warning and a match in its last minute dies like one in its first. SP09 adds a **drain window** (default 30 s): the server keeps serving, refuses new work, tells every client `server.draining{deadlineMs}`, exits early when no match is running, and otherwise aborts the remaining matches at the deadline with `room.closed{server-restart}`. No persistence, no result, no rules change.

## Problem (verified 2026-10-30)
- `shutdown()` (`main.ts`) = `http.close`, `clock.stop`, `hub.stop`, `rooms.closeAll('shutdown')`, close sockets 1001, 6 s grace; process hard-exits at 8 s; `kill_timeout = 10` must stay above 8 (`PVP_OPS.md:50`). Same-turn closure: no notice, and new `room.create`/`lobby.start` are racing the signal.
- `rooms.drop` (`room.ts` ~447) is the single removal point, but `closeAll`, `gc` (match-cap) and `onAbort` never tell the match controller; only `onStartCancel -> match.cancel` clears the clock membership and pause timers (`match.ts:328-331`). Pause timers are `unref`'d, so they do not block exit, but a closed/GC'd room keeps its deadline/idle timers armed until they fire (`pause.dispose()` is only called from `stop`/`cancel`).
- `hasPendingDeadline` makes `gc()` skip rooms with a pending pause deadline, so only the match-cap abort ever force-closes a paused room.
- The web already maps `room.closed` reasons `shutdown`/`server-restart` (`controller.ts:65`, "Server restarted. Room closed."), so the wire reason needs no change; the notice message and a refusal error code do.

## Goals / Non-Goals
Goals: warning before restart; finish-if-you-can; deterministic, bounded exit; no timer leaks; clean web terminal state; deploy output tells the owner when matches are live.
Non-goals: surviving restarts (room snapshot/restore, multi-machine, blue-green: [DEFERRED]); results for aborted matches; rematch across restart; blocking deploys on live matches (soft warning only); any sim/rules change.

## Requirements

| ID | Requirement |
|---|---|
| D1 | `startServer` returns `drain(opts?: { windowMs })` (new) beside the existing hard `shutdown()`. SIGTERM/SIGINT call `drain`. `DRAIN_MS` config, default 30000, 0 = legacy immediate path (used by existing tests); range 0-120000. |
| D2 | On drain start the server keeps listening and serving (healthz, token reconnects, running-match fan-out, pause/resume/quit, spectator attach for existing members) but refuses: `room.create`, `room.join` (play or watch, new members), `lobby.start`, `rematch`. Refusal = `error{code:'draining'}` (new `ErrorCode`). Existing seated players reattaching by token are NOT refused. |
| D3 | New S>C `server.draining{deadlineMs}`; `deadlineMs` is remaining ms (relative, skew-safe like `start`). Sent to every authed conn at drain start and to every conn authed afterwards (right after `welcome`). Not repeated. |
| D4 | Countdown rooms are treated as running (3-2-1 completes). Lobbies stay joinable-by-members until close but cannot start. |
| D5 | Drain ends at the earliest of: window elapsed; no room in `countdown`/`running` (after a minimum 3 s so the notice is delivered). Then every remaining room is closed with `room.closed{server-restart}` (lobby, ended, running alike); running/countdown matches end as ABORT: no `end` message, no `Forfeit`, no draw. |
| D6 | Rooms that finish naturally during the window behave normally (`end`, result). Their rooms close at D5. |
| D7 | [onRoomClosed hook EXISTS since 1a93075 (drop() and empty-room -> match.cancel); SP09 only extends it to drain/closeAll paths and adds tests] `rooms.drop` calls `onRoomClosed(room)` dep, wired to a match-controller teardown (idempotent: clock remove, `pause.dispose`, state maps) so every close path (drain, `closeAll`, gc match-cap, idle, abort) stops timers. `pause.dispose()` is already idempotent (`ended = true`). |
| D8 | After D5: close all sockets 1001 (`server-restart` reason string), `http.close`, exit 0. Hard exit timer = `windowMs + closeGraceMs(2000) + 1000`, replacing the fixed 8 s; `kill_timeout` in `fly.toml` = that + 5 s margin (default window: hard exit 33 s, `kill_timeout = 40`). A test asserts `fly.toml kill_timeout` > computed hard exit for the default `DRAIN_MS`. Set `kill_signal = 'SIGTERM'` explicitly. |
| D9 | `/healthz` adds `draining: boolean` and stays HTTP 200 while draining (a failing check could make Fly restart early); `ok` unchanged. |
| D10 | Web: on `server.draining` show a banner with a local countdown ("Server restarting - this match will end in 0:24"; in lobby "Server restarting - you can't start a new match"); disable Create/Join/Start/Rematch; `error{draining}` shows the same text. Notice never covers the pause overlay or result screen. |
| D11 | Web terminal state on `room.closed{server-restart}` after a draining notice (or on `shutdown`): "Server restarted. Your match ended with no result." with a single "Back to menu" action; `ConnBanner` may show reconnecting underneath. Menu actions work once reconnected. Strings for `shutdown`/`server-restart` unified. |
| D12 | `deploy-server.yml`: before `flyctl deploy`, a non-blocking step fetches `/healthz` and prints `running` and `rooms`; if `running > 0`, emits a `::warning::`. Never fails the job (network error = skip). |
| D13 | `PVP_OPS.md`: drain procedure, window, how to check `running`, what players see, the kill-signal/timeout relationship. |

## Architecture
State machine in `main.ts`: `serving -> draining(deadline) -> closing -> exited`. A `draining` flag + deadline are exposed to `room.ts` via a dep `isDraining(): boolean` (room manager has no `main` knowledge; the same dep pattern as `hasPendingDeadline`). `room.create_`, `join`, `start`, `rematch` check it first. Draining state does not affect `onAuthed` (reconnect attach path), `control` (pause/resume/quit) or `onMatchMessage`.

Notice fan-out: `main.ts` iterates `hub` conns once (a new `hub.broadcast(msg)` or iteration over authed conns; hub already tracks `connCount`), and the hub's post-`welcome` hook sends it to late joiners while `draining`. `deadlineMs` is computed from `now()` at each send.

Early-exit poll: a 500 ms `setInterval` (unref'd, in `main.ts`) checks `rooms.runningCount()` plus countdown rooms; also re-checked on room end. `runningCount` exists (`room.ts` ~526, counts `running` only); add `activeMatchCount()` counting `countdown|running`.

Close sequence (D5/D8): `rooms.closeAll('server-restart')` -> each `drop` fires `onRoomClosed` -> `match` teardown; `clock.stop`; sockets `close(1001,'server-restart')`; wait <= 2 s; `terminate` stragglers; `http.close`; exit. The existing `shutdown()` keeps its current shape (used for `DRAIN_MS=0` and tests) but also goes through `onRoomClosed`.

Interaction with SP08/SP07: a `resync` or token reattach during drain is allowed (same attach path). A paused match (budget or manual) is aborted at the same deadline; pause holds do not extend the window. The clock keeps ticking during drain so running matches are unaffected.

Web: `controller.ts` gets `case 'server.draining'` -> store `{ deadlineAt: now + deadlineMs }`; `PvpLayer` renders from state; `error draining` mapped in `ERROR_STRINGS`. After `room.closed`, `reset(...)` already clears match state; add a `terminal: 'server-restart'` string path.

## Versions
- RULES_VERSION: no change (3.2.0); aborted matches produce no outcome, no `Forfeit` command, no hash/replay impact. (Owner override to "draw via Forfeit" would be a rules minor bump; not planned.)
- PROTOCOL_VERSION: additive wire (`server.draining` message, `draining` error code) rides the shared **2 -> 3** bump (SP11 D6); whichever of SP08/SP09/SP11 lands a wire change first bumps `version.ts`. Strict validators reject the unknown message on old clients, which the handshake `pv` gate already prevents. Server-first deploy order unchanged.
- Content/BOT versions: untouched.
- Absorbs: SP04#16 drain remainder (notice + window; the original SIGTERM close stays as `DRAIN_MS=0`), drain half of SP04#20, "SIGTERM drain" bullet in SP06 M3 deferrals.

## Decisions

| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Aborted match outcome | ABORT, no result | Draw via `Forfeit`; winner by score | No rules change; result implies finality the server cannot honor [RESOLVED: orchestrator default - owner may override] |
| D2 | Window | 30 s default, env `DRAIN_MS` | 5 s; 120 s | Long enough to read the notice and finish a late-game; keeps deploys short |
| D3 | New joins during drain | Refuse all new members, allow token reattach | Allow lobby joins | A lobby joined now dies in seconds |
| D4 | Listening during window | Keep http/ws open | `http.close` at start | Reconnects and healthz must keep working |
| D5 | Early exit | When no countdown/running match (min 3 s) | Always wait full window | Idle deploys finish in seconds |
| D6 | Close reason | Reuse `server-restart` | New reason | Web already maps it |
| D7 | Healthz while draining | 200 + `draining:true` | 503 | Avoid check-triggered early kill |
| D8 | Persistence | None | Snapshot rooms to volume | [DEFERRED] multi-machine / state snapshot |

## Manual steps (owner-only)
1. Confirm Fly's stop signal and timeout semantics on the real app: `fly.toml` explicit `kill_signal`/`kill_timeout` honored (`fly config show`), and that the proxy stops routing NEW connections to a stopping machine while existing ones continue.
2. Production rehearsal: start a live match, `fly deploy`, observe notice, abort and "server restarted" screen; check `fly logs` for `server.signal`, drain timing and exit code 0.
3. Verify Fly allows `kill_timeout` >= 40 s (else set drain window 20 s, kill_timeout 30) and no new-connection routing during stop (same as step 1; result recorded in `PVP_OPS.md`).
4. Decide whether to schedule deploys around play sessions (D12 only warns).

## Risks / Open Questions
- Fly `strategy = 'immediate'` replaces the machine in place: total outage = drain window + boot (~5-10 s). Accepted at friends-only scale. [RESOLVED: orchestrator default]
- Auto-deploy on every push to main (`deploy-server.yml`) can now take up to ~35 s per deploy and abort a match. D12 warns only; blocking is [DEFERRED].
- `deploy-server.yml`, `main.ts`, `limits.ts`, `room.ts` security edits (backpressure close, attach limiter, per-IP conn rate, ping limiter cleanup) are committed (a0a63c4, dde99c1, 1a93075); SP09 builds on them. Ping-limiter cleanup in `drop` must stay compatible with the new `onRoomClosed` call. [RESOLVED: sequencing note]
- `onRoomClosed` from `drop` also fires on ended-room TTL expiry and rematch-free closes; teardown must be a no-op for already-torn-down rooms. [RESOLVED: D7 idempotent; test it]
- Whether Fly's kill_timeout allows >= 40 s on this plan, and that the proxy stops routing new connections to a stopping machine. [DEFERRED: owner verifies at first deploy; fallback drain window 20 s, kill_timeout 30]

## Acceptance Criteria
1. Server: after drain start, `room.create`/`join`/`lobby.start`/`rematch` return `error draining`; a token reconnect into a running match succeeds and gets `start`+`catchup`; every authed conn (existing and new) receives exactly one `server.draining` with sensible `deadlineMs`.
2. A running match is aborted at the deadline with `room.closed{server-restart}` and no `end`; sockets close 1001; process exits 0 within `windowMs + 3 s`. With fake timers, no pause/idle timers remain armed after `closeAll`.
3. Zero running matches: drain completes in about 3 s. A match that ends mid-window delivers its `end` normally.
4. `onRoomClosed` fires on drain, `closeAll`, match-cap gc, idle close and abort; second invocation is harmless.
5. `/healthz` returns 200 with `draining:true`; `fly.toml` kill_timeout test passes.
6. Web: notice banner with countdown, disabled Create/Join/Start, terminal "Server restarted" screen, menu usable after reconnect; component tests with fake timers.
7. Wire: `server.draining` and `draining` validated; `PROTOCOL_VERSION === 3`; handshake mismatch test updated (shared with SP11).
8. Two-process e2e (spawned `dist/main.js`, SIGTERM) covers notice -> abort -> exit; `pnpm run ci` green.
