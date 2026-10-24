---
status: approved
summary: Stop ends the shared run; Reset clears stopped presentation and returns to Ready without bypassing admission or cooldown
date: 2026-10-24
---
# PRD: 01 Stream Stop and Reset

Branch: `feat/kane-stream-controls`; base `origin/kane-cli` at `8fe6196`. User confirmed: **“Return to Ready; Start launches a fresh match.”** This records the principal's bounded design; no additional product decisions are open.

## TL;DR

Add Stop while a run is starting or live. Stop ends all play and cleans owned driver, Chrome, preview and profiles; all viewers see Stopped. Reset appears immediately after Stop is requested, remains disabled during cleanup, then clears the old shared video/logs/metadata. Reset returns to Ready when the original cooldown permits; Start alone launches a fresh match. Reset never spends credits or clears spending/admission history.

## Problem

The public viewer only offers Start. Its controller exposes `start`, `snapshot`, `end` and permanent `close`; there is no reusable cancellation or reset API. `end()` handles active-process teardown but does not cancel an inactive start/preflight. A Stop implemented only through `end()` could allow a delayed start to spawn after the viewer believes it stopped.

## Goals / Non-goals

Goals: explicit shared Stop/Reset behavior, safe cancellation throughout startup, complete owned-process cleanup, consistent reconnecting viewers, preserved existing limits.

Non-goals: pause/resume, partial match carryover, budget/admission reset, automatic Kane work on Reset, public game/CDP input, SP03 driver internals, dependencies or root package changes, changes to normal match completion, deployment before merge.

## Requirements

### R1 Shared controls

- Stop is visible during `starting` and `live`; clicking it stops play rather than pausing. Repeated requests are idempotent.
- All viewers see Stopped for an explicitly stopped run. Reset appears immediately after Stop is clicked/requested and is disabled until cleanup completes. Existing failure/normal-end behavior remains unchanged; Reset visibility is required after explicit Stop only.
- Reset clears the old run's frame, pending decoded JPEG, logs, replay cursor and run metadata for all viewers. When cooldown has expired, display Ready with Start available subject to normal admission. During remaining cooldown, clear presentation but retain cooldown until its original expiry.
- Start after Reset boots a fresh game. Reset never launches a driver, checks/consumes credits or starts a match.

### R2 Reusable lifecycle cancellation

Add controller `stop()` and `reset()`; allow terminal outcome `stopped`. Do not use permanent `close()` as Stop.

Create a per-start cancellation token/controller **before emitting `starting`**. Stop synchronously invalidates/aborts that attempt before its first await. Verify cancellation after every asynchronous boundary, including resource-lock acquisition, credit preflight, port validation, log-directory creation and PID identity/persistence, and before the paid-capable driver spawn. Stopping an inactive `starting` attempt must prevent any later driver appearance.

Stop handles both pending start and active play. Reuse existing active `end` cleanup while adding safe inactive-start cancellation. Concurrent Stop, repeated Stop, close, driver exit and cleanup are idempotent; no subsequent start may proceed until cleanup is complete. Late driver exit must not overwrite `stopped`.

Retain bounded identity-based teardown of the actual driver, owned Chrome/preview descendants and validated profiles, including fallback launch descendants. Never kill foreign processes or remove unrelated profiles. Snapshot/state broadcasts must represent the stopped run and cleanup progress consistently.

### R3 Reset and preserved controls

Reset returns 409 while active, starting, ending, or a start attempt remains pending. When quiescent it is idempotent. Clear `runId`, `startedAt`, `endsAtMax` and `outcome`; clear relay and cached frame before broadcasting reset/state or serving replay. Preserve the original cooldown timer/deadline and daily/per-IP admission history, credit floor and all existing caps. Reset during cooldown clears presentation while staying in cooldown; it cannot make a later Start eligible early.

### R4 HTTP boundary

Add exact POST `/stop` and POST `/reset` routes. Apply the same Origin/Host validation, body limit <=1 KiB, header limits, request timeouts and generic errors as `/start`. Reject wrong methods with 405, invalid origins with 403, active reset conflicts with 409 and oversized bodies with 413. Keep responses free of private paths, balances, process details and raw driver output. Existing static allowlist, CSP, text-only log rendering, filtered events and read-only CDP method facade remain intact; no public browser-control or test-build exposure.

### R5 Viewer consistency

Broadcast reset/state to every viewer. Clear relay/cache before that broadcast and any subsequent replay. A reconnecting client that missed the reset event must detect prior non-null run ID becoming null and clear stale canvas/log/cursor itself; the existing null-ID `starting` transition must not cause reset/reconnect loops. Keep generation invalidation so an older in-flight JPEG decode cannot redraw after Reset. Controls and disabled states follow shared server state, including two simultaneous viewers.

## Architecture

Changes stay in `tools/kane/stream/run.mjs`, `server.mjs`, `public/**`, stream tests and runbook. The controller owns reusable cancellation, explicit stopped outcome, quiescent reset and unchanged admission/cooldown accounting. Server routes use the existing bounded decoder and guards, clear shared relay/screencast cache, and broadcast state/reset. Viewer controls map these states to Stop/Reset and invalidate old display work. Existing driver ownership and public relay/CDP contracts remain unchanged.

Delivery remains two dependent implementation units: lifecycle/HTTP plus TDD, then viewer controls/two-viewer verification/runbook. This is sequencing only; `TASKS.md` is generated separately after principal review. Review/fix the result, then open a PR against `kane-cli`. Keep hosted primary unchanged until the feature is merged.

## Decisions

| # | Decision | Choice | Reason |
|---|---|---|---|
| 1 | Reset behavior | Return to Ready; Start starts a fresh match | Explicit user confirmation |
| 2 | Stop semantics | End all play and clean owned resources | Requested Stop, not pause |
| 3 | Admission/cooldown | Preserve original limits and deadline | Reset cannot bypass spending controls |
| 4 | Workspace | New linked feature worktree | Primary checkout serves the current real run |
| 5 | Validation | Ephemeral mock/injected services and Node-only fixtures | Protect active production browser/resources |

## Manual steps

No owner setup is required for this bounded change. Deployment waits for merge and a separate hosting instruction; implementation/review must not change the running primary checkout or its uncommitted deployment documentation.

## Risks / Open Questions

- [RESOLVED: synchronous cancellation before awaits plus post-await checks] Startup cancellation must not permit delayed paid spawn.
- [RESOLVED: identity-owned bounded cleanup, including fallback descendants] Stop may not affect another worktree's processes.
- [RESOLVED: generation invalidation plus non-null-to-null run-ID handling] Lost reset events and late JPEG decoding may not restore stale content.
- [RESOLVED: original deadline and admission state retained] Reset cannot shorten cooldown or replenish daily/IP budgets.
- [DEFERRED] Pause/resume and automatic new-match Reset.

## Acceptance criteria

- Meaningful TDD covers Stop during resource-lock wait, preflight, port checks, identity/persistence and live play; deferred boundaries cannot spawn after cancellation. Repeated Stop, late exits, concurrent close and cleanup preserve stopped semantics and prevent premature restart.
- Node-only detached-process fixtures prove owned descendant/profile cleanup without touching foreign processes; no real Chrome/preview/Kane calls.
- Reset conflicts while unsafe, is idempotent when quiescent, clears metadata/cache/relay, and cannot bypass original cooldown, IP/daily admission or credit floor.
- HTTP tests cover 403/405/409/413, route/body limits and privacy. Existing natural completion remains unchanged.
- Two-viewer UI tests verify Stop/Reset visibility/disabled states, shared Stopped, shared Reset, stale SSE replay/cursor and JPEG decode invalidation, reconnect-after-missed-reset behavior and fresh Start behavior.
- New tests use ephemeral HTTP, injected process operations, mocked JPEGs and Node-only fixtures. User permits Playwright checks against a mock backend only. No production 8787/4175/9225, other 4173/5173, active global runtime lock, actual Chrome/preview or paid calls are touched.
