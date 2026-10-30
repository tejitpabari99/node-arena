---
status: approved
summary: M3 SP11 — reconnect UX polish, protocol cleanup (SeatStatus drop 'bot', rename 'grace'->'away', drop dead seat.status driving), unlimited-flag broadcast fix, ready-flag fix on host pass, and the M3 acceptance sweep that closes old rows in SP02/04/05 TASKS.
date: 2026-10-30
---
# PRD: SP11 Reconnect polish, protocol cleanup and M3 acceptance sweep

Repo/branch: node-arena / `feat/pvp-m3` · Milestone: **M3** · Depends on: SP08 (resync), SP09 (drain notice), SP07 (reconnect, pause.state) · Coordinates with: SP08/SP09 (`room.ts`, `messages.ts`, `validate.ts`, `version.ts`), SP10 (report only).
Owns: `packages/net/src/{messages,validate,version}.ts`, `apps/server/src/{room,pause,match}.ts` (small fixes), `apps/web/src/pvp/controller.ts`, `apps/web/src/ui/pvp/{SeatLegend,ConnBanner,Lobby,PvpLayer}.tsx`, tests, `docs/*` gate notes, pointer text in 02/04/05 TASKS.md.

## TL;DR
M2 shipped a minimal reconnect and left stale protocol vocabulary behind (`grace`, `bot`, a `seat.status` message the server never sends). SP11 (1) removes that vocabulary, (2) shows each other seat's away/forfeit state with remaining budget from `pause.state`, (3) fixes two verified state bugs, (4) polishes the connection banner, and (5) runs the M3 acceptance sweep and reconciles old M3 task rows.

## Problem (verified 2026-10-30)
- `SeatStatus = 'connected'|'grace'|'bot'` (`messages.ts:21`), validated in `validate.ts:81`; `lobby.state` reports `'grace'` for a closed conn (`room.ts:171`).
- `seat.status` exists in the catalogue (`messages.ts:67`) but `grep` finds no server emitter in `apps/server/src`; the web only stores it and `SeatLegend` reads `st==='grace'`/`'bot'` (`SeatLegend.tsx:17`) with text "bot took over", which SP07 voided. In-match away state is only visible in `pause.state.holds` (`connected:false`).
- `pause.ts` `syncEliminated` (~252-261) recomputes unlimited mode and bumps `epoch` but does not itself broadcast; a client can hold a stale `unlimited`/`budgets` until the next hold change.
- [FIXED in dde99c1: host-pass / hostless lobby clears ready flags; no work left, keep lobby test as regression only] `reserveSeat` previously passed host on without clearing ready flags.
- `ConnBanner` shows only `Reconnecting...`, `Connection lost.`, refused, superseded; `connecting` and backoff progress are invisible.
- An M2 hardening fix rate-limits catch-up attaches (5 s per player); a reconnect that lands inside that window is closed `CLOSE_RATE_LIMITED`.

## Goals / Non-Goals
Goals: one coherent seat-status vocabulary; accurate away/forfeit chips; correct unlimited flag; honest banner states; M3 closed with evidence.
Non-goals: resume-from-checkpoint; bot takeover or seat-reclaim-after-bot (void); changing the 30 s budget policy; load testing (SP10); drain behavior (SP09).

## Requirements

| ID | Requirement |
|---|---|
| C1 | `SeatStatus = 'connected' \| 'away'`. `'bot'` removed (bot seats are `kind:'bot'`, never an occupant status); `'grace'` renamed `'away'` in `messages.ts`, `validate.ts` `SEAT_STATUS`, and lobby occupant status in `room.ts`. |
| C2 | `seat.status` message: server never emits it; remove `SeatStatusMsg` from the catalogue, validator and web handler. In-match away/forfeit display derives from `pause.state` + `start.seats` + sim `eliminatedAt`. (If review finds a real emitter, keep the message with the C1 vocabulary instead.) |
| C3 | `SeatLegend`: statuses `eliminated` (label "Eliminated"; no wire distinction for forfeit), `away` ("Away 0:21" from the seat's `pause.state` budget), bots show "Bot". Remove "bot took over" wording. Away chip counts down locally from the snapshot (display only, as `toPauseView` already does). |
| C4 | Chips update for all viewers (players and spectators) from `pause.state`; a seat with a `disconnect` hold and `connected:false` is away; a manual hold shows "Paused". |
| C5 | `pause.syncEliminated` must broadcast: whenever it bumps `epoch` (or changes `unlimited`), `match.ts` publishes `pause.state` to all conns. Add the publish at the call site after `pause.syncEliminated(elim)` (`match.ts:155`) when `epoch()` changed. |
| C6 | [DONE in dde99c1; regression check only] Host pass in `reserveSeat` clears all ready flags, consistent with the other host-pass paths; covered by a lobby test. |
| C7 | Banner states: `connecting` ("Connecting..."), `reconnecting` (attempt count / next retry seconds when available), `lost` (Retry), `refused` (Reload), `superseded` (terminal). Active-match banner does not hide the pause overlay or countdown. |
| C8 | A reconnect closed with `CLOSE_RATE_LIMITED` (4005) is retried with growing backoff and shown as `reconnecting`, not `lost`. Close-code mapping verified (only 4000/4003 are terminal); the `attempt` reset gap is FIXED in 8528f00 (reset only after STABLE_MS = 10 s stable; 4005 min delay 5.5 s); remaining work = the `info` getter and banner. Connection exposes a client-local `info` getter for C7 (attempt, next retry time, last close code). |
| C9 | During the post-reconnect catch-up overlay, the banner clears on `welcome` and the overlay owns the progress UI (existing SP05#13). |
| C10 | Acceptance sweep (below). |

## Architecture
Protocol: type-level rename + one removal. Strict validators reject unknown enum values, so old clients/servers cannot interoperate; `PROTOCOL_VERSION` 2 -> **3** (shared bump, see Versions). Server-first deploy order unchanged (handshake `pv` already gates).

Server: `lobbyState` maps `conn.closed ? 'away' : 'connected'`. `Lobby.tsx:16` ("Waiting for player to reconnect") compares `!== 'connected'`, so it continues to work. `match.ts` publishes after `syncEliminated`; `publish` already broadcasts the full snapshot with `budgets` and `unlimited` (`pause.ts:280`). No sim change.

Web: legend consumes a derived `awayBySeat` from `state.pause` (holds with `connected:false`, budget from `budgets[player]`) and lobby occupant status in lobby; no dependence on `seat.status`. Banner takes `conn` plus optional retry info from `createPvpConnection` (small additive field on `onState`, client-local, not wire).

## Versions
- RULES_VERSION: no change (3.2.0); no rule or sim edit.
- PROTOCOL_VERSION: **2 -> 3**, one bump for all M3 wire changes (SP11's enum change, any SP09 notice message). Whichever lands first bumps `version.ts`; later SPs add to v3 without another bump. All on `feat/pvp-m3`, shipped together, server first.
- Absorbs old rows: SP05#16 (polish; basic resume already SP07), SP05#18 (acceptance sweep), SP04#19 (void; add closing pointer), SP04#20 load-smoke half is SP10, resync half SP08.

## Acceptance sweep (C10)
Scope: M3 only plus gaps from the M2 review. Method: map each PRD acceptance list (SP07 criteria 1-5+, SP08, SP09, this PRD) to a named test; add missing tests; no new features.
- Known gaps to cover: unlimited flag after quit/elimination during pause (C5); host-pass ready clear (C6); rate-limited reconnect backoff (C8); spectator resync; resync + pause; drain notice with a connected client (SP09).
- Doc notes: `tools/README.md`/runbook entries for `resync`, drain, load smoke; mark `pvp-plan` M3 done; README of the PvP folder M3 rows.
- Reconcile TASKS pointers (text only, tasks generation regenerates): 02#13 -> SP08; 04#19 void -> SP07/SP11; 04#20 -> SP08 + SP10; 05#16 -> SP11; 05#17 -> SP08; 05#18 -> SP11.
- Gate: `pnpm run ci`, `pnpm check:docs`, `pnpm check:rules` green (no rule changes expected); SP10 report attached, not gated.
Dependency: sweep tasks run last, after SP08 and SP09 land.

## Decisions

| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | `'grace'` | Rename `'away'` | Keep; remove | `grace` implies bot takeover, which was dropped |
| D2 | `'bot'` | Remove from `SeatStatus` | Keep for display | Bots are a seat kind; status never sent |
| D3 | `seat.status` | Remove (no emitter) | Implement emitter | `pause.state` + lobby state are already the source of truth (SP07 cut-able note) |
| D4 | Away chips | Derive from `pause.state` | New server push | No extra wire; already full snapshot |
| D5 | Stale `unlimited` | Publish on epoch bump after `syncEliminated` | Client recompute | Server is authority (SP07 D6) |
| D6 | Version | Single shared v3 bump | Per-SP bumps | One deploy unit, avoids churn |
| D7 | Rate-limited reconnect | Backoff retry | Terminal `lost` | Transient by design (5 s window) |
| D8 | Sweep timing | Last, after SP08/SP09 | Parallel | Needs final behavior |

## Risks / Open Questions
- Removing `seat.status` is a catalogue change: confirm no e2e or test helper depends on it. [RESOLVED: orchestrator default — owner may override; keep if a consumer is found]
- "Forfeited" vs "Eliminated" labelling: no wire distinction exists; label stays "Eliminated". [DEFERRED]
- Merge conflicts in `room.ts`/`messages.ts` with SP08/SP09 are likely; sequence: SP08 -> SP09 -> SP11, or rebase. [RESOLVED: SP11 lands last]
- Banner retry detail (verified 2026-10-30, `apps/web/src/net/connection.ts`): `PvpConnection` exposes only `state: ConnState` (`connecting|connected|reconnecting|lost|refused|superseded`), `onState(cb(state))`, `onMessage`, `send`, `retry`, `close`. `attempt`, `outageStart` and the pending backoff delay (`backoffDelay`, `BACKOFF_MS` 0.5-8 s, +-20% jitter, `GIVE_UP_MS` 60 s) are closure-private; the close code is not surfaced. SP11 must add a client-local `info` getter `{ attempt, nextRetryAt: number | null, outageStartedAt: number | null, lastCloseCode: number | null }` (set in `scheduleReconnect`/`onclose`) and let `onState` callbacks read it; no wire change. C8 finding: `onclose` maps only 4000 -> `superseded` and 4003 -> `refused`; every other code, including `CLOSE_RATE_LIMITED` 4005, already goes to `scheduleReconnect` (so it shows `reconnecting`, not `lost`, until the 60 s give-up). Former gap (attempt reset on every `welcome`, retry loop at ~0.5 s against the 5 s window) FIXED in 8528f00; SP11 only needs the `info` getter to expose the existing attempt/backoff state. [RESOLVED: exposed = state only; additions specified in C7/C8 — verified]
- Client 5.5 s retry vs the 60 s per-IP catch-up window (20/min) can burn attempts until `GIVE_UP_MS` -> `lost`; tune banner/backoff to the catch-up window. [DEFERRED]

## Acceptance Criteria
1. Wire: `grace`/`bot` rejected by validators, `away` accepted; `PROTOCOL_VERSION === 3`; handshake mismatch test updated; no `seat.status` in catalogue.
2. Legend: another seat that disconnects shows "Away" with a decreasing budget in both players' and spectators' views; returns to normal on `resume`; text no longer says "bot took over".
3. Quit/elimination during a pause that flips unlimited mode produces a broadcast `pause.state` with `unlimited:true`, `null` budget.
4. Host drop in lobby clears all ready flags (already delivered in dde99c1; regression test only).
5. Banner shows each of connecting/reconnecting/lost/refused/superseded with correct controls; rate-limited reconnect ends in `connected`, not `lost`.
6. Every acceptance bullet of SP07 (M3-relevant), SP08, SP09 and this PRD maps to a passing test; the old-row pointers in 02/04/05 TASKS.md are updated.
7. CI chain green on `feat/pvp-m3`.
