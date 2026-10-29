---
status: draft
summary: M2 enhancement — shared per-player 30-second pause/disconnect budget, confirmed Quit forfeits and authoritative 1v1 outcomes; non-1v1 and concurrent-disconnect policy remains open.
date: 2026-10-29
---
# PRD: SP07 Pause, Quit and window-close forfeit

Repo/branch: node-arena / `feat/pvp` · Milestone: **M2 (next milestone), planning only** · Depends on: SP01 outcome/replay rules, SP02 control messages/catch-up, SP04 match lifecycle/clock, SP05 controls/reconnect, SP06 integration/e2e.

## TL;DR
Each player gets **30 seconds total cumulative pause time per match**. Manual pauses and detected disconnects/window closes consume that player's same remaining balance; the board and match clock freeze, while an authoritative real-time countdown continues. Resume preserves unused time. In 1v1, confirmed Quit or remaining-budget expiry gives the opponent the win.

These user decisions supersede the old blanket “no PvP pause” and “30-second grace then bot takeover” plan for 1v1. This is a future M2 enhancement: no feature implementation, active rules edit or version bump is authorized by this planning record. Broader M2 implementation remains paused. Owner reports joining works; full M1 gameplay approval remains pending.

## Problem
The M1 Esc/Leave menu does not pause play. The earlier future plan gave each disconnect a fresh grace period and replaced the player with a bot. The owner instead wants a bounded pause that visibly freezes both players' game, a safe explicit Quit action, and window-close handling that cannot reset the allowance.

## Goals / Non-Goals
Goals: one server-owned allowance per player/match; frozen simulation and match clock; visible remaining-time feedback; voluntary Resume; confirmed 1v1 forfeit; reconnect within the same balance; exactly one authoritative terminal outcome.

Non-goals: speed control; auto-pause merely because a tab becomes hidden; reliable `beforeunload` delivery; reconnect across server process loss; general desync recovery/load hardening (M3); choosing team/FFA loss semantics here. Spectators remain read-only.

## Requirements

| ID | Requirement |
|---|---|
| P1 | Initialize each player's balance to 30,000 ms on a new match. Repeated pause, disconnect, reload, token reconnect or control-message retry cannot refresh it. A new match/rematch resets it. |
| P2 | Manual Pause automatically starts a visible countdown from that player's remaining balance (30 seconds initially). Both clients see pause owner, reason and remaining time. Freeze server simulation ticks, board state, bot decisions and the logical match timer for the pause. |
| P3 | The pausing player can Resume before expiry; charge elapsed real time once and retain the unused balance for later pauses. The opponent cannot resume that player's pause. Pause and Quit controls remain visible with clear ownership/permission state. |
| P4 | If still paused at the owner's budget deadline, the server ends a 1v1 match with that player forfeiting and the opponent winning. A new pause with zero balance immediately reaches this condition; it cannot buy a free pause or extra tick. |
| P5 | Quit in the pause menu opens confirmation: **Yes** forfeits and the other player wins in 1v1; **No**, cancel or dialog dismissal does not quit. The countdown continues while confirmation is open. Opening/canceling confirmation never resets time or silently resumes the match. |
| P6 | Detected connection loss, including a closed game window, starts a pause using the disconnected player's **remaining** balance. Return/reconnect before expiry must permit catch-up and Resume within the same allowance; failure to return/resume before expiry forfeits in 1v1. No fresh 30-second grace and no 1v1 bot takeover. |
| P7 | Disconnect during the player's existing manual pause changes connection/reason state without restarting the interval or charging it twice. Losing/replacing a socket cannot overwrite the original pause deadline. |
| P8 | Server deadlines, permissions and terminal state decide the outcome. Client clocks display estimates only; clients cannot claim a winner, extend a deadline or resume an expired match. Quit/disconnect/Resume after an existing result cannot change that result. |
| P9 | While paused, reject new gameplay commands with a clear paused response. Previously accepted delayed commands stay in their bounded original tick buffers and can apply only on their original logical ticks after Resume. No command, bot update, catch-up request or control message may advance the live simulation during pause. |
| P10 | Hidden-tab visibility alone does not pause. The server observes socket close or heartbeat timeout, not the user's browser window directly; browser unload hooks are optional hints, never authority. Document and test a bounded detection lag separately from the remaining-budget countdown. |
| P11 | Spectators cannot Pause, Resume another player's pause or forfeit a player. Proposed bot policy: bots never initiate pauses or own a manual pause allowance; a human pause freezes all bot simulation work too. Human-vs-bot enablement requires explicit scope confirmation below. |

## Architecture

**Authoritative state and clocks (SP04).** Keep per-match balances keyed by stable seated player identity on the server, not in browser storage. A paused match stores owner, reason, pause epoch, start time and deadline from an injected monotonic wall-clock source. Effective remaining time is derived from that interval. Charge once on Resume or termination. The global scheduler continues servicing timers/heartbeats and other rooms while skipping this room's logical tick work. Resume rebases its schedule: elapsed pause time must not produce a burst of catch-up simulation ticks or consume match time. Stable match/epoch identifiers make retries and stale frames harmless.

**Detection and reconnection (SP02/04/05).** Tick traffic stops during pause, so the earlier “ticks double as heartbeat, no separate keepalive” assumption is insufficient. Specify an independent ping/pong cadence, timeout and maximum detection lag before implementation; it must continue during pauses. Socket close starts the budget promptly when observed; unobserved network/window loss begins it at timeout detection. Do not promise an exact deadline measured from the physical window close.

Promote the minimum token reconnect/reclaim, log catch-up and runtime recreation path from M3 into M2 **before enabling window-close/disconnect pause**. Reconnecting to the same match recovers authoritative pause state/balance, rebuilds to the frozen tick and can Resume when ready before the existing deadline. Handshake alone must not stop budget consumption or grant time for catch-up. This capability is planned, not an M1 claim. General M3 reconnect polish and automatic desync resync stay M3.

**Wire/UI (SP02/05).** Design strict validated Pause/Resume/Quit intents and authoritative pause-state updates (match/epoch, owner, reason, deadline/remaining allowance, frozen tick and permissions). Exact message names belong in the settled protocol update. Control state travels independently of tick frames and survives reconnect; clients must align to the frozen tick without consuming future live ticks. Show the countdown on both clients with Pause/Resume and Quit/confirmation states. Client countdown reaching zero does not invent an outcome; wait for the server result. A late Resume or Yes must first resolve deadline expiry and then respect terminal idempotence.

**Deterministic termination (SP01/02/04).** Existing elimination/timeout outcomes and command-only replay logs do not yet express a forfeit while ticks are frozen. Before implementation, specify a deterministic logged terminal forfeit event at the frozen tick with an unambiguous ordered position, losing player, reason and authoritative winners. Replay/catch-up must reproduce the terminal outcome and final hash consistently without an extra gameplay tick or wall-clock reads in the pure sim. Keep ranking/result mapping explicit. Resolve its exact representation and compatibility in a reviewed design, then update GAME_RULES stable IDs/changelog and RULES_VERSION/protocol/replay compatibility as required, add meaningful rule/replay tests, and only then code. **Do not edit the active mechanics contract or versions for this future plan.**

## Decisions

| # | Decision | Choice | Alternative rejected | Why |
|---|---|---|---|---|
| D1 | Allowance | 30 seconds cumulative per player per match | Fresh 30 seconds per pause/drop | User confirmed total budget |
| D2 | Freeze | Board + logical match clock; wall-time budget continues | Pause only local rendering | Shared visible pause |
| D3 | Resume | Owner can resume; unused balance persists | Reset allowance on Resume | User confirmed |
| D4 | Quit | Confirmation Yes forfeits; No/cancel stays | Immediate quit | Avoid accidental loss |
| D5 | Window close/drop | Same remaining allowance, then 1v1 forfeit | Old independent grace then bot | User selected this policy |
| D6 | Authority | Server deadline and one terminal result | Client-reported winner/countdown | Enforceable and race-safe |
| D7 | Timing | Next milestone M2, docs now | Implement immediately | User explicitly deferred implementation |

## Manual steps
No new owner setup is required for this planning task. Before implementation, settle the open product policies below and approve the resulting coherent PRD; then regenerate affected tasks. M1 owner gameplay review and eventual production approval remain separate.

## Risks / Open Questions

- [OPEN] Team/3–4-player FFA forfeit and pause policy: does Quit/expiry eliminate one seat, lose a team, or end the match, and how do remaining units/placements behave? Do not infer whole-team loss from the 1v1 rule or enable it by analogy.
- [OPEN] Concurrent/opponent pause or simultaneous disconnect policy: whose interval runs, whether multiple balances run, what happens when both 1v1 players are absent/expire together, and when all sockets disappear. Specify outcome/tie ordering and room retention; avoid GC preempting a valid deadline/result.
- [OPEN] Lobby/countdown disconnect policy: the allowance is per match; define phase boundary, seat reservation and host transfer. Old lobby grace behavior is not automatically the new match rule.
- [OPEN] Bot scope/permissions proposal P11: confirm human-vs-bot support and whether 1v1 forfeit applies to it; spectators remain read-only and bots do not initiate pause under this proposal.
- [RESOLVED: implementation prerequisite] Specify heartbeat detection bounds, exact protocol/queued-input ordering and deterministic terminal-event/replay/version contract in the reviewed technical design before coding; no fresh client-only winner path.
- [RESOLVED: milestone dependency] Minimum reconnect/catch-up/Resume is promoted to M2; broader reconnect/resync hardening remains M3. Existing task lists are historical projections until reconciled.

**Task generation is pending these questions.** No SP07 TASKS.md and no affected TASKS.md regeneration while `[OPEN]` items remain. Broader M2 coding is still paused.

## Acceptance Criteria

1. Fake-clock integration: Pause at tick N holds all board state/hash and match-time values fixed across both clients/referee while the visible real-time balance decreases; unrelated rooms/heartbeats continue. Resume has no burst of owed ticks.
2. Pause 8 seconds, Resume, pause again: about 22 seconds remain. Reload/reconnect does not refresh it; new match/rematch starts at 30 seconds. Exhausted-budget Pause forfeits without advancing a tick.
3. Disconnect/window close after earlier usage consumes only the remainder. Return/catch-up/Resume before deadline converges at the same hash and preserves unused time. A manually paused player disconnecting is charged once with unchanged deadline. No 1v1 bot takeover occurs.
4. Quit Yes produces opponent victory/own defeat exactly once; No/cancel preserves the pause and countdown. Expiry while confirmation is open, late Resume/Yes, repeated frames and post-result socket close cannot flip the winner or emit conflicting results.
5. Pause-state permissions and malformed/spoofed controls are covered; spectator control attempts fail. Commands received during pause are rejected; previously accepted delayed commands apply only after Resume at their original ticks. No control path steps live simulation while paused.
6. Heartbeat tests cover abrupt close, silent drop and loss while paused against documented detection bounds; hidden visibility alone has no effect. A reconnect that cannot finish before deadline cannot extend the allowance.
7. Forfeit terminal log round-trips through replay/catch-up with the same outcome/final tick/hash; late join/reconnect after end receives the immutable result. Rule tests use stable `covers R-...` titles once active rules are authored; campaign regressions remain green.
8. Two-browser M2 coverage verifies both countdown displays, freeze/Resume, repeated cumulative usage, Quit confirmation and window-close/return/expiry. Add team/FFA/concurrent/lobby cases only after their policies are settled, then reconcile affected tasks and milestone ordering before implementation.
