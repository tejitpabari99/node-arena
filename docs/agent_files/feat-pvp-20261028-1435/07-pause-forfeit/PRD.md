---
status: approved
summary: M2 — per-player 30 s cumulative pause/disconnect budget, confirmed Quit, deadline forfeit as a logged `Forfeit` command (RULES_VERSION 3.2.0), heartbeat, pause wire messages (PROTOCOL_VERSION 2), minimum reconnect/catch-up, all four owner policies settled.
date: 2026-10-29
---
# PRD: SP07 Pause, Quit and window-close forfeit

Repo/branch: node-arena / `feat/pvp-m2` · Milestone: **M2 (active)** · Depends on: SP01 outcome/replay rules, SP02 control messages/catch-up, SP04 match lifecycle/clock, SP05 controls/reconnect, SP06 integration/e2e.

## TL;DR
Each human gets **30 s cumulative pause time per match** (server-owned). Manual pauses and detected disconnects/window closes draw on that one balance; board, bots and match clock freeze while the wall-clock countdown runs. Resume keeps unused time. Quit (confirmed) or budget expiry **eliminates that seat only**: its buildings go neutral, its troops vanish, the match continues for the rest (1v1 = opponent wins). The elimination is a deterministic logged `Forfeit` command, so replay, catch-up and hashes need no wall-clock reads. Human-vs-bots (no other human) has unlimited pause.

Supersedes the blanket "no PvP pause" and the "30 s grace then bot takeover" plan for human players. M2 implementation is authorized: GAME_RULES text + changelog + `RULES_VERSION` bump come first, per AGENTS.md mechanics order (tasks do this, not this PRD).

## Problem
M1 Esc/Leave does not pause. The old plan gave each disconnect a fresh grace then a bot. The owner wants a bounded pause that freezes everyone, a safe explicit Quit, and window-close handling that cannot reset the allowance.

## Goals / Non-Goals
Goals: one server-owned allowance per human/match; frozen sim and match clock; visible countdown; voluntary Resume; confirmed Quit; same-balance reconnect; exactly one authoritative result; defined team/FFA/concurrent/lobby/bot behavior.
Non-goals: speed control; auto-pause on hidden tab; reliable `beforeunload`; reconnect across server restart; auto-resync on desync, reconnect polish, load smoke (M3); bot takeover of humans (dropped).

## Requirements

| ID | Requirement |
|---|---|
| P1 | Each human seat starts a match with 30,000 ms. Pause, disconnect, reload, token reconnect and message retries cannot refresh it. Rematch resets it. Bots have no balance. |
| P2 | Manual Pause opens a **hold** for that seat; all clients see owner, reason and remaining balance. Server ticks, bot decisions and the logical match timer freeze. |
| P3 | Only the owner can Resume its hold; elapsed real time is charged once, the rest is kept. |
| P4 | A hold whose deadline (`start + remaining`) passes forfeits that seat (P9). Pausing with 0 balance expires immediately; it cannot buy a tick. UI disables Pause at 0. |
| P5 | Quit: client shows Yes/No confirmation (countdown keeps running); Yes sends `quit` and forfeits (P9). No/dismiss changes nothing. `room.leave` during a running match is treated as `quit` for seated players (client must confirm first). |
| P6 | Detected connection loss (socket close or heartbeat timeout) opens a `disconnect` hold on the remaining balance. Reconnect must catch up to the frozen tick and send `resume` inside the deadline; handshake alone stops nothing. |
| P7 | Disconnect during the seat's own manual hold only marks it `connected=false`; deadline and charge are unchanged (charged once). |
| P8 | Server deadlines, permissions and terminal state decide outcomes; client countdowns are estimates. Control after the result cannot change it. |
| P9 | **Forfeit** = seat-only elimination (decision 1): server appends a `Forfeit{player}` system command to the log; sim neutralizes the seat's buildings, kills its troops, sets `eliminatedAt`. A team wins if any teammate survives (R-WIN-04); last team standing wins; if every remaining team is eliminated in the same tick the result is a draw (R-WIN-06b). |
| P10 | Detection: abrupt close is observed on the socket `close` event; silent drops by heartbeat (below). Hidden tab alone never opens a hold. |
| P11 | Spectators can never pause, resume or forfeit. Bots never pause. Bot simulation freezes with the match. |
| P12 | Concurrent holds (decision 2): see Concurrency below. |
| P13 | Lobby/countdown (decision 3): see Lobby below. |
| P14 | Unlimited mode (decision 4): if no OTHER non-eliminated human seat exists, pause has no budget and no expiry forfeit; Quit still forfeits. |

## Decisions

| # | Decision | Choice | Alternative rejected | Why |
|---|---|---|---|---|
| D1 | Allowance | 30 s cumulative per human per match | Fresh 30 s per pause/drop | Owner |
| D2 | Freeze | Board + logical match clock; wall budget keeps running | Local-only pause | Shared visible pause |
| D3 | Resume | Owner resumes; unused balance persists | Reset on Resume | Owner |
| D4 | Quit | Confirmation Yes forfeits | Immediate quit | Avoid accidents |
| D5 | Window close | Same remaining balance, then forfeit; no bot takeover | Fresh grace then bot | Owner |
| D6 | Authority | Server deadline + one terminal result | Client winner/countdown | Race-safe |
| D7 | Timing | M2 | Defer | Owner (now approved) |
| D8 | [RESOLVED: team / 3–4p FFA] | Quit/expiry eliminates ONLY that seat: buildings neutral, troops (incl. in transit) vanish, match continues; a team still wins if teammates survive; 1v1 = opponent victory | Whole-team loss; match end | Owner 2026-10-29 |
| D9 | [RESOLVED: concurrent pauses] | Manual Pause rejected while the match is paused; a disconnect during another player's pause starts that player's own hold; multiple balances may run; match resumes only when all holds end; first deadline forfeits, unless every other surviving human seat is also away (disconnect hold, not connected) at that instant, in which case the match ends as a draw (no winner); if a connected human remains the expiring seat forfeits per D8; same-instant deadlines forfeit together (draw if that eliminates every remaining team) | Single global hold; awarding victory to an absent player | Owner; all-humans-away draw is an owner-decision correction (2026-10-29) |
| D10 | [RESOLVED: lobby/countdown] | Budget only after match start. Lobby drop: seat reserved 30 s for token reconnect then freed; host passes to next human seat; a drop in the 3-2-1 countdown cancels it back to lobby | Budget in lobby | Owner |
| D11 | [RESOLVED: bots] | No other human seated: pause unlimited, no expiry forfeit; Quit = that human's loss. Bots never pause; spectators read-only | Budget vs bots | Owner |
| D12 | Forfeit encoding | `Forfeit{player}` command in the command log, applied in phase 1 of the frozen tick | Out-of-band terminal record; wall-clock in sim | Replay/catch-up/hash stay command-only |
| D13 | Heartbeat | Server-initiated ws protocol ping/pong | App-level `ping` timer in client | Browser answers off the JS thread, so throttled hidden tabs are not false disconnects |
| D14 | Sole-human abandonment | Disconnected hold in unlimited mode has no forfeit; room closed `idle` after 10 min without a connected human, no result | Infinite retention | Engineering safety (no leaked rooms), not a product rule |

## Design

### (a) Heartbeat (`apps/server` conn/hub, `main.ts` ws adapter)
Server pings every **3000 ms** (`HEARTBEAT_INTERVAL_MS`) via the ws protocol ping frame (new optional `Socket.ping()` / `onPong`; `wrapWs` implements). Any inbound frame or pong refreshes `lastSeen`. A 1000 ms sweep closes an authed conn with no inbound for **7000 ms** (`HEARTBEAT_TIMEOUT_MS`, new close code 4004). **Detection bound: abrupt close ≈ immediate; silent drop ≤ 8 s** after the last inbound. The budget starts at detection (not backdated), so a silent drop can cost the opponent up to 8 s of live play before the freeze; documented, tested. Timers use the hub's injected timers, run independently of the 20 Hz loop, and continue during pauses. App-level `ping`/`pong` messages stay for optional RTT display only. The old "ticks double as heartbeat" assumption is void.

### (b) Wire protocol (`packages/net`; `PROTOCOL_VERSION` 1 → **2**)
Client → server (strict, exact fields): `pause {t}`, `resume {t, epoch:int}`, `quit {t}`. Server → client: `pause.state {t, epoch:int, paused:boolean, tick:int, unlimited:boolean, holds:[{player:int, reason:'manual'|'disconnect', connected:boolean, since:int}] (≤4), budgets:(int|null)[] (≤4, ms 0..30000, null = bot/unlimited)}`. `seat.status` gains statuses `away` (lobby reserve, optional `graceMs`) and `forfeit` with optional `cause:'quit'|'budget'`; `grace`/`bot` stay in the union but nothing sends them. New error codes `paused`, `no-match` (web `ERROR_STRINGS` updated). Server-message validation must also accept `Forfeit` inside `tick.c` and `catchup.cmds`; the **client** `cmd`/`wireCommand` validator still accepts only `DrawLine`/`CutLine`, so clients cannot inject a Forfeit.

Semantics:
- `epoch` is a per-match counter bumped on every hold change (open, close, forfeit). `pause.state` is a full snapshot broadcast to players and spectators on every change and to every (re)authed seat; clients ignore `epoch` ≤ last seen. `budgets[i]` is the remaining ms at send time; clients count down locally (display only).
- `pause`: only a seated, non-eliminated human in `running`. Rejected `paused` while any hold exists, except an idempotent repeat by the current owner (re-sends state). Otherwise opens a manual hold, removes the room from the clock, bumps epoch, broadcasts. Non-seat/spectator → `not-your-seat`; wrong room state → `no-match`.
- `resume {epoch}`: ends the sender's own hold if `epoch` ≥ hold `since` (older = stale interval, ignored; state re-sent). No hold → no-op + state. Match resumes only when no holds remain.
- `quit`: allowed any time in `running`; appends a pending `Forfeit`; removes the sender's hold; sends `seat.status{forfeit}`. Repeats and post-result calls are no-ops.
- `cmd` while any hold exists → `error paused`, never queued (client cannot tell which ticks it targets). Commands accepted before the pause stay in `LockstepServer`'s per-tick buffer keyed by their original target ticks and apply at those ticks after resume.
- **Frozen tick** `pause.state.tick` = `lockstep.nextTick` = the next tick to be closed. All `tick` frames `< tick` precede `pause.state` on every socket (ws is ordered, pause handling is synchronous). The client steps until `sim.view.tick === tick` and then holds; queued ticks beyond it are a protocol error.
- Control messages share the per-connection bucket (SP02 R9).

### (c) Deterministic forfeit (`defs`, `sim`, `net`, `server`)
- `packages/defs` COMMANDS gains `Forfeit {player}` (reject reasons: `gameover`, `malformed`, `unknown-id`, `not-pvp`, `eliminated`).
- Server: `LockstepServer.closeTick(botCmds, systemCmds)` prepends `Forfeit`s (ascending seat) to the tick's command array, so they go through `CommandLog.append`, the `tick` frame, `catchup` and `ReplayRecord.commands` like any command. No new frame, no side record.
- Sim: phase 1 runs a first pass of `Forfeit`s (ascending player), then `DrawLine`/`CutLine`. Effect on seat `s`: owner → neutral, **building level retained**, its lines cancelled, troops sourced at its buildings die, growth timers reset, tower cooldown unchanged; `eliminatedAt = tick`; `SeatEliminated` emitted. Neutral towers then fire per existing `neutralFires` (accepted consequence of "buildings become neutral"). Outcome is evaluated at phase 9 of the same step by R-WIN-04..07 unchanged. No sim code reads time; **who forfeits and when is decided outside and recorded in the log.**
- **When it is stepped.** Forfeit is applied in tick `N = frozen tick`, never an extra tick: (i) if applying all pending forfeits leaves ≤ 1 team alive (terminal, incl. all-eliminated draw) the server immediately closes tick N with them (one step, `end` follows; finalTick N+1, valid under replay validation `entry.tick < finalTick`); (ii) otherwise they stay pending and apply as the first system commands of tick N when the match resumes. A non-paused Quit applies at the next normal tick.
- **Hash.** No new hash words. Owner/level/timers and (pvp) `eliminatedAt` are already hashed; domain stays `sim-state-v2`. Campaign hashes/replays unaffected (Forfeit is rejected `not-pvp`).
- **Rules** (GAME_RULES, written before tests/code): new area **FFT**: `R-FFT-01` Forfeit effect, `R-FFT-02` validity, phase-1 order and system-issued-only provenance, `R-FFT-03` outcome interaction (simultaneous forfeit of all remaining teams → draw via R-WIN-06b; eliminatedAt feeds R-WIN-07). Amend in place: R-ELM-01 (second elimination cause), R-WIN-04/06(b) (cross-reference), R-TCK-03/§4 phase-1 row and §4.1 (command set union). Tests use `covers R-FFT-0x`. The implementing task confirms where `check:rules` registers new IDs.
- **Versions.** `RULES_VERSION` **3.1.0 → 3.2.0 minor** (additive command; no existing replay outcome changes). Replay compat is exact major.minor, so goldens/`levels-lock`/`content.json` get `rulesVersion` metadata refresh only (as in 3.1.0); a new pvp forfeit golden replay locks behavior. `SCHEMA_VERSION` 2.0.0 unchanged (`commands[].cmd` is open JSON). `BOT_VERSION` unchanged (bots never emit Forfeit). Handshake already gates rules major.minor and `pv`, so client/server must deploy together (server first, as before).

### Concurrency (decision 2)
Server pause module (`apps/server`, pure, injected monotonic `now` truncated to integer ms, injected timers): `holds: seat → {origin, connected, since, startedAt, deadline}`. Each hold charges only its own seat. One timer armed for the earliest deadline, re-armed on any change.
- **Expiry order.** Let `d0` = earliest deadline among holds; the set `E0` with deadline exactly `d0` forfeits **together** (same tick). Ordering uses recorded deadlines, not timer lateness. If the match is then terminal, later holds are moot (1v1: first to expire loses; identical deadlines → both eliminated → draw). Else the next earliest is evaluated.
- **Absent opponent / all-humans-away draw** (owner-decision correction, 2026-10-29; supersedes the earlier "absent opponent wins"). When a hold's deadline expires (set `E0`), the server checks its own connection state at that instant: let `A` = surviving human seats with an active disconnect hold and no connected socket (includes `E0`). (i) If every surviving human seat is in `A`, the match ends immediately as a **draw among all surviving seats/teams** (no winner), never a victory for an absent player; 1v1 with both disconnected => the first expiry ends the match as a draw. (ii) If at least one other surviving human seat is connected, `E0` forfeits per D8 (seat eliminated; 1v1 = the connected opponent wins; teams/FFA continue while teams remain). (iii) Same-instant expiries still forfeit together (draw if that eliminates every remaining team). Limit: human(s)-vs-bots-only stays unlimited mode (D10/D14, no expiry); "all humans gone" there is the D14 idle close with no result. With >=2 humans plus bots, all humans away at an expiry => draw including bot seats (replaces the earlier "bot team wins"). **Representation: no new command or flag.** The server (not the sim) reads connection state, then appends `Forfeit{player}` for `E0` and, in case (i), for every other surviving seat (humans and bots, ascending seat) in the same `closeTick` as system commands; the sim eliminates every remaining team in one tick, so R-WIN-06b/R-FFT-03 yields the draw. The decision is fully in the logged commands; the sim never reads connection state or time; replay/catch-up/hash unchanged. The retained `end` is a draw (`winner` null). Note: "all humans gone" at expiry is evaluated with the same recorded-deadline ordering as above.
- **Match resume** only when `holds` is empty. A disconnect-origin hold ends on `resume` sent after catch-up (web auto-sends it when caught up; a manual-origin hold needs an explicit click even after reconnect).
- **Retention.** `gc()` only touches `ended`/`closed`; the current `onDisconnect` "all conns closed ⇒ close + drop" path is removed for running rooms. A running room with a pending deadline cannot be dropped except by shutdown or abort. After the result, `endedAt` is set and the room (with its immutable `end`) is kept `ENDED_ROOM_TTL_MS` (10 min) so absent players can fetch it. Unlimited-mode abandonment: see D14.
- **Unlimited recompute** at hold start and after every elimination (a human seat becomes the only live human ⇒ its deadline clears).

### Lobby / countdown (decision 3)
Lobby drop: seat stays reserved 30 s (`seat.status away`, `graceMs`), token reconnect reclaims it, then it is freed. Host drop/leave: host passes immediately to the earliest connected human seat, ready flags cleared (existing); the returning ex-host is a normal member. Countdown: any seated-human drop or leave cancels it: state → `lobby`, the clock entry is removed, `lobby.state` is broadcast; web returns countdown → lobby on that message. Socket-less lobby GC (2 min) stays ≥ the 30 s reserve. No budget is charged outside `running`.

### (d) Minimum reconnect: M2 vs M3
**M2 (here):** token reclaim of a held seat (`onAuthed` rebinds conn; `welcome.resume`); in `running`/`ended` server sends `start`, full `catchup` from `CommandLog.range(0, nextTick)` (≤2000-tick chunks, last `done:true`), then `pause.state`, `seat.status`, and the stored `end` if over, then subscribes the new conn to live frames, all in one synchronous turn; web recreates sim + `LockstepClient(0)` + runtime on a repeated `start` for the same `matchId` (replacing the M1 "keep the running match" shortcut), shows the catch-up overlay (budgeted stepping, NetDriver already does), then auto-resumes disconnect holds; forfeited seat reconnects as an eliminated player (no spectator conversion); reconnect after `end` gets the immutable result; web `PvpConnection` backoff already exists. Catch-up may use SP02#10 `createCatchup` or the existing NetDriver drain, whichever lands first.
**M3 (left):** auto-resync on `desync`, resume-from-checkpoint (avoid full replay), polished reconnect UX/status chips beyond basic, seat-reclaim-after-bot (void now), SIGTERM drain / server-restart recovery, load smoke.

### (e) Room clock rebasing
Match ticks are call-counted (`closeTick` once per `tick()`), never derived from `now - startAt`, so no owed ticks can accrue. Pause removes the room's `ClockRoom` from the shared loop synchronously in the message handler (no tick can interleave). Resume re-adds it with `startAt = clock.boundary(now())` so the first tick lands on the next loop boundary even if the loop is lagging (≤ `MAX_CATCHUP` burst cannot reach it). Other rooms and heartbeats are untouched. Terminal flush (c-i) calls the same tick path once. Test: fake clock, pause 10 s, resume ⇒ next `tick` frame is `n = frozen tick`, exactly one per 50 ms thereafter.

## Manual steps
None for the owner. Production deploy of RULES/PROTOCOL bumps follows the existing server-first order (SP06).

## Risks / Open Questions
- Neutral forfeited towers fire at everyone (level retained, existing `neutralFires`). Intentional; revisit after play-test (content flag, not a rule change).
- Silent-drop detection lag (≤ 8 s) lets the opponent play unpaused for that window; accepted.
- Full replay on reconnect costs up to ~2.4 s CPU on an 8-minute match (M3 checkpoint resume).
- Pre-existing M1 cap behaviors unchanged: `Forfeit`s count toward `cmdCap`.
- No `[OPEN]` product questions remain.

## Acceptance Criteria
1. Fake-clock: pause at tick N holds referee/client state, hash and match timer for 10 s while budgets fall; other rooms and heartbeats keep running; resume emits tick N next, no burst.
2. Pause 8 s, resume, pause again ⇒ ~22 s left; reload/reconnect does not refresh; rematch resets; a 0-balance Pause forfeits without advancing a tick; unlimited mode (human + bots) never expires.
3. Disconnect/window close charges only the remainder; return + catch-up + `resume` before the deadline converges to the same hash; manual hold + disconnect is charged once; no bot takeover.
4. Quit Yes ⇒ one defeat/victory; No keeps the pause. Expiry during the confirm dialog, late Resume/Yes, repeated frames, post-result close cannot change the result.
5. Team/FFA: forfeit leaves a 2v2 teammate alive and play continues; 3–4p FFA continues for the rest; same-instant 1v1 expiry ⇒ draw; earlier-deadline expiry ⇒ connected opponent wins; 1v1 both disconnected ⇒ first expiry ends as draw (not a win for the absent player), logged as `Forfeit` for every surviving seat in one tick; expiry with a connected human elsewhere forfeits only the expiring seat; humans+bots with all humans away at expiry ⇒ draw; human-vs-bots-only never expires (owner-decision correction 2026-10-29).
6. Concurrent: second manual Pause ⇒ `paused`; a disconnect during another's pause opens its own hold; resume only after all holds end; spectator/forged controls rejected; `cmd` during pause ⇒ `paused`; pre-pause buffered commands apply at their original ticks.
7. Heartbeat: abrupt close, silent drop (≤ 8 s), drop while paused, hidden tab (protocol pong still answered ⇒ no hold).
8. Replay: forfeit log round-trips through `playReplay`, catch-up and a reconnecting client with equal final hash/outcome; reconnect after `end` receives the same `end`. `check:rules` green with `covers R-FFT-0x`; campaign goldens unchanged except `rulesVersion` metadata.
9. Lobby: drop reserves 30 s then frees; host transfer; countdown drop cancels to lobby.
10. Two-browser e2e (SP06): countdown on both sides, freeze/Resume, cumulative use, Quit confirm, window-close/return/expiry, bot-only unlimited pause.
