---
status: draft
summary: 13 M2 tasks - FFT rules + RULES 3.2.0, Forfeit sim, protocol v2, heartbeat, server pause/forfeit/lobby/reconnect, web pause UI, two-browser e2e.
date: 2026-10-29
---
# Tasks: SP07 Pause, Quit and window-close forfeit
Source of truth: docs/agent_files/feat-pvp-20261028-1435/07-pause-forfeit/PRD.md. Per-player 30 s cumulative pause budget, confirmed Quit, deadline forfeit as a logged `Forfeit` command. SP07 owns everything it introduces; host transfer itself is SP04#14 (depended on, tested here for the countdown/lobby cases). SP04#19 (M3 grace/bot takeover) is void per D5. No [OPEN] items in the PRD.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M2] Rules: R-FFT area + RULES_VERSION 3.2.0 | SP01#8 | todo |
| 2 | [M2] defs/sim: `Forfeit` command + forfeit golden | 1, SP01#7 | todo |
| 3 | [M2] net: protocol v2 messages, validators, `closeTick` system cmds | 2, SP02#3, SP02#6 | todo |
| 4 | [M2] Server heartbeat (ws ping + app ping) | 3 | todo |
| 5 | [M2] Server pause module (holds, budgets, deadlines, epoch) | 3 | todo |
| 6 | [M2] Server pause/resume/quit wiring + clock rebase | 4, 5 | todo |
| 7 | [M2] Server forfeit emission, terminal flush, cmd reserve, retention | 6, SP04#14 | todo |
| 8 | [M2] Lobby seat reserve + countdown cancel unwind | 6, SP04#11, SP04#14 | todo |
| 9 | [M2] Server minimum reconnect (reclaim + full catch-up) | 7, SP04#13, SP02#10 | todo |
| 10 | [M2] Web pause state, freeze stepping, app ping | 3, SP05#13 | todo |
| 11 | [M2] Web pause/resume/quit-confirm UI + start.cancel | 8, 10 | todo |
| 12 | [M2] Web reconnect: runtime recreation + auto-resume | 9, 10 | todo |
| 13 | [M2] Two-browser e2e + docs + deployed-heartbeat runbook | 11, 12, SP06#3, SP06#15 | todo |

## Task 1 - [M2] Rules: R-FFT area + RULES_VERSION 3.2.0
What it is / what it means: Mechanics-first step (AGENTS.md order; PRD Design (c) Rules/Versions, P9, D8, D12).
What changes at a high level: GAME_RULES gets new area FFT: R-FFT-01 effect (owner neutral, level retained, lines cancelled, troops sourced there die, timers reset, `eliminatedAt` set), R-FFT-02 validity/phase-1 order/system-only provenance, R-FFT-03 outcome interaction (all remaining teams at once = draw via R-WIN-06b). Amend R-ELM-01, R-WIN-04/06(b), R-TCK-03/section 4 phase 1 and 4.1. Changelog entry; `RULES_VERSION` 3.1.0 -> 3.2.0 minor. Confirm where `check:rules` registers new IDs.
Done when: docs gate and `check:rules` pass with the new IDs (tests land in task 2); changelog and version bump present.

## Task 2 - [M2] defs/sim: `Forfeit` command + forfeit golden
What it is / what it means: Deterministic seat elimination (P9, D12, Design (c)).
What changes at a high level: `packages/defs` COMMANDS gains `Forfeit {player}` with reject reasons gameover/malformed/unknown-id/not-pvp/eliminated. Sim phase 1 runs a Forfeit pass (ascending player) before DrawLine/CutLine and applies R-FFT-01, emits `SeatEliminated`. No new hash words (domain stays `sim-state-v2`). Tests title `covers R-FFT-0x`. New pvp forfeit golden replay; other goldens/`levels-lock`/`content.json` get `rulesVersion` metadata refresh only.
Done when: sim tests for effect, rejections, order, team survives (AC5 sim part), simultaneous all-teams draw; `playReplay` of forfeit log round-trips (AC8); `check:rules`, `sim:golden`, `replay:verify golden` green; campaign hashes unchanged.

## Task 3 - [M2] net: protocol v2 messages, validators, `closeTick` system cmds
What it is / what it means: Wire contract (Design (b), D12), PROTOCOL_VERSION 1 -> 2.
What changes at a high level: client `pause{t}`, `resume{t,epoch}`, `quit{t}`; server `pause.state` snapshot, `start.cancel{t,matchId}`; error codes `paused`, `no-match`. Server-message validation accepts `Forfeit` in `tick.c` and `catchup.cmds`; client `cmd`/`wireCommand` still only DrawLine/CutLine. `LockstepServer.closeTick(botCmds, systemCmds)` prepends Forfeits (ascending seat) through `CommandLog.append`. Strict parse; control messages share the SP02 rate bucket. `seat.status` extras stay optional/uncut.
Done when: net tests cover valid/invalid shapes, forged Forfeit from a client rejected, Forfeit round-trips through tick/catchup/CommandLog, handshake gates pv 2.

## Task 4 - [M2] Server heartbeat (ws ping + app ping)
What it is / what it means: Disconnect detection (P10, D13, Design (a)).
What changes at a high level: optional `Socket.ping()`/`onPong` implemented by `wrapWs`; hub pings every 3000 ms; any inbound frame, pong or app `ping` refreshes `lastSeen`; server answers app `ping` with `pong` (currently `internal`). 1000 ms sweep closes authed conns silent for 7000 ms with code 4004. Injected timers, independent of the 20 Hz loop, continue while paused. Detection reported to a hook for the pause module; hidden tab alone opens nothing.
Done when: fake-timer tests: abrupt close immediate, silent drop <= 8 s, drop while paused detected, protocol-pong-only conn kept alive, app-ping-only conn kept alive (AC7).

## Task 5 - [M2] Server pause module (holds, budgets, deadlines, epoch)
What it is / what it means: Pure budget/hold engine (P1-P4, P6, P7, P12, P14, D9, D14, Concurrency).
What changes at a high level: module with injected integer-ms `now` and timers: per-seat 30 000 ms balance charged once, holds `{origin, connected, since, startedAt, deadline}`, one timer for earliest deadline, epoch bump on every change, `pause.state` snapshot builder (budgets null for bots/unlimited). Expiry set E0 of identical deadlines; away set A over `effectiveEliminated` (sim-eliminated plus pendingForfeit) decides forfeit vs all-humans-away draw (Forfeit list for every surviving seat). Unlimited recompute at hold start and after each elimination or pending forfeit. Manual-hold plus disconnect charged once.
Done when: unit tests for AC2 budget math (8 s + re-pause ~22 s, 0-balance expiry, rematch reset), AC5 expiry cases, AC11 away set, AC12 pending-forfeit/unlimited orders, D14 idle close after 10 min.

## Task 6 - [M2] Server pause/resume/quit wiring + clock rebase
What it is / what it means: Connects module to rooms (P2, P3, P5, P8, P11, Design (b) semantics and (e)).
What changes at a high level: handlers: `pause` (seated non-eliminated human, running only; `no-match` in countdown/pre-tick-0, `paused` if any hold, idempotent repeat by owner, `not-your-seat` for spectators); `resume{epoch}` with stale-ignore; `quit` (countdown = leave/cancel, running = pending Forfeit); `cmd` while holds exist -> `paused`, pre-pause buffered commands keep original ticks. Frozen tick = `lockstep.nextTick`, broadcast before further frames and to every (re)authed seat. Pause removes `ClockRoom`; resume re-adds with `startAt = clock.boundary(now())`. Disconnect/heartbeat events open disconnect holds. `room.leave` while running acts as `quit`.
Done when: AC1 (fake clock, 10 s freeze, next tick n = frozen tick, no burst, other rooms unaffected) and AC6 (second Pause `paused`, concurrent holds, resume only after all, forged/spectator rejected, buffered cmds apply at original ticks).

## Task 7 - [M2] Server forfeit emission, terminal flush, cmd reserve, retention
What it is / what it means: Authoritative single result (P4, P8, P9, D9, D12, Risks critique fixes).
What changes at a high level: expiry/quit append `Forfeit`s via `closeTick` system cmds at the frozen tick N (immediate close when `effectiveEliminated` leaves <= 1 team, else pending until resume). Terminal flush in one turn: cancel timers, clear holds, bump epoch, close tick N, broadcast final `pause.state{paused:false}` before `end`, mark `ended`; all later inputs no-ops. `SYSTEM_CMD_RESERVE = 8` in seat budgets `floor((cmdCap - 8)/seats)`; refused system append = abort `internal`. Remove "all conns closed => drop" for running rooms; ended rooms kept 10 min with `end`; sole-human abandonment closes `idle` after 10 min.
Done when: AC4 (Quit Yes/No, expiry during confirm, late frames no change), AC5 team/FFA/1v1 draw cases, AC13 (log size unchanged after flush), AC14 (every seat at budget still forfeits), AC2 zero-balance pause forfeits without advancing a tick.

## Task 8 - [M2] Lobby seat reserve + countdown cancel unwind
What it is / what it means: Lobby/countdown policy (P13, D10, Lobby section).
What changes at a high level: lobby drop reserves the seat 30 s for token reclaim (visible via not-connected occupant in `lobby.state`), then frees; host passes to earliest connected human (SP04#14 mechanism). Start validation requires every human seat occupied, ready and connected (`bad-lobby`). Any seated-human drop/leave/quit or seat going away during countdown (incl. pre-tick-0 gap) cancels with full unwind: clear `room.match`/`startAt`, ClockRoom, `active` and WeakMap entries, state -> lobby, ready cleared, `start.cancel{matchId}` to all then `lobby.state`. Next Start uses new matchId/seed/budgets. Lobby GC stays >= 30 s; no budget charged outside running.
Done when: AC9 server side (reserve then free, host transfer, countdown drop cancels, Start refused while reserved, no leftovers, later Start works, `pause` -> `no-match`, `quit` cancels).

## Task 9 - [M2] Server minimum reconnect (reclaim + full catch-up)
What it is / what it means: M2 slice of reconnect (Design (d), P6, D5).
What changes at a high level: token reclaim rebinds the seat; in running/ended the server sends `start`, full `catchup` from `CommandLog.range(0,nextTick)` (<= 2000-tick chunks, last `done:true`), then `pause.state`, `seat.status`, stored `end` if over, then live subscribe, in one synchronous turn. Forfeited seat returns as an eliminated player (no spectator conversion). Reuse SP04#13 catch-up path and SP02#10 runner. No bot takeover.
Done when: AC3 server side (return + catch-up + resume before deadline gives same hash, no refresh of budget on reconnect, no bot takeover), AC8 (reconnecting client equal final hash/outcome; reconnect after `end` gets identical `end`).

## Task 10 - [M2] Web pause state, freeze stepping, app ping
What it is / what it means: Client protocol handling (Design (b), P2, D13).
What changes at a high level: PvpConnection sends app `ping {t}` every 3 s; PvpController/NetDriver track `pause.state` (ignore epoch <= last, `lastEpoch` reset to -1 on every `start`), step to `tick` frozen value then hold, local display-only budget countdown, treat queued ticks past frozen tick as protocol error; new error strings for `paused`/`no-match`.
Done when: unit tests: epoch stale/reset (AC15), freeze at frozen tick with hash equality, countdown display from snapshot, ping cadence.

## Task 11 - [M2] Web pause/resume/quit-confirm UI + start.cancel
What it is / what it means: Player-facing controls (P2-P5, D4, Lobby web side).
What changes at a high level: HUD Pause button (disabled at 0 balance or when not eligible), pause overlay with owner/reason/remaining and Resume for the owner only, Esc/Leave opens Yes/No Quit confirm while countdown keeps running (Yes sends `quit`, No/dismiss no change), spectator read-only, unlimited-mode display. On `start.cancel` (or `lobby.state` during countdown) discard sim/runtime/LockstepClient and return countdown -> lobby.
Done when: component/controller tests; AC4 UI half (No keeps pause), AC9 web half (discard on `start.cancel`, later Start works).

## Task 12 - [M2] Web reconnect: runtime recreation + auto-resume
What it is / what it means: Client side of minimum reconnect (Design (d), P6, D5).
What changes at a high level: repeated `start` for the same matchId recreates sim + `LockstepClient(0)` + runtime (replaces M1 keep-running shortcut), shows SP05#13 catch-up overlay, then auto-sends `resume` for a disconnect hold once caught up (manual holds need a click); eliminated player view after forfeit; post-`end` reconnect shows the stored result.
Done when: AC3 client side (convergent hash, auto-resume inside deadline, manual hold not auto-resumed), AC8 client reconnect convergence.

## Task 13 - [M2] Two-browser e2e + docs + deployed-heartbeat runbook
What it is / what it means: Acceptance and docs (AC10, AC16, Manual steps).
What changes at a high level: Playwright specs on the SP06 harness: countdown on both sides, freeze/Resume, cumulative use, Quit confirm, window close/return/expiry, bot-only unlimited pause. Update PVP docs (protocol v2, RULES 3.2.0, pause policy, FUTURES M3 items). Add the manual post-Fly-deploy heartbeat check (app ping only survives; network kill detected <= 8 s) to the owner runbook, flagged non-CI.
Done when: specs green in the pvp-e2e job; docs gate passes; runbook item documented.

## Acceptance coverage
AC1 -> 6; AC2 -> 5, 7; AC3 -> 9, 12; AC4 -> 7, 11; AC5 -> 2, 5, 7; AC6 -> 6; AC7 -> 4; AC8 -> 2, 9, 12; AC9 -> 8, 11; AC10 -> 13; AC11 -> 5; AC12 -> 5; AC13 -> 7; AC14 -> 7; AC15 -> 10; AC16 -> 13 (owner manual).
