---
status: approved
summary: Approved shared stream Stop/Reset design; Reset returns to Ready and preserves spending controls
date: 2026-10-24
---
# Stream controls

| Sub-project | Design | Status | Depends on |
|---|---|---|---|
| 01 Stream controls | [PRD](01-stream-controls/PRD.md) | approved | Existing merged SP05 stream (`8fe6196`) |

One bounded sub-project. Planned order: lifecycle/HTTP and cancellation tests → viewer controls/two-viewer verification/runbook → reviews/fixes → PR targeting `kane-cli`. No task file yet; principal reviews the PRD first.

Locked: Stop ends all play; Reset appears after Stop and returns to Ready without launching a match; Start launches a fresh match. Preserve cooldown/deadline and daily/IP/credit controls. Reset cannot complete before cleanup. All viewers clear old run presentation, including reconnects and late JPEG decoding.

Work only in `feat/kane-stream-controls` linked worktree. Hosted primary remains on `kane-cli` with its separate deployment docs and active resources unchanged. Verification uses mock/injected ephemeral services and Node-only fixtures; Playwright, if used, targets mock backend only. No real Chrome/preview/Kane calls or deployment before merge. No unresolved design questions.
