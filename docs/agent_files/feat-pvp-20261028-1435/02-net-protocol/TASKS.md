---
status: draft
summary: Task breakdown for packages/net - scaffold, wire catalogue + strict validation, handshake, CommandLog, lockstep server/client, outcome adapter (M1); catch-up, rate limits, batching (M2); auto-resync (M3)
date: 2026-10-28
---
# Tasks: Net Protocol (packages/net)
Source of truth: docs/agent_files/feat-pvp-20261028-1435/02-net-protocol/PRD.md. New pure package `@node-arena/net` shared by apps/server and apps/web; no sockets/DOM/Node APIs. SP01 deps reference real task numbers (SP01#8 = pvp outcome / view.over). SP07 (2026-10-29) ownership: all pause/quit/forfeit/heartbeat/reconnect-hold work is tracked in ../07-pause-forfeit/TASKS.md, not here; entries below carry only amended decisions. Protocol v2 (`PROTOCOL_VERSION` 2: `pause`/`resume{epoch}`/`quit`, `pause.state`, `start.cancel`, `paused`/`no-match` errors, `closeTick(botCmds, systemCmds)`, `Forfeit` accepted in server `tick.c`/`catchup.cmds`, client `cmd` still DrawLine/CutLine only) is SP07-owned. Tick-as-heartbeat claim is void (ticks stop during pause; liveness is SP07 heartbeat).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M1] Scaffold packages/net + lint/determinism/build wiring | none | done |
| 2 | [M1] Message catalogue, versions, codec | 1 | done |
| 3 | [M1] Strict parse/validate (client + server messages) | 2 | done |
| 4 | [M1] Handshake version checks | 2, 3 | done |
| 5 | [M1] CommandLog | 1 | done |
| 6 | [M1] LockstepServer | 3, 5 | done |
| 7 | [M1] LockstepClient | 2 | done |
| 8 | [M1] Outcome adapter (toWireOutcome) | 2, SP01#8 | done |
| 9 | [M1] Server/client lockstep integration + replay test | 6, 7, 8 | done |
| 10 | [M2] Catch-up runner + local-join-late helper | 5, 7 | todo |
| 11 | [M2] Rate limiter | 6 | todo |
| 12 | [M2] Lagging-client `ticks` batching | 5, 6 | todo |
| 13 | [M3] Auto-resync on desync | 7, 10 | todo |

## Task 1 — [M1] Scaffold packages/net + lint/determinism/build wiring
What it is: empty `@node-arena/net` package so later tasks land in a gated workspace (Decision on dependency graph; R1 layout).
What changes at a high level: package.json (exports dist/), tsconfig + tsconfig.check (lib ES2022, types []), `tsx --test` runner, eslint config copying bots' `no-restricted-imports` pattern and the `eslint.determinism.cjs` preset; forbid ws, node:*, DOM, bots, apps. Add net to root `test` filter, `typecheck:net`, lint and `build:prerequisites`. Placeholder `index.ts` with a smoke test. Edit shared root package.json minimally (cross-SP rebase risk).
Done when: `pnpm lint`, `typecheck`, `test`, `build` include net and pass; a deliberately forbidden import fails lint locally; campaign goldens untouched.

## Task 2 — [M1] Message catalogue, versions, codec
What it is: the single wire contract (R1, Decisions 1, 5, 10, 11, 12).
What changes at a high level: `version.ts` (`PROTOCOL_VERSION` int), `messages.ts` with all C>S and S>C types in the PRD catalogue (incl. `room.closed{reason}`, rich `lobby.state`, `start` with `youPlayer:null` for spectators, lobby `seat.status`, no time-limit field in `lobby.update`) and the full error-code list; `codec.ts` JSON encode with size helper (identical-bytes broadcast string). Types only, no validation yet.
Amended 2026-10-29: v2 message additions are SP07's, layered on this catalogue.
Done when: every message type has a typed constructor/encode path; type tests compile; encode of an empty tick is the compact `{"t":"tick","n":N}` form.

## Task 3 — [M1] Strict parse/validate
What it is: `parseClientMessage` / `parseServerMessage` (R2, Decision 4, Risk: hash format, oversized indices).
What changes at a high level: hand-written validators that copy only known fields (no `__proto__` leakage); client msgs reject unknown fields/types and any `player` on `cmd`; server msgs tolerate unknown fields and ignore unknown `t`; size limit; nick/token/code/hash (`/^[0-9a-f]{16}$/`, tick multiple of 20) /auth length checks; return `{ok,msg}` or `{ok:false,code}`, never throw. Round-trip tests for every message type.
Amended 2026-10-29: SP07 extends server-message validation to accept `Forfeit`; client `cmd` validation unchanged (clients cannot inject it).
Done when: malformed, oversized, non-JSON, unknown-field, injected-`player` and proto-pollution inputs all return codes; every message round-trips; no throws under fuzz-style table.

## Task 4 — [M1] Handshake version checks
What it is: R3 and Decision 6 — mismatched builds refused at hello.
What changes at a high level: pure `checkHello(hello, serverVersions)` returning `welcome` data or `error{version-mismatch}` carrying server versions. Exact match for protocol, schema, content; rules compared major.minor only (same as `playReplay`); `versions.bot` logged-only, never a refusal. `auth` ignored.
Done when: tests refuse each of protocol/rules major/rules minor/schema/content mismatch, accept patch-only rules diff and any bot version, and ok-path yields `welcome`.

## Task 5 — [M1] CommandLog
What it is: bounded server log matching `ReplayRecord.commands` shape (Decision 8).
What changes at a high level: `log.ts` flat `{tick,cmd}[]`, hard caps (`timeLimitTicks + 200` ticks, ~20k entries) with explicit overflow result, `range(from,to,maxTicks)` chunking (<=2000 ticks), checkpoint store (<=480 entries) for hash comparison.
Done when: append/range/cap tests pass; chunk boundaries cover all ticks without gap or overlap; log is directly consumable by `playReplay`.

## Task 6 — [M1] LockstepServer
What it is: pure, timer-free scheduler (R4, R5, R8 detect, R10 input).
What changes at a high level: `submit(player,cmd)` validates, stamps player from sender seat, targets `nextTick + inputDelay` (default 3, configurable 1..10, rejects out of range); rejects spectator/empty/bot seats (`not-your-seat`) and out-of-range indices; `closeTick(botCmds?)` pops buffer, appends bot cmds, logs, increments; `recordCheckpoint` / `onHash` returns ok or desync.
Done when: tests assert `next+3` stamping, injected-`player` rejection, logged cmd carries sender player, bots land on current tick, hash mismatch yields desync, ordering is arrival order.

## Task 7 — [M1] LockstepClient
What it is: queue-only client scheduler (R6, Decision on ownership: does not own or step the Sim).
What changes at a high level: `push(msg)` queues contiguous `tick`/`ticks`/`catchup` entries; gap or duplicate flagged as protocol error requesting resync; `drain(maxSteps)` returns `{n,cmds}[]` never ahead of received ticks; `after(n)` returns `hash` message when `(n+1)%20===0`; `queued()` exposed; outgoing cmd has no tick, no prediction.
Done when: tests show tick N is never released before it arrives, gaps/duplicates flagged, hash emitted at the right cadence and tick value, empty ticks handled.

## Task 8 — [M1] Outcome adapter (toWireOutcome)
What it is: only file touching SP01 types (R10, interface assumption).
What changes at a high level: `outcome.ts` with `EndOutcome` and `toWireOutcome(view.over)` mapping result/winnerTeam/reason/ranking; `end` message carries outcome, finalTick, finalHash. Clients display, never derive. Any SP01 rename touches only this file.
Done when: adapter tests cover win, draw, timeout, elimination; typecheck against SP01's actual `view.over` shape passes.

## Task 9 — [M1] Server/client lockstep integration + replay test
What it is: end-to-end acceptance in-memory (M1 criteria).
What changes at a high level: test harness with one LockstepServer, referee sim and two LockstepClients with own sims, scripted cmds, no sockets; compare `sim.hash()` at every 20th tick and final; feed the server log through `playReplay`; server-side checkpoint comparison passes; export public surface in `index.ts`.
Amended 2026-10-29: client scheduler must also hold at a server-announced frozen tick (SP07 pause); no change to shipped behaviour here.
Done when: both clients' hashes equal referee at each checkpoint and at end, log passes `playReplay`, and `pnpm test` covers it.

## Task 10 — [M2] Catch-up runner + local-join-late helper
What it is: R7 never-stall catch-up. Amended 2026-10-29: now also the M2 path for mid-match reconnect (SP07 minimum reconnect: full catch-up to the frozen tick, then resume), not only spectator/late join.
What changes at a high level: `catchup.ts` `createCatchup(level, seed)` returning `{sim, feed(chunk), run(budgetMs, now)}` with injected `now`, `{events:false}` stepping, progress `{tick,target}`, hand-off to live queue without gap; caller-supplied `resolveLevel`; `start.simHash` mismatch throws `version-mismatch`. Also the local-join-late helper (M1-usable by tests).
Done when: from tick 0 under a 6 ms budget the sim reaches the server hash; joined-late client resumes live with no gap; simHash mismatch throws.

## Task 11 — [M2] Rate limiter
What it is: R9 per-seat abuse limits. Amended 2026-10-29: SP07 control messages (`pause`/`resume`/`quit`/app `ping`) share the per-connection bucket; the SP07 command-log system reserve is SP07's.
What changes at a high level: `ratelimit.ts` token/window limiter (injected time) for cmds/tick, cmds/s, hash and ping; integrate into `LockstepServer.submit` returning `rate-limited`; out-of-range indices count toward the limit; abuse escalates to error then disconnect advice.
Done when: tests trigger `rate-limited` for each limit, normal play stays under, and real-match cmd volume stays within log caps.

## Task 12 — [M2] Lagging-client `ticks` batching
What it is: R11 slow socket never delays others.
What changes at a high level: server-side helper producing one `ticks` batch from CommandLog for a client marked behind (caller decides via bufferedAmount >256 KB), then resume live; client `push` accepts `ticks` contiguous with its queue.
Done when: tests show a lagging client receives a gap-free batch then live ticks, and other clients' tick sequence/timing output is unchanged.

## Task 13 — [M3] Auto-resync on desync
What it is: R8 auto-resync (M3). Amended 2026-10-29: stays M3; only reconnect catch-up moved to M2 (SP07).
What changes at a high level: on `desync`/protocol error, LockstepClient emits `resync` and exposes a reset path; server answers with full catch-up from the log; reuse catch-up runner. Caller (SP05) rebuilds the Sim.
Done when: a forced hash mismatch yields `desync` then the client converges to the server hash after full resync in test.
