---
status: in-progress
summary: Two dependent implementation tasks; Task 1 dispatched for lifecycle and HTTP controls
date: 2026-10-24
---
# Tasks: Stream Stop and Reset

Source of truth: [PRD.md](PRD.md). The approved design preserves original spending/admission controls and cooldown while adding shared Stop/Reset. Validation uses ephemeral mocked/injected services and Node-only fixtures; hosted primary and its resources remain untouched. Tasks were generated as todo; the principal then marked Task 1 in-progress for imminent dispatch.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Reusable lifecycle and guarded HTTP Stop/Reset | none | in-progress |
| 2 | Shared viewer controls, verification and runbook | 1 | todo |

## Task 1 — Reusable lifecycle and guarded HTTP Stop/Reset

What it is / what it means: Add reusable Stop and quiescent Reset without changing natural completion, spending limits or driver ownership.

What changes at a high level: Build cancellation-first startup and idempotent owned-process cleanup, with stopped outcome protected from late exits. Avoid cyclic pending-start/Stop promises. Add guarded exact POST controls and shared reset broadcasts after clearing relay/frame cache. Retain original cooldown deadline, admission history and privacy boundaries.

Done when: Meaningful TDD covers lock/preflight/port/persistence/live cancellation, races, repeated Stop/concurrent close and Node-only descendant cleanup. Reset conflicts while unsafe, never spawns or spends, and cannot bypass cooldown/IP/daily/floor controls. Ephemeral HTTP tests verify 403/405/409/413 and privacy; no production ports, Chrome, preview or paid calls are touched.

## Task 2 — Shared viewer controls, verification and runbook

What it is / what it means: Expose Stop during starting/live and Reset immediately after explicit Stop, disabled until cleanup completes; make every viewer observe the same result.

What changes at a high level: Render Stopped, clear old frame/log/cursor and metadata on Reset, and return to Ready subject to retained cooldown. Guard missed reset events, in-flight JPEG decoding and old-socket blobs delivered after Reset; replace video connections and reject stale socket callbacks. Document controls and safe verification.

Done when: Two-viewer tests prove shared states, controls, cooldown, stale SSE/JPEG/socket rejection, reconnect behavior and fresh Start. Natural-end behavior stays unchanged. Use mocked JPEGs, injected ephemeral backend and optional Playwright against mocks only; preserve running primary services and prepare the result for review and a PR against kane-cli.
