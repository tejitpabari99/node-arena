---
status: in-progress
summary: Both tasks in progress for attempt-correlation correctness fix and review
date: 2026-10-24
---
# Tasks: Stream Stop and Reset

Source of truth: [PRD.md](PRD.md). The approved design preserves original spending/admission controls and cooldown while adding shared Stop/Reset. Validation requires ephemeral mocked/injected services and Node-only fixtures. Optional actual fake-driver smoke uses dedicated alternate ports only after lock checks; primary services remain intentionally off and untouched. Tasks were generated as todo; the principal then marked Task 1 in-progress for imminent dispatch.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Reusable lifecycle and guarded HTTP Stop/Reset | none | in-progress |
| 2 | Shared viewer controls, verification and runbook | 1 | in-progress |

## Task 1 — Reusable lifecycle and guarded HTTP Stop/Reset

What it is / what it means: Add reusable Stop and quiescent Reset without changing natural completion, spending limits or driver ownership.

What changes at a high level: Build cancellation-first startup and idempotent owned-process cleanup, with stopped outcome protected from late exits. Avoid cyclic pending-start/Stop promises. Install and expose UUID attempt correlation before starting; retain failed-preflight correlation until Reset and reject conditional stale Stop before side effects. Validate optional headers, preserving missing-header compatibility. Add guarded exact POST controls and shared reset broadcasts after clearing relay/frame cache. Retain original cooldown deadline, admission history and privacy boundaries. Boot, GET/WS/SSE and Reset must not run a driver or credit preflight; only explicit Start may do so.

Done when: Meaningful TDD covers lock/preflight/port/persistence/live cancellation, races, repeated Stop/concurrent close and Node-only descendant cleanup. Reset conflicts while unsafe, never spawns or spends, and cannot bypass cooldown/IP/daily/floor controls. Ephemeral HTTP tests verify 400/403/405/409/413, invalid-header/no-spawn, correlation privacy, conditional Stop against a newer run, and zero spawns/preflight on boot, GET, connections and Reset. No primary ports/services or paid calls are touched.

## Task 2 — Shared viewer controls, verification and runbook

What it is / what it means: Expose Stop during starting/live and Reset immediately after explicit Stop, disabled until cleanup completes; make every viewer observe the same result.

What changes at a high level: Render Stopped, clear old frame/log/cursor and metadata on Reset, and return to Ready subject to retained cooldown. Guard missed reset events, in-flight JPEG decoding and old-socket blobs delivered after Reset; replace video connections and reject stale socket callbacks. Correlate own pending Start/Stop with fresh UUIDs, preserve intent through unrelated state and retire it on matching settlement even idle/null. Ignore stale HTTP. Document controls and safe verification. Page open/reload, connections and Reset never automatically Start.

Done when: Two-viewer tests prove shared states, controls, cooldown, stale SSE/JPEG/socket rejection, reconnect behavior and fresh Start. Correlation tests cover failed preflight with delayed 503, unrelated reset/start and stale conditional Stop. Initial-load/reload/Reset browser checks issue zero POST `/start`; only Start clicks launch. Natural-end behavior stays unchanged. Required mock/injected tests remain; optional actual fake-driver smoke uses 4176/9226/8789 and a dedicated lock after global-lock checks. Preserve stopped primary and SP04 ports; no paid calls or hosting before merge. Review/fix, then open the user-requested PR against kane-cli.
