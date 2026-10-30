---
status: draft
summary: 8 M3 tasks - PROTOCOL v3 wire, drain state machine + refusals, notice fan-out, room-close teardown, exit timing + fly.toml, web notice/terminal UI, deploy warning + ops docs, two-process e2e.
date: 2026-10-30
---
# Tasks: SP09 Drain-aware restart
Source of truth: docs/agent_files/feat-pvp-20261028-1435/09-drain-restart/PRD.md. SIGTERM opens a 30 s notice window; running matches finish or are aborted with no result at the deadline. SP09 is the first M3 wire change (lands after SP08, which has none), so Task 1 owns the shared PROTOCOL_VERSION 2 -> 3 bump. No RULES_VERSION change. No [OPEN] items in the PRD.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M3] Protocol v3: `server.draining`, `draining` error | SP08#1 | todo |
| 2 | [M3] Server drain state machine, refusals, healthz | 1 | todo |
| 3 | [M3] Draining notice fan-out + late joiners | 2 | todo |
| 4 | [M3] `onRoomClosed` teardown on all close paths | 2 | todo |
| 5 | [M3] Close sequence, hard-exit timing, fly.toml | 2, 4 | todo |
| 6 | [M3] Web notice banner, disabled actions, terminal state | 1, 3 | todo |
| 7 | [M3] Deploy-time warning + PVP_OPS docs | 5 | todo |
| 8 | [M3] Two-process SIGTERM e2e + web component tests | 5, 6, 7 | todo |

## Task 1 — [M3] Protocol v3: `server.draining`, `draining` error
What it is / what it means: Additive wire and the shared version bump (D3, Versions, AC7).
What changes at a high level: New S>C `server.draining{deadlineMs}` message and `draining` ErrorCode with strict validators; `PROTOCOL_VERSION` 2 -> 3. Update the handshake mismatch test (shared with SP11, which only consumes the bump). Server-first deploy order unchanged.
Done when: net tests validate both shapes and reject malformed ones; `PROTOCOL_VERSION === 3`; handshake test updated.

## Task 2 — [M3] Server drain state machine, refusals, healthz
What it is / what it means: Serve while draining, refuse new work (D1, D2, D4, D5, D9; D3/D4 decisions).
What changes at a high level: `DRAIN_MS` config (default 30000, range 0-120000, 0 = legacy immediate path). `startServer` gains `drain({windowMs})` beside `shutdown()`; SIGTERM/SIGINT call it. State `serving -> draining -> closing -> exited` with an `isDraining` dep into the room manager; `room.create`, `join`, `lobby.start`, `rematch` answer `error draining`; token reattach, resync, control and match fan-out unaffected. Countdown counts as running via `activeMatchCount()`; 500 ms unref'd poll ends drain at window end or when no active match (minimum 3 s). `/healthz` adds `draining`, stays 200.
Done when: AC1 refusals and token reconnect, AC3 (about 3 s with no matches, natural `end` mid-window) and AC5 healthz pass.

## Task 3 — [M3] Draining notice fan-out + late joiners
What it is / what it means: Warn every client once (D3, Architecture notice fan-out).
What changes at a high level: Hub broadcast of `server.draining` with remaining ms at drain start to all authed connections, and a post-`welcome` send to connections authed while draining; never repeated. `deadlineMs` computed from `now()` at each send.
Done when: every existing and new authed conn receives exactly one notice with sensible `deadlineMs` (AC1).

## Task 4 — [M3] `onRoomClosed` teardown on all close paths
What it is / what it means: No timer leaks (D7; the hook exists since 1a93075).
What changes at a high level: Extend the existing hook so drain and `closeAll` paths also run the idempotent match teardown (clock remove, `pause.dispose`, state maps), alongside match-cap gc, idle close and abort; `shutdown()` goes through it too. Keep the ping-limiter cleanup in `drop` compatible.
Done when: tests show the hook fires on drain, `closeAll`, gc, idle and abort, a second call is harmless, and fake-timer runs find no armed pause/idle timers after `closeAll` (AC4, AC2 part).

## Task 5 — [M3] Close sequence, hard-exit timing, fly.toml
What it is / what it means: Deterministic bounded exit and abort semantics (D5, D6, D8, AC2, AC5).
What changes at a high level: At drain end `closeAll('server-restart')` aborts remaining rooms (no `end`, no `Forfeit`, no draw); paused matches abort at the same deadline; then sockets close 1001, stragglers terminated after the 2 s grace, `http.close`, exit 0. Hard-exit timer becomes window + grace + 1 s. `fly.toml` gets explicit `kill_signal = 'SIGTERM'` and `kill_timeout` = hard exit + 5 s (40 for default). A test asserts `kill_timeout` exceeds the computed hard exit for default `DRAIN_MS`.
Done when: running match aborted at the deadline with `room.closed{server-restart}` and no `end`, exit within window + 3 s, kill_timeout test green.

## Task 6 — [M3] Web notice banner, disabled actions, terminal state
What it is / what it means: Player-facing drain UX (D10, D11).
What changes at a high level: Controller stores deadline on `server.draining`; `PvpLayer` renders a local-countdown banner (match vs lobby wording) that never covers the pause overlay or result; Create/Join/Start/Rematch disabled; `error draining` mapped to the same text. `room.closed{server-restart}` (and `shutdown`) after notice shows "Server restarted. Your match ended with no result." with a single Back to menu action; strings unified; menu usable after reconnect.
Done when: component tests with fake timers cover banner countdown, disabled actions, terminal screen and post-reconnect menu (AC6).

## Task 7 — [M3] Deploy-time warning + PVP_OPS docs
What it is / what it means: Owner visibility (D12, D13).
What changes at a high level: Non-blocking `deploy-server.yml` step before `flyctl deploy` fetching `/healthz`, printing `running` and `rooms`, `::warning::` if running > 0, never failing the job. `PVP_OPS.md` documents the drain procedure, window, checking `running`, player-visible behavior and kill-signal/timeout relationship.
Done when: workflow step present and tolerant of fetch failure; docs gate passes.

## Task 8 — [M3] Two-process SIGTERM e2e + web component tests
What it is / what it means: End-to-end acceptance (AC2, AC8).
What changes at a high level: Spawn `dist/main.js`, start a match over real sockets, send SIGTERM; assert notice -> abort -> exit 0 timing. Confirm web component tests are wired. Run `pnpm run ci`.
Done when: e2e passes and the gate chain is green.

## Manual steps (owner)
1. Confirm on the real Fly app that explicit `kill_signal`/`kill_timeout` are honored (`fly config show`), kill_timeout >= 40 s is allowed (else window 20 s / timeout 30), and the proxy stops routing new connections to a stopping machine; record in `PVP_OPS.md`.
2. Production rehearsal: live match, `fly deploy`, observe notice, abort, "server restarted" screen; check `fly logs` for signal, drain timing, exit 0.
3. Decide whether to schedule deploys around play sessions (D12 only warns).
