---
status: done
summary: 7 M3 tasks - SeatStatus/seat.status protocol cleanup, unlimited-flag broadcast fix, connection info getter, banner states, away chips in legend, gap-closing tests, M3 acceptance sweep.
date: 2026-10-30
---
# Tasks: SP11 Reconnect polish, protocol cleanup and M3 acceptance sweep
Source of truth: docs/agent_files/feat-pvp-20261028-1435/11-reconnect-polish/PRD.md. Lands last (SP08 -> SP09 -> SP11). SP09#1 owns the shared PROTOCOL_VERSION 2 -> 3 bump; SP11 adds its SeatStatus enum change within v3 with no further bump. No RULES_VERSION change. No [OPEN] items in the PRD (C6 and the 8528f00 attempt-reset were already delivered; regression only).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M3] Protocol cleanup: `SeatStatus` away-only, drop `seat.status` | SP09#1 | done |
| 2 | [M3] Broadcast `pause.state` after `syncEliminated` epoch change | SP08#1, SP09#5 | done |
| 3 | [M3] Connection `info` getter | SP08#2, SP09#6 | done |
| 4 | [M3] Banner states and catch-up overlay handoff | 3 | done |
| 5 | [M3] SeatLegend away/eliminated/bot chips from `pause.state` | 1, 2, SP08#2 | done |
| 6 | [M3] Gap-closing tests (unlimited, host-pass, 4005, spectator resync, resync+pause, drain) | 2, 4, 5, SP08#4, SP09#8 | done |
| 7 | [M3] M3 acceptance sweep, doc notes, old-row pointers | 6, SP08#5, SP09#8, SP10#6 | done |

## Task 1 — [M3] Protocol cleanup: `SeatStatus` away-only, drop `seat.status`
What it is / what it means: One coherent seat-status vocabulary (C1, C2, D1-D3, D6, AC1).
What changes at a high level: `SeatStatus` becomes `connected | away` in `messages.ts` and the validator enum; lobby occupant status in `room.ts` maps closed conn to `away`; `SeatStatusMsg` removed from catalogue, validator and web handler (kept with C1 vocabulary only if review finds a real emitter or a test/e2e consumer). `Lobby.tsx` waiting check still works. Update tests and the handshake mismatch test, still against v3 from SP09#1.
Done when: validators reject `grace`/`bot` and accept `away`; `PROTOCOL_VERSION === 3`; no `seat.status` in the catalogue.

## Task 2 — [M3] Broadcast `pause.state` after `syncEliminated` epoch change
What it is / what it means: Fix stale `unlimited`/`budgets` after quit or elimination during a pause (C5, D5, AC3).
What changes at a high level: In `match.ts`, after `pause.syncEliminated(elim)`, publish the `pause.state` snapshot to all conns when `epoch()` changed. No sim change.
Done when: a server test shows quit/elimination during a pause that flips unlimited mode yields a broadcast `pause.state` with `unlimited:true` and null budget.

## Task 3 — [M3] Connection `info` getter
What it is / what it means: Expose existing backoff state for the banner; confirm rate-limited reconnect is treated as transient (C8, D7).
What changes at a high level: Client-local `info` getter `{attempt, nextRetryAt, outageStartedAt, lastCloseCode}` on `createPvpConnection`, set in `onclose`/`scheduleReconnect`, readable from `onState` callbacks. No wire change. Close-code mapping stays (only 4000/4003 terminal; 4005 retried with the 5.5 s minimum delay).
Done when: unit tests with fake timers show `info` values across a retry loop and 4005 staying in `reconnecting`.

## Task 4 — [M3] Banner states and catch-up overlay handoff
What it is / what it means: Honest connection states (C7, C9, AC5).
What changes at a high level: `ConnBanner` renders connecting, reconnecting (attempt / next retry seconds), lost (Retry), refused (Reload) and superseded (terminal) from `conn` plus `info`; does not hide the pause overlay or countdown; clears on `welcome` so the existing catch-up overlay owns progress.
Done when: component tests cover all five states with controls and the `welcome` handoff.

## Task 5 — [M3] SeatLegend away/eliminated/bot chips from `pause.state`
What it is / what it means: Accurate chips for players and spectators (C3, C4, D4, AC2).
What changes at a high level: Derive `awayBySeat` from `state.pause` holds with `connected:false` plus `budgets`; `eliminated` ("Eliminated"), `away` ("Away 0:21", local display countdown), manual hold "Paused", bots "Bot"; lobby uses occupant status. Remove "bot took over" text and `seat.status`/`grace` reads.
Done when: component tests show Away with decreasing budget for both views, return to normal on `resume`, and no "bot took over".

## Task 6 — [M3] Gap-closing tests (unlimited, host-pass, 4005, spectator resync, resync+pause, drain)
What it is / what it means: Fill the named acceptance gaps with tests only, no features (C10 known gaps, C6, C8, AC3-AC5).
What changes at a high level: Add or confirm named tests for unlimited flag after quit/elimination, host-pass ready clear (regression from dde99c1), rate-limited reconnect ending `connected` not `lost`, spectator resync, resync during pause, and the drain notice with a connected client.
Done when: each gap has a passing, named test.

## Task 7 — [M3] M3 acceptance sweep, doc notes, old-row pointers
What it is / what it means: Close M3 with evidence (C10, D8, AC6, AC7).
What changes at a high level: Map every M3-relevant acceptance bullet of SP07, SP08, SP09 and SP11 to a passing test; add any missing. Doc notes in `tools/README.md` and runbook for `resync`, drain and load smoke; mark `pvp-plan` M3 done; PvP README M3 rows. Text-only pointers: 02#13 -> SP08; 04#19 void -> SP07/SP11; 04#20 -> SP08 + SP10; 05#16 -> SP11; 05#17 -> SP08; 05#18 -> SP11. Attach (not gate) the SP10 report. Run `pnpm run ci`, `pnpm check:docs`, `pnpm check:rules`.
Done when: gate chain green on `feat/pvp-m3` and the AC-to-test map is recorded.

## Manual steps (owner)
None in the PRD. M3 owner-only items live in SP09 and SP10 (first Fly deploy verification, drain rehearsal, load run, `MAX_ROOMS`/VM decision).
