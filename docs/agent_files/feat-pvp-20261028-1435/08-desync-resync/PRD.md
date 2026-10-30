---
status: draft
summary: M3 SP08 — automatic recovery from a hash desync or lockstep stream error. Client sends the existing `resync`; server answers through the reconnect attach path (start + full catch-up + pause.state); web recreates sim/runtime. Limit 1 per 10 s per seat/spectator. No RULES_VERSION change; no wire change of its own.
date: 2026-10-30
---
# PRD: SP08 Desync auto-resync

Repo/branch: node-arena / `feat/pvp-m3` · Milestone: **M3** · Depends on: SP02 (`LockstepClient`, catalogue), SP04 (`room.ts`/`match.ts` attach + limits), SP05 (controller/NetDriver), SP07 (reconnect attach, pause.state) · Coordinates with: SP09 (also edits `room.ts`/protocol), SP11 (acceptance sweep, PROTOCOL bump).
Owns: `apps/server/src/room.ts` (`resync` case), `apps/server/src/match.ts` (log fields only), `apps/server/src/limits.ts` (resync limiter), `apps/web/src/pvp/controller.ts` (desync/push-error handlers), `apps/web/src/driver/net-driver.ts` (hash suppression during catch-up), `apps/web/src/ui/pvp/PvpLayer.tsx` (toast text), tests; `packages/net` only for tests/doc comments.

## TL;DR
Today a `desync` message only logs and toasts, and a gap/duplicate in the tick stream shows "Out of sync. Leave and rejoin." (controller `case 'desync'`, `markSyncLost`/`onPushError`). M3 turns both into a self-heal: the client sends `resync{}`; the server replays exactly what it does for a token reconnect (`attachMidMatch`: `start`, full `catchup` from `CommandLog`, `pause.state`, stored `end`); the web client re-runs `startMatch(m, reconnect=true)` (fresh sim + `LockstepClient(0)` + runtime) and converges. One resync per 10 s per seat; over limit falls back to today's "Leave and rejoin".

## Problem
A client whose sim diverges (bug, bad cache, dropped frame) is stuck with a wrong board for the rest of the match, and the only remedy is leaving, which for a seated player is a forfeit-by-leave. `resync` is already in the C>S catalogue (`messages.ts` `ResyncMsg`, `validate.ts` `resync: ['t']`) but `room.ts` answers `internal: not supported yet` (default branch, ~560). `LockstepClient.reset()` exists but is unused; we will not need it (full rebuild instead).

## Goals / Non-Goals
Goals: automatic recovery with a visible toast; no change to server sim or referee; bounded cost; works for seated players and spectators; no loop.
Non-goals: resume-from-checkpoint (full replay stays, ~2.4 s CPU worst case, SP07 risk table; revisit only if SP10 load data demands); fixing the cause of a desync; resync in lobby/countdown; a `reason` field on `resync` (would force a wire change; the client logs reason locally and the server already logs `desync` with both hashes).

## Requirements

| ID | Requirement |
|---|---|
| S1 | Triggers: (a) server `desync` message; (b) `LockstepClient` push failure (`onPushError` / `needsResync`: gap, duplicate, bad range). Either sends one `resync{}` if none is in flight. |
| S2 | While a resync is in flight (sent, no `start` yet) further triggers are ignored. Cleared by the next `start` for this room. |
| S3 | Server: `resync` from a seated player or spectator in `running` or `ended` runs `attachMidMatch(room, conn, youPlayer-or-null, alwaysPause = state==='running')` exactly as reconnect (`room.ts` ~497-510): `start` -> chunked `catchup` (last `done:true`) -> `pause.state` -> stored `end`, one synchronous turn. Lobby/countdown/no room -> `error no-match`. |
| S4 | Limit: 1 resync per 10 s per player id (seat or spectator), enforced by a new limiter beside `IpLimits`. Over limit -> `error rate-limited`; connection stays open. |
| S5 | A resync also spends the existing catch-up token (`allowCatchUp`: 5 s per player, 20/min per IP). Both must pass; the 10 s limit is the binding one for one player. |
| S6 | Client on `start` recreates sim, `LockstepClient(0)`, NetDriver and runtime (existing `case 'start'` -> `startMatch(m, true)`), resets `lastEpoch`, shows the catch-up overlay, auto-resumes an own disconnect hold per existing `maybeAutoResume`. |
| S7 | Client shows a toast "Resyncing..." (reuse `toast-desync` slot; text change only). Success is silent once caught up. |
| S8 | Client falls back to the terminal "Out of sync. Leave and rejoin." (`syncLost`) when the server answers `rate-limited`/`no-match` to a resync, or after 3 auto-resyncs in one match. |
| S10 | Client suppresses `hash` sends for every tick <= the catch-up target (`to` of the `catchup` chunk with `done:true` for the current attach); hashing resumes with the first live-stepped tick past it. Implemented in `NetDriver` (applies equally to SP07 reconnect, where the same burst exists today). No server change: the server keeps tolerating repeats and does not add a per-conn "last validated" cursor. |
| S9 | Server logs `resync` (room, matchId, seat/spectator, tick, outcome allowed/limited) at info/warn. No sim, hash or log mutation. |

## Architecture
Server (`room.ts` message switch): new `case 'resync'` beside `ping`. Finds room via `byPlayer` (spectators included), derives `youPlayer` with `seatOf` (-1 -> `null`), checks `room.state`, checks limiter then `catchUpAllowed`, calls `attachMidMatch`. No hold bookkeeping (`onSeatReconnect`) is called: the seat never disconnected, so pause state is untouched; `alwaysPause=true` while running guarantees the client receives a fresh epoch snapshot even when no hold exists.

Live-stream continuity (verified): the per-connection lag cursor `feeds` (`match.ts` ~63) is keyed by `Conn`, which survives. `catchUp` sends `log.range(0, nextTick)` and the `start`/catch-up/pause run synchronously, so no `tick` frame can interleave; the next live `tick` is `nextTick`, contiguous with the last catch-up chunk. The new client's `LockstepClient(0)` accepts it. Ordering means any stale pre-resync `tick`/`pause.state` arrives BEFORE `start` (old driver, discarded by the generation token) and cannot land between chunks.

Stale epoch decision: `lastEpoch = -1` on `start` stays (`controller.ts` ~259). Because the snapshot is sent in the same turn after the chunks, the only `pause.state` a client sees after `start` is the fresh one; a stale one cannot sit between chunks. Two guards: (1) `pause.state` is ignored if no driver; (2) `alwaysPause` ensures a post-start snapshot always exists. [RESOLVED: no extra code beyond these]

Composition with M2 hardening: (a) backpressure close (`BACKPRESSURE_CLOSE_BYTES` 2 MB, `limits.ts`): a resync burst is a full-log send; if a slow link trips the close, the client reconnects, and that reconnect is itself a catch-up attach gated by the 5 s per-player gap (`allowCatchUp`), which resync just spent. SP11 owns making such a `rate-limited` reconnect close a backoff-retry, not a terminal state. (b) `DESYNC_MIN_GAP_MS` (10 s per seat, `match.ts` ~11) already throttles `desync` sends; it matches the resync window so a persistent divergence yields at most one `desync` + one resync per 10 s, then falls to S8.

Client: `case 'desync'` keeps its log + event, then `requestResync('desync')`; `onPushError` and `markSyncLost` become `requestResync('push-error')` first and only reach `syncLost` per S8. A `resyncCount` per match (reset on a new `matchId`) enforces the cap. The `start` handler already distinguishes reconnect vs fresh by `matchId`.

Convergence check (verified 2026-10-30): server `onHash` (`lockstep-server.ts:115`) is stateless per tick: it compares the client hash to `log.checkpoint(tick)` (kept for the whole match, cap 480 = 9,600 ticks) and keeps no "last validated" cursor, so a hash for an old tick from a correct rebuilt sim returns `ok` and never `desync`. BUT the web `NetDriver.stepOne` (`net-driver.ts:148`) calls `client.after()` and sends a `hash` for EVERY 20th tick it steps, including during catch-up replay, with no suppression. The server limiter allows `hashPerSec: 4` and advises `disconnect` after 30 violations within the 5 s decay (`ratelimit.ts:25`), and the connection token bucket is 40/s burst 80 (`limits.ts:3-4`). A rebuilt client replaying thousands of ticks inside the 8 ms/frame budget emits far more than 4 hashes/s, so a resync (and today's SP07 reconnect) can trip `rate-limited` errors and a `CLOSE_RATE_LIMITED` close. [RESOLVED: hash repeats do not trip desync, but catch-up hash bursts trip the rate limiter; requirement S10 added — verified]

Not used: `createCatchup`/`createJoinLate` (`packages/net`) stay as test oracles only; production catch-up is the web NetDriver budgeted drain fed by the server's `catchup` chunks.

## Versions
- RULES_VERSION: no change (3.2.0). Sim, content, commands and hashing untouched; replay compat unaffected (checked: nothing in `packages/sim`/`defs` is edited).
- PROTOCOL_VERSION: SP08 adds no message, field or enum value (`resync` and `error` codes `rate-limited`/`no-match` already exist). It rides the shared v2 -> v3 bump made by whichever of SP09/SP11 lands a wire change first; SP08 must not bump alone.
- Absorbs old rows: SP02#13 (auto-resync; `reset()` path dropped in favor of controller rebuild), SP04#20 resync half (load-smoke half moves to SP10), SP05#17 (runtime recreation). SP04#19 already void.

## Decisions

| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Server reply | Reuse reconnect attach (full catch-up from tick 0) | Resume from checkpoint; new `resync.ok` message | Zero new wire; already tested path; deterministic |
| D2 | Client recovery | Full rebuild via `startMatch(reconnect=true)` | `LockstepClient.reset()` + keep sim | A diverged sim cannot be trusted; runtime rebuild is already supported per start |
| D3 | Limit | 1/10 s per player id, plus shared catch-up token | Per-IP only; unlimited | Caps replay CPU (~2.4 s worst case); matches `DESYNC_MIN_GAP_MS` |
| D4 | Spectators | Allowed, same limit | Seats only | Same attach path; spectators also hit push errors |
| D5 | Cap per match | 3 auto-resyncs then terminal message | Unlimited with rate limit | Persistent non-determinism should surface, not mask |
| D6 | Wire | No `reason` field | `resync{reason}` | Avoids strict-schema change; client logs locally |
| D7 | Net helpers | `createCatchup`/`createJoinLate` oracle only | Wire into production | NetDriver budgeted drain stays production |
| D8 | Epoch | Keep `lastEpoch=-1` on `start` | Track per-attach nonce | Same-turn ordering makes stale snapshots impossible mid-chunks |

## Risks / Open Questions
- Auto-resync can hide real non-determinism. Mitigation: warn log with tick + both hashes (existing) plus resync log (S9); D5 cap. [RESOLVED: orchestrator default — owner may override]
- Resync while paused: client receives paused snapshot and freezes at `tick`; disconnect-hold auto-resume only fires for own disconnect holds, so a manual hold stays held. [RESOLVED: expected]
- Resync during the 3-2-1 gap before tick 0 returns `no-match`; client treats as S8 only if a desync was actually reported (cannot occur before tick 0). [RESOLVED]
- Hash-repeat behavior after rebuild: repeats are harmless to the desync check but catch-up bursts hit the hash rate limiter; fixed by S10. [RESOLVED: verified, see Convergence check]
- Coordination: SP09 and SP08 both edit `room.ts`'s switch/closing paths and SP09 may add protocol messages; land SP09's protocol bump first or merge carefully. SP11 depends on both.

## Acceptance Criteria
1. Server unit: `resync` in running room replies `start`, chunked `catchup` (`done` last), `pause.state`, in one turn; spectator variant has `youPlayer=null`; lobby/countdown -> `no-match`; second resync within 10 s -> `rate-limited`, conn open; interaction with `allowCatchUp` covered.
2. Forced hash mismatch (test hook corrupts client sim): client gets `desync`, sends one `resync`, recreates, and its hash equals the server hash at the next checkpoint; live ticks continue with no gap.
3. Forced gap in tick stream triggers the same recovery (no "Leave and rejoin" on first occurrence).
4. Duplicate triggers while in flight send one `resync`; fourth trigger in a match shows the terminal message.
5. Resync while paused: freeze tick and budgets unchanged, epoch accepted after `start`.
6. Rate-limited resync leaves the connection and match intact; banner/toast shows the fallback.
7. Catch-up (resync and reconnect) of a >=2,000-tick match sends no `hash` for ticks <= catch-up target and triggers zero `rate-limited` errors; first live checkpoint after catch-up hashes and matches (S10).
8. e2e (SP06 harness): two-browser match with an injected desync recovers and finishes with matching result.
