---
status: draft
summary: 6 M3 tasks - healthz rss/p50/cpu, in-process load harness + report, URL mode, spectator/churn scenarios, tiny CI test, first measured run + PVP_OPS capacity.
date: 2026-10-30
---
# Tasks: SP10 Load smoke
Source of truth: docs/agent_files/feat-pvp-20261028-1435/10-load-smoke/PRD.md. Report-only script (never a CI gate); no wire, RULES, PROTOCOL, content or BOT change; independent of SP08/SP09/SP11 and may land in any order. No [OPEN] items in the PRD.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M3] `/healthz` adds `rss`, `lateP50Ms`, `cpuMs` | none | todo |
| 2 | [M3] `load:smoke` in-process harness, sampler, report, verdicts | 1 | todo |
| 3 | [M3] URL mode and per-IP limit handling | 2 | todo |
| 4 | [M3] `--spectators` and `--churn` scenarios, forced-GC delta | 2 | todo |
| 5 | [M3] `load-smoke.test.ts` anti-rot test | 2 | todo |
| 6 | [M3] First measured run, report attachment, PVP_OPS Capacity | 3, 4, 5 | todo |

## Task 1 — [M3] `/healthz` adds `rss`, `lateP50Ms`, `cpuMs`
What it is / what it means: One metric path for local and Fly runs, and live observability (L8, D4, AC3).
What changes at a high level: `main.ts` `/healthz` gains `rss` (bytes), `lateP50Ms` (from the clock's lateness window) and `cpuMs` (cumulative user+system `process.cpuUsage()`). Additive JSON, existing keys unchanged, no protocol change. Extend the `shutdown.test.ts` shape test.
Done when: healthz returns the three numeric fields and the extended shape test passes.

## Task 2 — [M3] `load:smoke` in-process harness, sampler, report, verdicts
What it is / what it means: The tool that backs the SP04 R19 targets (L1, L2, L3, L5, L6, D1, D3, D5, AC1, AC2).
What changes at a high level: New `apps/server/scripts/load-smoke.ts` plus root `load:smoke` script (run under `tsx`). Flags `--rooms/--seconds/--level/--json/--strict`, defaults 20 rooms, 60 s steady state. Starts `startServer` on port 0 with real content and a quiet logger; one thin ws host client per room (hello, create, lobby bots, ready, start, ping every 3 s, no `cmd`/`hash`), levels cycled over Duel S/M and Cross; distinct `Fly-Client-IP` header per client (L4 in-process half). Samples every 2 s via loopback `/healthz` plus harness `monitorEventLoopDelay` (peak across samples). Rooms that end early are re-run via `rematch`. Prints table and JSON (config, seed and bot mix, samples, summary, verdicts) with fidelity-limits header; PASS/FAIL lines for p99 < 25 ms, peak RSS < 200 MB, all rooms running, no unexpected `room.closed`/`error`; exit 0/1 (strict)/2.
Done when: a default run prints the table, writes JSON, exits 0 on FAIL without `--strict` and 1 with it.

## Task 3 — [M3] URL mode and per-IP limit handling
What it is / what it means: Owner-runnable run against Fly without weakening limits (L4 URL half, L8 deltas, D7, AC4).
What changes at a high level: `--url wss://...` mode skips the in-process server, derives server RSS/CPU/lateness from `/healthz` deltas, and caps rooms to the per-IP limits (ramp 1 room per 13 s, max 5) while keeping new connections under 30/min and catch-up attaches within the 5 s per-player / 20 per-IP-per-min limiter. Header makes mode and any cap explicit.
Done when: URL-mode run against a local started server reports deltas and respects limits; header labels in-process numbers as an upper bound.

## Task 4 — [M3] `--spectators` and `--churn` scenarios, forced-GC delta
What it is / what it means: Mid-match catch-up cost and leak exposure (L7, AC5); the data SP08's resume-from-checkpoint non-goal waits on.
What changes at a high level: `--spectators K` attaches K spectators per room at the midpoint with attaches spaced under the catch-up limiter; `--churn` ends and restarts rooms. After the run rooms are closed and RSS after a forced GC (`--expose-gc`) is reported as an informational leak delta. Both reflected in table and JSON.
Done when: both flags run and appear in the report with the post-run GC RSS delta.

## Task 5 — [M3] `load-smoke.test.ts` anti-rot test
What it is / what it means: Keeps the script from rotting without being able to flake (L9, D2, AC6).
What changes at a high level: Tiny node test of the script core: 3 rooms for about 5 s, asserts rooms start and tick, no lateness or RSS thresholds. Runs inside `pnpm test`; script type-checks and lints with the server package.
Done when: the test passes in `pnpm test`, and typecheck/lint are green.

## Task 6 — [M3] First measured run, report attachment, PVP_OPS Capacity
What it is / what it means: Evidence and operator guidance (L10, AC7).
What changes at a high level: Run the default 20-room smoke (plus spectators and churn variants) on this machine; attach the JSON and table summary under this folder. `PVP_OPS.md` gains a "Capacity" section: how to run, how to read the table, measured numbers, FAIL actions (lower `MAX_ROOMS`, raise VM). A failed target is recorded as a follow-up item, not a blocker. Docs gate must pass.
Done when: report attached, Capacity section present, `pnpm check:docs` green.

## Manual steps (owner)
1. Run `pnpm load:smoke -- --url wss://<app>.fly.dev --rooms 5` against the deployed Fly app (a 20-room Fly run needs several client IPs or a temporary limit/`MAX_ROOMS` bump, owner's call).
2. Compare Fly `lateP99Ms`/`rss` from `/healthz` with local numbers; record both in `PVP_OPS.md`.
3. Decide `MAX_ROOMS` (default 40) and VM size from the numbers.
