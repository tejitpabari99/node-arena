---
status: approved
summary: M3 SP10 — report-only load smoke. A script runs N (default 20) concurrent bot-filled rooms against the real server loop (in-process, or a URL for owner runs) and reports tick lateness p50/p99, RSS and CPU per room against targets p99 < 25 ms, RSS < 200 MB. /healthz gains rss/cpu/p50. Not a CI gate.
date: 2026-10-30
---
# PRD: SP10 Load smoke

Repo/branch: node-arena / `feat/pvp-m3` · Milestone: **M3** · Depends on: SP04 (server, clock, `/healthz`), SP06 (Fly sizing, `PVP_OPS.md`) · Independent of SP08/SP09/SP11 (no wire change; may land in any order) · Feeds: SP08 (resume-from-checkpoint decision), SP11 (acceptance evidence).
Owns: `apps/server/scripts/load-smoke.ts` (new), root `package.json` script `load:smoke`, `apps/server/src/main.ts` (`/healthz` fields only), `apps/server/test/load-smoke.test.ts` (tiny), `docs/PVP_OPS.md` (capacity section), report attachment under this folder.

## TL;DR
SP04 sized the box (shared-cpu-1x, 256 MB, `--max-old-space-size=192`, `MAX_ROOMS` 40) from estimates and never measured it. SP10 adds a script that drives 20 concurrent bot-filled matches through the real `startServer` and prints a table: tick lateness p50/p99, RSS, CPU as a share of one vCPU and per room, against p99 < 25 ms and RSS < 200 MB. It informs capacity and the `MAX_ROOMS` default; it never fails a build.

## Problem
- Targets are claimed in SP04 R19 / TASKS#20 ("20-room smoke shows loop lateness p99 < 25 ms and RSS < 200 MB, CPU/room reported") with no tool behind them.
- A single timer (`clock.ts`, `TICK_MS` 50, `MAX_CATCHUP` 4) steps every running room's sim, bots and fan-out on one Node thread, so lateness is the one honest overload signal. Only a rolling p99 over the last 400 wakes (`LATENESS_SAMPLES`) is exposed (`/healthz lateP99Ms`); no p50, RSS or CPU.
- SP07 notes ~2.4 s CPU for a worst-case full-log replay (reconnect/resync catch-up is replayed client-side, but the server still serializes the chunks); no data on its effect on a loaded loop.
- Fly shared-cpu-1x is a burstable slice, so laptop numbers may not transfer.

## Goals / Non-Goals
Goals: reproducible local number for "N rooms"; honest pass/fail against the two targets; output usable as acceptance evidence (JSON + table); owner-runnable against Fly; healthz carries the same signals for live observation.
Non-goals: CI gate (noisy shared runners); browser clients or real sim on the client side; autoscaling; multi-machine; load on the Firebase web app; fixing perf (a failure produces a follow-up, not a block).

## Requirements

| ID | Requirement |
|---|---|
| L1 | `pnpm load:smoke [-- --rooms 20 --seconds 60 --level <id> --json <path> --url <wss> --strict]`; runs under `tsx` from `apps/server/scripts/`. Defaults: 20 rooms, 60 s steady state after all rooms are running. |
| L2 | Default mode is **in-process**: `startServer` on port 0 with the real content and an `info`-level-suppressed logger, so the production clock, room manager, match controller, bots, lockstep, rate limits and ws framing are exercised. Thin ws clients (not browsers, no client sim) on loopback. |
| L3 | One client per room as host: `hello` (distinct token), `room.create`, `lobby.update` with all other seats `bot` (difficulty mix), `lobby.ready`, `lobby.start`; then it consumes `tick`/`ticks` frames, sends `ping` every 3 s (heartbeat 7 s) and no `cmd`/`hash`. Levels cycle over the shipped PvP levels so Duel S, Duel M and Cross (4 seats) all appear. |
| L4 | Per-IP limits (8 conns, 5 creates/min per `Fly-Client-IP`, `limits.ts`) would block 20 rooms from loopback; in-process mode sets a distinct `Fly-Client-IP` header per client (`main.ts clientIp` honors it). In URL mode the proxy overwrites it, so rooms are capped at the limit (ramp 1 room/13 s, max 5) unless the owner runs from several IPs. M2 hardening limits (a0a63c4) also apply: 30 new connections per IP per min (ramp and churn must stay under it, or use distinct `Fly-Client-IP` per client in-process) and catch-up attaches limited to 1 per player per 5 s and 20 per IP per min (any reconnect/resync/spectator-join churn scenario must space attaches accordingly, else it measures the limiter). |
| L5 | Metrics, sampled every 2 s: clock `lateness()` p50/p99 (max over samples and final), `process.memoryUsage().rss` and `heapUsed`, event-loop delay p99 (`monitorEventLoopDelay`), `process.cpuUsage()` delta over wall time = CPU % of one vCPU, divided by running rooms = CPU per room; frames sent/s; `running` room count; any `error`/`room.closed` received by clients. |
| L6 | Verdict lines (PASS/FAIL, never exit non-zero without `--strict`): p99 < 25 ms; peak RSS < 200 MB; all N rooms stayed `running` for the whole window; zero unexpected `room.closed`/`error`. Exit codes: 0 report, 1 only with `--strict` and a FAIL, 2 harness error. |
| L7 | Optional scenarios (flags): `--spectators K` attaches K spectators per room at the midpoint (mid-match catch-up cost; this is the data SP08's non-goal "resume-from-checkpoint" waits on); `--churn` ends and restarts rooms to expose leaks. After the run, rooms are closed and the script reports `rss` after a forced GC (`--expose-gc`) as an informational leak delta. |
| L8 | `/healthz` adds `rss` (bytes), `lateP50Ms`, `cpuMs` (cumulative user+system from `process.cpuUsage()`). Additive JSON; existing keys unchanged; `shutdown.test.ts` shape test extended. In `--url` mode the script derives server-side RSS/CPU/lateness from healthz deltas. |
| L9 | A tiny node test (`load-smoke.test.ts`, 3 rooms, ~5 s, no thresholds) asserts the script's core runs and rooms tick. It exists to prevent script rot and runs inside `pnpm test`. |
| L10 | `PVP_OPS.md` gains a "Capacity" section: how to run, how to read the table, the measured numbers, and what to do on FAIL (lower `MAX_ROOMS`, raise VM). |

## Architecture
```
load-smoke.ts
  parse flags -> mode in-process | url
  in-process: startServer(parseConfig({PORT:'0', ALLOW_NO_ORIGIN:'1', MAX_ROOMS:N+5}))
  rooms[i] = BotRoomClient(i): ws + hello + create + configure + start
  sampler (2 s): server.clock.lateness(), process.* ; url mode: GET /healthz
  report: table to stdout + JSON {config, samples[], summary, verdict}
```
`startServer` currently returns `{port, content, close, shutdown}`; to read `clock.lateness()` in-process the harness uses `/healthz` (loopback HTTP, same code as production) rather than reaching into internals, so both modes share one metric path. That is why L8 adds `lateP50Ms`/`rss`/`cpuMs` to healthz; the harness's own `process.memoryUsage()` is reported separately as "harness+server (same process)" in in-process mode and labelled an upper bound.

Fidelity limits (stated in the report header): clients run no sim, send no `hash`/`cmd`, so the hash-check path, command validation and per-client backpressure are under-exercised; bots run server-side exactly as in production (`botTick`), which dominates CPU. A follow-up could add real `cmd` traffic. In-process mode shares one CPU with the harness, so numbers are pessimistic for the server and optimistic for nothing; `--spawn` (child process on `dist/main.js`, measured via healthz) is a documented fallback if in-process proves too noisy. [DEFERRED]

Calibration: the 8 min map time limit and `MATCH_CAP_EXTRA_MS` mean a 60 s window sits in mid-match; bots rarely end a Duel S in under a minute. If a room ends early the harness restarts it via `rematch` to hold N constant.

## Versions
- RULES_VERSION / PROTOCOL_VERSION / content / BOT: no change (script uses existing wire; healthz is HTTP, outside the protocol).
- Absorbs: SP04#20 load-smoke half and R19; closes the "load test" non-goal in SP06.

## Decisions

| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Gate | Report-only; `--strict` opt-in | Required CI check | Shared runners are noisy; flaky red hurts more than it informs |
| D2 | CI | Only the tiny L9 test in `pnpm test` (3 rooms, no thresholds) | Loose-threshold CI job; `workflow_dispatch` job with JSON artifact | Prevents rot, cannot flake on timing [RESOLVED: orchestrator default] ; dispatch job [DEFERRED] |
| D3 | Process model | In-process default | Child process only | Fast, debuggable; `--spawn` fallback [DEFERRED] |
| D4 | Metric source | `/healthz` (new fields) | Reach into clock internals | One path for local and Fly; doubles as live observability |
| D5 | Clients | Thin ws bots, no sim | Playwright / full sim clients | Measures server cost; cheap enough for 20 rooms |
| D6 | Targets | p99 < 25 ms, RSS < 200 MB | Looser | From SP04 R19; 25 ms = half a tick; 200 MB leaves ~56 MB headroom on the 256 MB VM (heap capped 192 MB) |
| D7 | Prod run | Owner, <= 5 rooms/IP | Relax limits for the test | Do not weaken production limits for a test |

## Manual steps (owner-only)
1. Run `pnpm load:smoke -- --url wss://<app>.fly.dev --rooms 5` against the deployed Fly app (limited to the per-IP caps; a 20-room Fly run needs several client IPs or a temporary env bump of `MAX_ROOMS`/limits, owner's call).
2. Compare Fly `lateP99Ms`/`rss` from `/healthz` with the local numbers; record both in `PVP_OPS.md`.
3. Decide `MAX_ROOMS` (currently default 40) and VM size from the numbers.

## Risks / Open Questions
- Local pass does not imply Fly pass (shared-cpu burst credits/throttling). [DEFERRED: owner verifies at first deploy via Manual steps 1-3; fallback: lower `MAX_ROOMS` / bigger VM]
- `LATENESS_SAMPLES` window is the last 400 clock wakes (~20 s), so a spike can age out between 2 s samples; harness keeps the max across samples and its own event-loop delay histogram. [RESOLVED]
- 40 rooms (`MAX_ROOMS`) may exceed what 1 shared vCPU can step; if 20 already fails, the follow-up is a lower cap, not a gate. [RESOLVED: report-only]
- Rooms are held by `WeakMap`s in `match.ts` (`servers`, `sims`, `ends`, `feeds`), so dropped rooms are collectable, but pause/clock timers are not torn down on every close path (see SP09 D7); `--churn` leak delta may implicate that. [RESOLVED: SP09 fixes the hook; SP10 measures]
- Bot difficulty mix changes CPU a lot; the default mix and seed are recorded in the JSON for comparison. [RESOLVED]
- CI test timing: 3 rooms for 5 s must not assert on lateness. [RESOLVED]

## Acceptance Criteria
1. `pnpm load:smoke` prints a table and writes JSON with config, per-sample series, summary and PASS/FAIL verdicts; exit 0 on FAIL without `--strict`, 1 with it.
2. Default run holds 20 rooms in `running` for 60 s with no unexpected `room.closed`/`error`; the report shows p50/p99 lateness, peak RSS, CPU % and CPU per room.
3. `/healthz` returns `rss`, `lateP50Ms`, `cpuMs` with numeric types; extended shape test passes.
4. Per-IP limits are respected in URL mode and bypassed only through the loopback header in in-process mode.
5. `--spectators` and `--churn` run and are reflected in the report; post-run forced-GC RSS delta printed.
6. `load-smoke.test.ts` passes in `pnpm test`; script type-checks and lints with the server package.
7. First measured results (this machine) attached to this folder and summarized in `PVP_OPS.md`; if a target fails, a follow-up item is recorded, not a blocked merge.
