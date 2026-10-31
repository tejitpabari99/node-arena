---
status: done
summary: 5 M3 tasks - server resync handler + limiter, web auto-resync controller, catch-up hash regression check, forced-desync tests, two-browser e2e.
date: 2026-10-30
---
# Tasks: SP08 Desync auto-resync
Source of truth: docs/agent_files/feat-pvp-20261028-1435/08-desync-resync/PRD.md. Client sends the existing `resync`; server answers through the reconnect attach path; web rebuilds sim/runtime. No RULES_VERSION change and no wire change of its own (rides the shared PROTOCOL_VERSION 2 -> 3 bump, made in SP09#1). No [OPEN] items in the PRD.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M3] Server `resync` handler + limiter + logging | SP07 reconnect attach | done |
| 2 | [M3] Web auto-resync controller (triggers, in-flight, cap, fallback) | 1 | done |
| 3 | [M3] Catch-up hash suppression regression check (S10) | 1, 2 | done |
| 4 | [M3] Forced desync / gap / pause / rate-limit tests | 2, 3 | done |
| 5 | [M3] Two-browser injected-desync e2e | 4, SP06#3 | done |

## Task 1 — [M3] Server `resync` handler + limiter + logging
What it is / what it means: Replaces the `internal: not supported yet` answer for `resync` with the reconnect attach (S3, S4, S5, S9, D1, D3, D4).
What changes at a high level: New `resync` case in the room message switch for seated players and spectators in `running`/`ended`; runs the existing mid-match attach (`start`, chunked `catchup`, `pause.state`, stored `end`) in one synchronous turn, always pausing-snapshot while running; no hold bookkeeping. Lobby/countdown/no room gives `no-match`. New limiter, 1 per 10 s per player id, checked before the shared `allowCatchUp` token; either refusal is `rate-limited` with the connection kept open. Info/warn log of room, match, seat/spectator, tick, outcome. No sim, hash or log mutation.
Done when: server unit tests cover running seat and spectator (`youPlayer` null), lobby/countdown `no-match`, second resync within 10 s limited, and resync-after-reconnect refused by the catch-up token (AC1).

## Task 2 — [M3] Web auto-resync controller (triggers, in-flight, cap, fallback)
What it is / what it means: Turns desync and stream errors into self-heal (S1, S2, S6, S7, S8, D2, D5, D6).
What changes at a high level: Controller `requestResync(reason)` fed by the `desync` message and by push errors/`markSyncLost`; one `resync{}` in flight, cleared by the next `start`, which already rebuilds sim, `LockstepClient(0)`, driver and runtime and resets `lastEpoch`. A per-match counter (reset on new `matchId`) caps at 3. A `rate-limited` answer is retried once after 5.5 s; `rate-limited`/`no-match` after that, a failed retry, or the cap falls to the terminal "Out of sync. Leave and rejoin." Toast text becomes "Resyncing...". `pause.state` ignored without a driver. No wire `reason`.
Done when: controller tests show one resync per burst of triggers, rebuild on `start`, retry-once then terminal, and 4th trigger terminal (AC4, AC6 client side).

## Task 3 — [M3] Catch-up hash suppression regression check (S10)
What it is / what it means: S10 shipped in M2 (8528f00); keep it as an acceptance check only, no new feature work.
What changes at a high level: Add or confirm a test over a >=2,000-tick catch-up (resync and reconnect paths) that the driver sends no `hash` for ticks up to the catch-up target and that the first live checkpoint afterward hashes. Only fix the driver if the check fails.
Done when: test shows zero `hash` sends and zero `rate-limited` errors during catch-up, and a matching hash at the next live checkpoint (AC7).

## Task 4 — [M3] Forced desync / gap / pause / rate-limit tests
What it is / what it means: Behavioral acceptance (AC2, AC3, AC5, AC6; D8, Convergence check).
What changes at a high level: Integration tests with a test hook corrupting the client sim and another dropping a tick frame: client receives `desync` or push error, sends one `resync`, rebuilds, hash equals the server hash at the next checkpoint with no tick gap. Resync while paused keeps freeze tick and budgets and accepts the fresh epoch. A rate-limited resync leaves connection and match intact and shows the fallback.
Done when: AC2, AC3, AC5 and AC6 pass without "Leave and rejoin" on the first occurrence.

## Task 5 — [M3] Two-browser injected-desync e2e
What it is / what it means: Browser-level proof on the SP06 harness (AC8).
What changes at a high level: Playwright two-browser match where one client's sim is corrupted mid-match; assert the Resyncing toast, recovery, and both clients finish with the matching result. Run `pnpm run ci`.
Done when: e2e passes and the gate chain is green.

## Manual steps (owner)
None.
